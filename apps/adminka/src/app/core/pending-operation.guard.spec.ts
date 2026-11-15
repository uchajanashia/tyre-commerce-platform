import { pendingGovernanceOperationGuard } from './pending-operation.guard';

describe('pendingGovernanceOperationGuard', () => {
  it('blocks navigation only while a privileged operation is in flight', () => {
    expect(
      pendingGovernanceOperationGuard(
        { canLeaveGovernance: () => false },
        {} as never,
        {} as never,
        {} as never,
      ),
    ).toBe(false);
    expect(
      pendingGovernanceOperationGuard(
        { canLeaveGovernance: () => true },
        {} as never,
        {} as never,
        {} as never,
      ),
    ).toBe(true);
  });
});
