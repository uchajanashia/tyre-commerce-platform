import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const STAFF_STATUSES = [
  "invited",
  "pending_activation",
  "active",
  "disabled",
] as const;
const SCOPE_TYPES = ["global", "warehouse", "channel", "company"] as const;
const RECOVERY_STATES = ["pending", "rejected", "executed", "expired"] as const;

export class IdentityPermissionGrantResponseDto {
  @ApiProperty()
  permission!: string;

  @ApiProperty({ enum: SCOPE_TYPES })
  scopeType!: (typeof SCOPE_TYPES)[number];

  @ApiProperty()
  scopeId!: string;
}

export class IdentityStaffProjectionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: "email" })
  email!: string;

  @ApiPropertyOptional()
  displayName?: string;

  @ApiProperty()
  role!: string;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ enum: STAFF_STATUSES })
  status!: (typeof STAFF_STATUSES)[number];

  @ApiProperty()
  mfaRequired!: boolean;

  @ApiProperty()
  mfaEnrolled!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ type: String, isArray: true })
  permissions!: string[];

  @ApiProperty({
    type: () => IdentityPermissionGrantResponseDto,
    isArray: true,
  })
  permissionGrants!: IdentityPermissionGrantResponseDto[];
}

export class IdentityAuthenticatedLoginResponseDto {
  @ApiProperty({ enum: ["authenticated"] })
  status!: "authenticated";

  @ApiProperty({ readOnly: true })
  accessToken!: string;

  @ApiProperty({ format: "date-time" })
  accessExpiresAt!: string;

  @ApiProperty({ type: () => IdentityStaffProjectionResponseDto })
  staff!: IdentityStaffProjectionResponseDto;
}

export class IdentityMfaRequiredLoginResponseDto {
  @ApiProperty({ enum: ["mfa_required"] })
  status!: "mfa_required";

  @ApiProperty({ readOnly: true })
  challengeToken!: string;

  @ApiProperty({ format: "date-time" })
  expiresAt!: string;
}

export class IdentityCompleteMfaResponseDto extends IdentityAuthenticatedLoginResponseDto {}

export class IdentityRefreshResponseDto {
  @ApiProperty({ readOnly: true })
  accessToken!: string;

  @ApiProperty({ format: "date-time" })
  accessExpiresAt!: string;

  @ApiProperty({ enum: ["rotated", "idempotent_replay"] })
  rotationResult!: "rotated" | "idempotent_replay";

  @ApiProperty({ type: () => IdentityStaffProjectionResponseDto })
  staff!: IdentityStaffProjectionResponseDto;
}

export class IdentityCsrfResponseDto {
  @ApiProperty({ readOnly: true })
  csrfToken!: string;
}

export class IdentityRevokedResponseDto {
  @ApiProperty({ enum: [true] })
  revoked!: true;
}

export class IdentitySessionRevocationResponseDto {
  @ApiProperty()
  revoked!: boolean;
}

export class IdentitySessionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  current!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  lastSeenAt!: string;

  @ApiProperty({ format: "date-time" })
  idleExpiresAt!: string;

  @ApiProperty({ format: "date-time" })
  absoluteExpiresAt!: string;

  @ApiPropertyOptional({ format: "date-time" })
  revokedAt?: string;

  @ApiPropertyOptional()
  deviceLabel?: string;

  @ApiPropertyOptional()
  browserFamily?: string;

  @ApiPropertyOptional()
  osFamily?: string;

  @ApiPropertyOptional({ format: "date-time" })
  mfaSatisfiedAt?: string;

  @ApiProperty()
  authMethod!: string;
}

export class IdentitySessionPageResponseDto {
  @ApiProperty({ type: () => IdentitySessionResponseDto, isArray: true })
  items!: IdentitySessionResponseDto[];

  @ApiPropertyOptional()
  nextCursor?: string;

  @ApiProperty()
  currentSessionId!: string;
}

export class InvitationInspectResponseDto {
  @ApiProperty({ enum: ["invite", "password_reset", "recovery"] })
  purpose!: "invite" | "password_reset" | "recovery";

  @ApiProperty({ format: "date-time" })
  expiresAt!: string;
}

export class InvitationAcceptResponseDto {
  @ApiProperty({ enum: ["pending_activation"] })
  status!: "pending_activation";

  @ApiProperty()
  mfaRequired!: boolean;

  @ApiPropertyOptional({ readOnly: true })
  activationProof?: string;
}

export class PasswordResetAcceptedResponseDto {
  @ApiProperty({ enum: [true] })
  accepted!: true;
}

export class PasswordResetCompletedResponseDto {
  @ApiProperty({ enum: [true] })
  completed!: true;
}

