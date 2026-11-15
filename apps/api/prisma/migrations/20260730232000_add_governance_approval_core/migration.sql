-- Increment 3A: additive, feature-disabled governance/approval core.
-- This migration intentionally creates no policy, active slot, role assignment,
-- approval request, decision, or execution business data.

CREATE TYPE "ApprovalPolicyProposalState" AS ENUM ('proposed', 'under_review', 'approved', 'rejected', 'active', 'retired');
CREATE TYPE "ApprovalPolicyMode" AS ENUM ('disabled', 'direct', 'approval_required');
CREATE TYPE "ApprovalReviewValue" AS ENUM ('approve', 'reject');
CREATE TYPE "ApprovalPolicyActivationKind" AS ENUM ('activate', 'retire');
CREATE TYPE "ApprovalRequestState" AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'expired', 'stale');
CREATE TYPE "ApprovalDecisionValue" AS ENUM ('approve', 'reject');
CREATE TYPE "ApprovalExecutionState" AS ENUM ('authorized');

CREATE TABLE "ActionIntent" (
  "id" TEXT NOT NULL,
  "tokenDigest" TEXT NOT NULL,
  "digestKeyId" TEXT NOT NULL,
  "intentVersion" INTEGER NOT NULL DEFAULT 1,
  "canonicalizationVersion" INTEGER NOT NULL DEFAULT 1,
  "hashAlgorithm" TEXT NOT NULL DEFAULT 'sha-256',
  "hashDomain" TEXT NOT NULL DEFAULT 'identity/action-intent',
  "hashVersion" INTEGER NOT NULL DEFAULT 1,
  "semanticEnvelope" JSONB NOT NULL,
  "actionHash" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "subjectTokenVersion" INTEGER NOT NULL,
  "subjectMfaVersion" INTEGER NOT NULL,
  "sessionId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "resourceVersion" INTEGER NOT NULL,
  "payloadHash" TEXT,
  "targetSetHash" TEXT,
  "policyHash" TEXT,
  "policyVersion" INTEGER,
  "approvalEvidenceSetHash" TEXT,
  "decisionValue" "ApprovalDecisionValue",
  "executionId" TEXT,
  "serverCorrelationId" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokeReasonCode" TEXT,
  CONSTRAINT "ActionIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActionIntent_positive_versions" CHECK (
    "intentVersion" > 0 AND "canonicalizationVersion" > 0 AND "hashVersion" > 0
    AND "subjectTokenVersion" > 0 AND "subjectMfaVersion" > 0 AND "resourceVersion" >= 0
    AND ("policyVersion" IS NULL OR "policyVersion" > 0)
  ),
  CONSTRAINT "ActionIntent_hash_metadata" CHECK (
    "hashAlgorithm" = 'sha-256' AND "hashDomain" = 'identity/action-intent'
  ),
  CONSTRAINT "ActionIntent_ttl" CHECK (
    "expiresAt" > "issuedAt" AND "expiresAt" <= "issuedAt" + INTERVAL '300 seconds'
  ),
  CONSTRAINT "ActionIntent_revocation_shape" CHECK (
    ("revokedAt" IS NULL AND "revokeReasonCode" IS NULL)
    OR ("revokedAt" IS NOT NULL AND "revokeReasonCode" IS NOT NULL)
  ),
  CONSTRAINT "ActionIntent_terminal_exclusive" CHECK ("consumedAt" IS NULL OR "revokedAt" IS NULL)
);

CREATE TABLE "GovernanceIdempotencyRecord" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "idempotencyKeyHash" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "hashAlgorithm" TEXT NOT NULL DEFAULT 'hmac-sha-256',
  "hashDomain" TEXT NOT NULL DEFAULT 'idempotency',
  "hashVersion" INTEGER NOT NULL DEFAULT 1,
  "canonicalizationVersion" INTEGER NOT NULL DEFAULT 1,
  "requestHash" TEXT NOT NULL,
  "resourceId" TEXT,
  "responseJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retainUntil" TIMESTAMP(3),
  CONSTRAINT "GovernanceIdempotencyRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GovernanceIdempotency_hash_metadata" CHECK (
    "hashAlgorithm" = 'hmac-sha-256' AND "hashDomain" = 'idempotency'
    AND "hashVersion" = 1 AND "canonicalizationVersion" = 1
  ),
  -- Null is the fail-closed retention policy: the tombstone never expires.
  CONSTRAINT "GovernanceIdempotency_permanent" CHECK ("retainUntil" IS NULL)
);

