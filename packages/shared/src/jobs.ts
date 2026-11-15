export const JOB_AUTHORIZATION_SCOPE_KINDS = ["resource_scoped", "global_operations", "cross_scope", "legacy_restricted"] as const;
export const JOB_SCOPE_MATCH_MODES = ["all", "any"] as const;
export const JOB_STATES = ["queued", "processing", "succeeded", "known_safe_failure", "external_outcome_unknown", "dead_lettered", "cancelled_before_effect", "reconciling", "reconciled_applied", "reconciled_not_applied"] as const;
export const JOB_TERMINAL_KINDS = ["succeeded", "known_safe_failure", "external_outcome_unknown", "dead_lettered", "cancelled_before_effect"] as const;
export const JOB_RECONCILIATION_STATES = ["reconciling", "reconciled_applied", "reconciled_not_applied"] as const;
export const JOB_SORT_FIELDS = ["createdAt", "availableAt", "state", "priority"] as const;
export const JOB_SORT_DIRECTIONS = ["asc", "desc"] as const;
export const JOB_SAFE_FIELD_CLASSIFICATIONS = ["public_operational", "masked"] as const;
export const JOB_SCOPE_DIMENSIONS = ["warehouse", "channel", "company"] as const;

export type JobAuthorizationScopeKind = typeof JOB_AUTHORIZATION_SCOPE_KINDS[number];
export type JobScopeMatchMode = typeof JOB_SCOPE_MATCH_MODES[number];
export type JobState = typeof JOB_STATES[number];
export type JobTerminalKind = typeof JOB_TERMINAL_KINDS[number];
export type JobSortField = typeof JOB_SORT_FIELDS[number];
export type JobSortDirection = typeof JOB_SORT_DIRECTIONS[number];

export interface JobSafeField {
  key: string;
  label: string;
  classification: typeof JOB_SAFE_FIELD_CLASSIFICATIONS[number];
  value: string | number | boolean | null;
}

export interface JobScopeRef {
  dimension: typeof JOB_SCOPE_DIMENSIONS[number];
  id: string;
}

export interface JobSummary {
  jobId: string;
  jobType: string;
  schemaVersion: number;
  ownerDomain: string;
  state: JobState;
  priority: number;
  createdAt: string;
  availableAt: string;
  serverCorrelationId: string;
  originatingAuditEventId: string;
  causationId?: string;
  safeSummary: JobSafeField[];
  allowedActions: [];
}

export interface JobAttemptFact {
  attemptStartedId: string;
  leaseGeneration: number;
  startedAt: string;
  outcome?: JobTerminalKind;
  outcomeAt?: string;
  safeReasonCode?: string;
}

export interface JobReconciliationFact {
  reconciliationId: string;
  state: typeof JOB_RECONCILIATION_STATES[number];
  occurredAt: string;
  safeReasonCode: string;
}

export interface JobDetail extends JobSummary {
  authorizationScopeKind: JobAuthorizationScopeKind;
  authorizationScopeRefs: JobScopeRef[];
  scopeMatchMode: JobScopeMatchMode;
  requiredGlobalGrant?: string;
  scopeResolverId: string;
  scopeResolverVersion: number;
  authorizationPolicyVersion: number;
  currentLeaseGeneration: number;
  leaseExpiresAt?: string;
  attempts: JobAttemptFact[];
  reconciliations: JobReconciliationFact[];
}

export interface JobListResult {
  items: JobSummary[];
  nextCursor?: string;
  asOfCreatedAt: string;
  allowedActions: [];
}

export interface JobReaderError {
  code:
    | "JOBS_READER_DISABLED"
    | "JOB_NOT_FOUND"
    | "INVALID_JOB_CURSOR"
    | "INVALID_JOB_QUERY";
}
