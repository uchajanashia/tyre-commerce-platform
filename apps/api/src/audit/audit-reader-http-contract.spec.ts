import "reflect-metadata";

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { INestApplication, Module, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import {
  AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1,
  AUDIT_EVENT_V2_CURSOR_TEST_ONLY_V1,
  AuditEventDetail,
  AuditEventListResult,
  AuditEventSummary,
  AuditSafeField,
  AuditScopeRef,
} from "@tyre/shared";

import {
  IdentityAccessGuard,
  IdentityRequest,
} from "../auth/identity-access.guard";
import {
  IdentityAuthService,
  StaffProjection,
} from "../auth/identity-auth.service";
import { IdentityJwtService } from "../auth/identity-jwt.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  AuditReaderController,
  AuditReaderEnabledGuard,
} from "./audit-reader.controller";
import { AUDIT_READER_CONFIG, AuditReaderConfig } from "./audit-reader.config";
import {
  AuditCursorPayload,
  AuditCursorService,
  auditDomainHash,
} from "./audit-cursor.service";
import { AuditReaderService } from "./audit-reader.service";
import {
  AUDIT_QUERY_KEYS,
  AuditEventDetailDto,
  AuditEventListQueryDto,
  AuditEventListResponseDto,
  AuditEventSummaryDto,
  AuditSafeFieldDto,
  AuditScopeRefDto,
} from "./dto/audit-reader.dto";

const FIXTURE = AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1;
const CURSOR_SUPPORT = AUDIT_EVENT_V2_CURSOR_TEST_ONLY_V1;
const CURSOR_CONFIG: AuditReaderConfig = {
  requested: true,
  enabled: true,
  disabledReasons: [],
  cursorMaxTtlSeconds: CURSOR_SUPPORT.cursorMaxTtlSeconds,
  maxPageSize: CURSOR_SUPPORT.maxPageSize,
  maxTimeRangeSeconds: 3_600,
  maxFilters: 13,
  maxCursorBytes: 4_096,
  detailPaddingMs: 1,
  queryPlanPolicyId: "fixture-test-only-plan-v1",
  readerPolicyVersion: CURSOR_SUPPORT.readerPolicyVersion,
  cursorKeys: [
    {
      id: CURSOR_SUPPORT.keyId,
      material: Buffer.from(CURSOR_SUPPORT.keyMaterialBase64Url, "base64url"),
      state: "issuing",
      notBefore: Date.parse("2026-07-30T00:00:00.000Z"),
      verifyUntil: Date.parse("2100-01-01T00:00:00.000Z"),
      revoked: false,
    },
  ],
};
const fixtureCursor = new AuditCursorService(CURSOR_CONFIG);

interface SummaryFacts {
  readonly id: string;
  readonly type: string;
  readonly schema: number;
  readonly timestamp: string;
  readonly actor: { readonly id: string; readonly kind: string };
  readonly subject: { readonly kind: string; readonly id: string | undefined };
  readonly operation: string;
  readonly entity: {
    readonly kind: string;
    readonly id: string | undefined;
    readonly version: string | undefined;
  };
  readonly result: AuditEventSummary["outcome"];
  readonly origin: AuditEventSummary["source"];
  readonly retention: string;
  readonly correlation: string;
  readonly approvalRequest: string | undefined;
  readonly approvalExecution: string | undefined;
}

interface DetailFacts {
  readonly summary: SummaryFacts;
  readonly authorization: {
    readonly kind: AuditEventDetail["authorizationScopeKind"];
    readonly scopes: readonly AuditScopeRef[];
    readonly match: AuditEventDetail["scopeMatchMode"];
    readonly resolver: { readonly id: string; readonly version: number };
    readonly policyVersion: number;
  };
  readonly reason: string | undefined;
  readonly before: readonly AuditSafeField[];
  readonly after: readonly AuditSafeField[];
  readonly metadata: readonly AuditSafeField[];
  readonly causation: string | undefined;
  readonly clientRequest: string | undefined;
  readonly bulkOperation: string | undefined;
  readonly bulkItem: string | undefined;
}