CREATE TABLE "ApprovalPolicyProposal" (
  "id" TEXT NOT NULL,
  "policyKey" TEXT NOT NULL,
  "proposedPolicyVersion" INTEGER NOT NULL,
  "actionType" TEXT NOT NULL,
  "actionSchemaVersionMin" INTEGER NOT NULL,
  "actionSchemaVersionMax" INTEGER NOT NULL,
  "mode" "ApprovalPolicyMode" NOT NULL,
  "requiredReviewCount" INTEGER NOT NULL,
  "requiredApproverCount" INTEGER NOT NULL,
  "semanticPolicy" JSONB NOT NULL,
  "policyHash" TEXT NOT NULL,
  "canonicalizationVersion" INTEGER NOT NULL DEFAULT 1,
  "hashAlgorithm" TEXT NOT NULL DEFAULT 'sha-256',
  "hashDomain" TEXT NOT NULL DEFAULT 'approval/policy',
  "hashVersion" INTEGER NOT NULL DEFAULT 1,
  "d05EvidenceDescriptors" JSONB NOT NULL,
  "approvalEvidenceSetHash" TEXT NOT NULL,
  "proposerId" TEXT NOT NULL,
  "proposerTokenVersion" INTEGER NOT NULL,
  "proposerMfaVersion" INTEGER NOT NULL,
  "proposerSessionId" TEXT NOT NULL,
  "serverCorrelationId" TEXT NOT NULL,
  "state" "ApprovalPolicyProposalState" NOT NULL DEFAULT 'proposed',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "ApprovalPolicyProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovalPolicyProposal_versions" CHECK (
    "proposedPolicyVersion" > 0 AND "actionSchemaVersionMin" > 0
    AND "actionSchemaVersionMax" >= "actionSchemaVersionMin"
    AND "requiredReviewCount" >= 2
    AND (("mode" = 'disabled' AND "requiredApproverCount" = 0) OR ("mode" <> 'disabled' AND "requiredApproverCount" >= 1))
    AND "canonicalizationVersion" = 1 AND "hashVersion" = 1
    AND "proposerTokenVersion" > 0 AND "proposerMfaVersion" > 0 AND "version" > 0
  ),
  CONSTRAINT "ApprovalPolicyProposal_hash_metadata" CHECK (
    "hashAlgorithm" = 'sha-256' AND "hashDomain" = 'approval/policy'
  )
);

CREATE TABLE "ApprovalPolicyReviewDecision" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "reviewerTokenVersion" INTEGER NOT NULL,
  "reviewerMfaVersion" INTEGER NOT NULL,
  "reviewerAccountVersion" INTEGER NOT NULL,
  "reviewerSessionId" TEXT NOT NULL,
  "value" "ApprovalReviewValue" NOT NULL,
  "policyHash" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "authorizationSnapshot" JSONB NOT NULL,
  "actionHash" TEXT NOT NULL,
  "actionIntentId" TEXT NOT NULL,
  "serverCorrelationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalPolicyReviewDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovalPolicyReviewDecision_versions" CHECK (
    "reviewerTokenVersion" > 0 AND "reviewerMfaVersion" > 0 AND "reviewerAccountVersion" > 0
  )
);

CREATE TABLE "ApprovalPolicy" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "policyKey" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "actionType" TEXT NOT NULL,
  "actionSchemaVersionMin" INTEGER NOT NULL,
  "actionSchemaVersionMax" INTEGER NOT NULL,
  "mode" "ApprovalPolicyMode" NOT NULL,
  "requiredApproverCount" INTEGER NOT NULL,
  "semanticPolicy" JSONB NOT NULL,
  "policyHash" TEXT NOT NULL,
  "canonicalizationVersion" INTEGER NOT NULL DEFAULT 1,
  "hashAlgorithm" TEXT NOT NULL DEFAULT 'sha-256',
  "hashDomain" TEXT NOT NULL DEFAULT 'approval/policy',
  "hashVersion" INTEGER NOT NULL DEFAULT 1,
  "approvalEvidenceSetHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovalPolicy_versions" CHECK (
    "policyVersion" > 0 AND "actionSchemaVersionMin" > 0
    AND "actionSchemaVersionMax" >= "actionSchemaVersionMin"
    AND (("mode" = 'disabled' AND "requiredApproverCount" = 0) OR ("mode" <> 'disabled' AND "requiredApproverCount" >= 1))
    AND "canonicalizationVersion" = 1 AND "hashVersion" = 1
  ),
  CONSTRAINT "ApprovalPolicy_hash_metadata" CHECK (
    "hashAlgorithm" = 'sha-256' AND "hashDomain" = 'approval/policy'
  )
);

