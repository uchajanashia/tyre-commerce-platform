import {
  AuditEventDetail,
  AuditEventListResult,
  AuditEventOutcome,
  AuditEventSource,
  AuditEventSummary,
  AuditReaderError,
  AuditSortDirection,
  AuditSortField,
} from "./audit";

/** Exact V2 HTTP query vocabulary exercised by the cross-workspace contract tests. */
export interface AuditEventV2ListQueryContractV1 {
  readonly occurredFrom: string;
  readonly occurredTo: string;
  readonly eventFamily: string;
  readonly outcome: AuditEventOutcome;
  readonly actorId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly approvalRequestId: string;
  readonly approvalExecutionId: string;
  readonly serverCorrelationId: string;
  readonly causationId: string;
  readonly bulkOperationId: string;
  readonly bulkItemId: string;
  readonly source: AuditEventSource;
  readonly retentionClass: string;
  readonly sortField: AuditSortField;
  readonly sortDirection: AuditSortDirection;
  readonly pageSize: number;
  readonly cursor: string;
}

export interface AuditEventV2ContractFixtureV1 {
  readonly version: "audit-event-v2-contract-fixture-v1";
  readonly listQuery: AuditEventV2ListQueryContractV1;
  readonly summary: AuditEventSummary;
  readonly listPage: AuditEventListResult;
  readonly detail: AuditEventDetail;
  readonly errors: {
    readonly invalidCursor: AuditReaderError;
    readonly eventNotFound: AuditReaderError;
    readonly invalidQuery: AuditReaderError;
  };
}

