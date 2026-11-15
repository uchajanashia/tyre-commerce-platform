export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'stale'
  | 'executing'
  | 'executed'
  | 'known_safe_execution_failed'
  | 'external_outcome_unknown'
  | 'reconciling'
  | 'dead_lettered';

export type ApprovalAllowedAction = 'approve' | 'reject' | 'cancel';
export type ApprovalSortField = 'createdAt' | 'expiresAt' | 'status' | 'actionType';
export type SortDirection = 'asc' | 'desc';

export interface SafeActorReference {
  readonly id: string;
  readonly displayName: string;
}

export interface SafeTargetReference {
  readonly type: string;
  readonly id: string;
  readonly version: number;
  readonly label: string;
}

export interface SafeFieldProjection {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly classification: 'operational' | 'masked';
}

export interface SafeDiffProjection {
  readonly key: string;
  readonly label: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly classification: 'operational' | 'masked';
}

export interface ApprovalQuorumProjection {
  readonly satisfied: number;
  readonly required: number;
}

export interface ApprovalSummary {
  readonly id: string;
  readonly version: number;
  readonly actionType: string;
  readonly actionLabel: string;
  readonly targetSummary: string;
  readonly requester: SafeActorReference;
  readonly status: ApprovalStatus;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly quorum: ApprovalQuorumProjection | null;
  readonly allowedActions: readonly ApprovalAllowedAction[];
}

export interface ApprovalTimelineEntry {
  readonly id: string;
  readonly occurredAt: string;
  readonly kind: 'requested' | 'decision' | 'status' | 'execution';
  readonly label: string;
  readonly actor: SafeActorReference | null;
  readonly outcome: string | null;
  readonly reason: string | null;
}

export interface ApprovalDetail extends ApprovalSummary {
  readonly immutable: {
    readonly schemaVersion: number;
    readonly adapterVersion: string;
    readonly policyVersion: string;
    readonly payloadHash: string;
    readonly targetSetHash: string;
    readonly policyHash: string;
    readonly targets: readonly SafeTargetReference[];
  };
  readonly preview: {
    readonly fields: readonly SafeFieldProjection[];
    readonly changes: readonly SafeDiffProjection[];
  };
  readonly timeline: readonly ApprovalTimelineEntry[];
}

export interface ApprovalListQuery {
  readonly status?: ApprovalStatus;
  readonly actionType?: string;
  readonly requesterId?: string;
  readonly sort?: ApprovalSortField;
  readonly direction?: SortDirection;
  readonly cursor?: string;
}

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly previousCursor: string | null;
}

export type ApprovalListResponse = CursorPage<ApprovalSummary>;

export interface ApprovalActionIntent {
  readonly intentToken: string;
  readonly requestedActionHash: string;
  readonly expiresAt: string;
}

export interface ApprovalActionResult {
  readonly request: ApprovalDetail;
}

export type GovernanceErrorKind =
  | 'disabled'
  | 'forbidden'
  | 'not_found'
  | 'stale'
  | 'expired'
  | 'conflict'
  | 'dependency'
  | 'invalid_cursor'
  | 'stale_auth'
  | 'unavailable'
  | 'unknown';

export class GovernanceApiError extends Error {
  constructor(
    readonly kind: GovernanceErrorKind,
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'GovernanceApiError';
  }
}
