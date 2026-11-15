-- Security re-gate remediation. Additive because 20260730232000 may already be
-- present in an operator environment. No business policy or active slot is seeded.

ALTER TABLE "ApprovalPolicyProposal" ADD COLUMN "reviewEvidenceSetHash" TEXT;
ALTER TABLE "ActionIntent" ADD COLUMN "reasonCode" TEXT;

CREATE TABLE "ApprovalBootstrapEvidenceAdmission" (
  "id" TEXT NOT NULL,
  "approvalEvidenceSetHash" TEXT NOT NULL,
  "verifierControlReference" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "ApprovalBootstrapEvidenceAdmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovalBootstrapEvidenceAdmission_window" CHECK ("expiresAt" IS NULL OR "expiresAt" > "verifiedAt")
);
CREATE UNIQUE INDEX "ApprovalBootstrapEvidenceAdmission_approvalEvidenceSetHash_key"
  ON "ApprovalBootstrapEvidenceAdmission"("approvalEvidenceSetHash");
CREATE TRIGGER "ApprovalBootstrapEvidenceAdmission_append_only" BEFORE UPDATE OR DELETE ON "ApprovalBootstrapEvidenceAdmission"
FOR EACH ROW EXECUTE FUNCTION "governance_reject_mutation"();

CREATE OR REPLACE FUNCTION "governance_action_intent_insert_admission"() RETURNS trigger AS $$
BEGIN
  IF NEW."consumedAt" IS NOT NULL OR NEW."revokedAt" IS NOT NULL OR NEW."revokeReasonCode" IS NOT NULL THEN
    RAISE EXCEPTION 'ACTION_INTENT_MUST_START_UNUSED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ActionIntent_insert_admission" BEFORE INSERT ON "ActionIntent"
FOR EACH ROW EXECUTE FUNCTION "governance_action_intent_insert_admission"();

CREATE OR REPLACE FUNCTION "governance_action_intent_reason_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."reasonCode" IS DISTINCT FROM OLD."reasonCode" THEN RAISE EXCEPTION 'ACTION_INTENT_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ActionIntent_reason_immutable" BEFORE UPDATE ON "ActionIntent"
FOR EACH ROW EXECUTE FUNCTION "governance_action_intent_reason_immutable"();

CREATE OR REPLACE FUNCTION "governance_policy_review_admission"() RETURNS trigger AS $$
DECLARE
  proposal "ApprovalPolicyProposal"%ROWTYPE;
  minimum_contract INTEGER;
BEGIN
  SELECT * INTO proposal FROM "ApprovalPolicyProposal" WHERE "id" = NEW."proposalId" FOR SHARE;
  SELECT "minimumAuthContractVersion" INTO minimum_contract FROM "SecurityControl" WHERE "id" = 1;
  IF proposal."id" IS NULL OR proposal."state" NOT IN ('proposed', 'under_review', 'approved')
     OR NEW."reviewerId" = proposal."proposerId"
     OR NEW."policyHash" <> proposal."policyHash"
     OR NEW."evidenceHash" <> proposal."approvalEvidenceSetHash" THEN
    RAISE EXCEPTION 'POLICY_REVIEW_ADMISSION_DENIED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Admin" a
    JOIN "StaffSession" s ON s."id" = NEW."reviewerSessionId" AND s."staffUserId" = a."id"
    WHERE a."id" = NEW."reviewerId" AND a."enabled" = TRUE AND a."status" = 'active'
      AND a."tokenVersion" = NEW."reviewerTokenVersion" AND a."mfaVersion" = NEW."reviewerMfaVersion"
      AND a."version" = NEW."reviewerAccountVersion" AND s."revokedAt" IS NULL
      AND s."idleExpiresAt" > CURRENT_TIMESTAMP AND s."absoluteExpiresAt" > CURRENT_TIMESTAMP
      AND s."tokenVersionSnapshot" = NEW."reviewerTokenVersion"
      AND s."authContractVersion" >= COALESCE(minimum_contract, 2147483647)
      AND EXISTS (
        SELECT 1 FROM "AdminRoleAssignment" ara
        JOIN "RolePermission" rp ON rp."roleId" = ara."roleId"
        JOIN "Permission" p ON p."id" = rp."permissionId"
        WHERE ara."adminId" = a."id" AND ara."scopeType" = 'global' AND ara."scopeId" = ''
          AND p."key" = 'approval_policies.review'
      )
  ) THEN RAISE EXCEPTION 'POLICY_REVIEW_ACTOR_INELIGIBLE'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "ActionIntent" i
    WHERE i."id" = NEW."actionIntentId" AND i."consumedAt" IS NOT NULL AND i."revokedAt" IS NULL
      AND i."action" = 'approval.policy.review' AND i."subjectId" = NEW."reviewerId"
      AND i."sessionId" = NEW."reviewerSessionId" AND i."resourceType" = 'ApprovalPolicyProposal'
      AND i."resourceId" = NEW."proposalId" AND i."policyHash" = NEW."policyHash"
      AND i."approvalEvidenceSetHash" = NEW."evidenceHash" AND i."decisionValue"::text = NEW."value"::text
      AND i."actionHash" = NEW."actionHash"
  ) THEN RAISE EXCEPTION 'POLICY_REVIEW_INTENT_INVALID'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ApprovalPolicyReviewDecision_admission" BEFORE INSERT ON "ApprovalPolicyReviewDecision"
