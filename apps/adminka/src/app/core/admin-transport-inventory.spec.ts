import { GovernanceApiService } from './governance-api.service';
import { IdentityApiService } from './identity-api.service';

import { operations } from '@tyre/admin-api-client';

/**
 * Migration parity inventory. Generated operationIds are intentionally not listed until the
 * checked-in generated package provides their authoritative names.
 */
describe('Admin transport migration inventory', () => {
  it('accounts for every Governance adapter operation before generated-client migration', () => {
    expectPublicMethods(GovernanceApiService.prototype, [
      'executeApprovalAction',
      'getApproval',
      'getAuditEvent',
      'getJob',
      'listApprovals',
      'listAuditEvents',
      'listJobs',
      'prepareApprovalAction',
    ]);
  });

  it('accounts for every Identity adapter operation before generated-client migration', () => {
    expectPublicMethods(IdentityApiService.prototype, [
      'acceptInvitation',
      'approveRecoveryRequest',
      'completeMfa',
      'completePasswordReset',
      'confirmMfaEnrollment',
      'createRecoveryRequest',
      'createStaff',
      'csrf',
      'currentStaff',
      'inspectInvitation',
      'listRoles',
      'listStaff',
      'login',
      'logout',
      'previewCreateStaff',
      'previewInvitationResend',
      'previewRecoveryApproval',
      'previewRecoveryRequest',
      'previewRoleAssignments',
      'previewStaffAction',
      'previewTargetSessionRevoke',
      'refresh',
      'requestPasswordReset',
      'resendInvitation',
      'revokeAll',
      'revokeSession',
      'revokeTargetSession',
      'sessions',
      'staffAction',
      'staffDetail',
      'startMfaEnrollment',
      'stepUp',
      'targetSessions',
      'updateRoleAssignments',
    ]);
  });

  it('excludes unapproved one-time credential delivery operations from the ordinary client', () => {
    expect('staff-admin.create' in operations).toBe(false);
    expect('staff-admin.resend' in operations).toBe(false);
  });
});

function expectPublicMethods(prototype: object, expectedMethods: readonly string[]): void {
  for (const method of expectedMethods) {
    expect(typeof Object.getOwnPropertyDescriptor(prototype, method)?.value).toBe('function');
  }
  expect([...expectedMethods].sort()).toEqual(expectedMethods);
}