CREATE TABLE "ApprovalPolicyActivation" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "kind" "ApprovalPolicyActivationKind" NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorTokenVersion" INTEGER NOT NULL,
  "actorMfaVersion" INTEGER NOT NULL,
  "actorSessionId" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "approvalEvidenceSetHash" TEXT NOT NULL,
  "actionHash" TEXT NOT NULL,
  "actionIntentId" TEXT NOT NULL,
  "reasonCode" TEXT,
  "serverCorrelationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalPolicyActivation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovalPolicyActivation_versions" CHECK ("actorTokenVersion" > 0 AND "actorMfaVersion" > 0),
  CONSTRAINT "ApprovalPolicyActivation_reason" CHECK (
    ("kind" = 'activate' AND "reasonCode" IS NULL)
    OR ("kind" = 'retire' AND "reasonCode" IS NOT NULL)
  )
);

CREATE TABLE "ApprovalPolicyActiveSlot" (
  "policyKey" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "actionSchemaVersionMin" INTEGER NOT NULL,
  "actionSchemaVersionMax" INTEGER NOT NULL,
  "policyId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalPolicyActiveSlot_pkey" PRIMARY KEY (
    "policyKey", "actionType", "actionSchemaVersionMin", "actionSchemaVersionMax"
  ),
  CONSTRAINT "ApprovalPolicyActiveSlot_versions" CHECK (
    "actionSchemaVersionMin" > 0 AND "actionSchemaVersionMax" >= "actionSchemaVersionMin" AND "version" > 0
  )
);

CREATE TABLE "ApprovalRequest" (
  "id" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "normalizationVersion" INTEGER NOT NULL,
  "adapterVersion" INTEGER NOT NULL,
  "semanticCommand" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "targetSetHash" TEXT NOT NULL,
  "canonicalizationVersion" INTEGER NOT NULL DEFAULT 1,
  "hashAlgorithm" TEXT NOT NULL DEFAULT 'sha-256',
  "hashVersion" INTEGER NOT NULL DEFAULT 1,
  "policyId" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "requiredApproverCount" INTEGER NOT NULL,
  "requesterId" TEXT NOT NULL,
  "requesterTokenVersion" INTEGER NOT NULL,
  "requesterMfaVersion" INTEGER NOT NULL,
  "requesterAccountVersion" INTEGER NOT NULL,
  "requesterSessionId" TEXT NOT NULL,
  "idempotencyKeyHash" TEXT NOT NULL,
  "idempotencyKeyId" TEXT NOT NULL,
  "serverCorrelationId" TEXT NOT NULL,
  "state" "ApprovalRequestState" NOT NULL DEFAULT 'pending',
  "version" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "supersedesRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "terminalAt" TIMESTAMP(3),
  "staleReasonCode" TEXT,
  CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovalRequest_versions" CHECK (
    "schemaVersion" > 0 AND "normalizationVersion" > 0 AND "adapterVersion" > 0
    AND "canonicalizationVersion" = 1 AND "hashVersion" = 1 AND "policyVersion" > 0
    AND "requiredApproverCount" >= 1 AND "requesterTokenVersion" > 0
    AND "requesterMfaVersion" > 0 AND "requesterAccountVersion" > 0 AND "version" > 0
  ),
  CONSTRAINT "ApprovalRequest_hash_metadata" CHECK ("hashAlgorithm" = 'sha-256'),
  CONSTRAINT "ApprovalRequest_expiry" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "ApprovalRequest_terminal_shape" CHECK (
    ("state" IN ('pending', 'approved') AND "terminalAt" IS NULL AND "staleReasonCode" IS NULL)
    OR ("state" IN ('rejected', 'cancelled', 'expired') AND "terminalAt" IS NOT NULL AND "staleReasonCode" IS NULL)
    OR ("state" = 'stale' AND "terminalAt" IS NOT NULL AND "staleReasonCode" IS NOT NULL)
  )
);

