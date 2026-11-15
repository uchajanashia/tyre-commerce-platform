import { CanDeactivateFn } from '@angular/router';

export interface PendingGovernanceOperation {
  canLeaveGovernance(): boolean;
}

/** Prevents navigation from presenting an in-flight privileged mutation as cancelled. */
export const pendingGovernanceOperationGuard: CanDeactivateFn<PendingGovernanceOperation> = (
  component,
) => component.canLeaveGovernance();