/** Test-only decoded cursor contract. This material must never be used by runtime configuration. */
export interface AuditEventV2CursorPayloadContractV1 {
  readonly cursorVersion: "ac1";
  readonly keyId: string;
  readonly viewerId: string;
  readonly sessionId: string;
  readonly accountVersion: number;
  readonly tokenVersion: number;
  readonly minimumAuthContractVersion: number;
  readonly securityControlVersion: number;
  readonly authorizationGraphDigestVersion: 1;
  readonly authorizationGraphDigest: string;
  readonly readerPolicyVersion: number;
  readonly normalizedFilterHash: string;
  readonly sortField: AuditSortField;
  readonly sortDirection: AuditSortDirection;
  readonly pageSize: number;
  readonly asOfOccurredAt: string;
  readonly lastSortValue: string;
  readonly lastOccurredAt: string;
  readonly lastEventId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

const cursorAuthorizationGraph = {
  viewerId: "fixture-reader-001",
  sessionId: "fixture-session-001",
  accountVersion: 1,
  tokenVersion: 1,
  minimumAuthContractVersion: 2,
  securityControlVersion: 1,
  readerPolicyVersion: 1,
  assignmentGraph: {
    grants: [{ permission: "audit.read", scopeType: "global", scopeId: "" }],
  },
};

const cursorNormalizedQuery = {
  occurredFrom: "2026-07-30T00:00:00.000Z",
  occurredTo: "2026-07-30T00:31:00.000Z",
  eventFamily: "inventory.stock",
  outcome: "succeeded",
  actorId: "fixture-actor-001",
  entityType: "InventoryItem",
  entityId: "fixture-item-001",
  approvalRequestId: "fixture-approval-request-001",
  approvalExecutionId: "fixture-approval-execution-001",
  serverCorrelationId: "fixture-server-correlation-001",
  causationId: "fixture-causation-001",
  bulkOperationId: "fixture-bulk-operation-001",
  bulkItemId: "fixture-bulk-item-001",
  source: "admin_api",
  retentionClass: "operational",
  sortField: "occurredAt",
  sortDirection: "desc",
  pageSize: 25,
};

const requestCursorPayload = {
  cursorVersion: "ac1",
  keyId: "fixture_test_only_cursor_key_v1",
  viewerId: "fixture-reader-001",
  sessionId: "fixture-session-001",
  accountVersion: 1,
  tokenVersion: 1,
  minimumAuthContractVersion: 2,
  securityControlVersion: 1,
  authorizationGraphDigestVersion: 1,
  authorizationGraphDigest: "551Mt1XurBwVluAAkXM6cvoHkVy5bZbTavLQnvtV9yo",
  readerPolicyVersion: 1,
  normalizedFilterHash: "foLxBjVV3wENC1HPpF6_v4fCUS7GMD-zs8LX-8RwuSE",
  sortField: "occurredAt",
  sortDirection: "desc",
  pageSize: 25,
  asOfOccurredAt: "2026-07-30T00:31:00.000Z",
  lastSortValue: "2026-07-30T00:20:00.000Z",
  lastOccurredAt: "2026-07-30T00:20:00.000Z",
  lastEventId: "fixture-audit-event-000",
  issuedAt: "2026-07-30T04:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
} satisfies AuditEventV2CursorPayloadContractV1;

const nextCursorPayload = {
  ...requestCursorPayload,
  lastSortValue: "2026-07-30T00:30:00.000Z",
  lastOccurredAt: "2026-07-30T00:30:00.000Z",
  lastEventId: "fixture-audit-event-001",
} satisfies AuditEventV2CursorPayloadContractV1;

const requestCursor =
  "ac1.fixture_test_only_cursor_key_v1.AQIDBAUGBwgJCgsM.1QzN_lMEVoMb651XkJNSSytkwwt0FKJ9M1gWKGPSDtnh9k2V9_-iLK9SqzMTIVXTjTOj0Zn8rYJtzxVHGe6fZtTFBYr7rffCJG0TBhZo9yiJKQhC4iAiFkc60pcmRhoixhO2ujjBFbDNspf1N4s4l-Y77qa7rrxYj9-0g2Ruw8-4Zp95rYyYWKF05o9aDGal2ksEXz-nD1hODo2GsCIif74ymm5WGk-rjMko7N-PkqAjToCUNw4kGTC9tyEZwFX55I--D2SsOJre5Yuk4M1i2VimRluP8IR1Q6IP1ecIY-CBQ9d14QSkve5JtTCADmMaak2dqrSovHxXPtsbrohdT2PUfhwdKzGpXqLtCrnJ9dutRcKmgtN760wZJ_EXwCTI_gWGbQYXXWAxQ8wB3NigRbm-ZYYuFCPEiYJS6ltFQcyUnJIhbJ8Kd1YD7T0DX_Sh8hlJUvwx3711JAazxzOe9qzH7sWeQj8lcMcIULPKewwLvLXEbz3wjVYUdk2jdPyfmW1jwivsoAlI236KrzgRe_t8gdpFB3rlwzi8ZoVr20q-aNZZrmZyaDSd-I6RU5zvjwQgdnNJIYgVy3X3jkYrQXtQititqB7Qb8oAJE-KSNgm6qrC_Qnz5TCWqr5ztYF2Cb0NdxrhvhFFij8bqUkrXt2pJGcZ9BznfMG-82i0ic7ZxmdQeGnP4fkngh2Bh3rmTDrL8wz3AZNa-pHOSVpIZDYdjmwFfXpFq7OogdP77FnbhRNjKk-ZpP_JbbcEwHey8SuQAkQWwicz2qSc09dltuIEIZ41RoKgdrUyna9ihLSafrfOvQBZB-HrKw47hyHtL4IK0DC8nEPkbRmM-aNeMBHehIdZEe8DlPQ10O82eUgTVciLJv0CTkrLWaoWnIGhDOaXWRcQyIu-lQFZOaPQy_WN6Noe7--ueaGnknx7E-iJzigypcvMude6UwqmQAALFwuSkDBfMRXIWb4AitgHoB4.muqUrFSU556tYSoMSQVjzA";

const nextCursor =
  "ac1.fixture_test_only_cursor_key_v1.DQ4PEBESExQVFhcY.mm5kgT2iZAdkE2Gs7pf1gmW3Omu0_UJj50cu9TeDNkVLO-UEigp-u4NIHJG91gnB2lOgWSntQf_ik1uOkPPdd7PCiMpHJFsA3S5XIzhHtWYk24b9g57NKiGFQEfbxQOwQVbc8rN_HWNQx7hv93UDlOfmBAX48_reoK8GybsNczGPpAM9c7sTyfQk7dq3k1Tc3x7BTkW96xXp1bnds1bj1cAZYnu2lKhhZZVNk7o_FErMhflM4XYB8ChJh2g9KU7RDn0prtLITwToMhS0VmVQEAdtB0jgM-fefQEFu2YAx0ROghMyP_ONRYXXqmkQ5wRCcnwUvneEf9Th6bCxo-qFAkZgApxw1yOC6sksBq1qiR7iWykhAXQl7rNAJTd_ZuSbkJFWploBTgkZiqsIahIPXEpTY78-5zmHgpn48f_DhTtoVL9T7FW4x4_VhvGwFhZtphN4LxRtQn2ZTMQt2BnpDoNEg93vY3t0jh2_fZIocU_pMU0T-yKAC2IaV0a7su-SLZCDIERJfwcLYz4iKBmmNviGYTibnNo4yCeyLgrzk1uQepeJstqQFgsDQTTE9oi6Ot9yWmNJuz58ALBJCg7vwG4YD7c79B2PS5BXfI_Le4oj_19tTqQvFfeaU_9AGj1hKMy9XXzP2SzoVMxSTa8hViHx-Ui9xZI4R2WElKcDdRRMw52VFSKVmoWJaHJETc5evCdduhr6v3EwdeeIUNFcD8dfoP33tLvIYUwYc8jQ4qIW--JUVYjtPv2oUo-7m47TC81sfc-zQLK2Gj6iA0-i-ODTaj85bN4sNrGUrJTxcTvLizW9FRwf20o0qRuwUnC_fpHLxmBzTI6UueEKn_X9bYx9haFsuRPBdtZU8h98BhNCv2AXtiHFgxgMpJ0v1k8Yo1B5XHU_uqiaezw7w7b1uq2f-Pz7-p5BMm3B92iUdRlV6D2ydLu0HHrnZXo2aZ552BKQxfugntRkUCgeSfkKwB0.ouiJ-l0Wv72VdSF6XFerpw";

const listQuery = {
  occurredFrom: "2026-07-30T00:00:00.000Z",
  occurredTo: "2026-07-30T00:31:00.000Z",
  eventFamily: "inventory.stock",
  outcome: "succeeded",
  actorId: "fixture-actor-001",
  entityType: "InventoryItem",
  entityId: "fixture-item-001",
  approvalRequestId: "fixture-approval-request-001",
  approvalExecutionId: "fixture-approval-execution-001",
  serverCorrelationId: "fixture-server-correlation-001",
  causationId: "fixture-causation-001",
  bulkOperationId: "fixture-bulk-operation-001",
  bulkItemId: "fixture-bulk-item-001",
  source: "admin_api",
  retentionClass: "operational",
  sortField: "occurredAt",
  sortDirection: "desc",
  pageSize: 25,
  cursor: requestCursor,
} satisfies AuditEventV2ListQueryContractV1;

const summary = {
  eventId: "fixture-audit-event-001",
  eventType: "inventory.stock.updated",
  schemaVersion: 2,
  occurredAt: "2026-07-30T00:30:00.000Z",
  actorId: "fixture-actor-001",
  actorType: "Staff",
  subjectType: "Warehouse",
  subjectId: "fixture-warehouse-001",
  action: "inventory.stock.update",
  entityType: "InventoryItem",
  entityId: "fixture-item-001",
  entityVersion: "7",
  outcome: "succeeded",
  source: "admin_api",
  retentionClass: "operational",
  serverCorrelationId: "fixture-server-correlation-001",
  approvalRequestId: "fixture-approval-request-001",
  approvalExecutionId: "fixture-approval-execution-001",
  allowedActions: [],
} satisfies AuditEventSummary;

const listPage = {
  items: [summary],
  nextCursor,
  asOfOccurredAt: "2026-07-30T00:31:00.000Z",
  allowedActions: [],
} satisfies AuditEventListResult;

const detail = {
  ...summary,
  authorizationScopeKind: "resource_scoped",
  authorizationScopeRefs: [
    { dimension: "warehouse", id: "fixture-warehouse-001" },
  ],
  scopeMatchMode: "all",
  scopeResolverId: "fixture-inventory-scope-resolver",
  scopeResolverVersion: 3,
  authorizationPolicyVersion: 5,
  reasonCode: "FIXTURE_STOCK_RECONCILIATION",
  before: [
    {
      key: "quantity",
      label: "Stock quantity",
      classification: "public_operational",
      value: 12,
    },
  ],
  after: [
    {
      key: "quantity",
      label: "Stock quantity",
      classification: "public_operational",
      value: 15,
    },
  ],
  metadata: [
    {
      key: "operatorReference",
      label: "Operator reference",
      classification: "masked",
      value: "[masked]",
    },
  ],
  causationId: "fixture-causation-001",
  clientRequestId: "fixture-client-request-001",
  bulkOperationId: "fixture-bulk-operation-001",
  bulkItemId: "fixture-bulk-item-001",
} satisfies AuditEventDetail;

const errors = {
  invalidCursor: { code: "INVALID_AUDIT_CURSOR" },
  eventNotFound: { code: "AUDIT_EVENT_NOT_FOUND" },
  invalidQuery: { code: "INVALID_AUDIT_QUERY" },
} satisfies AuditEventV2ContractFixtureV1["errors"];

Object.freeze(listQuery);
Object.freeze(summary.allowedActions);
Object.freeze(summary);
Object.freeze(listPage.items);
Object.freeze(listPage.allowedActions);
Object.freeze(listPage);
Object.freeze(detail.allowedActions);
Object.freeze(detail.authorizationScopeRefs[0]);
Object.freeze(detail.authorizationScopeRefs);
Object.freeze(detail.before[0]);
Object.freeze(detail.before);
Object.freeze(detail.after[0]);
Object.freeze(detail.after);
Object.freeze(detail.metadata[0]);
Object.freeze(detail.metadata);
Object.freeze(detail);
Object.freeze(errors.invalidCursor);
Object.freeze(errors.eventNotFound);
Object.freeze(errors.invalidQuery);
Object.freeze(errors);
Object.freeze(cursorAuthorizationGraph.assignmentGraph.grants[0]);
Object.freeze(cursorAuthorizationGraph.assignmentGraph.grants);
Object.freeze(cursorAuthorizationGraph.assignmentGraph);
Object.freeze(cursorAuthorizationGraph);
Object.freeze(cursorNormalizedQuery);
Object.freeze(requestCursorPayload);
Object.freeze(nextCursorPayload);

/**
 * Conspicuously test-only key/config for interoperability tests. Never import this into runtime
 * modules or environment readers.
 */
export const AUDIT_EVENT_V2_CURSOR_TEST_ONLY_V1 = Object.freeze({
  warning: "TEST_ONLY_DO_NOT_USE_IN_RUNTIME_CONFIGURATION",
  keyId: "fixture_test_only_cursor_key_v1",
  keyMaterialBase64Url: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
  decryptAt: "2026-07-30T04:30:00.000Z",
  cursorMaxTtlSeconds: 3_000_000_000,
  maxPageSize: 25,
  readerPolicyVersion: 1,
  authorizationGraph: cursorAuthorizationGraph,
  normalizedQuery: cursorNormalizedQuery,
  requestPayload: requestCursorPayload,
  nextPayload: nextCursorPayload,
});

export const AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1 = Object.freeze({
  version: "audit-event-v2-contract-fixture-v1",
  listQuery,
  summary,
  listPage,
  detail,
  errors,
} satisfies AuditEventV2ContractFixtureV1);
