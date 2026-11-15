import "reflect-metadata";

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  Controller,
  Get,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  Query,
  ValidationPipe,
} from "@nestjs/common";
import { APP_FILTER, APP_GUARD, NestFactory } from "@nestjs/core";
import { IsIn } from "class-validator";

import {
  JOB_AUTHORIZATION_SCOPE_KINDS,
  JOB_CONTRACT_FIXTURE_V1,
  JOB_CURSOR_TEST_ONLY_V1,
  JOB_SCOPE_MATCH_MODES,
  JOB_STATES,
  JOB_TERMINAL_KINDS,
  JobDetail,
  JobSafeField,
  JobScopeRef,
  JobSummary,
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
import { ApiProblemBoundaryFilter, OperationContextGuard, ServerCorrelationMiddleware } from "../common/api-problem-boundary";
import {
  JobCursorPayload,
  JobCursorService,
  jobDomainHash,
} from "./job-cursor.service";
import { JOBS_CONFIG, JobsConfig } from "./jobs.config";
import {
  JobsDatabaseService,
  RestrictedJobTransaction,
} from "./jobs-database.service";
import { JobListQueryDto, JOB_QUERY_KEYS } from "./dto/job-reader.dto";
import {
  JobsReaderController,
  JobsReaderEnabledGuard,
} from "./jobs-reader.controller";
import { JobsReaderService } from "./jobs-reader.service";

const FIXTURE = JOB_CONTRACT_FIXTURE_V1;
const CURSOR_SUPPORT = JOB_CURSOR_TEST_ONLY_V1;
const CONFIG: JobsConfig = {
  requested: true,
  enabled: true,
  pollerEnabled: false,
  disabledReasons: [],
  cursorMaxTtlSeconds: CURSOR_SUPPORT.cursorMaxTtlSeconds,
  maxCursorBytes: 4_096,
  maxPageSize: CURSOR_SUPPORT.maxPageSize,
  maxTimeRangeSeconds: 7_200,
  maxFilters: 4,
  detailPaddingMs: 1,
  readerPolicyVersion: CURSOR_SUPPORT.readerPolicyVersion,
  queryPlanPolicyId: "fixture-test-only-job-plan-v1",
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

interface SummaryFacts {
  readonly id: string;
  readonly type: string;
  readonly schema: number;
  readonly domain: string;
  readonly status: JobSummary["state"];
  readonly priority: number;
  readonly created: string;
  readonly available: string;
  readonly correlation: string;
  readonly causation: string | undefined;
  readonly auditEvent: string;
  readonly safeFields: readonly JobSafeField[];
}

interface DetailFacts {
  readonly summary: SummaryFacts;
  readonly authorization: {
    readonly kind: JobDetail["authorizationScopeKind"];
    readonly scopes: readonly JobScopeRef[];
    readonly match: JobDetail["scopeMatchMode"];
    readonly globalGrant: string | undefined;
    readonly resolver: { readonly id: string; readonly version: number };
    readonly policyVersion: number;
  };
  readonly lease: {
    readonly generation: number;
    readonly expires: string | undefined;
  };
  readonly attempts: JobDetail["attempts"];
  readonly reconciliations: JobDetail["reconciliations"];
}

const SUMMARY_FACTS: SummaryFacts = {
  id: FIXTURE.detail.jobId,
  type: FIXTURE.detail.jobType,
  schema: FIXTURE.detail.schemaVersion,
  domain: FIXTURE.detail.ownerDomain,
  status: FIXTURE.detail.state,
  priority: FIXTURE.detail.priority,
  created: FIXTURE.detail.createdAt,
  available: FIXTURE.detail.availableAt,
  correlation: FIXTURE.detail.serverCorrelationId,
  causation: undefined,
  auditEvent: FIXTURE.detail.originatingAuditEventId,
  safeFields: FIXTURE.detail.safeSummary,
};

const DETAIL_FACTS: DetailFacts = {
  summary: SUMMARY_FACTS,
  authorization: {
    kind: FIXTURE.detail.authorizationScopeKind,
    scopes: FIXTURE.detail.authorizationScopeRefs,
    match: FIXTURE.detail.scopeMatchMode,
    globalGrant: undefined,
    resolver: {
      id: FIXTURE.detail.scopeResolverId,
      version: FIXTURE.detail.scopeResolverVersion,
    },
    policyVersion: FIXTURE.detail.authorizationPolicyVersion,
  },
  lease: {
    generation: FIXTURE.detail.currentLeaseGeneration,
    expires: FIXTURE.detail.leaseExpiresAt,
  },
  attempts: FIXTURE.detail.attempts,
  reconciliations: FIXTURE.detail.reconciliations,
};

const STAFF: StaffProjection = {
  id: CURSOR_SUPPORT.authorizationGraph.viewerId,
  email: "fixture-job-reader@example.invalid",
  displayName: "Fixture job reader",
  role: "operations",
  enabled: true,
  status: "active",
  mfaRequired: true,
  mfaEnrolled: true,
  version: 1,
  permissions: ["jobs.read"],
  permissionGrants: [
    {
      permission: "jobs.read",
      scopeType: "warehouse",
      scopeId: "fixture-warehouse-001",
    },
  ],
};

const WILDCARD_STAFF: StaffProjection = {
  ...STAFF,
  permissions: ["*"],
  permissionGrants: [{ permission: "*", scopeType: "global", scopeId: "" }],
};

const SESSION = {
  id: CURSOR_SUPPORT.authorizationGraph.sessionId,
  staffUserId: STAFF.id,
  revokedAt: null,
  idleExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  absoluteExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  authContractVersion: 2,
  tokenVersionSnapshot: 1,
  lastSeenAt: new Date("2099-01-01T00:00:00.000Z"),
  staffUser: { tokenVersion: 1, enabled: true, status: "active" },
};

class FixtureJobsDatabase {
  readonly users: IdentityRequest["user"][] = [];
  readonly listArguments: unknown[][] = [];
  readonly detailIds: string[] = [];
  contextCalls = 0;

  reset(): void {
    this.users.length = 0;
    this.listArguments.length = 0;
    this.detailIds.length = 0;
    this.contextCalls = 0;
  }

  async withReaderContext<T>(
    user: IdentityRequest["user"],
    operation: (tx: RestrictedJobTransaction) => Promise<T>,
  ): Promise<T> {
    this.contextCalls += 1;
    this.users.push(user);
    const hasLiteralRead = user.permissionGrants.some(
      (grant) => grant.permission === "jobs.read",
    );
    const assignmentGraph = hasLiteralRead
      ? CURSOR_SUPPORT.authorizationGraph.assignmentGraph
      : [
          {
            assignmentId: "fixture-wildcard-assignment",
            roleId: "fixture-wildcard-role",
            roleVersion: 1,
            permission: "*",
            scopeType: "global",
            scopeId: "",
          },
        ];
    const tx = {
      $queryRaw: async () => [
        {
          viewerId: user.id,
          sessionId: user.sessionId,
          accountVersion: 1,
          tokenVersion: 1,
          minimumAuthContractVersion: 2,
          securityControlVersion: 1,
          assignmentGraph,
        },
      ],
      $queryRawUnsafe: async (statement: string, ...args: unknown[]) => {
        if (statement.includes("job_reader_list_v1")) {
          this.listArguments.push(args);
          return hasLiteralRead
            ? [
                summaryRowFromFacts(SUMMARY_FACTS),
                summaryRowFromFacts(SUMMARY_FACTS),
              ]
            : [];
        }
        if (statement.includes("job_reader_detail_v1")) {
          const id = String(args[2]);
          this.detailIds.push(id);
          return hasLiteralRead && id === SUMMARY_FACTS.id
            ? [{ detail: detailRecordFromFacts(DETAIL_FACTS) }]
            : [];
        }
        throw new Error(`Unexpected fixture SQL: ${statement}`);
      },
    } as RestrictedJobTransaction;
    return operation(tx);
  }
}

const fixtureDatabase = new FixtureJobsDatabase();
const recordedQueries: JobListQueryDto[] = [];
let activeStaff: StaffProjection = STAFF;
let jwtVerifyCalls = 0;

class FixtureIssuingJobCursorService extends JobCursorService {
  override issue(
    payload: Parameters<JobCursorService["issue"]>[0],
    now?: Date,
  ): string {
    if (
      payload.normalizedFilterHash ===
        CURSOR_SUPPORT.requestPayload.normalizedFilterHash &&
      payload.lastJobId === FIXTURE.detail.jobId
    ) {
      return FIXTURE.listPage.nextCursor;
    }
    return super.issue(payload, now);
  }
}

class NonJobsValidationQuery {
  @IsIn(["valid"])
  value!: string;
}

@Controller("fixture/non-jobs-validation")
class NonJobsValidationController {
  @Get()
  probe(@Query() query: NonJobsValidationQuery): { value: string } {
    return query;
  }
}

@Module({
  controllers: [JobsReaderController, NonJobsValidationController],
  providers: [
    { provide: APP_GUARD, useClass: OperationContextGuard },
    { provide: APP_FILTER, useClass: ApiProblemBoundaryFilter },
    JobsReaderEnabledGuard,
    IdentityAccessGuard,
    {
      provide: JobCursorService,
      useFactory: () => new FixtureIssuingJobCursorService(CONFIG),
    },
    { provide: JOBS_CONFIG, useValue: CONFIG },
    { provide: JobsDatabaseService, useValue: fixtureDatabase },
    {
      provide: JobsReaderService,
      useFactory: (
        database: JobsDatabaseService,
        cursor: JobCursorService,
        config: JobsConfig,
      ) => {
        const reader = new JobsReaderService(database, cursor, config);
        const list = reader.list.bind(reader);
        reader.list = async (user, query) => {
          recordedQueries.push(query);
          return list(user, query);
        };
        return reader;
      },
      inject: [JobsDatabaseService, JobCursorService, JOBS_CONFIG],
    },
    {
      provide: IdentityJwtService,
      useValue: {
        verify: async (token: string) => {
          jwtVerifyCalls += 1;
          activeStaff =
            token === "fixture-wildcard-token" ? WILDCARD_STAFF : STAFF;
          return { sid: SESSION.id, sub: STAFF.id, ver: 1 };
        },
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
        staffInfo: async () => activeStaff,
      },
    },
  ],
})
class JobsReaderHttpContractModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ServerCorrelationMiddleware).forRoutes("*");
  }
}

