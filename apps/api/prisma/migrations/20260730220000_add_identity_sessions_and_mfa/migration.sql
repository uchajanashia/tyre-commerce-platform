-- Foundation Increment 2: additive staff identity, rotating sessions, MFA and recovery.
-- Existing enabled admins deliberately become pending_activation and must complete the
-- supervised enrollment inventory before the irreversible contract-v2 cutover.

CREATE TYPE "StaffAccountStatus" AS ENUM ('invited', 'pending_activation', 'active', 'disabled');
CREATE TYPE "StaffInvitationPurpose" AS ENUM ('invite', 'password_reset', 'recovery');
CREATE TYPE "StaffInvitationDeliveryStatus" AS ENUM ('pending', 'accepted', 'failed', 'manual');
CREATE TYPE "SecretDeliveryEnvelopeState" AS ENUM ('pending', 'delivering', 'delivered', 'failed', 'expired');
CREATE TYPE "MfaCredentialStatus" AS ENUM ('pending', 'confirmed', 'revoked');
CREATE TYPE "AuthChallengePurpose" AS ENUM ('login_mfa', 'enroll_mfa', 'step_up');
CREATE TYPE "StaffRecoveryRequestState" AS ENUM ('pending', 'rejected', 'executed', 'expired');
CREATE TYPE "AuthThrottleKind" AS ENUM ('login_ip', 'login_account', 'mfa_account', 'public_ip', 'public_identity');

ALTER TABLE "Admin"
  ALTER COLUMN "passwordHash" DROP NOT NULL,
  ALTER COLUMN "enabled" SET DEFAULT false,
  ADD COLUMN "emailNormalized" TEXT,
  ADD COLUMN "displayName" TEXT,
  ADD COLUMN "status" "StaffAccountStatus",
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "mfaVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
  ADD COLUMN "activatedAt" TIMESTAMP(3),
  ADD COLUMN "disabledAt" TIMESTAMP(3),
  ADD COLUMN "disabledReason" TEXT,
  ADD COLUMN "createdById" TEXT;

UPDATE "Admin"
SET "status" = CASE WHEN "enabled" THEN 'pending_activation'::"StaffAccountStatus"
                    ELSE 'disabled'::"StaffAccountStatus" END,
    "enabled" = false,
    "disabledAt" = CASE WHEN "enabled" THEN NULL ELSE COALESCE("updatedAt", CURRENT_TIMESTAMP) END,
    "disabledReason" = CASE WHEN "enabled" THEN NULL ELSE 'pre_identity_migration_disabled' END;

ALTER TABLE "Admin"
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'pending_activation',
  ADD CONSTRAINT "Admin_status_enabled_check" CHECK ("enabled" = ("status" = 'active')),
  ADD CONSTRAINT "Admin_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Intentionally nullable during the staged upgrade. PostgreSQL lower()/trim()
-- is not the identity contract (which also requires NFKC and IDNA ASCII).
-- scripts/backfill-staff-email-canonicalization.ts imports the exact runtime
-- normalizer, reports/fails on collisions, fills this column transactionally,
-- and records the SecurityControl readiness marker before identity v2 can boot.
CREATE UNIQUE INDEX "Admin_emailNormalized_key" ON "Admin"("emailNormalized");
CREATE INDEX "Admin_status_idx" ON "Admin"("status");

CREATE TABLE "StaffSession" (
  "id" TEXT NOT NULL,
  "staffUserId" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "authContractVersion" INTEGER NOT NULL DEFAULT 2,
  "tokenVersionSnapshot" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idleExpiresAt" TIMESTAMP(3) NOT NULL,
  "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "revokedById" TEXT,
  "deviceLabel" TEXT,
  "browserFamily" TEXT,
  "osFamily" TEXT,
  "mfaSatisfiedAt" TIMESTAMP(3),
  "authMethod" TEXT NOT NULL,
  CONSTRAINT "StaffSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffSession_expiry_check" CHECK ("idleExpiresAt" <= "absoluteExpiresAt")
);
CREATE UNIQUE INDEX "StaffSession_familyId_key" ON "StaffSession"("familyId");
CREATE INDEX "StaffSession_staffUserId_revokedAt_idx" ON "StaffSession"("staffUserId", "revokedAt");
CREATE INDEX "StaffSession_idleExpiresAt_idx" ON "StaffSession"("idleExpiresAt");
CREATE INDEX "StaffSession_absoluteExpiresAt_idx" ON "StaffSession"("absoluteExpiresAt");