CREATE TABLE "ApprovalDecision" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorTokenVersion" INTEGER NOT NULL,
  "actorMfaVersion" INTEGER NOT NULL,
  "actorAccountVersion" INTEGER NOT NULL,
  "actorSessionId" TEXT NOT NULL,
  "value" "ApprovalDecisionValue" NOT NULL,
  "authorizationSnapshot" JSONB NOT NULL,
  "policyHash" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "targetSetHash" TEXT NOT NULL,
  "actionHash" TEXT NOT NULL,
  "actionIntentId" TEXT NOT NULL,
  "serverCorrelationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovalDecision_versions" CHECK (
    "actorTokenVersion" > 0 AND "actorMfaVersion" > 0 AND "actorAccountVersion" > 0
  )
);

CREATE TABLE "ApprovalExecution" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "state" "ApprovalExecutionState" NOT NULL DEFAULT 'authorized',
  "actorId" TEXT NOT NULL,
  "actorTokenVersion" INTEGER NOT NULL,
  "actorMfaVersion" INTEGER NOT NULL,
  "actorAccountVersion" INTEGER NOT NULL,
  "actorSessionId" TEXT NOT NULL,
  "approvalEvidenceSetHash" TEXT NOT NULL,
  "policyHash" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "targetSetHash" TEXT NOT NULL,
  "actionHash" TEXT NOT NULL,
  "actionIntentId" TEXT NOT NULL,
  "serverCorrelationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovalExecution_versions" CHECK (
    "actorTokenVersion" > 0 AND "actorMfaVersion" > 0 AND "actorAccountVersion" > 0
  )
);

CREATE INDEX "ActionIntent_subjectId_sessionId_expiresAt_idx" ON "ActionIntent"("subjectId", "sessionId", "expiresAt");
CREATE INDEX "ActionIntent_action_resourceType_resourceId_idx" ON "ActionIntent"("action", "resourceType", "resourceId");
CREATE INDEX "ActionIntent_expiresAt_consumedAt_revokedAt_idx" ON "ActionIntent"("expiresAt", "consumedAt", "revokedAt");
CREATE INDEX "GovernanceIdempotencyRecord_createdAt_idx" ON "GovernanceIdempotencyRecord"("createdAt");
CREATE UNIQUE INDEX "GovernanceIdempotencyRecord_actorId_actionType_idempotencyK_key" ON "GovernanceIdempotencyRecord"("actorId", "actionType", "idempotencyKeyHash");
CREATE INDEX "ApprovalPolicyProposal_state_createdAt_idx" ON "ApprovalPolicyProposal"("state", "createdAt");
CREATE INDEX "ApprovalPolicyProposal_actionType_actionSchemaVersionMin_ac_idx" ON "ApprovalPolicyProposal"("actionType", "actionSchemaVersionMin", "actionSchemaVersionMax");
CREATE UNIQUE INDEX "ApprovalPolicyProposal_policyKey_proposedPolicyVersion_key" ON "ApprovalPolicyProposal"("policyKey", "proposedPolicyVersion");
CREATE UNIQUE INDEX "ApprovalPolicyReviewDecision_actionIntentId_key" ON "ApprovalPolicyReviewDecision"("actionIntentId");
CREATE INDEX "ApprovalPolicyReviewDecision_proposalId_value_createdAt_idx" ON "ApprovalPolicyReviewDecision"("proposalId", "value", "createdAt");
CREATE UNIQUE INDEX "ApprovalPolicyReviewDecision_proposalId_reviewerId_key" ON "ApprovalPolicyReviewDecision"("proposalId", "reviewerId");
CREATE UNIQUE INDEX "ApprovalPolicy_proposalId_key" ON "ApprovalPolicy"("proposalId");
CREATE INDEX "ApprovalPolicy_actionType_actionSchemaVersionMin_actionSche_idx" ON "ApprovalPolicy"("actionType", "actionSchemaVersionMin", "actionSchemaVersionMax");
CREATE UNIQUE INDEX "ApprovalPolicy_policyKey_policyVersion_key" ON "ApprovalPolicy"("policyKey", "policyVersion");
CREATE UNIQUE INDEX "ApprovalPolicyActivation_actionIntentId_key" ON "ApprovalPolicyActivation"("actionIntentId");
CREATE INDEX "ApprovalPolicyActivation_proposalId_createdAt_idx" ON "ApprovalPolicyActivation"("proposalId", "createdAt");
CREATE UNIQUE INDEX "ApprovalPolicyActivation_policyId_kind_key" ON "ApprovalPolicyActivation"("policyId", "kind");
CREATE UNIQUE INDEX "ApprovalPolicyActiveSlot_policyId_key" ON "ApprovalPolicyActiveSlot"("policyId");
CREATE INDEX "ApprovalRequest_state_expiresAt_idx" ON "ApprovalRequest"("state", "expiresAt");
CREATE INDEX "ApprovalRequest_actionType_createdAt_idx" ON "ApprovalRequest"("actionType", "createdAt");
CREATE INDEX "ApprovalRequest_policyId_state_idx" ON "ApprovalRequest"("policyId", "state");
CREATE UNIQUE INDEX "ApprovalRequest_requesterId_actionType_idempotencyKeyHash_key" ON "ApprovalRequest"("requesterId", "actionType", "idempotencyKeyHash");
CREATE UNIQUE INDEX "ApprovalDecision_actionIntentId_key" ON "ApprovalDecision"("actionIntentId");
CREATE INDEX "ApprovalDecision_requestId_value_createdAt_idx" ON "ApprovalDecision"("requestId", "value", "createdAt");
CREATE UNIQUE INDEX "ApprovalDecision_requestId_actorId_key" ON "ApprovalDecision"("requestId", "actorId");
CREATE UNIQUE INDEX "ApprovalExecution_requestId_key" ON "ApprovalExecution"("requestId");
CREATE UNIQUE INDEX "ApprovalExecution_actionIntentId_key" ON "ApprovalExecution"("actionIntentId");