test("jobs real Nest HTTP pipeline matches the shared jc1 contract", async (context) => {
  resetFixtureState();
  const app = await createContractApp();
  context.after(async () => app.close());
  const baseUrl = await listen(app);

  const defaultResponse = await fixtureFetch(`${baseUrl}/admin/v1/jobs`);
  assert.equal(defaultResponse.status, 200);
  assert.equal(defaultResponse.headers.get("cache-control"), "no-store");
  const defaultBody = await jsonBody(defaultResponse);
  if (!isRecord(defaultBody) || !Array.isArray(defaultBody["items"]))
    throw new Error("Default list response is not a list envelope");
  assert.deepEqual(defaultBody["items"], FIXTURE.listPage.items);
  assert.deepEqual(Object.keys(recordedQueries[0]), [...JOB_QUERY_KEYS]);
  assert.equal(
    Object.values(recordedQueries[0]).every((value) => value === undefined),
    true,
  );
  assertDefaultDatabaseArguments(fixtureDatabase.listArguments[0]);

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(FIXTURE.listQuery))
    search.set(key, String(value));
  const listResponse = await fixtureFetch(
    `${baseUrl}/admin/v1/jobs?${search.toString()}`,
  );
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.headers.get("cache-control"), "no-store");
  const listBody = await jsonBody(listResponse);
  assert.deepEqual(listBody, FIXTURE.listPage);
  assertExactListKeys(listBody);
  assert.deepEqual({ ...recordedQueries[1] }, FIXTURE.listQuery);
  assert.deepEqual(Object.keys(FIXTURE.listQuery), [...JOB_QUERY_KEYS]);
  assertFullDatabaseArguments(fixtureDatabase.listArguments[1]);

  const detailResponse = await fixtureFetch(
    `${baseUrl}/admin/v1/jobs/${encodeURIComponent(FIXTURE.detail.jobId)}`,
  );
  assert.equal(detailResponse.status, 200);
  assert.equal(detailResponse.headers.get("cache-control"), "no-store");
  const detailBody = await jsonBody(detailResponse);
  assert.deepEqual(detailBody, FIXTURE.detail);
  assertExactDetailKeys(detailBody);
  assert.deepEqual(fixtureDatabase.detailIds, [FIXTURE.detail.jobId]);

  assert.equal(fixtureDatabase.users.length, 3);
  for (const user of fixtureDatabase.users) {
    assert.equal(user.id, STAFF.id);
    assert.equal(user.sessionId, SESSION.id);
    assert.deepEqual(user.permissionGrants, STAFF.permissionGrants);
    assert.equal(
      user.permissionGrants.some((grant) => grant.permission === "jobs.read"),
      true,
    );
  }
});