CREATE TABLE "RefreshToken" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "tokenDigest" TEXT NOT NULL,
  "digestKeyId" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "replacedByTokenId" TEXT,
  CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RefreshToken_replacedByTokenId_key" ON "RefreshToken"("replacedByTokenId");
CREATE INDEX "RefreshToken_sessionId_expiresAt_idx" ON "RefreshToken"("sessionId", "expiresAt");
CREATE INDEX "RefreshToken_sessionId_usedAt_revokedAt_idx" ON "RefreshToken"("sessionId", "usedAt", "revokedAt");

CREATE TABLE "RefreshRotationReceipt" (
  "id" TEXT NOT NULL,
  "predecessorId" TEXT NOT NULL,
  "successorId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "encryptionKeyId" TEXT NOT NULL,
  "nonce" BYTEA,
  "ciphertext" BYTEA,
  "authTag" BYTEA,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "ciphertextClearedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshRotationReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RefreshRotationReceipt_ciphertext_shape_check" CHECK (
    ("nonce" IS NULL AND "ciphertext" IS NULL AND "authTag" IS NULL AND "ciphertextClearedAt" IS NOT NULL)
    OR ("nonce" IS NOT NULL AND "ciphertext" IS NOT NULL AND "authTag" IS NOT NULL AND "ciphertextClearedAt" IS NULL)
  )
);
CREATE UNIQUE INDEX "RefreshRotationReceipt_predecessorId_key" ON "RefreshRotationReceipt"("predecessorId");
CREATE UNIQUE INDEX "RefreshRotationReceipt_successorId_key" ON "RefreshRotationReceipt"("successorId");
CREATE INDEX "RefreshRotationReceipt_expiresAt_ciphertextClearedAt_idx" ON "RefreshRotationReceipt"("expiresAt", "ciphertextClearedAt");
CREATE INDEX "RefreshRotationReceipt_sessionId_idx" ON "RefreshRotationReceipt"("sessionId");

