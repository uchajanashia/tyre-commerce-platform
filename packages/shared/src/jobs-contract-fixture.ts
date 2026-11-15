import { JobDetail, JobListResult, JobReaderError, JobSummary } from "./jobs";

const safeSummary = [
  {
    key: "operation",
    label: "Operation",
    classification: "public_operational" as const,
    value: "inventory.snapshot",
  },
];

const summary = {
  jobId: "11111111-1111-4111-8111-111111111111",
  jobType: "inventory.snapshot",
  schemaVersion: 1,
  ownerDomain: "inventory",
  state: "dead_lettered",
  priority: 20,
  createdAt: "2026-07-30T08:00:00.000Z",
  availableAt: "2026-07-30T08:00:00.000Z",
  serverCorrelationId: "fixture-job-correlation-001",
  originatingAuditEventId: "fixture-audit-event-job-001",
  safeSummary,
  allowedActions: [],
} satisfies JobSummary;

const cursorAssignmentGraph = [
  {
    assignmentId: "fixture-job-assignment-001",
    roleId: "fixture-job-role-001",
    roleVersion: 1,
    permission: "jobs.read",
    scopeType: "warehouse",
    scopeId: "fixture-warehouse-001",
  },
];

const cursorAuthorizationGraph = {
  viewerId: "fixture-job-reader-001",
  sessionId: "fixture-job-session-001",
  accountVersion: 1,
  tokenVersion: 1,
  minimumAuthContractVersion: 2,
  securityControlVersion: 1,
  readerPolicyVersion: 1,
  assignmentGraph: cursorAssignmentGraph,
};

const cursorNormalizedQuery = {
  createdFrom: "2026-07-30T07:00:00.000Z",
  createdTo: "2026-07-30T08:30:00.000Z",
  state: "dead_lettered",
  jobType: "inventory.snapshot",
  ownerDomain: "inventory",
  correlationId: "fixture-job-correlation-001",
  sortField: "createdAt",
  sortDirection: "desc",
  pageSize: 1,
} as const;

const requestCursorPayload = {
  cursorVersion: "jc1",
  keyId: "fixture_test_only_job_cursor_key_v1",
  viewerId: cursorAuthorizationGraph.viewerId,
  sessionId: cursorAuthorizationGraph.sessionId,
  accountVersion: 1,
  tokenVersion: 1,
  minimumAuthContractVersion: 2,
  securityControlVersion: 1,
  authorizationGraphDigestVersion: 1,
  authorizationGraphDigest: "PayIBbYMcOE5ETxgKd-n3K5my6jeC9-t8RvEsXts-xo",
  readerPolicyVersion: 1,
  normalizedFilterHash: "3uD64_3SoR6KYXMcIY4SZdfzbcMy87vXq0xfdE_dU70",
  sortField: "createdAt",
  sortDirection: "desc",
  pageSize: 1,
  asOfCreatedAt: "2026-07-30T08:30:00.000Z",
  lastSortValue: "2026-07-30T07:59:00.000Z",
  lastCreatedAt: "2026-07-30T07:59:00.000Z",
  lastJobId: "00000000-0000-4000-8000-000000000000",
  issuedAt: "2026-07-30T09:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
} as const;