const SUMMARY_FACTS: SummaryFacts = {
  id: FIXTURE.summary.eventId,
  type: FIXTURE.summary.eventType,
  schema: FIXTURE.summary.schemaVersion,
  timestamp: FIXTURE.summary.occurredAt,
  actor: { id: FIXTURE.summary.actorId, kind: FIXTURE.summary.actorType },
  subject: { kind: FIXTURE.summary.subjectType, id: FIXTURE.summary.subjectId },
  operation: FIXTURE.summary.action,
  entity: {
    kind: FIXTURE.summary.entityType,
    id: FIXTURE.summary.entityId,
    version: FIXTURE.summary.entityVersion,
  },
  result: FIXTURE.summary.outcome,
  origin: FIXTURE.summary.source,
  retention: FIXTURE.summary.retentionClass,
  correlation: FIXTURE.summary.serverCorrelationId,
  approvalRequest: FIXTURE.summary.approvalRequestId,
  approvalExecution: FIXTURE.summary.approvalExecutionId,
};

const DETAIL_FACTS: DetailFacts = {
  summary: SUMMARY_FACTS,
  authorization: {
    kind: FIXTURE.detail.authorizationScopeKind,
    scopes: FIXTURE.detail.authorizationScopeRefs,
    match: FIXTURE.detail.scopeMatchMode,
    resolver: {
      id: FIXTURE.detail.scopeResolverId,
      version: FIXTURE.detail.scopeResolverVersion,
    },
    policyVersion: FIXTURE.detail.authorizationPolicyVersion,
  },
  reason: FIXTURE.detail.reasonCode,
  before: FIXTURE.detail.before,
  after: FIXTURE.detail.after,
  metadata: FIXTURE.detail.metadata,
  causation: FIXTURE.detail.causationId,
  clientRequest: FIXTURE.detail.clientRequestId,
  bulkOperation: FIXTURE.detail.bulkOperationId,
  bulkItem: FIXTURE.detail.bulkItemId,
};

const STAFF: StaffProjection = {
  id: "fixture-reader-001",
  email: "fixture-reader@example.invalid",
  displayName: "Fixture reader",
  role: "auditor",
  enabled: true,
  status: "active",
  mfaRequired: true,
  mfaEnrolled: true,
  version: 1,
  permissions: ["audit.read"],
  permissionGrants: [
    { permission: "audit.read", scopeType: "global", scopeId: "" },
  ],
};

const SESSION = {
  id: "fixture-session-001",
  staffUserId: STAFF.id,
  revokedAt: null,
  idleExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  absoluteExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  authContractVersion: 2,
  tokenVersionSnapshot: 1,
  lastSeenAt: new Date("2099-01-01T00:00:00.000Z"),
  staffUser: { tokenVersion: 1, enabled: true, status: "active" },
};

class FixtureReader {
  readonly listQueries: AuditEventListQueryDto[] = [];
  readonly detailIds: string[] = [];
  readonly cursorPayloads: AuditCursorPayload[] = [];

  async list(
    _user: IdentityRequest["user"],
    query: AuditEventListQueryDto,
  ): Promise<AuditEventListResult> {
    this.listQueries.push(query);
    if (query.cursor) {
      this.cursorPayloads.push(
        fixtureCursor.decrypt(query.cursor, new Date(CURSOR_SUPPORT.decryptAt)),
      );
    }
    return listDtoFromFacts(SUMMARY_FACTS);
  }

  async detail(
    _user: IdentityRequest["user"],
    id: string,
  ): Promise<AuditEventDetail> {
    this.detailIds.push(id);
    return detailDtoFromFacts(DETAIL_FACTS);
  }
}

const fixtureReader = new FixtureReader();

@Module({
  controllers: [AuditReaderController],
  providers: [
    AuditReaderEnabledGuard,
    IdentityAccessGuard,
    { provide: AUDIT_READER_CONFIG, useValue: CURSOR_CONFIG },
    {
      provide: IdentityJwtService,
      useValue: {
        verify: async () => ({ sid: SESSION.id, sub: STAFF.id, ver: 1 }),
      },
    },
    {
      provide: PrismaService,
      useValue: {
        staffSession: {
          findUnique: async () => SESSION,
          updateMany: async () => ({ count: 0 }),
        },
        securityControl: {
          findUnique: async () => ({ minimumAuthContractVersion: 2 }),
        },
      },
    },
    {
      provide: IdentityAuthService,
      useValue: {
        assertEnabled: () => undefined,
        staffInfo: async () => STAFF,
      },
    },
    { provide: AuditReaderService, useValue: fixtureReader },
  ],
})
class AuditReaderHttpContractModule {}