export class MfaEnrollmentStartResponseDto {
  @ApiProperty({ readOnly: true })
  enrollmentToken!: string;

  @ApiProperty({ readOnly: true })
  otpauthUri!: string;

  @ApiProperty({ format: "date-time" })
  expiresAt!: string;
}

export class MfaEnrollmentConfirmResponseDto {
  @ApiProperty({ enum: [true] })
  confirmed!: true;

  @ApiProperty({ type: String, isArray: true, readOnly: true })
  recoveryCodes!: string[];
}

export class StepUpResponseDto {
  @ApiProperty({ readOnly: true })
  stepUpToken!: string;

  @ApiProperty({ format: "date-time" })
  expiresAt!: string;
}

export class StaffRoleSummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  name!: string;
}

export class StaffAssignmentViewResponseDto {
  @ApiProperty({ type: () => StaffRoleSummaryResponseDto })
  role!: StaffRoleSummaryResponseDto;

  @ApiProperty({ enum: SCOPE_TYPES })
  scopeType!: (typeof SCOPE_TYPES)[number];

  @ApiProperty()
  scopeId!: string;
}

export class StaffListItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: "email" })
  email!: string;

  @ApiPropertyOptional()
  displayName?: string;

  @ApiProperty({ enum: STAFF_STATUSES })
  status!: (typeof STAFF_STATUSES)[number];

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty()
  mfaRequired!: boolean;

  @ApiProperty()
  mfaEnrolled!: boolean;

  @ApiProperty({ type: () => StaffAssignmentViewResponseDto, isArray: true })
  assignments!: StaffAssignmentViewResponseDto[];

  @ApiPropertyOptional({ format: "date-time" })
  lastActivityAt?: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;
}

export class StaffListResponseDto {
  @ApiProperty({ type: () => StaffListItemResponseDto, isArray: true })
  items!: StaffListItemResponseDto[];

  @ApiPropertyOptional()
  nextCursor?: string;
}

export class StaffMfaCredentialResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  confirmedAt!: string | null;
}

export class StaffAssignmentDetailResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  adminId!: string;

  @ApiProperty()
  roleId!: string;

  @ApiProperty({ enum: SCOPE_TYPES })
  scopeType!: (typeof SCOPE_TYPES)[number];

  @ApiProperty()
  scopeId!: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ type: () => StaffRoleSummaryResponseDto })
  role!: StaffRoleSummaryResponseDto;
}

export class StaffDetailResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: "email" })
  email!: string;

  @ApiProperty({ type: String, nullable: true })
  displayName!: string | null;

  @ApiProperty({ enum: STAFF_STATUSES })
  status!: (typeof STAFF_STATUSES)[number];

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ minimum: 1 })
  tokenVersion!: number;

  @ApiProperty()
  mfaRequired!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  updatedAt!: string;

  @ApiProperty({ type: () => StaffMfaCredentialResponseDto, isArray: true })
  mfaCredentials!: StaffMfaCredentialResponseDto[];

  @ApiProperty({ type: () => StaffAssignmentDetailResponseDto, isArray: true })
  roleAssignments!: StaffAssignmentDetailResponseDto[];
}

export class StaffAssignmentInputResponseDto {
  @ApiProperty()
  roleId!: string;

  @ApiProperty({ enum: SCOPE_TYPES })
  scopeType!: (typeof SCOPE_TYPES)[number];

  @ApiProperty()
  scopeId!: string;
}

export class ActionHashPreviewResponseDto {
  @ApiProperty()
  requestedActionHash!: string;
}

export class StaffCreatePreviewResponseDto extends ActionHashPreviewResponseDto {
  @ApiProperty({ format: "email" })
  emailNormalized!: string;

  @ApiProperty({ type: () => StaffAssignmentInputResponseDto, isArray: true })
  assignments!: StaffAssignmentInputResponseDto[];

  @ApiProperty()
  mfaRequired!: boolean;
}

export class StaffAssignmentsPreviewResponseDto extends ActionHashPreviewResponseDto {
  @ApiProperty({ type: () => StaffAssignmentInputResponseDto, isArray: true })
  assignments!: StaffAssignmentInputResponseDto[];

  @ApiProperty()
  mfaRequired!: boolean;
}

export class StaffMutationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: STAFF_STATUSES })
  status!: (typeof STAFF_STATUSES)[number];

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ minimum: 1 })
  version!: number;
}

export class StaffInvitationDeliveryResponseDto {
  @ApiProperty()
  invitationId!: string;

  @ApiProperty({ format: "date-time" })
  expiresAt!: string;

  @ApiPropertyOptional({ readOnly: true })
  developmentOneTimeUrl?: string;
}