ALTER TABLE "ApprovalPolicyReviewDecision" ADD CONSTRAINT "ApprovalPolicyReviewDecision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ApprovalPolicyProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ApprovalPolicyProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalPolicyActivation" ADD CONSTRAINT "ApprovalPolicyActivation_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ApprovalPolicyProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalPolicyActivation" ADD CONSTRAINT "ApprovalPolicyActivation_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalPolicyActiveSlot" ADD CONSTRAINT "ApprovalPolicyActiveSlot_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalExecution" ADD CONSTRAINT "ApprovalExecution_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "governance_reject_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'GOVERNANCE_APPEND_ONLY';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GovernanceIdempotencyRecord_append_only" BEFORE UPDATE OR DELETE ON "GovernanceIdempotencyRecord" FOR EACH ROW EXECUTE FUNCTION "governance_reject_mutation"();
CREATE TRIGGER "ApprovalPolicyReviewDecision_append_only" BEFORE UPDATE OR DELETE ON "ApprovalPolicyReviewDecision" FOR EACH ROW EXECUTE FUNCTION "governance_reject_mutation"();
CREATE TRIGGER "ApprovalPolicy_append_only" BEFORE UPDATE OR DELETE ON "ApprovalPolicy" FOR EACH ROW EXECUTE FUNCTION "governance_reject_mutation"();
CREATE TRIGGER "ApprovalPolicyActivation_append_only" BEFORE UPDATE OR DELETE ON "ApprovalPolicyActivation" FOR EACH ROW EXECUTE FUNCTION "governance_reject_mutation"();
CREATE TRIGGER "ApprovalDecision_append_only" BEFORE UPDATE OR DELETE ON "ApprovalDecision" FOR EACH ROW EXECUTE FUNCTION "governance_reject_mutation"();
CREATE TRIGGER "ApprovalExecution_append_only" BEFORE UPDATE OR DELETE ON "ApprovalExecution" FOR EACH ROW EXECUTE FUNCTION "governance_reject_mutation"();

