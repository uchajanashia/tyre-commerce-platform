import { setTimeout as delay } from 'node:timers/promises';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuditEventDetail, AuditEventListResult, AuditEventSummary, AuditSafeField } from '@tyre/shared';

import type { IdentityRequest } from '../auth/identity-access.guard';
import { canonicalJsonText } from '../governance/canonical-json';
import { AuditCursorPayload, AuditCursorService, auditDomainHash, constantTimeAuditTextEqual } from './audit-cursor.service';
import { assertSafeAuditText, auditRegistryDigest, registeredAuditSchema } from './audit-event-registry';
import { AuditDatabaseService, RestrictedAuditTransaction } from './audit-database.service';
import { AUDIT_READER_CONFIG, AuditReaderConfig } from './audit-reader.config';
import { AuditEventListQueryDto } from './dto/audit-reader.dto';

interface ViewerContext {
  viewerId: string;
  sessionId: string;
  accountVersion: number;
  tokenVersion: number;
  minimumAuthContractVersion: number;
  securityControlVersion: number;
  authorizationGraphDigest: string;
}

interface DbViewerContextRow {
  viewerId: string;
  sessionId: string;
  accountVersion: number;
  tokenVersion: number;
  minimumAuthContractVersion: number;
  securityControlVersion: number;
  assignmentGraph: unknown;
}

interface NormalizedAuditQuery {
  occurredFrom: string;
  occurredTo: string;
  eventFamily?: string;
  outcome?: 'succeeded' | 'failed' | 'denied';
  actorId?: string;
  entityType?: string;
  entityId?: string;
  approvalRequestId?: string;
  approvalExecutionId?: string;
  serverCorrelationId?: string;
  causationId?: string;
  bulkOperationId?: string;
  bulkItemId?: string;
  source?: 'admin_api' | 'job' | 'webhook' | 'import' | 'system';
  retentionClass?: string;
  sortField: 'occurredAt' | 'eventType' | 'outcome';
  sortDirection: 'asc' | 'desc';
  pageSize: number;
}

interface AuditRow {
  id: string;
  eventType: string;
  schemaVersion: number;
  registryDigest: string;
  occurredAt: Date;
  actorId: string;
  actorType: string;
  sessionId: string | null;
  subjectType: string;
  subjectId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  entityVersion: string | null;
  authorizationScopeKind: string;
  scopeMatchMode: string;
  scopeResolverId: string;
  scopeResolverVersion: number;
  authorizationPolicyVersion: number;
  outcome: 'succeeded' | 'failed' | 'denied';
  reasonCode: string | null;
  safeBefore: unknown;
  safeAfter: unknown;
  safeMetadata: unknown;
  approvalRequestId: string | null;
  approvalExecutionId: string | null;
  bulkOperationId: string | null;
  bulkItemId: string | null;
  serverCorrelationId: string;
  causationId: string | null;
  clientRequestId: string | null;
  source: 'admin_api' | 'job' | 'webhook' | 'import' | 'system';
  retentionClass: string;
}

@Injectable()
export class AuditReaderService {
  constructor(
    private readonly database: AuditDatabaseService,
    private readonly cursor: AuditCursorService,
    @Inject(AUDIT_READER_CONFIG) private readonly config: AuditReaderConfig,
  ) {}

  assertEnabled(): void {
    if (!this.config.enabled) throw new NotFoundException({ code: 'AUDIT_READER_DISABLED' });
  }

