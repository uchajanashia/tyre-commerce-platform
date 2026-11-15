CREATE TYPE "IdentityKeyCompromiseState" AS ENUM ('handling', 'completed', 'failed');
CREATE TYPE "IdentityArtifactReissueState" AS ENUM ('pending', 'issued', 'failed');

ALTER TABLE "SecurityControl"
  ADD COLUMN "identityCanonicalizationVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "identityCanonicalizedAt" TIMESTAMP(3),
  ADD COLUMN "identityCanonicalizationDigest" TEXT;

CREATE TABLE "IdentityKeyCompromise" (
  "id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "state" "IdentityKeyCompromiseState" NOT NULL DEFAULT 'handling',
  "affectedAccounts" INTEGER NOT NULL DEFAULT 0,
  "affectedArtifacts" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "IdentityKeyCompromise_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IdentityKeyCompromise_purpose_keyId_key" ON "IdentityKeyCompromise"("purpose", "keyId");
CREATE INDEX "IdentityKeyCompromise_purpose_state_idx" ON "IdentityKeyCompromise"("purpose", "state");

CREATE TABLE "IdentityArtifactReissue" (
  "id" TEXT NOT NULL,
  "compromiseId" TEXT NOT NULL,
  "staffUserId" TEXT NOT NULL,
  "purpose" "StaffInvitationPurpose" NOT NULL,
  "requestedById" TEXT NOT NULL,
  "sourceArtifactId" TEXT NOT NULL,
  "state" "IdentityArtifactReissueState" NOT NULL DEFAULT 'pending',
  "replacementId" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "IdentityArtifactReissue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IdentityArtifactReissue_sourceArtifactId_key" ON "IdentityArtifactReissue"("sourceArtifactId");
CREATE INDEX "IdentityArtifactReissue_compromiseId_state_idx" ON "IdentityArtifactReissue"("compromiseId", "state");