CREATE OR REPLACE FUNCTION "governance_action_intent_transition"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ACTION_INTENT_IMMUTABLE'; END IF;
  IF ROW(NEW."id", NEW."tokenDigest", NEW."digestKeyId", NEW."intentVersion", NEW."canonicalizationVersion",
         NEW."hashAlgorithm", NEW."hashDomain", NEW."hashVersion", NEW."semanticEnvelope", NEW."actionHash",
         NEW."subjectId", NEW."subjectTokenVersion", NEW."subjectMfaVersion", NEW."sessionId", NEW."action",
         NEW."resourceType", NEW."resourceId", NEW."resourceVersion", NEW."payloadHash", NEW."targetSetHash",
         NEW."policyHash", NEW."policyVersion", NEW."approvalEvidenceSetHash", NEW."decisionValue", NEW."executionId",
         NEW."serverCorrelationId", NEW."nonce", NEW."issuedAt", NEW."expiresAt")
     IS DISTINCT FROM
     ROW(OLD."id", OLD."tokenDigest", OLD."digestKeyId", OLD."intentVersion", OLD."canonicalizationVersion",
         OLD."hashAlgorithm", OLD."hashDomain", OLD."hashVersion", OLD."semanticEnvelope", OLD."actionHash",
         OLD."subjectId", OLD."subjectTokenVersion", OLD."subjectMfaVersion", OLD."sessionId", OLD."action",
         OLD."resourceType", OLD."resourceId", OLD."resourceVersion", OLD."payloadHash", OLD."targetSetHash",
         OLD."policyHash", OLD."policyVersion", OLD."approvalEvidenceSetHash", OLD."decisionValue", OLD."executionId",
         OLD."serverCorrelationId", OLD."nonce", OLD."issuedAt", OLD."expiresAt") THEN
    RAISE EXCEPTION 'ACTION_INTENT_IMMUTABLE';
  END IF;
  IF OLD."consumedAt" IS NOT NULL OR OLD."revokedAt" IS NOT NULL THEN RAISE EXCEPTION 'ACTION_INTENT_TERMINAL'; END IF;
  IF NEW."consumedAt" IS NULL AND NEW."revokedAt" IS NULL THEN RAISE EXCEPTION 'ACTION_INTENT_NO_TRANSITION'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ActionIntent_transition_only" BEFORE UPDATE OR DELETE ON "ActionIntent" FOR EACH ROW EXECUTE FUNCTION "governance_action_intent_transition"();

CREATE OR REPLACE FUNCTION "governance_policy_proposal_transition"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'POLICY_PROPOSAL_IMMUTABLE'; END IF;
  IF ROW(NEW."id", NEW."policyKey", NEW."proposedPolicyVersion", NEW."actionType", NEW."actionSchemaVersionMin",
         NEW."actionSchemaVersionMax", NEW."mode", NEW."requiredReviewCount", NEW."requiredApproverCount",
         NEW."semanticPolicy", NEW."policyHash", NEW."canonicalizationVersion", NEW."hashAlgorithm", NEW."hashDomain",
         NEW."hashVersion", NEW."d05EvidenceDescriptors", NEW."approvalEvidenceSetHash", NEW."proposerId",
         NEW."proposerTokenVersion", NEW."proposerMfaVersion", NEW."proposerSessionId", NEW."serverCorrelationId", NEW."createdAt")
     IS DISTINCT FROM
     ROW(OLD."id", OLD."policyKey", OLD."proposedPolicyVersion", OLD."actionType", OLD."actionSchemaVersionMin",
         OLD."actionSchemaVersionMax", OLD."mode", OLD."requiredReviewCount", OLD."requiredApproverCount",
         OLD."semanticPolicy", OLD."policyHash", OLD."canonicalizationVersion", OLD."hashAlgorithm", OLD."hashDomain",
         OLD."hashVersion", OLD."d05EvidenceDescriptors", OLD."approvalEvidenceSetHash", OLD."proposerId",
         OLD."proposerTokenVersion", OLD."proposerMfaVersion", OLD."proposerSessionId", OLD."serverCorrelationId", OLD."createdAt") THEN
    RAISE EXCEPTION 'POLICY_PROPOSAL_IMMUTABLE';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'POLICY_PROPOSAL_CAS_REQUIRED'; END IF;
  IF NOT (
    (OLD."state" = 'proposed' AND NEW."state" IN ('under_review', 'rejected')) OR
    (OLD."state" = 'under_review' AND NEW."state" IN ('under_review', 'approved', 'rejected')) OR
    (OLD."state" = 'approved' AND NEW."state" IN ('active', 'rejected')) OR
    (OLD."state" = 'active' AND NEW."state" = 'retired')
  ) THEN RAISE EXCEPTION 'POLICY_PROPOSAL_INVALID_TRANSITION'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ApprovalPolicyProposal_transition_only" BEFORE UPDATE OR DELETE ON "ApprovalPolicyProposal" FOR EACH ROW EXECUTE FUNCTION "governance_policy_proposal_transition"();