FOR EACH ROW EXECUTE FUNCTION "governance_policy_review_admission"();

CREATE OR REPLACE FUNCTION "governance_policy_proposal_transition"() RETURNS trigger AS $$
DECLARE
  approve_count INTEGER;
  reject_count INTEGER;
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

  IF NEW."state" = 'approved' THEN
    SELECT count(*) FILTER (WHERE "value" = 'approve'), count(*) FILTER (WHERE "value" = 'reject')
      INTO approve_count, reject_count FROM "ApprovalPolicyReviewDecision" WHERE "proposalId" = NEW."id";
    IF NEW."reviewEvidenceSetHash" IS NULL OR approve_count < NEW."requiredReviewCount" OR reject_count > 0 THEN
      RAISE EXCEPTION 'POLICY_PROPOSAL_QUORUM_NOT_ADMISSIBLE';
    END IF;
  ELSIF NEW."state" = 'active' THEN
    IF NOT EXISTS (SELECT 1 FROM "ApprovalPolicy" p JOIN "ApprovalPolicyActiveSlot" s ON s."policyId" = p."id"
      JOIN "ApprovalPolicyActivation" a ON a."policyId" = p."id" AND a."kind" = 'activate'
      WHERE p."proposalId" = NEW."id") THEN RAISE EXCEPTION 'POLICY_PROPOSAL_ACTIVATION_EVIDENCE_MISSING'; END IF;
  ELSIF NEW."state" = 'retired' THEN
    IF EXISTS (SELECT 1 FROM "ApprovalPolicy" p JOIN "ApprovalPolicyActiveSlot" s ON s."policyId" = p."id" WHERE p."proposalId" = NEW."id")
       OR NOT EXISTS (SELECT 1 FROM "ApprovalPolicy" p JOIN "ApprovalPolicyActivation" a ON a."policyId" = p."id" AND a."kind" = 'retire' WHERE p."proposalId" = NEW."id")
    THEN RAISE EXCEPTION 'POLICY_PROPOSAL_RETIREMENT_EVIDENCE_MISSING'; END IF;
  END IF;
  IF NEW."state" IN ('proposed', 'under_review') AND NEW."reviewEvidenceSetHash" IS NOT NULL THEN
    RAISE EXCEPTION 'POLICY_REVIEW_EVIDENCE_PREMATURE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "governance_policy_materialization_admission"() RETURNS trigger AS $$
DECLARE proposal "ApprovalPolicyProposal"%ROWTYPE;
BEGIN
  SELECT * INTO proposal FROM "ApprovalPolicyProposal" WHERE "id" = NEW."proposalId" FOR SHARE;
  IF proposal."id" IS NULL OR proposal."state" <> 'approved' OR proposal."reviewEvidenceSetHash" IS NULL
     OR NEW."policyKey" <> proposal."policyKey" OR NEW."policyVersion" <> proposal."proposedPolicyVersion"
     OR NEW."actionType" <> proposal."actionType"
     OR NEW."actionSchemaVersionMin" <> proposal."actionSchemaVersionMin"
     OR NEW."actionSchemaVersionMax" <> proposal."actionSchemaVersionMax"
     OR NEW."mode" <> proposal."mode" OR NEW."requiredApproverCount" <> proposal."requiredApproverCount"
     OR NEW."semanticPolicy" IS DISTINCT FROM proposal."semanticPolicy"
     OR NEW."policyHash" <> proposal."policyHash"
     OR NEW."canonicalizationVersion" <> proposal."canonicalizationVersion"
     OR NEW."hashAlgorithm" <> proposal."hashAlgorithm" OR NEW."hashDomain" <> proposal."hashDomain"
     OR NEW."hashVersion" <> proposal."hashVersion"
     OR NEW."approvalEvidenceSetHash" <> proposal."reviewEvidenceSetHash" THEN
    RAISE EXCEPTION 'POLICY_MATERIALIZATION_ADMISSION_DENIED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ApprovalPolicy_materialization_admission" BEFORE INSERT ON "ApprovalPolicy"
