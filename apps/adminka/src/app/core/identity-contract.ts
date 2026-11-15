import {
  AdminInfo,
  IdentityRefreshResponse,
  RoleCatalogResponse as SharedRoleCatalogResponse,
  StaffSessionInfo,
  StaffSessionPage,
} from '@tyre/shared';

export type StaffStatus = 'invited' | 'pending_activation' | 'active' | 'disabled';

export interface IdentityFeatureConfig {
  apiBaseUrl: string;
  enabled: boolean;
  passwordResetDelivery?: 'manual' | 'email';
}

export interface AuthenticatedLoginResult {
  status: 'authenticated';
  accessToken: string;
  accessExpiresAt: string;
  staff: AdminInfo;
}

export interface MfaRequiredLoginResult {
  status: 'mfa_required';
  challengeToken: string;
  expiresAt: string;
}

export type IdentityLoginResult = AuthenticatedLoginResult | MfaRequiredLoginResult;

export type RefreshResult = IdentityRefreshResponse;

export type StaffSessionItem = StaffSessionInfo;

export type StaffSessionList = StaffSessionPage;

export interface MfaEnrollmentStart {
  enrollmentToken: string;
  otpauthUri: string;
  expiresAt: string;
}

export interface MfaEnrollmentConfirmed {
  confirmed: true;
  recoveryCodes: string[];
}

export interface RoleAssignmentView {
  roleId: string;
  roleName: string;
  scopeType: 'global' | 'warehouse' | 'channel' | 'company';
  scopeId: string;
}

export type RoleCatalogItem = SharedRoleCatalogResponse['items'][number];

export type RoleCatalogResponse = SharedRoleCatalogResponse;

export interface StaffListItem {
  id: string;
  email: string;
  displayName?: string;
  status: StaffStatus;
  mfaRequired: boolean;
  mfaEnrolled: boolean;
  lastActivityAt?: string | null;
  version: number;
  assignments: Array<{
    role: { id: string; key: string; name: string };
    scopeType: RoleAssignmentView['scopeType'];
    scopeId: string;
  }>;
}

export interface StaffListResponse {
  items: StaffListItem[];
  nextCursor?: string;
}

export interface StaffDetailResponse {
  id: string;
  email: string;
  displayName?: string | null;
  status: StaffStatus;
  enabled: boolean;
  version: number;
  tokenVersion: number;
  mfaRequired: boolean;
  createdAt: string;
  updatedAt: string;
  mfaCredentials: Array<{ id: string; confirmedAt: string | null }>;
  roleAssignments: StaffListItem['assignments'];
}

export interface TargetStaffSessionItem {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
  deviceLabel: string | null;
  browserFamily: string | null;
  osFamily: string | null;
  mfaSatisfiedAt: string | null;
  authMethod: string;
}

export interface TargetStaffSessionList {
  items: TargetStaffSessionItem[];
  nextCursor?: string;
}

export interface CreateStaffRequest {
  email: string;
  displayName: string;
  mfaRequired: boolean;
  assignments: Array<Pick<RoleAssignmentView, 'roleId' | 'scopeType' | 'scopeId'>>;
  idempotencyKey: string;
}

export interface CreateStaffPreviewResponse {
  requestedActionHash: string;
  emailNormalized: string;
  assignments: CreateStaffRequest['assignments'];
  mfaRequired: boolean;
}

export interface RoleAssignmentsPreviewResponse {
  requestedActionHash: string;
  assignments: CreateStaffRequest['assignments'];
  mfaRequired: boolean;
}

export interface StaffMutationResponse {
  id: string;
  status: StaffStatus;
  enabled: boolean;
  version: number;
}

export interface RoleAssignmentsMutationResponse {
  id: string;
  version: number;
  tokenVersion: number;
  mfaRequired: boolean;
  assignments: Array<{
    roleId: string;
    scopeType: RoleAssignmentView['scopeType'];
    scopeId: string;
  }>;
}

export interface InvitationResendResponse {
  targetId: string;
  version: number;
  invitation: { invitationId: string; expiresAt: string };
}

export interface IdentityApiError {
  code?: string;
  message?: string;
}