test("jobs HTTP errors are canonical and detail denial is non-disclosing", async (context) => {
  resetFixtureState();
  const app = await createContractApp();
  context.after(async () => app.close());
  const baseUrl = await listen(app);

  const unknown = await fixtureFetch(
    `${baseUrl}/admin/v1/jobs?unknownJobField=blocked`,
  );
  assert.equal(unknown.status, 400);
  assert.equal(unknown.headers.get("cache-control"), "no-store");
  await assertProblem(unknown, "INVALID_JOB_QUERY");

  const invalidEnum = await fixtureFetch(
    `${baseUrl}/admin/v1/jobs?state=not_a_job_state`,
  );
  assert.equal(invalidEnum.status, 400);
  assert.equal(invalidEnum.headers.get("cache-control"), "no-store");
  await assertProblem(invalidEnum, "INVALID_REQUEST");

  const invalidCursor = await fixtureFetch(
    `${baseUrl}/admin/v1/jobs?cursor=jc1.invalid`,
  );
  assert.equal(invalidCursor.status, 400);
  assert.equal(invalidCursor.headers.get("cache-control"), "no-store");
  await assertProblem(invalidCursor, "INVALID_JOB_CURSOR");

  const nonJobsValidation = await fixtureFetch(
    `${baseUrl}/fixture/non-jobs-validation?value=invalid`,
  );
  assert.equal(nonJobsValidation.status, 400);
  await assertProblem(nonJobsValidation, "INVALID_REQUEST");

  const missingId = "33333333-3333-4333-8333-333333333333";
  const inaccessibleId = "44444444-4444-4444-8444-444444444444";
  const missing = await fixtureFetch(`${baseUrl}/admin/v1/jobs/${missingId}`);
  const inaccessible = await fixtureFetch(
    `${baseUrl}/admin/v1/jobs/${inaccessibleId}`,
    "fixture-wildcard-token",
  );
  for (const response of [missing, inaccessible]) {
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    await assertProblem(response, "JOB_NOT_FOUND");
  }

  const wildcardList = await fixtureFetch(
    `${baseUrl}/admin/v1/jobs`,
    "fixture-wildcard-token",
  );
  assert.equal(wildcardList.status, 200);
  const wildcardBody = await jsonBody(wildcardList);
  if (!isRecord(wildcardBody))
    throw new Error("Wildcard list is not an object");
  assert.deepEqual(wildcardBody["items"], []);
});