FOR EACH ROW EXECUTE FUNCTION "governance_policy_materialization_admission"();

CREATE OR REPLACE FUNCTION "governance_policy_activation_admission"() RETURNS trigger AS $$
DECLARE
  proposal "ApprovalPolicyProposal"%ROWTYPE;
  policy "ApprovalPolicy"%ROWTYPE;
  permission_key TEXT;
BEGIN
  SELECT * INTO proposal FROM "ApprovalPolicyProposal" WHERE "id" = NEW."proposalId" FOR SHARE;
  SELECT * INTO policy FROM "ApprovalPolicy" WHERE "id" = NEW."policyId" FOR SHARE;
  permission_key := CASE WHEN NEW."kind" = 'activate' THEN 'approval_policies.activate' ELSE 'approval_policies.retire' END;
  IF proposal."id" IS NULL OR policy."id" IS NULL OR policy."proposalId" <> proposal."id"
     OR NEW."policyHash" <> policy."policyHash" OR NEW."approvalEvidenceSetHash" <> policy."approvalEvidenceSetHash"
     OR (NEW."kind" = 'activate' AND proposal."state" <> 'approved')
     OR (NEW."kind" = 'retire' AND proposal."state" <> 'active')
     OR NEW."actorId" = proposal."proposerId"
     OR EXISTS (SELECT 1 FROM "ApprovalPolicyReviewDecision" r WHERE r."proposalId" = proposal."id" AND r."reviewerId" = NEW."actorId")
  THEN RAISE EXCEPTION 'POLICY_ACTIVATION_ADMISSION_DENIED'; END IF;
  IF NEW."kind" = 'activate' AND NOT EXISTS (
    SELECT 1 FROM "ApprovalBootstrapEvidenceAdmission" e
    WHERE e."approvalEvidenceSetHash" = proposal."approvalEvidenceSetHash"
      AND e."revokedAt" IS NULL AND e."verifiedAt" <= CURRENT_TIMESTAMP
      AND (e."expiresAt" IS NULL OR e."expiresAt" > CURRENT_TIMESTAMP)
  ) THEN RAISE EXCEPTION 'POLICY_BOOTSTRAP_EVIDENCE_NOT_ADMITTED'; END IF;
  IF NEW."kind" = 'activate' AND (
    EXISTS (SELECT 1 FROM "ApprovalPolicyReviewDecision" r WHERE r."proposalId" = proposal."id" AND r."value" = 'reject')
    OR (SELECT count(DISTINCT r."reviewerId") FROM "ApprovalPolicyReviewDecision" r
        JOIN "Admin" ra ON ra."id" = r."reviewerId"
        JOIN "StaffSession" rs ON rs."id" = r."reviewerSessionId" AND rs."staffUserId" = ra."id"
        WHERE r."proposalId" = proposal."id" AND r."value" = 'approve'
          AND r."policyHash" = proposal."policyHash" AND r."evidenceHash" = proposal."approvalEvidenceSetHash"
          AND ra."enabled" = TRUE AND ra."status" = 'active'
          AND ra."tokenVersion" = r."reviewerTokenVersion" AND ra."mfaVersion" = r."reviewerMfaVersion"
          AND ra."version" = r."reviewerAccountVersion" AND rs."revokedAt" IS NULL
          AND rs."idleExpiresAt" > CURRENT_TIMESTAMP AND rs."absoluteExpiresAt" > CURRENT_TIMESTAMP
          AND rs."tokenVersionSnapshot" = r."reviewerTokenVersion"
          AND EXISTS (SELECT 1 FROM "AdminRoleAssignment" ara JOIN "RolePermission" rp ON rp."roleId" = ara."roleId"
            JOIN "Permission" p ON p."id" = rp."permissionId" WHERE ara."adminId" = ra."id"
            AND ara."scopeType" = 'global' AND ara."scopeId" = '' AND p."key" = 'approval_policies.review')) < proposal."requiredReviewCount"
  ) THEN RAISE EXCEPTION 'POLICY_REVIEW_EVIDENCE_NO_LONGER_EFFECTIVE'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Admin" a JOIN "StaffSession" s ON s."id" = NEW."actorSessionId" AND s."staffUserId" = a."id"
    WHERE a."id" = NEW."actorId" AND a."enabled" = TRUE AND a."status" = 'active'
      AND a."tokenVersion" = NEW."actorTokenVersion" AND a."mfaVersion" = NEW."actorMfaVersion"
      AND s."revokedAt" IS NULL AND s."idleExpiresAt" > CURRENT_TIMESTAMP AND s."absoluteExpiresAt" > CURRENT_TIMESTAMP
      AND s."tokenVersionSnapshot" = NEW."actorTokenVersion"
      AND EXISTS (SELECT 1 FROM "AdminRoleAssignment" ara JOIN "RolePermission" rp ON rp."roleId" = ara."roleId"
        JOIN "Permission" p ON p."id" = rp."permissionId" WHERE ara."adminId" = a."id"
        AND ara."scopeType" = 'global' AND ara."scopeId" = '' AND p."key" = permission_key)
  ) THEN RAISE EXCEPTION 'POLICY_ACTIVATION_ACTOR_INELIGIBLE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "ActionIntent" i WHERE i."id" = NEW."actionIntentId" AND i."consumedAt" IS NOT NULL
      AND i."revokedAt" IS NULL AND i."subjectId" = NEW."actorId" AND i."sessionId" = NEW."actorSessionId"
      AND i."policyHash" = NEW."policyHash" AND i."approvalEvidenceSetHash" = NEW."approvalEvidenceSetHash"
      AND i."actionHash" = NEW."actionHash"
      AND ((NEW."kind" = 'activate' AND i."action" = 'approval.policy.activate' AND i."resourceType" = 'ApprovalPolicyProposal' AND i."resourceId" = proposal."id" AND i."reasonCode" IS NULL)
        OR (NEW."kind" = 'retire' AND i."action" = 'approval.policy.retire' AND i."resourceType" = 'ApprovalPolicy' AND i."resourceId" = policy."id" AND i."reasonCode" = NEW."reasonCode")))
  THEN RAISE EXCEPTION 'POLICY_ACTIVATION_INTENT_INVALID'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ApprovalPolicyActivation_admission" BEFORE INSERT ON "ApprovalPolicyActivation"