  async list(user: IdentityRequest['user'], query: AuditEventListQueryDto): Promise<AuditEventListResult> {
    this.assertEnabled();
    try {
      return await this.database.withReaderContext(user, async (tx) => {
      const viewer = await this.currentViewer(tx, user);
      let continuation: AuditCursorPayload | undefined;
      if (query.cursor) {
        try {
          continuation = this.cursor.decrypt(query.cursor);
        } catch {
          await this.recordCursorRejection(user, query.cursor, 'INVALID_CURSOR');
          throw new BadRequestException({ code: 'INVALID_AUDIT_CURSOR' });
        }
      }
      const asOf = continuation ? new Date(continuation.asOfOccurredAt) : new Date();
      const normalized = this.normalizeQuery(query, asOf);
      const filterHash = auditDomainHash('normalized-filter', normalized);
      if (continuation && !this.cursorMatches(continuation, viewer, normalized, filterHash, asOf)) {
        await this.recordCursorRejection(user, query.cursor!, 'BOUNDARY_MISMATCH');
        throw new BadRequestException({ code: 'INVALID_AUDIT_CURSOR' });
      }
      const rows = await this.selectAuthorized(tx, normalized, asOf, continuation, normalized.pageSize + 1);
      const hasNext = rows.length > normalized.pageSize;
      const page = rows.slice(0, normalized.pageSize);
      const items = page.map((row) => this.summary(row));
      let nextCursor: string | undefined;
      if (hasNext && page.length) {
        const last = page[page.length - 1];
        nextCursor = this.cursor.issue({
          viewerId: viewer.viewerId, sessionId: viewer.sessionId,
          accountVersion: viewer.accountVersion, tokenVersion: viewer.tokenVersion,
          minimumAuthContractVersion: viewer.minimumAuthContractVersion,
          securityControlVersion: viewer.securityControlVersion, authorizationGraphDigestVersion: 1,
          authorizationGraphDigest: viewer.authorizationGraphDigest, readerPolicyVersion: this.config.readerPolicyVersion!,
          normalizedFilterHash: filterHash, sortField: normalized.sortField, sortDirection: normalized.sortDirection,
          pageSize: normalized.pageSize, asOfOccurredAt: asOf.toISOString(),
          lastSortValue: this.sortValue(last, normalized.sortField), lastOccurredAt: last.occurredAt.toISOString(),
          lastEventId: last.id,
        });
      }
      return { items, ...(nextCursor ? { nextCursor } : {}), asOfOccurredAt: asOf.toISOString(), allowedActions: [] };
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'AUDIT_DB_CONTEXT_INVALID') throw this.notFound();
      throw error;
    }
  }

  async detail(user: IdentityRequest['user'], eventId: string): Promise<AuditEventDetail> {
    this.assertEnabled();
    const started = Date.now();
    try {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(eventId)) throw this.notFound();
      try {
        return await this.database.withReaderContext(user, async (tx) => {
        const rows = await tx.$queryRaw<Array<{ event: Record<string, unknown>; scopeRefs: Array<{ dimension: string; scopeId: string }> }>>`
          SELECT event, scope_refs AS "scopeRefs" FROM audit_reader_detail_v1(${eventId})
        `;
        if (rows.length !== 1) throw this.notFound();
        const raw = rows[0].event;
        const row = { ...raw, occurredAt: new Date(String(raw.occurredAt)) } as unknown as AuditRow;
        const refs = rows[0].scopeRefs;
          return {
            ...this.summary(row),
            authorizationScopeKind: row.authorizationScopeKind as AuditEventDetail['authorizationScopeKind'],
            authorizationScopeRefs: refs.map((ref) => ({ dimension: ref.dimension as AuditEventDetail['authorizationScopeRefs'][number]['dimension'], id: ref.scopeId })),
            scopeMatchMode: row.scopeMatchMode as AuditEventDetail['scopeMatchMode'],
            scopeResolverId: row.scopeResolverId,
            scopeResolverVersion: row.scopeResolverVersion,
            authorizationPolicyVersion: row.authorizationPolicyVersion,
            ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}),
            before: this.safeFields(row, 'before', row.safeBefore),
            after: this.safeFields(row, 'after', row.safeAfter),
            metadata: this.safeFields(row, 'metadata', row.safeMetadata),
            ...(row.causationId ? { causationId: row.causationId } : {}),
            ...(row.clientRequestId ? { clientRequestId: row.clientRequestId } : {}),
            ...(row.bulkOperationId ? { bulkOperationId: row.bulkOperationId } : {}),
            ...(row.bulkItemId ? { bulkItemId: row.bulkItemId } : {}),
          };
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'AUDIT_DB_CONTEXT_INVALID') throw this.notFound();
        throw error;
      }
    } finally {
      const remaining = this.config.detailPaddingMs! - (Date.now() - started);
      if (remaining > 0) await delay(remaining);
    }
  }

  private async currentViewer(tx: RestrictedAuditTransaction, user: IdentityRequest['user']): Promise<ViewerContext> {
    const rows = await tx.$queryRaw<DbViewerContextRow[]>`SELECT
      viewer_id AS "viewerId", session_id AS "sessionId", account_version AS "accountVersion",
      token_version AS "tokenVersion", minimum_auth_contract_version AS "minimumAuthContractVersion",
      security_control_version AS "securityControlVersion", assignment_graph AS "assignmentGraph"
      FROM audit_reader_current_context_v1()
    `;
    if (rows.length !== 1 || rows[0].viewerId !== user.id || rows[0].sessionId !== user.sessionId) throw this.notFound();
    const context = rows[0];
    const graph = {
      viewerId: context.viewerId, sessionId: context.sessionId,
      accountVersion: context.accountVersion, tokenVersion: context.tokenVersion,
      minimumAuthContractVersion: context.minimumAuthContractVersion,
      securityControlVersion: context.securityControlVersion,
      readerPolicyVersion: this.config.readerPolicyVersion!,
      assignmentGraph: context.assignmentGraph,
    };
    return {
      viewerId: context.viewerId, sessionId: context.sessionId,
      accountVersion: context.accountVersion, tokenVersion: context.tokenVersion,
      minimumAuthContractVersion: context.minimumAuthContractVersion,
      securityControlVersion: context.securityControlVersion,
      authorizationGraphDigest: auditDomainHash('authorization-graph', graph),
    };
  }

  private normalizeQuery(query: AuditEventListQueryDto, asOf: Date): NormalizedAuditQuery {
    if (!Number.isFinite(asOf.getTime())) throw new BadRequestException({ code: 'INVALID_AUDIT_CURSOR' });
    const pageSize = query.pageSize ?? this.config.maxPageSize!;
    if (pageSize < 1 || pageSize > this.config.maxPageSize!) throw this.invalidQuery();
    const occurredTo = query.occurredTo ? new Date(query.occurredTo) : asOf;
    const occurredFrom = query.occurredFrom ? new Date(query.occurredFrom) :
      new Date(occurredTo.getTime() - this.config.maxTimeRangeSeconds! * 1_000);
    if (!Number.isFinite(occurredFrom.getTime()) || !Number.isFinite(occurredTo.getTime()) ||
        occurredFrom > occurredTo || occurredTo > asOf ||
        occurredTo.getTime() - occurredFrom.getTime() > this.config.maxTimeRangeSeconds! * 1_000) throw this.invalidQuery();
    const filterFields = ['eventFamily','outcome','actorId','entityType','entityId','approvalRequestId',
      'approvalExecutionId','serverCorrelationId','causationId','bulkOperationId','bulkItemId','source','retentionClass'] as const;
    if (filterFields.filter((field) => query[field] !== undefined).length > this.config.maxFilters!) throw this.invalidQuery();
    for (const field of filterFields) {
      const value = query[field];
      if (typeof value === 'string') {
        try { assertSafeAuditText(value, 128, `query.${field}`); } catch { throw this.invalidQuery(); }
      }
    }
    if (query.eventFamily && !/^[a-z][a-z0-9_.-]{0,127}$/.test(query.eventFamily)) throw this.invalidQuery();
    return {
      occurredFrom: occurredFrom.toISOString(), occurredTo: occurredTo.toISOString(),
      ...Object.fromEntries(filterFields.flatMap((field) => query[field] === undefined ? [] : [[field, query[field]]])),
      sortField: query.sortField ?? 'occurredAt', sortDirection: query.sortDirection ?? 'desc', pageSize,
    } as NormalizedAuditQuery;
  }

  private cursorMatches(
    cursor: AuditCursorPayload,
    viewer: ViewerContext,
    query: NormalizedAuditQuery,
    filterHash: string,
    asOf: Date,
  ): boolean {
    return constantTimeAuditTextEqual(cursor.viewerId, viewer.viewerId) &&
      constantTimeAuditTextEqual(cursor.sessionId, viewer.sessionId) &&
      cursor.accountVersion === viewer.accountVersion && cursor.tokenVersion === viewer.tokenVersion &&
      cursor.minimumAuthContractVersion === viewer.minimumAuthContractVersion &&
      cursor.securityControlVersion === viewer.securityControlVersion &&
      cursor.readerPolicyVersion === this.config.readerPolicyVersion &&
      constantTimeAuditTextEqual(cursor.authorizationGraphDigest, viewer.authorizationGraphDigest) &&
      constantTimeAuditTextEqual(cursor.normalizedFilterHash, filterHash) &&
      cursor.sortField === query.sortField && cursor.sortDirection === query.sortDirection &&
      cursor.pageSize === query.pageSize && cursor.asOfOccurredAt === asOf.toISOString() &&
      Number.isFinite(Date.parse(cursor.lastOccurredAt));
  }

  private async selectAuthorized(
    tx: RestrictedAuditTransaction,
    query: NormalizedAuditQuery,
    asOf: Date,
    cursor: AuditCursorPayload | undefined,
    limit: number,
  ): Promise<AuditRow[]> {
    return tx.$queryRaw<AuditRow[]>`
      SELECT * FROM audit_reader_list_v1(
        ${new Date(query.occurredFrom)}, ${new Date(query.occurredTo)}, ${query.eventFamily ?? null},
        ${query.outcome ?? null}, ${query.actorId ?? null}, ${query.entityType ?? null}, ${query.entityId ?? null},
        ${query.approvalRequestId ?? null}, ${query.approvalExecutionId ?? null}, ${query.serverCorrelationId ?? null},
        ${query.causationId ?? null}, ${query.bulkOperationId ?? null}, ${query.bulkItemId ?? null},
        ${query.source ?? null}, ${query.retentionClass ?? null}, ${query.sortField}, ${query.sortDirection}, ${asOf},
        ${cursor?.lastSortValue ?? null}, ${cursor ? new Date(cursor.lastOccurredAt) : null}, ${cursor?.lastEventId ?? null}, ${limit}::integer
      )
    `;
  }

  private summary(row: AuditRow): AuditEventSummary {
    return {
      eventId: row.id, eventType: row.eventType, schemaVersion: row.schemaVersion,
      occurredAt: row.occurredAt.toISOString(), actorId: row.actorId, actorType: row.actorType,
      subjectType: row.subjectType, ...(row.subjectId ? { subjectId: row.subjectId } : {}),
      action: row.action, entityType: row.entityType, ...(row.entityId ? { entityId: row.entityId } : {}),
      ...(row.entityVersion ? { entityVersion: row.entityVersion } : {}), outcome: row.outcome,
      source: row.source, retentionClass: row.retentionClass, serverCorrelationId: row.serverCorrelationId,
      ...(row.approvalRequestId ? { approvalRequestId: row.approvalRequestId } : {}),
      ...(row.approvalExecutionId ? { approvalExecutionId: row.approvalExecutionId } : {}), allowedActions: [],
    };
  }

  private safeFields(row: AuditRow, section: 'before' | 'after' | 'metadata', raw: unknown): AuditSafeField[] {
    const schema = registeredAuditSchema(row.eventType, row.schemaVersion);
    if (auditRegistryDigest(schema) !== row.registryDigest || !Array.isArray(raw)) throw this.notFound();
    const definitions = schema.fields[section];
    const seen = new Set<string>();
    return raw.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw this.notFound();
      const record = entry as Record<string, unknown>;
      const key = record.key;
      if (typeof key !== 'string' || seen.has(key) || !definitions[key]) throw this.notFound();
      seen.add(key);
      const definition = definitions[key];
      const value = record.value;
      if (definition.classification === 'masked') {
        if (value !== '[masked]') throw this.notFound();
      } else if (value !== null && typeof value !== definition.type) throw this.notFound();
      if (typeof value === 'string') {
        try {
          assertSafeAuditText(value, definition.classification === 'masked' ? 16 : definition.maxBytes!, `stored.${key}`);
        } catch {
          throw this.notFound();
        }
      }
      return { key, label: definition.label, classification: definition.classification, value } as AuditSafeField;
    });
  }

  private sortValue(row: AuditRow, field: NormalizedAuditQuery['sortField']): string {
    return field === 'occurredAt' ? row.occurredAt.toISOString() : String(row[field]);
  }

  private async recordCursorRejection(
    viewer: Pick<IdentityRequest['user'], 'id' | 'sessionId'>,
    raw: string,
    code: 'INVALID_CURSOR' | 'BOUNDARY_MISMATCH',
  ): Promise<void> {
    const keyId = raw.split('.', 3)[1];
    try {
      await this.database.recordCursorRejection(
        viewer, code, keyId && /^[A-Za-z0-9_-]{1,64}$/.test(keyId) ? keyId : undefined,
      );
    } catch {
      // Validation failures never disclose or log cursor/filter material. The
      // caller still receives the same bounded cursor error.
    }
  }

  private notFound(): NotFoundException { return new NotFoundException({ code: 'AUDIT_EVENT_NOT_FOUND' }); }
  private invalidQuery(): BadRequestException { return new BadRequestException({ code: 'INVALID_AUDIT_QUERY' }); }
}