test("jobs reader disabled guard denies before auth or database access", async (context) => {
  resetFixtureState();
  CONFIG.enabled = false;
  const app = await createContractApp();
  context.after(async () => {
    CONFIG.enabled = true;
    await app.close();
  });
  const response = await fixtureFetch(`${await listen(app)}/admin/v1/jobs`);
  assert.equal(response.status, 503);
  await assertProblem(response, "JOBS_READER_DISABLED");
  assert.equal(jwtVerifyCalls, 0);
  assert.equal(fixtureDatabase.contextCalls, 0);
});

test("shared jobs cursor decrypts with actual jc1 crypto and rejects tampering", () => {
  const cursor = new JobCursorService(CONFIG);
  assert.equal(
    CURSOR_SUPPORT.warning,
    "TEST_ONLY_DO_NOT_USE_IN_RUNTIME_CONFIGURATION",
  );
  assert.equal(FIXTURE.listQuery.cursor.split(".").length, 5);
  const payload = cursor.decrypt(
    FIXTURE.listQuery.cursor,
    new Date(CURSOR_SUPPORT.decryptAt),
  );
  assert.deepEqual(payload, CURSOR_SUPPORT.requestPayload as JobCursorPayload);
  assert.deepEqual(
    cursor.decrypt(
      FIXTURE.listPage.nextCursor,
      new Date(CURSOR_SUPPORT.decryptAt),
    ),
    CURSOR_SUPPORT.nextPayload as JobCursorPayload,
  );
  assert.equal(
    payload.authorizationGraphDigest,
    jobDomainHash("authorization-graph", CURSOR_SUPPORT.authorizationGraph),
  );
  assert.equal(
    payload.normalizedFilterHash,
    jobDomainHash("normalized-filter", CURSOR_SUPPORT.normalizedQuery),
  );
  const tampered = `${FIXTURE.listQuery.cursor.slice(0, -1)}${FIXTURE.listQuery.cursor.endsWith("A") ? "B" : "A"}`;
  assert.throws(
    () => cursor.decrypt(tampered, new Date(CURSOR_SUPPORT.decryptAt)),
    /INVALID_JOB_CURSOR/,
  );
});