export class StaffCreateSummaryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: "email" })
  email!: string;

  @ApiProperty({ enum: ["invited"] })
  status!: "invited";

  @ApiProperty({ minimum: 1 })
  version!: number;
}

export class StaffCreateResponseDto {
  @ApiProperty({ type: () => StaffCreateSummaryResponseDto })
  staff!: StaffCreateSummaryResponseDto;

  @ApiProperty({ type: () => StaffInvitationDeliveryResponseDto })
  invitation!: StaffInvitationDeliveryResponseDto;
}

export class StaffInvitationResendResponseDto {
  @ApiProperty()
  targetId!: string;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ type: () => StaffInvitationDeliveryResponseDto })
  invitation!: StaffInvitationDeliveryResponseDto;
}

export class StaffTargetSessionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;

  @ApiProperty({ format: "date-time" })
  lastSeenAt!: string;

  @ApiProperty({ format: "date-time" })
  idleExpiresAt!: string;

  @ApiProperty({ format: "date-time" })
  absoluteExpiresAt!: string;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  revokedAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  deviceLabel!: string | null;

  @ApiProperty({ type: String, nullable: true })
  browserFamily!: string | null;

  @ApiProperty({ type: String, nullable: true })
  osFamily!: string | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  mfaSatisfiedAt!: string | null;

  @ApiProperty()
  authMethod!: string;
}

export class StaffTargetSessionPageResponseDto {
  @ApiProperty({ type: () => StaffTargetSessionResponseDto, isArray: true })
  items!: StaffTargetSessionResponseDto[];

  @ApiPropertyOptional()
  nextCursor?: string;
}

export class StaffTargetSessionRevokedResponseDto {
  @ApiProperty({ enum: [true] })
  revoked!: true;

  @ApiProperty({ minimum: 1 })
  targetVersion!: number;
}

export class StaffAssignmentMutationRowResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  adminId!: string;

  @ApiProperty()
  roleId!: string;

  @ApiProperty({ enum: SCOPE_TYPES })
  scopeType!: (typeof SCOPE_TYPES)[number];

  @ApiProperty()
  scopeId!: string;

  @ApiProperty({ format: "date-time" })
  createdAt!: string;
}

export class StaffAssignmentsMutationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ minimum: 1 })
  tokenVersion!: number;

  @ApiProperty()
  mfaRequired!: boolean;

  @ApiProperty({
    type: () => StaffAssignmentMutationRowResponseDto,
    isArray: true,
  })
  assignments!: StaffAssignmentMutationRowResponseDto[];
}

export class RoleCatalogItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  isSystem!: boolean;

  @ApiProperty({ type: String, isArray: true })
  permissions!: string[];

  @ApiProperty()
  mfaRequired!: boolean;

  @ApiProperty()
  assignmentAllowed!: boolean;

  @ApiPropertyOptional()
  blockReasonCode?: string;
}

export class RoleCatalogResponseDto {
  @ApiProperty({ type: () => RoleCatalogItemResponseDto, isArray: true })
  items!: RoleCatalogItemResponseDto[];

  @ApiProperty({ enum: SCOPE_TYPES, isArray: true })
  scopeTypes!: Array<"global" | "warehouse" | "channel" | "company">;
}

export class RecoveryRequestPreviewResponseDto extends ActionHashPreviewResponseDto {
  @ApiProperty()
  payloadHash!: string;

  @ApiProperty({ minimum: 1 })
  targetVersion!: number;

  @ApiProperty({ minimum: 1 })
  targetTokenVersion!: number;

  @ApiProperty({ minimum: 1 })
  targetMfaVersion!: number;

  @ApiProperty()
  roleScopeSnapshotHash!: string;

  @ApiProperty({ minimum: 1 })
  validForSeconds!: number;
}

export class RecoveryRequestCreatedResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ["pending"] })
  state!: "pending";

  @ApiProperty()
  payloadHash!: string;

  @ApiProperty({ format: "date-time" })
  expiresAt!: string;
}

export class RecoveryApprovalPreviewResponseDto extends ActionHashPreviewResponseDto {
  @ApiProperty()
  payloadHash!: string;

  @ApiProperty({ enum: RECOVERY_STATES })
  state!: (typeof RECOVERY_STATES)[number];

  @ApiProperty({ format: "date-time" })
  expiresAt!: string;
}

export class RecoveryApprovedResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ["executed"] })
  state!: "executed";

  @ApiProperty({ enum: ["pending_activation"] })
  targetStatus!: "pending_activation";

  @ApiProperty({ type: () => StaffInvitationDeliveryResponseDto })
  invitation!: StaffInvitationDeliveryResponseDto;
}
