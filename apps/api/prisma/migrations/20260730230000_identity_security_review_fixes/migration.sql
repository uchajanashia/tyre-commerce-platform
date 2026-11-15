ALTER TYPE "AuthThrottleKind" ADD VALUE IF NOT EXISTS 'step_up_account';
CREATE TYPE "IdentityKeyRotationState" AS ENUM ('running', 'completed', 'failed');

CREATE TABLE "StaffMutationRequest" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "idempotencyKeyHash" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "resourceId" TEXT,
  "responseJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StaffMutationRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffMutationRequest_actorId_action_idempotencyKeyHash_key"
  ON "StaffMutationRequest"("actorId", "action", "idempotencyKeyHash");
CREATE INDEX "StaffMutationRequest_expiresAt_idx" ON "StaffMutationRequest"("expiresAt");

CREATE TABLE "IdentityKeyRotation" (
  "id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "targetKeyId" TEXT NOT NULL,
  "state" "IdentityKeyRotationState" NOT NULL DEFAULT 'running',
  "lastCredentialId" TEXT,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "IdentityKeyRotation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IdentityKeyRotation_purpose_state_idx" ON "IdentityKeyRotation"("purpose", "state");

INSERT INTO "Permission" ("id", "key", "description") VALUES
  ('perm-staff-read', 'staff.read', 'Read staff profiles and assignments'),
  ('perm-staff-manage', 'staff.manage', 'Manage staff lifecycle and invitations'),
  ('perm-roles-assign', 'roles.assign', 'Replace staff role assignments'),
  ('perm-sessions-manage', 'sessions.manage', 'Read and revoke target staff sessions'),
  ('perm-staff-recovery-request', 'staff.recovery.request', 'Request staff MFA recovery'),
  ('perm-staff-recovery-approve', 'staff.recovery.approve', 'Approve staff MFA recovery')
ON CONFLICT ("key") DO NOTHING;
