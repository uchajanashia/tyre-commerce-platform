import { setTimeout as delay } from "node:timers/promises";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  JobDetail,
  JobListResult,
  JobSafeField,
  JobSummary,
} from "@tyre/shared";
import type { IdentityRequest } from "../auth/identity-access.guard";
import {
  constantTimeJobTextEqual,
  JobCursorPayload,
  JobCursorService,
  jobDomainHash,
} from "./job-cursor.service";
import { JOBS_CONFIG, JobsConfig } from "./jobs.config";
import {
  RestrictedJobTransaction,
  JobsDatabaseService,
} from "./jobs-database.service";
import { JobListQueryDto } from "./dto/job-reader.dto";

interface ViewerContext {
  viewerId: string;
  sessionId: string;
  accountVersion: number;
  tokenVersion: number;
  minimumAuthContractVersion: number;
  securityControlVersion: number;
  authorizationGraphDigest: string;
}
interface DbContext {
  viewerId: string;
  sessionId: string;
  accountVersion: number;
  tokenVersion: number;
  minimumAuthContractVersion: number;
  securityControlVersion: number;
  assignmentGraph: unknown;
}
interface DbJob {
  jobId: string;
  jobType: string;
  schemaVersion: number;
  ownerDomain: string;
  state: JobSummary["state"];
  priority: number;
  createdAt: Date;
  availableAt: Date;
  serverCorrelationId: string;
  causationId: string | null;
  originatingAuditEventId: string;
  safeSummary: unknown;
}
interface Normalized {
  createdFrom: string;
  createdTo: string;
  state?: string;
  jobType?: string;
  ownerDomain?: string;
  correlationId?: string;
  sortField: "createdAt" | "availableAt" | "state" | "priority";
  sortDirection: "asc" | "desc";
  pageSize: number;
}

@Injectable()
export class JobsReaderService {
  constructor(
    private readonly database: JobsDatabaseService,
    private readonly cursor: JobCursorService,
    @Inject(JOBS_CONFIG) private readonly config: JobsConfig,
  ) {}
  assertEnabled(): void {
    if (!this.config.enabled)
      throw new ServiceUnavailableException({ code: "JOBS_READER_DISABLED" });
  }

  async list(
    user: IdentityRequest["user"],
    query: JobListQueryDto,
  ): Promise<JobListResult> {
    this.assertEnabled();
    return this.database.withReaderContext(user, async (tx) => {
      const viewer = await this.viewer(tx, user);
      let continuation: JobCursorPayload | undefined;
      if (query.cursor) {
        try {
          continuation = this.cursor.decrypt(query.cursor);
        } catch {
          throw new BadRequestException({ code: "INVALID_JOB_CURSOR" });
        }
      }
      const asOf = continuation
        ? new Date(continuation.asOfCreatedAt)
        : new Date();
      const normalized = this.normalize(query, asOf);
      const filterHash = jobDomainHash("normalized-filter", normalized);
      if (
        continuation &&
        !this.matches(continuation, viewer, normalized, filterHash, asOf)
      )
        throw new BadRequestException({ code: "INVALID_JOB_CURSOR" });
      const rows = await tx.$queryRawUnsafe<DbJob[]>(
        "SELECT * FROM job_reader_list_v1($1,$2,$3::timestamptz,$4::timestamptz,$5::text,$6::text,$7::text,$8::text,$9,$10,$11::integer,$12::text,$13::timestamptz,$14::uuid)",
        viewer.viewerId,
        viewer.sessionId,
        new Date(normalized.createdFrom),
        new Date(normalized.createdTo),
        normalized.state ?? null,
        normalized.jobType ?? null,
        normalized.ownerDomain ?? null,
        normalized.correlationId ?? null,
        normalized.sortField,
        normalized.sortDirection,
        normalized.pageSize + 1,
        continuation?.lastSortValue ?? null,
        continuation ? new Date(continuation.lastCreatedAt) : null,
        continuation?.lastJobId ?? null,
      );
      const page = rows.slice(0, normalized.pageSize);
      const items = page.map((row) => this.summary(row));
      let nextCursor: string | undefined;
      if (rows.length > normalized.pageSize && page.length) {
        const last = page[page.length - 1];
        nextCursor = this.cursor.issue({
          viewerId: viewer.viewerId,
          sessionId: viewer.sessionId,
          accountVersion: viewer.accountVersion,
          tokenVersion: viewer.tokenVersion,
          minimumAuthContractVersion: viewer.minimumAuthContractVersion,
          securityControlVersion: viewer.securityControlVersion,
          authorizationGraphDigestVersion: 1,
          authorizationGraphDigest: viewer.authorizationGraphDigest,
          readerPolicyVersion: this.config.readerPolicyVersion!,
          normalizedFilterHash: filterHash,
          sortField: normalized.sortField,
          sortDirection: normalized.sortDirection,
          pageSize: normalized.pageSize,
          asOfCreatedAt: asOf.toISOString(),
          lastSortValue: this.sortValue(last, normalized.sortField),
          lastCreatedAt: last.createdAt.toISOString(),
          lastJobId: last.jobId,
        });
      }
      return {
        items,
        nextCursor,
        asOfCreatedAt: asOf.toISOString(),
        allowedActions: [],
      };
    });
  }