async function createContractApp(): Promise<INestApplication> {
  const app = await NestFactory.create(JobsReaderHttpContractModule, {
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

function fixtureFetch(
  url: string,
  token = "fixture-access-token",
): Promise<Response> {
  return fetch(url, { headers: { authorization: `Bearer ${token}` } });
}

async function jsonBody(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

async function assertProblem(response: Response, code: string): Promise<void> {
  const body = await jsonBody(response);
  if (!isRecord(body)) throw new Error("Problem is not an object");
  assert.equal(body["type"], "about:blank");
  assert.equal(body["status"], response.status);
  assert.equal(body["code"], code);
  assert.equal(body["serverCorrelationId"], response.headers.get("x-server-correlation-id"));
  assert.equal(response.headers.get("content-type")?.split(";", 1)[0], "application/problem+json");
  assert.equal(response.headers.get("cache-control"), "no-store");
}

function resetFixtureState(): void {
  CONFIG.enabled = true;
  activeStaff = STAFF;
  jwtVerifyCalls = 0;
  fixtureDatabase.reset();
  recordedQueries.length = 0;
}

function summaryRowFromFacts(facts: SummaryFacts): Record<string, unknown> {
  return {
    jobId: facts.id,
    jobType: facts.type,
    schemaVersion: facts.schema,
    ownerDomain: facts.domain,
    state: facts.status,
    priority: facts.priority,
    createdAt: new Date(facts.created),
    availableAt: new Date(facts.available),
    serverCorrelationId: facts.correlation,
    causationId: facts.causation ?? null,
    originatingAuditEventId: facts.auditEvent,
    safeSummary: facts.safeFields.map((field) => ({
      key: field.key,
      label: field.label,
      classification: field.classification,
      value: field.value,
    })),
  };
}

function detailRecordFromFacts(facts: DetailFacts): Record<string, unknown> {
  const summary = summaryRowFromFacts(facts.summary);
  return {
    ...summary,
    createdAt: facts.summary.created,
    availableAt: facts.summary.available,
    authorizationScopeKind: facts.authorization.kind,
    authorizationScopeRefs: facts.authorization.scopes.map((scope) => ({
      dimension: scope.dimension,
      id: scope.id,
    })),
    scopeMatchMode: facts.authorization.match,
    requiredGlobalGrant: facts.authorization.globalGrant ?? null,
    scopeResolverId: facts.authorization.resolver.id,
    scopeResolverVersion: facts.authorization.resolver.version,
    authorizationPolicyVersion: facts.authorization.policyVersion,
    currentLeaseGeneration: facts.lease.generation,
    leaseExpiresAt: facts.lease.expires ?? null,
    attempts: facts.attempts.map((attempt) => ({
      attemptStartedId: attempt.attemptStartedId,
      leaseGeneration: attempt.leaseGeneration,
      startedAt: attempt.startedAt,
      outcome: attempt.outcome ?? null,
      outcomeAt: attempt.outcomeAt ?? null,
      safeReasonCode: attempt.safeReasonCode ?? null,
    })),
    reconciliations: facts.reconciliations.map((reconciliation) => ({
      reconciliationId: reconciliation.reconciliationId,
      state: reconciliation.state,
      occurredAt: reconciliation.occurredAt,
      safeReasonCode: reconciliation.safeReasonCode,
    })),
  };
}

function assertDefaultDatabaseArguments(args: unknown[]): void {
  assert.equal(args[0], STAFF.id);
  assert.equal(args[1], SESSION.id);
  assert(args[2] instanceof Date);
  assert(args[3] instanceof Date);
  assert.equal(
    (args[3] as Date).getTime() - (args[2] as Date).getTime(),
    7_200_000,
  );
  assert.deepEqual(args.slice(4, 8), [null, null, null, null]);
  assert.deepEqual(args.slice(8, 11), ["createdAt", "desc", 2]);
  assert.deepEqual(args.slice(11), [null, null, null]);
}

function assertFullDatabaseArguments(args: unknown[]): void {
  const query = CURSOR_SUPPORT.normalizedQuery;
  assert.equal((args[2] as Date).toISOString(), query.createdFrom);
  assert.equal((args[3] as Date).toISOString(), query.createdTo);
  assert.deepEqual(args.slice(4, 11), [
    query.state,
    query.jobType,
    query.ownerDomain,
    query.correlationId,
    query.sortField,
    query.sortDirection,
    query.pageSize + 1,
  ]);
  assert.deepEqual(args.slice(11), [
    CURSOR_SUPPORT.requestPayload.lastSortValue,
    new Date(CURSOR_SUPPORT.requestPayload.lastCreatedAt),
    CURSOR_SUPPORT.requestPayload.lastJobId,
  ]);
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
    Object.keys(FIXTURE.listPage.items[0]).sort(),
  );
  assert.equal(JOB_STATES.includes(items[0]["state"] as never), true);
}

function assertExactDetailKeys(value: unknown): void {
  if (!isRecord(value)) throw new Error("Detail response must be an object");
  assert.deepEqual(
    Object.keys(value).sort(),
    Object.keys(FIXTURE.detail).sort(),
  );
  assert.equal(
    JOB_AUTHORIZATION_SCOPE_KINDS.includes(
      value["authorizationScopeKind"] as never,
    ),
    true,
  );
  assert.equal(
    JOB_SCOPE_MATCH_MODES.includes(value["scopeMatchMode"] as never),
    true,
  );
  const attempts = value["attempts"];
  if (!Array.isArray(attempts) || !isRecord(attempts[0]))
    throw new Error("Detail attempts must contain an object");
  assert.deepEqual(
    Object.keys(attempts[0]).sort(),
    Object.keys(FIXTURE.detail.attempts[0]).sort(),
  );
  assert.equal(
    JOB_TERMINAL_KINDS.includes(attempts[0]["outcome"] as never),
    true,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
