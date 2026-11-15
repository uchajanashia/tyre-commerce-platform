/** Safe transport vocabulary for the feature-disabled generic approval core. */
export type ApprovalPolicyMode = 'disabled' | 'direct' | 'approval_required';
export type ApprovalPolicyProposalState = 'proposed' | 'under_review' | 'approved' | 'rejected' | 'active' | 'retired';
export type ApprovalRequestState = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'stale';
export type ApprovalDecisionValue = 'approve' | 'reject';

export interface ApprovalStateResult {
  requestId: string;
  state: ApprovalRequestState;
  version: number;
}

export interface ActionIntentResult {
  intentToken: string;
  actionHash: string;
  expiresAt: string;
}

export interface ApprovalPolicyProposalResult {
  proposalId: string;
  state: ApprovalPolicyProposalState;
  version: number;
}