const requestCursor =
  "jc1.fixture_test_only_job_cursor_key_v1.AQIDBAUGBwgJCgsM.1QzN_lMEVoMb651XkJNSSytkwwt0FKJ9M1QHLnfUGdjEwxuN7--gLqtJtjQJP1a36Tup2Jr3p4Jz0RVHc5aRaJfRBJb8sOzRP3gOABdBwjuYMSRv7CI0EREiyuVyCmIt0HujrAXGV6P1v7H_OP4bks547JfmkqAu1Kii71duyu2OZJgC7JrVVq838o5GC3u-yVARQjmmJm1dH5WqnSwgabkQqXlXAEmqwNEj8dHOhKciUp2wBBklAza8-zkBiFer94GwSHmkIYHJ87mRttV6yVqvRk-S8ZhoQsdr1e0CY-qLQ8lr4QTOxeBH_iqACHMbT3jLsqy4vn5TJcYctJZeKwfdcBYdITupQLztCtOx-9XkS96Wr5Vj8wgWNv0WxzPy1RSQai0nXGIkZfkNy_WwX7mSYZEIIDCM9NhBpBYUWeiRjb8nQJpcKBAk8GdNCLT07U4RBqJowehXcV_93zqU9r7F_JnPa2lGMcgcUbXlcC82-q3cfz3yi0sUcVCgaZifmWd8xiHsoApA237goCQDJ6o_xbkaRT6DknblIcswigzdNZIAyDAzLmHr8pyZUZ7jkgQ5a3BJL5oO0y2n2h92GiYhz_bnx1PTctYIKk6xbN8h64bDsUezqHGMk6lsp4RwHfpTA1-vpBtFrz8EqBF0GP2vBGs-7ALQPN7Zhwm2tNqftA48XTL7lOct7Revig6obFjjzVutMKlWkeOaPQkIfTccmFobTW9Pu6qm08D56G7XjSYufBfW_9vJfqAI3Un_p3PfWWEW0yEo3L7Hqokn4OMOLr0iXYWwWrR-0-whypGaf7fOvQAyWfL9Kxs3jCbxMolux3f1zUzie0DJu_dRdlzPxoZIJvUYnvlsibBpeV4TQsKKMZtHHlzHX7c_m8b3SqDICBtRh9y_iBZJPr6Xi7PbvZMY89yqf7eqvGZ7BfvRgzU-rurMue23Hl6mHFhfQQiJkGpIJj3IHvYP3IFO9ha80dlCADIjM934Oh0D3rsdSOE2.DG09WOV54CIcN5hsSDxfnQ";

const nextCursorPayload = {
  ...requestCursorPayload,
  lastSortValue: summary.createdAt,
  lastCreatedAt: summary.createdAt,
  lastJobId: summary.jobId,
} as const;

const nextCursor =
  "jc1.fixture_test_only_job_cursor_key_v1.DQ4PEBESExQVFhcY.mm5kgT2iZAdkE2Gs7pf1gmW3Omu0_UJj50s_8yOFIURuDrMckhp8uYdTAZanyAqlvluqUCrmS__8jVuO-ovTefDWidZAOUATxjtKJTlugHU1w6rQjZzbLXedWDWPiXu_Vz7J5I54X3Boyp5l-AAgkc-lBjSlz-ao-9gQpYgNehO5pgRGMq1ex_pn-durlEnHzAXUU0O8wiD6xKHxnljhw8c7UWy3jq5gKY1GjrR-Ak3NmeRo0mEA6i5Iy3AlYUyDHXMn6c_AVh__JCaBAH1IAAVkB1z9MvvDfGRhu2wKx05Egg0sP_PnPYvZ4XMQ4RRDV0lCpm-Ufdbl8q22ufSGZiJpDJZw3SmC9NcsBscShxCrVTURLDI99vdPNDt-YfOhu4BAoXExTwsMrJ4EfT8fRkp_Z6gY0yrP_8Prv7KSnR9tRZJVwFDumMnym6v-QVY4uUQge0o0XCi7GZJjxRnjD5FGkYG-Si0XzxKrfJQHemzUd1UL6yODDH4bUVq5r4qTLJudJE9IfgQDYj9JJwS1a6jEJFrF359fmGnraUSowh3zJ9PQ1IzRUF51SybM9Yq2J99rR2BJtSxoGO0QXleymzNpSplxm1CMVoxfco7wX40k_nNsAupvWLaAauhfCDhnPIvjKTmBwyboccxNTPd-EAH32USa3YwPB3rj4MYBSAAKsfT5MHmh75uDB3hqQLoQnEV1hE2gjks8HpXcJIIcFsZetsvphK7CcVUWIdvS5pUa89cZA9CiZdmoQZi3hrCeXZUjJuqzUbStHCT5ehHgruHZZRwud9k8GrDY4teyPx7LijW9FRx0hVkiqQ68WXejY5qv0Sc6HYGSr7hP3aHyK8Fsx6B9jgnafNsNq0AjBgVCqGoWoUeA0w4AooAG0QhO5RYmDXl-9f-bZisrxKuy-uvJrbX95q1FNHvM2XKUYwoNpSC-f5q0HEDqKC42NcYtjhGLxaG3ifxkF2ARH6BDlhVRTIlSk28bKvuAt1287S1zk0BE.6-LtZNweRHh7G1yn_1PNkQ";

