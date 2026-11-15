export type AuditAuthorizationScopeKind =
  | 'resource_scoped'
  | 'global_security'
  | 'cross_scope'
  | 'legacy_restricted';
export type AuditScopeMatchMode = 'all' | 'any';
export type AuditScopeDimension = 'warehouse' | 'channel' | 'company';
export type AuditEventSource = 'admin_api' | 'job' | 'webhook' | 'import' | 'system';
export type AuditEventOutcome = 'succeeded' | 'failed' | 'denied';
export type AuditSafeFieldClassification = 'public_operational' | 'masked';
export type AuditSortField = 'occurredAt' | 'eventType' | 'outcome';
export type AuditSortDirection = 'asc' | 'desc';

export interface AuditSafeField {
  key: string;
  label: string;
  classification: AuditSafeFieldClassification;
  value: string | number | boolean | null;
}

export interface AuditScopeRef {
  dimension: AuditScopeDimension;
  id: string;
}

export interface AuditEventSummary {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  actorId: string;
  actorType: string;
  subjectType: string;
  subjectId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  entityVersion?: string;
  outcome: AuditEventOutcome;
  source: AuditEventSource;
  retentionClass: string;
  serverCorrelationId: string;
  approvalRequestId?: string;
  approvalExecutionId?: string;
  allowedActions: [];
}

export interface AuditEventDetail extends AuditEventSummary {
  authorizationScopeKind: AuditAuthorizationScopeKind;
  authorizationScopeRefs: AuditScopeRef[];
  scopeMatchMode: AuditScopeMatchMode;
  scopeResolverId: string;
  scopeResolverVersion: number;
  authorizationPolicyVersion: number;
  reasonCode?: string;
  before: AuditSafeField[];
  after: AuditSafeField[];
  metadata: AuditSafeField[];
  causationId?: string;
  clientRequestId?: string;
  bulkOperationId?: string;
  bulkItemId?: string;
}

export interface AuditEventListResult {
  items: AuditEventSummary[];
  nextCursor?: string;
  asOfOccurredAt: string;
  allowedActions: [];
}

export interface AuditReaderError {
  code: 'AUDIT_READER_DISABLED' | 'AUDIT_EVENT_NOT_FOUND' | 'INVALID_AUDIT_CURSOR' | 'INVALID_AUDIT_QUERY';
}