CREATE OR REPLACE FUNCTION "governance_approval_request_transition"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'APPROVAL_REQUEST_IMMUTABLE'; END IF;
  IF ROW(NEW."id", NEW."actionType", NEW."schemaVersion", NEW."normalizationVersion", NEW."adapterVersion",
         NEW."semanticCommand", NEW."payloadHash", NEW."targetSetHash", NEW."canonicalizationVersion", NEW."hashAlgorithm",
         NEW."hashVersion", NEW."policyId", NEW."policyHash", NEW."policyVersion", NEW."requiredApproverCount",
         NEW."requesterId", NEW."requesterTokenVersion", NEW."requesterMfaVersion", NEW."requesterAccountVersion",
         NEW."requesterSessionId", NEW."idempotencyKeyHash", NEW."idempotencyKeyId", NEW."serverCorrelationId",
         NEW."expiresAt", NEW."supersedesRequestId", NEW."createdAt")
     IS DISTINCT FROM
     ROW(OLD."id", OLD."actionType", OLD."schemaVersion", OLD."normalizationVersion", OLD."adapterVersion",
         OLD."semanticCommand", OLD."payloadHash", OLD."targetSetHash", OLD."canonicalizationVersion", OLD."hashAlgorithm",
         OLD."hashVersion", OLD."policyId", OLD."policyHash", OLD."policyVersion", OLD."requiredApproverCount",
         OLD."requesterId", OLD."requesterTokenVersion", OLD."requesterMfaVersion", OLD."requesterAccountVersion",
         OLD."requesterSessionId", OLD."idempotencyKeyHash", OLD."idempotencyKeyId", OLD."serverCorrelationId",
         OLD."expiresAt", OLD."supersedesRequestId", OLD."createdAt") THEN
    RAISE EXCEPTION 'APPROVAL_REQUEST_IMMUTABLE';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'APPROVAL_REQUEST_CAS_REQUIRED'; END IF;
  IF NOT (
    (OLD."state" = 'pending' AND NEW."state" IN ('pending', 'approved', 'rejected', 'cancelled', 'expired', 'stale')) OR
    (OLD."state" = 'approved' AND NEW."state" IN ('rejected', 'expired', 'stale'))
  ) THEN RAISE EXCEPTION 'APPROVAL_REQUEST_INVALID_TRANSITION'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ApprovalRequest_transition_only" BEFORE UPDATE OR DELETE ON "ApprovalRequest" FOR EACH ROW EXECUTE FUNCTION "governance_approval_request_transition"();

-- Permission vocabulary only. No role receives these permissions here.
INSERT INTO "Permission" ("id", "key", "description") VALUES
  ('perm_approval_policies_read', 'approval_policies.read', 'Read governance policy evidence'),
  ('perm_approval_policies_propose', 'approval_policies.propose', 'Propose immutable approval policy semantics'),
  ('perm_approval_policies_review', 'approval_policies.review', 'Append a policy review decision'),
  ('perm_approval_policies_activate', 'approval_policies.activate', 'Activate an approved policy'),
  ('perm_approval_policies_retire', 'approval_policies.retire', 'Retire an active policy'),
  ('perm_approvals_read', 'approvals.read', 'Read approval request evidence'),
  ('perm_approvals_request', 'approvals.request', 'Create an approval request'),
  ('perm_approvals_decide', 'approvals.decide', 'Append an approval decision'),
  ('perm_approvals_cancel', 'approvals.cancel', 'Cancel an owned pending approval request'),
  ('perm_approvals_execute', 'approvals.execute', 'Authorize execution after quorum')
ON CONFLICT ("key") DO NOTHING;