test("audit controller HTTP pipeline matches the shared V2 contract fixture", async (context) => {
  fixtureReader.listQueries.length = 0;
  fixtureReader.detailIds.length = 0;
  fixtureReader.cursorPayloads.length = 0;
  const app = await createContractApp();
  context.after(async () => app.close());
  const baseUrl = await listen(app);

  const defaultResponse = await fixtureFetch(
    `${baseUrl}/admin/v1/audit-events`,
  );
  assert.equal(defaultResponse.status, 200);
  assert.equal(defaultResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await jsonBody(defaultResponse), FIXTURE.listPage);
  assert.deepEqual(Object.keys(fixtureReader.listQueries[0]), [
    ...AUDIT_QUERY_KEYS,
  ]);
  assert.equal(
    Object.values(fixtureReader.listQueries[0]).every(
      (value) => value === undefined,
    ),
    true,
  );

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(FIXTURE.listQuery))
    search.set(key, String(value));
  const listResponse = await fixtureFetch(
    `${baseUrl}/admin/v1/audit-events?${search.toString()}`,
  );
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.headers.get("cache-control"), "no-store");
  const listBody = await jsonBody(listResponse);
  assert.deepEqual(listBody, FIXTURE.listPage);
  assertExactListKeys(listBody);
  assert.deepEqual({ ...fixtureReader.listQueries[1] }, FIXTURE.listQuery);
  assert.deepEqual(Object.keys(FIXTURE.listQuery), [...AUDIT_QUERY_KEYS]);
  assert.deepEqual(fixtureReader.cursorPayloads, [
    CURSOR_SUPPORT.requestPayload,
  ]);

  const detailResponse = await fixtureFetch(
    `${baseUrl}/admin/v1/audit-events/${encodeURIComponent(FIXTURE.detail.eventId)}`,
  );
  assert.equal(detailResponse.status, 200);
  assert.equal(detailResponse.headers.get("cache-control"), "no-store");
  const detailBody = await jsonBody(detailResponse);
  assert.deepEqual(detailBody, FIXTURE.detail);
  assertExactDetailKeys(detailBody);
  assert.deepEqual(fixtureReader.detailIds, [FIXTURE.detail.eventId]);

  const invalidResponse = await fixtureFetch(
    `${baseUrl}/admin/v1/audit-events?unknownAuditField=blocked`,
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(
    await jsonBody(invalidResponse),
    FIXTURE.errors.invalidQuery,
  );
  assert.equal(fixtureReader.listQueries.length, 2);
});

test("shared audit cursors decrypt with actual ac1 crypto and preserve every binding", () => {
  assert.equal(
    CURSOR_SUPPORT.warning,
    "TEST_ONLY_DO_NOT_USE_IN_RUNTIME_CONFIGURATION",
  );
  assert.equal(FIXTURE.listQuery.cursor.split(".").length, 5);
  assert.equal(FIXTURE.listPage.nextCursor?.split(".").length, 5);

  const at = new Date(CURSOR_SUPPORT.decryptAt);
  const request = fixtureCursor.decrypt(FIXTURE.listQuery.cursor, at);
  const next = fixtureCursor.decrypt(FIXTURE.listPage.nextCursor ?? "", at);
  assert.deepEqual(request, CURSOR_SUPPORT.requestPayload);
  assert.deepEqual(next, CURSOR_SUPPORT.nextPayload);
  assert.equal(
    request.authorizationGraphDigest,
    auditDomainHash("authorization-graph", CURSOR_SUPPORT.authorizationGraph),
  );
  assert.equal(
    request.normalizedFilterHash,
    auditDomainHash("normalized-filter", CURSOR_SUPPORT.normalizedQuery),
  );
  assert.equal(request.viewerId, STAFF.id);
  assert.equal(request.sessionId, SESSION.id);
  assert.equal(request.asOfOccurredAt, FIXTURE.listPage.asOfOccurredAt);
  assert.equal(next.lastEventId, FIXTURE.summary.eventId);
  assert.equal(next.lastOccurredAt, FIXTURE.summary.occurredAt);

  const tampered = `${FIXTURE.listQuery.cursor.slice(0, -1)}${FIXTURE.listQuery.cursor.endsWith("A") ? "B" : "A"}`;
  assert.throws(
    () => fixtureCursor.decrypt(tampered, at),
    /INVALID_AUDIT_CURSOR/,
  );
});

async function createContractApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AuditReaderHttpContractModule, {
    abortOnError: false,
    logger: ["error"],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  return app;
}

async function listen(app: INestApplication): Promise<string> {
  await app.listen(0, "127.0.0.1");
  return app.getUrl();
}