  async detail(user: IdentityRequest["user"], id: string): Promise<JobDetail> {
    this.assertEnabled();
    const started = Date.now();
    try {
      return await this.database.withReaderContext(user, async (tx) => {
        await this.viewer(tx, user);
        const [row] = await tx.$queryRawUnsafe<Array<{ detail: unknown }>>(
          "SELECT job_reader_detail_v1($1,$2,$3::uuid) AS detail",
          user.id,
          user.sessionId,
          id,
        );
        if (!row?.detail || typeof row.detail !== "object")
          throw this.notFound();
        return this.detailProjection(row.detail);
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (
        error instanceof Error &&
        /invalid input syntax for type uuid|JOBS_DB_CONTEXT_INVALID/.test(
          error.message,
        )
      )
        throw this.notFound();
      throw error;
    } finally {
      const left = this.config.detailPaddingMs! - (Date.now() - started);
      if (left > 0) await delay(left);
    }
  }

  private async viewer(
    tx: RestrictedJobTransaction,
    user: IdentityRequest["user"],
  ): Promise<ViewerContext> {
    const [row] = await tx.$queryRaw<
      DbContext[]
    >`SELECT viewer_id AS "viewerId",session_id AS "sessionId",account_version AS "accountVersion",token_version AS "tokenVersion",minimum_auth_contract_version AS "minimumAuthContractVersion",security_control_version AS "securityControlVersion",assignment_graph AS "assignmentGraph" FROM job_reader_current_context_v1()`;
    if (!row || row.viewerId !== user.id || row.sessionId !== user.sessionId)
      throw this.notFound();
    return {
      ...row,
      authorizationGraphDigest: jobDomainHash("authorization-graph", {
        viewerId: row.viewerId,
        sessionId: row.sessionId,
        accountVersion: row.accountVersion,
        tokenVersion: row.tokenVersion,
        minimumAuthContractVersion: row.minimumAuthContractVersion,
        securityControlVersion: row.securityControlVersion,
        readerPolicyVersion: this.config.readerPolicyVersion,
        assignmentGraph: row.assignmentGraph,
      }),
    };
  }
  private normalize(q: JobListQueryDto, asOf: Date): Normalized {
    const pageSize = q.pageSize ?? this.config.maxPageSize!;
    const createdTo = q.createdTo ? new Date(q.createdTo) : asOf;
    const createdFrom = q.createdFrom
      ? new Date(q.createdFrom)
      : new Date(createdTo.getTime() - this.config.maxTimeRangeSeconds! * 1000);
    if (
      pageSize < 1 ||
      pageSize > this.config.maxPageSize! ||
      !Number.isFinite(createdFrom.getTime()) ||
      !Number.isFinite(createdTo.getTime()) ||
      createdFrom > createdTo ||
      createdTo > asOf ||
      createdTo.getTime() - createdFrom.getTime() >
        this.config.maxTimeRangeSeconds! * 1000
    )
      throw new BadRequestException({ code: "INVALID_JOB_QUERY" });
    const filters = [q.state, q.jobType, q.ownerDomain, q.correlationId].filter(
      (v) => v !== undefined,
    );
    if (
      filters.length > this.config.maxFilters! ||
      filters.some(
        (v) =>
          typeof v !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v),
      )
    )
      throw new BadRequestException({ code: "INVALID_JOB_QUERY" });
    return {
      createdFrom: createdFrom.toISOString(),
      createdTo: createdTo.toISOString(),
      ...(q.state && { state: q.state }),
      ...(q.jobType && { jobType: q.jobType }),
      ...(q.ownerDomain && { ownerDomain: q.ownerDomain }),
      ...(q.correlationId && { correlationId: q.correlationId }),
      sortField: q.sortField ?? "createdAt",
      sortDirection: q.sortDirection ?? "desc",
      pageSize,
    };
  }
  private matches(
    c: JobCursorPayload,
    v: ViewerContext,
    n: Normalized,
    hash: string,
    asOf: Date,
  ): boolean {
    return (
      c.viewerId === v.viewerId &&
      c.sessionId === v.sessionId &&
      c.accountVersion === v.accountVersion &&
      c.tokenVersion === v.tokenVersion &&
      c.minimumAuthContractVersion === v.minimumAuthContractVersion &&
      c.securityControlVersion === v.securityControlVersion &&
      c.readerPolicyVersion === this.config.readerPolicyVersion &&
      c.sortField === n.sortField &&
      c.sortDirection === n.sortDirection &&
      c.pageSize === n.pageSize &&
      c.asOfCreatedAt === asOf.toISOString() &&
      constantTimeJobTextEqual(
        c.authorizationGraphDigest,
        v.authorizationGraphDigest,
      ) &&
      constantTimeJobTextEqual(c.normalizedFilterHash, hash)
    );
  }
  private summary(row: DbJob): JobSummary {
    return {
      jobId: row.jobId,
      jobType: row.jobType,
      schemaVersion: row.schemaVersion,
      ownerDomain: row.ownerDomain,
      state: row.state,
      priority: row.priority,
      createdAt: row.createdAt.toISOString(),
      availableAt: row.availableAt.toISOString(),
      serverCorrelationId: row.serverCorrelationId,
      ...(row.causationId ? { causationId: row.causationId } : {}),
      originatingAuditEventId: row.originatingAuditEventId,
      safeSummary: this.safe(row.safeSummary),
      allowedActions: [],
    };
  }
  private detailProjection(value: unknown): JobDetail {
    const raw = value as JobDetail & {
      causationId?: string | null;
      requiredGlobalGrant?: string | null;
      leaseExpiresAt?: string | null;
    };
    if (
      !Array.isArray(raw.authorizationScopeRefs) ||
      !Array.isArray(raw.attempts) ||
      !Array.isArray(raw.reconciliations)
    )
      throw new Error("JOB_DETAIL_INVALID");
    return {
      jobId: raw.jobId,
      jobType: raw.jobType,
      schemaVersion: raw.schemaVersion,
      ownerDomain: raw.ownerDomain,
      state: raw.state,
      priority: raw.priority,
      createdAt: raw.createdAt,
      availableAt: raw.availableAt,
      serverCorrelationId: raw.serverCorrelationId,
      ...(raw.causationId ? { causationId: raw.causationId } : {}),
      originatingAuditEventId: raw.originatingAuditEventId,
      safeSummary: this.safe(raw.safeSummary),
      allowedActions: [],
      authorizationScopeKind: raw.authorizationScopeKind,
      authorizationScopeRefs: raw.authorizationScopeRefs.map((scope) => ({
        dimension: scope.dimension,
        id: scope.id,
      })),
      scopeMatchMode: raw.scopeMatchMode,
      ...(raw.requiredGlobalGrant
        ? { requiredGlobalGrant: raw.requiredGlobalGrant }
        : {}),
      scopeResolverId: raw.scopeResolverId,
      scopeResolverVersion: raw.scopeResolverVersion,
      authorizationPolicyVersion: raw.authorizationPolicyVersion,
      currentLeaseGeneration: raw.currentLeaseGeneration,
      ...(raw.leaseExpiresAt ? { leaseExpiresAt: raw.leaseExpiresAt } : {}),
      attempts: raw.attempts.map((attempt) => {
        const item = attempt as typeof attempt & {
          outcome?: typeof attempt.outcome | null;
          outcomeAt?: string | null;
          safeReasonCode?: string | null;
        };
        return {
          attemptStartedId: item.attemptStartedId,
          leaseGeneration: item.leaseGeneration,
          startedAt: item.startedAt,
          ...(item.outcome ? { outcome: item.outcome } : {}),
          ...(item.outcomeAt ? { outcomeAt: item.outcomeAt } : {}),
          ...(item.safeReasonCode
            ? { safeReasonCode: item.safeReasonCode }
            : {}),
        };
      }),
      reconciliations: raw.reconciliations.map((item) => ({
        reconciliationId: item.reconciliationId,
        state: item.state,
        occurredAt: item.occurredAt,
        safeReasonCode: item.safeReasonCode,
      })),
    };
  }
  private safe(value: unknown): JobSafeField[] {
    if (!Array.isArray(value) || value.some((x) => !x || typeof x !== "object"))
      throw new Error("JOB_SAFE_SUMMARY_INVALID");
    return value as JobSafeField[];
  }
  private sortValue(row: DbJob, field: Normalized["sortField"]): string {
    return field === "createdAt"
      ? row.createdAt.toISOString()
      : field === "availableAt"
        ? row.availableAt.toISOString()
        : String(row[field]);
  }
  private notFound(): NotFoundException {
    return new NotFoundException({ code: "JOB_NOT_FOUND" });
  }
}