FOR EACH ROW EXECUTE FUNCTION "governance_policy_activation_admission"();

CREATE OR REPLACE FUNCTION "governance_active_slot_admission"() RETURNS trigger AS $$
DECLARE policy "ApprovalPolicy"%ROWTYPE;
DECLARE proposal_state "ApprovalPolicyProposalState";
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('governance-active-slot:' || NEW."actionType"));
  SELECT * INTO policy FROM "ApprovalPolicy" WHERE "id" = NEW."policyId" FOR SHARE;
  SELECT "state" INTO proposal_state FROM "ApprovalPolicyProposal" WHERE "id" = policy."proposalId" FOR SHARE;
  IF policy."id" IS NULL OR proposal_state <> 'approved'
     OR NEW."policyKey" <> policy."policyKey" OR NEW."actionType" <> policy."actionType"
     OR NEW."actionSchemaVersionMin" <> policy."actionSchemaVersionMin"
     OR NEW."actionSchemaVersionMax" <> policy."actionSchemaVersionMax"
     OR NOT EXISTS (SELECT 1 FROM "ApprovalPolicyActivation" a WHERE a."policyId" = policy."id" AND a."kind" = 'activate'
       AND a."policyHash" = policy."policyHash" AND a."approvalEvidenceSetHash" = policy."approvalEvidenceSetHash")
  THEN RAISE EXCEPTION 'ACTIVE_POLICY_SLOT_ADMISSION_DENIED'; END IF;
  IF EXISTS (SELECT 1 FROM "ApprovalPolicyActiveSlot" s WHERE s."actionType" = NEW."actionType"
    AND int4range(s."actionSchemaVersionMin", s."actionSchemaVersionMax", '[]') &&
        int4range(NEW."actionSchemaVersionMin", NEW."actionSchemaVersionMax", '[]'))
  THEN RAISE EXCEPTION 'ACTIVE_POLICY_SCHEMA_RANGE_OVERLAP'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ApprovalPolicyActiveSlot_admission" BEFORE INSERT ON "ApprovalPolicyActiveSlot"
FOR EACH ROW EXECUTE FUNCTION "governance_active_slot_admission"();

CREATE OR REPLACE FUNCTION "governance_active_slot_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'ACTIVE_POLICY_SLOT_IMMUTABLE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "ApprovalPolicyActivation" a WHERE a."policyId" = OLD."policyId" AND a."kind" = 'retire') THEN
    RAISE EXCEPTION 'ACTIVE_POLICY_SLOT_RETIREMENT_EVIDENCE_MISSING';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ApprovalPolicyActiveSlot_mutation" BEFORE UPDATE OR DELETE ON "ApprovalPolicyActiveSlot"
FOR EACH ROW EXECUTE FUNCTION "governance_active_slot_mutation"();