async function jsonBody(response: Response): Promise<unknown> {
  const parsed: unknown = JSON.parse(await response.text());
  return parsed;
}

function fixtureFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: { authorization: "Bearer fixture-access-token" },
  });
}

function listDtoFromFacts(facts: SummaryFacts): AuditEventListResponseDto {
  const response = new AuditEventListResponseDto();
  response.items = [summaryDtoFromFacts(facts)];
  response.nextCursor = FIXTURE.listPage.nextCursor;
  response.asOfOccurredAt = FIXTURE.listPage.asOfOccurredAt;
  response.allowedActions = [];
  return response;
}

function summaryDtoFromFacts(facts: SummaryFacts): AuditEventSummaryDto {
  const dto = new AuditEventSummaryDto();
  populateSummaryDto(dto, facts);
  return dto;
}

function populateSummaryDto(
  dto: AuditEventSummaryDto,
  facts: SummaryFacts,
): void {
  dto.eventId = facts.id;
  dto.eventType = facts.type;
  dto.schemaVersion = facts.schema;
  dto.occurredAt = facts.timestamp;
  dto.actorId = facts.actor.id;
  dto.actorType = facts.actor.kind;
  dto.subjectType = facts.subject.kind;
  dto.subjectId = facts.subject.id;
  dto.action = facts.operation;
  dto.entityType = facts.entity.kind;
  dto.entityId = facts.entity.id;
  dto.entityVersion = facts.entity.version;
  dto.outcome = facts.result;
  dto.source = facts.origin;
  dto.retentionClass = facts.retention;
  dto.serverCorrelationId = facts.correlation;
  dto.approvalRequestId = facts.approvalRequest;
  dto.approvalExecutionId = facts.approvalExecution;
  dto.allowedActions = [];
}

function detailDtoFromFacts(facts: DetailFacts): AuditEventDetailDto {
  const dto = new AuditEventDetailDto();
  populateSummaryDto(dto, facts.summary);
  dto.authorizationScopeKind = facts.authorization.kind;
  dto.authorizationScopeRefs = facts.authorization.scopes.map((scope) =>
    scopeDto(scope),
  );
  dto.scopeMatchMode = facts.authorization.match;
  dto.scopeResolverId = facts.authorization.resolver.id;
  dto.scopeResolverVersion = facts.authorization.resolver.version;
  dto.authorizationPolicyVersion = facts.authorization.policyVersion;
  dto.reasonCode = facts.reason;
  dto.before = facts.before.map((field) => safeFieldDto(field));
  dto.after = facts.after.map((field) => safeFieldDto(field));
  dto.metadata = facts.metadata.map((field) => safeFieldDto(field));
  dto.causationId = facts.causation;
  dto.clientRequestId = facts.clientRequest;
  dto.bulkOperationId = facts.bulkOperation;
  dto.bulkItemId = facts.bulkItem;
  return dto;
}

function safeFieldDto(field: AuditSafeField): AuditSafeFieldDto {
  const dto = new AuditSafeFieldDto();
  dto.key = field.key;
  dto.label = field.label;
  dto.classification = field.classification;
  dto.value = field.value;
  return dto;
}

function scopeDto(scope: AuditScopeRef): AuditScopeRefDto {
  const dto = new AuditScopeRefDto();
  dto.dimension = scope.dimension;
  dto.id = scope.id;
  return dto;
}

function assertExactListKeys(value: unknown): void {
  if (!isRecord(value)) throw new Error("List response must be an object");
  assert.deepEqual(
    Object.keys(value).sort(),
    Object.keys(FIXTURE.listPage).sort(),
  );
  const items = value["items"];
  if (!Array.isArray(items) || !isRecord(items[0]))
    throw new Error("List item must be an object");
  assert.deepEqual(
    Object.keys(items[0]).sort(),
    Object.keys(FIXTURE.summary).sort(),
  );
}

function assertExactDetailKeys(value: unknown): void {
  if (!isRecord(value)) throw new Error("Detail response must be an object");
  assert.deepEqual(
    Object.keys(value).sort(),
    Object.keys(FIXTURE.detail).sort(),
  );
  for (const key of ["before", "after", "metadata"] as const) {
    const fields: unknown = value[key];
    if (!Array.isArray(fields) || !isRecord(fields[0])) {
      throw new Error(`Detail ${key} must contain an object`);
    }
    assert.deepEqual(
      Object.keys(fields[0]).sort(),
      Object.keys(FIXTURE.detail[key][0]).sort(),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
