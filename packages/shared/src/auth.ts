/**
 * Admin auth contract — shared by @tyre/api (AuthController/AuthService) and
 * @tyre/adminka. Mirrors POST /admin/auth/login and GET /admin/me.
 */

/** Safe admin projection; never carries the password hash. */
export interface AdminInfo {
  id: string;
  email: string;
  role: string;
  enabled: boolean;
  permissions: string[];
  permissionGrants: Array<{
    permission: string;
    scopeType: 'global' | 'warehouse' | 'channel' | 'company';
    scopeId: string;
  }>;
}

/** Body of POST /admin/auth/login. */
export interface LoginRequest {
  email: string;
  password: string;
}

/** Response of POST /admin/auth/login. */
export interface LoginResponse {
  accessToken: string;
  admin: AdminInfo;
}

export type StaffAccountStatus = 'invited' | 'pending_activation' | 'active' | 'disabled';

export interface StaffInfo extends AdminInfo {
  displayName?: string;
  status: StaffAccountStatus;
  mfaRequired: boolean;
  mfaEnrolled: boolean;
  version: number;
}

export type IdentityLoginResponse =
  | { status: 'mfa_required'; challengeToken: string; expiresAt: string }
  | { status: 'authenticated'; accessToken: string; accessExpiresAt: string; staff: StaffInfo };

export interface IdentityRefreshResponse {
  accessToken: string;
  accessExpiresAt: string;
  rotationResult: 'rotated' | 'idempotent_replay';
  staff: StaffInfo;
}

export interface CsrfResponse {
  csrfToken: string;
}

export interface StaffSessionInfo {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt?: string;
  deviceLabel?: string;
  browserFamily?: string;
  osFamily?: string;
  mfaSatisfiedAt?: string;
  authMethod: string;
}

export interface StaffSessionPage {
  items: StaffSessionInfo[];
  nextCursor?: string;
  currentSessionId: string;
}

export interface RoleCatalogResponse {
  items: Array<{
    id: string;
    key: string;
    name: string;
    description?: string;
    isSystem: boolean;
    permissions: string[];
    mfaRequired: boolean;
    assignmentAllowed: boolean;
    blockReasonCode?: string;
  }>;
  scopeTypes: Array<'global' | 'warehouse' | 'channel' | 'company'>;
}

export interface OneTimeTokenRequest { token: string }
export interface InvitationInspectResponse {
  purpose: 'invite' | 'password_reset' | 'recovery';
  expiresAt: string;
}
export interface AcceptInvitationRequest extends OneTimeTokenRequest { password: string }
export interface AcceptInvitationResponse {
  status: 'pending_activation';
  mfaRequired: boolean;
  activationProof?: string;
}
export interface PasswordResetRequest { email: string }
export interface CompletePasswordResetRequest extends OneTimeTokenRequest { newPassword: string }

export interface MfaEnrollmentStartRequest { activationProof: string }
export interface MfaEnrollmentStartResponse {
  enrollmentToken: string;
  otpauthUri: string;
  expiresAt: string;
}
export interface MfaEnrollmentConfirmRequest { enrollmentToken: string; code: string }
export interface MfaEnrollmentConfirmResponse { confirmed: true; recoveryCodes: string[] }
export interface StepUpRequest { code: string; requestedActionHash: string }
export interface StepUpResponse { stepUpToken: string; expiresAt: string }
export interface ActionHashPreview { requestedActionHash: string }
export interface VersionedStaffMutation { expectedVersion: number }
export interface StaffRoleAssignmentInput {
  roleId: string;
  scopeType: 'global' | 'warehouse' | 'channel' | 'company';
  scopeId: string;
}
export interface StaffActionPreviewRequest extends VersionedStaffMutation {
  reasonCode?: string;
  reasonComment?: string;
}
export interface StaffActionRequest extends VersionedStaffMutation {
  reasonCode: string;
  reasonComment?: string;
  stepUpToken: string;
}
export interface ReplaceStaffAssignmentsPreviewRequest extends VersionedStaffMutation {
  assignments: StaffRoleAssignmentInput[];
}
export interface ReplaceStaffAssignmentsRequest extends ReplaceStaffAssignmentsPreviewRequest {
  stepUpToken: string;
}
export interface StaffActionHashPreview extends ActionHashPreview {
  mfaRequired?: boolean;
}
export interface RevokeTargetSessionRequest extends VersionedStaffMutation { stepUpToken: string }
export interface RecoveryRequestPreview extends ActionHashPreview {
  payloadHash: string;
  targetVersion: number;
  targetTokenVersion: number;
  targetMfaVersion: number;
  roleScopeSnapshotHash: string;
  validForSeconds: number;
}