CREATE TABLE "StaffInvitation" (
  "id" TEXT NOT NULL,
  "staffUserId" TEXT NOT NULL,
  "purpose" "StaffInvitationPurpose" NOT NULL,
  "selector" TEXT NOT NULL,
  "tokenDigest" TEXT NOT NULL,
  "digestKeyId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "deliveryStatus" "StaffInvitationDeliveryStatus" NOT NULL DEFAULT 'pending',
  "deliveryReference" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffInvitation_selector_key" ON "StaffInvitation"("selector");
CREATE UNIQUE INDEX "StaffInvitation_one_active_purpose_key" ON "StaffInvitation"("staffUserId", "purpose") WHERE "consumedAt" IS NULL AND "revokedAt" IS NULL;
CREATE INDEX "StaffInvitation_staffUserId_purpose_consumedAt_revokedAt_idx" ON "StaffInvitation"("staffUserId", "purpose", "consumedAt", "revokedAt");
CREATE INDEX "StaffInvitation_expiresAt_idx" ON "StaffInvitation"("expiresAt");

CREATE TABLE "SecretDeliveryEnvelope" (
  "id" TEXT NOT NULL,
  "invitationId" TEXT NOT NULL,
  "purpose" "StaffInvitationPurpose" NOT NULL,
  "recipientHash" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "encryptionKeyId" TEXT NOT NULL,
  "nonce" BYTEA,
  "ciphertext" BYTEA,
  "authTag" BYTEA,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "state" "SecretDeliveryEnvelopeState" NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "ciphertextClearedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecretDeliveryEnvelope_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SecretDeliveryEnvelope_ciphertext_shape_check" CHECK (
    ("nonce" IS NULL AND "ciphertext" IS NULL AND "authTag" IS NULL AND "ciphertextClearedAt" IS NOT NULL)
    OR ("nonce" IS NOT NULL AND "ciphertext" IS NOT NULL AND "authTag" IS NOT NULL AND "ciphertextClearedAt" IS NULL)
  )
);
CREATE UNIQUE INDEX "SecretDeliveryEnvelope_invitationId_key" ON "SecretDeliveryEnvelope"("invitationId");
CREATE INDEX "SecretDeliveryEnvelope_state_expiresAt_idx" ON "SecretDeliveryEnvelope"("state", "expiresAt");

CREATE TABLE "SecretDeliveryOutbox" (
  "id" TEXT NOT NULL,
  "envelopeId" TEXT NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecretDeliveryOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SecretDeliveryOutbox_envelopeId_key" ON "SecretDeliveryOutbox"("envelopeId");
CREATE INDEX "SecretDeliveryOutbox_completedAt_availableAt_idx" ON "SecretDeliveryOutbox"("completedAt", "availableAt");

CREATE TABLE "MfaCredential" (
  "id" TEXT NOT NULL,
  "staffUserId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'totp',
  "secretCiphertext" BYTEA NOT NULL,
  "encryptionKeyId" TEXT NOT NULL,
  "nonce" BYTEA NOT NULL,
  "authTag" BYTEA NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "MfaCredentialStatus" NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastUsedStep" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MfaCredential_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MfaCredential_staffUserId_status_idx" ON "MfaCredential"("staffUserId", "status");
CREATE UNIQUE INDEX "MfaCredential_one_confirmed_totp_key" ON "MfaCredential"("staffUserId", "type") WHERE "status" = 'confirmed';

CREATE TABLE "MfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "staffUserId" TEXT NOT NULL,
  "codeDigest" TEXT NOT NULL,
  "digestKeyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MfaRecoveryCode_staffUserId_usedAt_revokedAt_idx" ON "MfaRecoveryCode"("staffUserId", "usedAt", "revokedAt");

CREATE TABLE "AuthChallenge" (
  "id" TEXT NOT NULL,
  "staffUserId" TEXT NOT NULL,
  "purpose" "AuthChallengePurpose" NOT NULL,
  "tokenDigest" TEXT NOT NULL,
  "digestKeyId" TEXT NOT NULL,
  "tokenVersionSnapshot" INTEGER NOT NULL,
  "credentialVersionSnapshot" INTEGER NOT NULL,
  "mfaVersionSnapshot" INTEGER NOT NULL,
  "sessionId" TEXT,
  "credentialId" TEXT,
  "credentialRecordVersion" INTEGER,
  "proofVersion" INTEGER,
  "requestedActionHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "remainingAttempts" INTEGER NOT NULL DEFAULT 5,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthChallenge_attempts_check" CHECK ("remainingAttempts" >= 0 AND "remainingAttempts" <= 5)
);
CREATE INDEX "AuthChallenge_staffUserId_purpose_expiresAt_idx" ON "AuthChallenge"("staffUserId", "purpose", "expiresAt");
CREATE INDEX "AuthChallenge_sessionId_idx" ON "AuthChallenge"("sessionId");

CREATE TABLE "StaffRecoveryRequest" (
  "id" TEXT NOT NULL,
  "targetStaffId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "approverId" TEXT,
  "reasonCode" TEXT NOT NULL,
  "reasonComment" TEXT,
  "commandPayload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "targetVersionSnapshot" INTEGER NOT NULL,
  "targetTokenVersionSnapshot" INTEGER NOT NULL,
  "targetMfaVersionSnapshot" INTEGER NOT NULL,
  "roleScopeSnapshotHash" TEXT NOT NULL,
  "state" "StaffRecoveryRequestState" NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "executedAt" TIMESTAMP(3),
  "executionIdempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffRecoveryRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffRecoveryRequest_actor_separation_check" CHECK ("requesterId" <> "targetStaffId" AND ("approverId" IS NULL OR ("approverId" <> "requesterId" AND "approverId" <> "targetStaffId")))
);
CREATE UNIQUE INDEX "StaffRecoveryRequest_executionIdempotencyKey_key" ON "StaffRecoveryRequest"("executionIdempotencyKey");
CREATE INDEX "StaffRecoveryRequest_targetStaffId_state_expiresAt_idx" ON "StaffRecoveryRequest"("targetStaffId", "state", "expiresAt");
CREATE INDEX "StaffRecoveryRequest_requesterId_createdAt_idx" ON "StaffRecoveryRequest"("requesterId", "createdAt");

CREATE TABLE "AuthThrottleBucket" (
  "keyHash" TEXT NOT NULL,
  "kind" "AuthThrottleKind" NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "windowCount" INTEGER NOT NULL DEFAULT 0,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "cooldownUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthThrottleBucket_pkey" PRIMARY KEY ("keyHash")
);
CREATE INDEX "AuthThrottleBucket_kind_cooldownUntil_idx" ON "AuthThrottleBucket"("kind", "cooldownUntil");

CREATE TABLE "SecurityControl" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "minimumAuthContractVersion" INTEGER NOT NULL DEFAULT 1,
  "sessionsEnforcedAt" TIMESTAMP(3),
  "legacyJwtRevokedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "SecurityControl_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SecurityControl_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "SecurityControl_contract_version_check" CHECK ("minimumAuthContractVersion" BETWEEN 1 AND 2)
);
INSERT INTO "SecurityControl" ("id", "minimumAuthContractVersion", "updatedAt") VALUES (1, 1, CURRENT_TIMESTAMP);

ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffSession" ADD CONSTRAINT "StaffSession_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StaffSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_replacedByTokenId_fkey" FOREIGN KEY ("replacedByTokenId") REFERENCES "RefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RefreshRotationReceipt" ADD CONSTRAINT "RefreshRotationReceipt_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "RefreshToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshRotationReceipt" ADD CONSTRAINT "RefreshRotationReceipt_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "RefreshToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshRotationReceipt" ADD CONSTRAINT "RefreshRotationReceipt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StaffSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecretDeliveryEnvelope" ADD CONSTRAINT "SecretDeliveryEnvelope_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "StaffInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecretDeliveryOutbox" ADD CONSTRAINT "SecretDeliveryOutbox_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "SecretDeliveryEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfaCredential" ADD CONSTRAINT "MfaCredential_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthChallenge" ADD CONSTRAINT "AuthChallenge_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthChallenge" ADD CONSTRAINT "AuthChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StaffSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthChallenge" ADD CONSTRAINT "AuthChallenge_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "MfaCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffRecoveryRequest" ADD CONSTRAINT "StaffRecoveryRequest_targetStaffId_fkey" FOREIGN KEY ("targetStaffId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffRecoveryRequest" ADD CONSTRAINT "StaffRecoveryRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffRecoveryRequest" ADD CONSTRAINT "StaffRecoveryRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecurityControl" ADD CONSTRAINT "SecurityControl_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "enforce_security_control_monotonic"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SecurityControl is monotonic and cannot be deleted';
  END IF;
  IF NEW."id" <> 1 OR NEW."minimumAuthContractVersion" < OLD."minimumAuthContractVersion" THEN
    RAISE EXCEPTION 'SecurityControl contract version cannot decrease';
  END IF;
  IF OLD."sessionsEnforcedAt" IS NOT NULL AND (NEW."sessionsEnforcedAt" IS NULL OR NEW."sessionsEnforcedAt" <> OLD."sessionsEnforcedAt") THEN
    RAISE EXCEPTION 'sessionsEnforcedAt is immutable after enforcement';
  END IF;
  IF OLD."legacyJwtRevokedAt" IS NOT NULL AND (NEW."legacyJwtRevokedAt" IS NULL OR NEW."legacyJwtRevokedAt" <> OLD."legacyJwtRevokedAt") THEN
    RAISE EXCEPTION 'legacyJwtRevokedAt is immutable after enforcement';
  END IF;
  IF NEW."minimumAuthContractVersion" >= 2 AND (NEW."sessionsEnforcedAt" IS NULL OR NEW."legacyJwtRevokedAt" IS NULL) THEN
    RAISE EXCEPTION 'contract v2 requires session and legacy JWT enforcement timestamps';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SecurityControl_monotonic_update"
BEFORE UPDATE ON "SecurityControl"
FOR EACH ROW EXECUTE FUNCTION "enforce_security_control_monotonic"();

CREATE OR REPLACE FUNCTION "reject_security_control_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SecurityControl is monotonic and cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SecurityControl_reject_delete"
BEFORE DELETE ON "SecurityControl"
FOR EACH ROW EXECUTE FUNCTION "reject_security_control_delete"();