const listQuery = {
  state: cursorNormalizedQuery.state,
  jobType: cursorNormalizedQuery.jobType,
  ownerDomain: cursorNormalizedQuery.ownerDomain,
  correlationId: cursorNormalizedQuery.correlationId,
  createdFrom: cursorNormalizedQuery.createdFrom,
  createdTo: cursorNormalizedQuery.createdTo,
  sortField: cursorNormalizedQuery.sortField,
  sortDirection: cursorNormalizedQuery.sortDirection,
  pageSize: cursorNormalizedQuery.pageSize,
  cursor: requestCursor,
};

const listPage = {
  items: [summary],
  nextCursor,
  asOfCreatedAt: requestCursorPayload.asOfCreatedAt,
  allowedActions: [],
} satisfies JobListResult;

const detail = {
  ...summary,
  authorizationScopeKind: "resource_scoped",
  authorizationScopeRefs: [
    { dimension: "warehouse", id: "fixture-warehouse-001" },
  ],
  scopeMatchMode: "all",
  scopeResolverId: "fixture-inventory-scope-resolver",
  scopeResolverVersion: 1,
  authorizationPolicyVersion: 1,
  currentLeaseGeneration: 1,
  leaseExpiresAt: "2026-07-30T08:01:30.000Z",
  attempts: [
    {
      attemptStartedId: "22222222-2222-4222-8222-222222222222",
      leaseGeneration: 1,
      startedAt: "2026-07-30T08:01:00.000Z",
      outcome: "dead_lettered",
      outcomeAt: "2026-07-30T08:02:00.000Z",
      safeReasonCode: "FIXTURE_SCHEMA_REJECTED",
    },
  ],
  reconciliations: [],
} satisfies JobDetail;

const errors = {
  invalidCursor: { code: "INVALID_JOB_CURSOR" },
  notFound: { code: "JOB_NOT_FOUND" },
  invalidQuery: { code: "INVALID_JOB_QUERY" },
} satisfies Record<string, JobReaderError>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
  }
  return value;
}

/** Conspicuously test-only jc1 key/config. Never import this into runtime modules. */
export const JOB_CURSOR_TEST_ONLY_V1 = deepFreeze({
  warning: "TEST_ONLY_DO_NOT_USE_IN_RUNTIME_CONFIGURATION",
  keyId: requestCursorPayload.keyId,
  keyMaterialBase64Url: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
  decryptAt: "2026-07-30T13:00:00.000Z",
  cursorMaxTtlSeconds: 3_000_000_000,
  maxPageSize: 1,
  readerPolicyVersion: 1,
  authorizationGraph: cursorAuthorizationGraph,
  normalizedQuery: cursorNormalizedQuery,
  requestPayload: requestCursorPayload,
  nextPayload: nextCursorPayload,
});

/** Wire-only interoperability fixture. It contains no runtime key material or raw job payload. */
export const JOB_CONTRACT_FIXTURE_V1 = deepFreeze({
  version: "job-contract-fixture-v1" as const,
  listQuery,
  listPage,
  detail,
  errors,
});
