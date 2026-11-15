-- Increment 3C: additive, zero-handler generic outbox/job evidence core.
-- This migration deliberately inserts no JobTypeRegistry, message, receipt or job rows.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tyre_jobs_guard_owner') THEN
    CREATE ROLE tyre_jobs_guard_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tyre_jobs_producer') THEN CREATE ROLE tyre_jobs_producer NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tyre_jobs_claimer') THEN CREATE ROLE tyre_jobs_claimer NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tyre_jobs_reader') THEN CREATE ROLE tyre_jobs_reader NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tyre_jobs_maintenance') THEN CREATE ROLE tyre_jobs_maintenance NOLOGIN NOINHERIT; END IF;
END $$;

CREATE TABLE "JobTypeRegistry" (
  "jobType" TEXT NOT NULL, "schemaVersion" INTEGER NOT NULL, "registryDigestVersion" INTEGER NOT NULL DEFAULT 1,
  "registryDigest" TEXT NOT NULL, "ownerDomain" TEXT NOT NULL, "producerId" TEXT NOT NULL, "consumerId" TEXT,
  "published" BOOLEAN NOT NULL DEFAULT false, "enqueueEnabled" BOOLEAN NOT NULL DEFAULT false,
  "handlerEnabled" BOOLEAN NOT NULL DEFAULT false, "externalEffectCapable" BOOLEAN NOT NULL DEFAULT false,
  "safeFieldSchema" JSONB NOT NULL, "authorizationScopeKind" TEXT NOT NULL, "scopeMatchMode" TEXT NOT NULL,
  "requiredGlobalGrant" TEXT, "allowGlobalReader" BOOLEAN NOT NULL DEFAULT false,
  "allowAnyResourceScope" BOOLEAN NOT NULL DEFAULT false, "allowedScopeDimensions" TEXT[] NOT NULL,
  "scopeResolverId" TEXT NOT NULL, "scopeResolverVersion" INTEGER NOT NULL, "authorizationPolicyVersion" INTEGER NOT NULL,
  "maxPayloadBytes" INTEGER NOT NULL, "maxChildFanout" INTEGER NOT NULL, "maxDepth" INTEGER NOT NULL,
  "maxOriginRows" INTEGER NOT NULL, "maxTransactionRows" INTEGER NOT NULL, "maxDerivedBytes" INTEGER NOT NULL,
  "maxAuditFacts" INTEGER NOT NULL, "leaseSeconds" INTEGER NOT NULL, "maxAttempts" INTEGER NOT NULL,
  "reclaimable" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "JobTypeRegistry_pkey" PRIMARY KEY ("jobType","schemaVersion"),
  CONSTRAINT "JobTypeRegistry_digest_key" UNIQUE ("jobType","schemaVersion","registryDigest"),
  CONSTRAINT "JobTypeRegistry_digest_check" CHECK ("registryDigestVersion"=1 AND "registryDigest" ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT "JobTypeRegistry_identity_check" CHECK ("jobType" ~ '^[a-z][a-z0-9_.-]{0,127}$' AND "ownerDomain" ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  CONSTRAINT "JobTypeRegistry_safe_schema_check" CHECK (jsonb_typeof("safeFieldSchema")='object'),
  CONSTRAINT "JobTypeRegistry_scope_check" CHECK (
    "authorizationScopeKind" IN ('resource_scoped','global_operations','cross_scope','legacy_restricted') AND
    "scopeMatchMode" IN ('all','any') AND
    ("scopeMatchMode"='all' OR ("authorizationScopeKind"='resource_scoped' AND "allowAnyResourceScope")) AND
    ("authorizationScopeKind"<>'global_operations' OR ("scopeMatchMode"='all' AND cardinality("allowedScopeDimensions")=0 AND "requiredGlobalGrant" IS NOT NULL)) AND
    ("authorizationScopeKind"<>'cross_scope' OR "scopeMatchMode"='all')),
  CONSTRAINT "JobTypeRegistry_limits_check" CHECK ("maxPayloadBytes">0 AND "maxChildFanout">=0 AND "maxDepth">=0 AND "maxOriginRows">0 AND "maxTransactionRows">0 AND "maxDerivedBytes">0 AND "maxAuditFacts">0 AND "leaseSeconds">0 AND "maxAttempts">0),
  CONSTRAINT "JobTypeRegistry_external_blocked_check" CHECK (NOT "externalEffectCapable")
);

CREATE TABLE "OutboxMessage" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "jobType" TEXT NOT NULL, "schemaVersion" INTEGER NOT NULL,
  "registryDigest" TEXT NOT NULL, "ownerDomain" TEXT NOT NULL, "producerId" TEXT NOT NULL, "consumerId" TEXT,
  "inputDigest" TEXT NOT NULL, "safePayload" JSONB NOT NULL, "idempotencyNamespace" TEXT NOT NULL,
  "deduplicationKey" TEXT NOT NULL, "originJobId" UUID NOT NULL, "parentJobId" UUID, "depth" INTEGER NOT NULL,
  "ancestryDigest" TEXT NOT NULL, "aggregateType" TEXT, "aggregateId" TEXT, "aggregateSequence" BIGINT,
  "authorizationScopeKind" TEXT NOT NULL, "scopeMatchMode" TEXT NOT NULL, "requiredGlobalGrant" TEXT,
  "scopeResolverId" TEXT NOT NULL, "scopeResolverVersion" INTEGER NOT NULL, "authorizationPolicyVersion" INTEGER NOT NULL,
  "serverCorrelationId" TEXT NOT NULL, "causationId" TEXT, "clientRequestId" TEXT,
  "originatingAuditEventId" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "OutboxMessage_registry_fkey" FOREIGN KEY ("jobType","schemaVersion","registryDigest") REFERENCES "JobTypeRegistry"("jobType","schemaVersion","registryDigest") ON DELETE RESTRICT,
  CONSTRAINT "OutboxMessage_audit_fkey" FOREIGN KEY ("originatingAuditEventId") REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT,
  CONSTRAINT "OutboxMessage_dedup_key" UNIQUE ("idempotencyNamespace","deduplicationKey"),
  CONSTRAINT "OutboxMessage_digest_check" CHECK ("inputDigest" ~ '^[A-Za-z0-9_-]{43}$' AND "ancestryDigest" ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT "OutboxMessage_payload_check" CHECK (jsonb_typeof("safePayload")='array' AND "depth">=0),
  CONSTRAINT "OutboxMessage_aggregate_check" CHECK (("aggregateType" IS NULL AND "aggregateId" IS NULL AND "aggregateSequence" IS NULL) OR ("aggregateType" IS NOT NULL AND "aggregateId" IS NOT NULL AND "aggregateSequence">0))
);

CREATE TABLE "BackgroundJob" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "outboxMessageId" UUID NOT NULL UNIQUE,
  "jobType" TEXT NOT NULL, "schemaVersion" INTEGER NOT NULL, "registryDigest" TEXT NOT NULL,
  "ownerDomain" TEXT NOT NULL, "safeSummary" JSONB NOT NULL, "inputDigest" TEXT NOT NULL,
  "originJobId" UUID NOT NULL, "parentJobId" UUID, "depth" INTEGER NOT NULL, "ancestryDigest" TEXT NOT NULL,
  "authorizationScopeKind" TEXT NOT NULL, "scopeMatchMode" TEXT NOT NULL, "requiredGlobalGrant" TEXT,
  "scopeResolverId" TEXT NOT NULL, "scopeResolverVersion" INTEGER NOT NULL, "authorizationPolicyVersion" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'queued', "priority" INTEGER NOT NULL, "availableAt" TIMESTAMPTZ(6) NOT NULL,
  "leaseGeneration" INTEGER NOT NULL DEFAULT 0, "leaseSecretDigest" BYTEA, "leaseDigestKeyId" TEXT,
  "leaseExpiresAt" TIMESTAMPTZ(6), "serverCorrelationId" TEXT NOT NULL, "causationId" TEXT,
  "originatingAuditEventId" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "BackgroundJob_outbox_fkey" FOREIGN KEY ("outboxMessageId") REFERENCES "OutboxMessage"("id") ON DELETE RESTRICT,
  CONSTRAINT "BackgroundJob_registry_fkey" FOREIGN KEY ("jobType","schemaVersion","registryDigest") REFERENCES "JobTypeRegistry"("jobType","schemaVersion","registryDigest") ON DELETE RESTRICT,
  CONSTRAINT "BackgroundJob_audit_fkey" FOREIGN KEY ("originatingAuditEventId") REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT,
  CONSTRAINT "BackgroundJob_state_check" CHECK ("state" IN ('queued','processing','succeeded','known_safe_failure','external_outcome_unknown','dead_lettered','cancelled_before_effect','reconciling','reconciled_applied','reconciled_not_applied')),
  CONSTRAINT "BackgroundJob_lease_check" CHECK (("state" IN ('processing','external_outcome_unknown','reconciling') AND "leaseGeneration">0 AND "leaseSecretDigest" IS NOT NULL AND "leaseDigestKeyId" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR ("state" NOT IN ('processing','external_outcome_unknown','reconciling') AND "leaseSecretDigest" IS NULL AND "leaseDigestKeyId" IS NULL AND "leaseExpiresAt" IS NULL)),
  CONSTRAINT "BackgroundJob_scope_check" CHECK ("authorizationScopeKind" IN ('resource_scoped','global_operations','cross_scope','legacy_restricted') AND "scopeMatchMode" IN ('all','any'))
);

CREATE TABLE "JobAuthorizationScopeRef" (
  "jobId" UUID NOT NULL REFERENCES "BackgroundJob"("id") ON DELETE RESTRICT, "dimension" TEXT NOT NULL, "scopeId" TEXT NOT NULL, "ordinal" INTEGER NOT NULL,
  PRIMARY KEY ("jobId","dimension","scopeId"), UNIQUE ("jobId","ordinal"), CHECK ("dimension" IN ('warehouse','channel','company') AND "scopeId"<>'' AND "ordinal">=0)
);
CREATE TABLE "JobOriginBudget" ("originJobId" UUID PRIMARY KEY, "rowCount" INTEGER NOT NULL, "derivedBytes" INTEGER NOT NULL, "auditFactCount" INTEGER NOT NULL, CHECK ("rowCount">=0 AND "derivedBytes">=0 AND "auditFactCount">=0));
CREATE TABLE "JobTransactionBudget" ("transactionId" BIGINT NOT NULL, "originJobId" UUID NOT NULL, "rowCount" INTEGER NOT NULL, PRIMARY KEY("transactionId","originJobId"), CHECK ("rowCount">=0));

CREATE TABLE "JobAttemptStarted" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "jobId" UUID NOT NULL REFERENCES "BackgroundJob"("id") ON DELETE RESTRICT,
  "leaseGeneration" INTEGER NOT NULL, "reclaimed" BOOLEAN NOT NULL, "serverCorrelationId" TEXT NOT NULL, "causationId" TEXT,
  "originatingAuditEventId" TEXT NOT NULL REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT, "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE("jobId","leaseGeneration"), CHECK("leaseGeneration">0)
);
CREATE TABLE "JobHeartbeatFact" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "attemptStartedId" UUID NOT NULL REFERENCES "JobAttemptStarted"("id") ON DELETE RESTRICT,
  "leaseGeneration" INTEGER NOT NULL, "previousLeaseExpiresAt" TIMESTAMPTZ(6) NOT NULL, "leaseExpiresAt" TIMESTAMPTZ(6) NOT NULL,
  "originatingAuditEventId" TEXT NOT NULL REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), CHECK("leaseExpiresAt">"previousLeaseExpiresAt")
);
CREATE TABLE "JobAttemptOutcome" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "attemptStartedId" UUID NOT NULL UNIQUE REFERENCES "JobAttemptStarted"("id") ON DELETE RESTRICT,
  "terminalKind" TEXT NOT NULL, "safeReasonCode" TEXT, "originatingAuditEventId" TEXT NOT NULL REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), CHECK("terminalKind" IN ('succeeded','known_safe_failure','external_outcome_unknown','dead_lettered','cancelled_before_effect'))
);
CREATE TABLE "OutboxConsumerReceipt" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "consumerId" TEXT NOT NULL, "messageId" UUID NOT NULL REFERENCES "OutboxMessage"("id") ON DELETE RESTRICT,
  "inputDigest" TEXT NOT NULL, "attemptStartedId" UUID NOT NULL UNIQUE REFERENCES "JobAttemptStarted"("id") ON DELETE RESTRICT,
  "leaseGeneration" INTEGER NOT NULL, "handlerId" TEXT NOT NULL, "schemaVersion" INTEGER NOT NULL, "idempotencyNamespace" TEXT NOT NULL,
  "originatingAuditEventId" TEXT NOT NULL REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE("consumerId","messageId"), CHECK("inputDigest" ~ '^[A-Za-z0-9_-]{43}$')
);
CREATE TABLE "ConsumerReceiptResult" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "receiptId" UUID NOT NULL UNIQUE REFERENCES "OutboxConsumerReceipt"("id") ON DELETE RESTRICT,
  "terminalKind" TEXT NOT NULL, "safeResult" JSONB, "originatingAuditEventId" TEXT NOT NULL REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), CHECK("terminalKind" IN ('succeeded','known_safe_failure','external_outcome_unknown','dead_lettered','cancelled_before_effect'))
);
CREATE TABLE "OutboxAcknowledgement" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "messageId" UUID NOT NULL UNIQUE REFERENCES "OutboxMessage"("id") ON DELETE RESTRICT,
  "attemptStartedId" UUID NOT NULL REFERENCES "JobAttemptStarted"("id") ON DELETE RESTRICT, "terminalKind" TEXT NOT NULL,
  "originatingAuditEventId" TEXT NOT NULL REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  CHECK("terminalKind" IN ('succeeded','known_safe_failure','external_outcome_unknown','dead_lettered','cancelled_before_effect'))
);
CREATE TABLE "DispatchFact" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "attemptStartedId" UUID NOT NULL REFERENCES "JobAttemptStarted"("id") ON DELETE RESTRICT,
  "kind" TEXT NOT NULL, "sequence" INTEGER NOT NULL, "originatingAuditEventId" TEXT NOT NULL REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), UNIQUE("attemptStartedId","sequence"), CHECK("kind" IN ('prepared','acknowledged','known_not_sent','external_outcome_unknown'))
);
CREATE TABLE "DeadLetterAdmission" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "jobId" UUID NOT NULL UNIQUE REFERENCES "BackgroundJob"("id") ON DELETE RESTRICT,
  "attemptStartedId" UUID NOT NULL REFERENCES "JobAttemptStarted"("id") ON DELETE RESTRICT, "safeReasonCode" TEXT NOT NULL,
  "originatingAuditEventId" TEXT NOT NULL REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE "JobReconciliation" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "jobId" UUID NOT NULL REFERENCES "BackgroundJob"("id") ON DELETE RESTRICT,
  "state" TEXT NOT NULL, "safeReasonCode" TEXT NOT NULL, "originatingAuditEventId" TEXT NOT NULL REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), CHECK("state" IN ('reconciling','reconciled_applied','reconciled_not_applied'))
);
CREATE TABLE "JobAuditLink" (
  "jobId" UUID NOT NULL REFERENCES "BackgroundJob"("id") ON DELETE RESTRICT, "auditEventId" TEXT NOT NULL UNIQUE REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT,
  "operation" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("jobId","auditEventId")
);
CREATE TABLE "JobFenceLossAudit" (
  "attemptStartedId" UUID NOT NULL REFERENCES "JobAttemptStarted"("id") ON DELETE RESTRICT, "leaseGeneration" INTEGER NOT NULL, "operation" TEXT NOT NULL,
  "auditEventId" TEXT NOT NULL UNIQUE REFERENCES "AuditEventV2"("id") ON DELETE RESTRICT, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY("attemptStartedId","leaseGeneration","operation"), CHECK("operation" IN ('heartbeat','finalize','known_safe_fail','quarantine','reconcile'))
);

CREATE TABLE "JobLeaseDigestKey" (
  "keyId" TEXT PRIMARY KEY, "keyMaterial" BYTEA NOT NULL, "notBefore" TIMESTAMPTZ(6) NOT NULL, "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), CHECK(octet_length("keyMaterial")=32 AND "expiresAt">"notBefore")
);
CREATE TABLE "JobLeaseDigestKeyRevocation" ("keyId" TEXT PRIMARY KEY REFERENCES "JobLeaseDigestKey"("keyId") ON DELETE RESTRICT, "revokedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), "reasonCode" TEXT NOT NULL);
CREATE TABLE "JobRuntimeContextKey" (
  "keyId" TEXT PRIMARY KEY, "purpose" TEXT NOT NULL UNIQUE, "keyMaterial" BYTEA NOT NULL,
  "notBefore" TIMESTAMPTZ(6) NOT NULL, "expiresAt" TIMESTAMPTZ(6) NOT NULL, "maxContextTtlSeconds" INTEGER NOT NULL,
  "runtimeContractDigest" TEXT NOT NULL, "registryDigest" TEXT NOT NULL, "operationalPolicyDigest" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  CHECK("purpose" IN ('producer','claimer','reader') AND octet_length("keyMaterial")=32 AND "expiresAt">"notBefore" AND "maxContextTtlSeconds">0 AND "runtimeContractDigest" ~ '^[A-Za-z0-9_-]{43}$' AND "registryDigest" ~ '^[A-Za-z0-9_-]{43}$' AND "operationalPolicyDigest" ~ '^[A-Za-z0-9_-]{43}$')
);
CREATE TABLE "JobRuntimeContextKeyRevocation" ("keyId" TEXT PRIMARY KEY REFERENCES "JobRuntimeContextKey"("keyId") ON DELETE RESTRICT, "revokedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), "reasonCode" TEXT NOT NULL);

CREATE INDEX "BackgroundJob_claim_idx" ON "BackgroundJob"("state","priority" DESC,"availableAt","id");
CREATE INDEX "BackgroundJob_lease_idx" ON "BackgroundJob"("state","leaseExpiresAt","leaseGeneration");
CREATE INDEX "BackgroundJob_owner_idx" ON "BackgroundJob"("ownerDomain","createdAt","id");
CREATE INDEX "BackgroundJob_correlation_idx" ON "BackgroundJob"("serverCorrelationId","createdAt","id");
CREATE INDEX "BackgroundJob_causation_idx" ON "BackgroundJob"("causationId","createdAt","id");
CREATE INDEX "BackgroundJob_origin_idx" ON "BackgroundJob"("originJobId","parentJobId","depth");
CREATE INDEX "OutboxMessage_aggregate_idx" ON "OutboxMessage"("jobType","aggregateType","aggregateId","aggregateSequence");
CREATE INDEX "OutboxMessage_correlation_idx" ON "OutboxMessage"("serverCorrelationId","createdAt","id");
CREATE INDEX "JobAuthorizationScopeRef_lookup_idx" ON "JobAuthorizationScopeRef"("dimension","scopeId","jobId");
CREATE INDEX "DeadLetterAdmission_created_idx" ON "DeadLetterAdmission"("createdAt","jobId");
CREATE INDEX "JobReconciliation_state_idx" ON "JobReconciliation"("state","createdAt","jobId");

CREATE OR REPLACE FUNCTION reject_job_immutable_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME USING ERRCODE='55000'; END $$;
CREATE OR REPLACE FUNCTION job_safe_payload_valid_v1(payload JSONB,definitions JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE item JSONB; definition JSONB; field_key TEXT; seen TEXT[]:=ARRAY[]::TEXT[]; kind TEXT; BEGIN
  IF jsonb_typeof(payload)<>'array' OR jsonb_typeof(definitions)<>'object' THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(payload) LOOP
    IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>4 OR NOT (item ?& ARRAY['key','label','classification','value']) THEN RETURN false; END IF;
    field_key:=item->>'key';definition:=definitions->field_key;
    IF field_key IS NULL OR field_key=ANY(seen) OR field_key !~ '^[a-z][A-Za-z0-9_.-]{0,127}$' OR field_key ~* '(password|authorization|cookie|secret|token|totp|recovery|ciphertext|auth.?tag|nonce|credential|payment|request.?body|attachment)' OR definition IS NULL OR item->>'label' IS DISTINCT FROM definition->>'label' OR item->>'classification' IS DISTINCT FROM definition->>'classification' OR definition->>'classification' NOT IN ('public_operational','masked') THEN RETURN false; END IF;
    seen:=array_append(seen,field_key);kind:=jsonb_typeof(item->'value');
    IF definition->>'classification'='masked' AND item->>'value'<>'[masked]' OR definition->>'classification'<>'masked' AND kind<>'null' AND kind IS DISTINCT FROM definition->>'type' OR kind='string' AND octet_length(item->>'value')>COALESCE((definition->>'maxBytes')::INTEGER,0) THEN RETURN false; END IF;
  END LOOP;
  RETURN cardinality(seen)=(SELECT count(*) FROM jsonb_object_keys(definitions));
END $$;
CREATE OR REPLACE FUNCTION validate_job_registry_insert_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ DECLARE key TEXT; def JSONB; BEGIN
  IF EXISTS(SELECT 1 FROM unnest(NEW."allowedScopeDimensions") d WHERE d NOT IN ('warehouse','channel','company')) OR cardinality(NEW."allowedScopeDimensions")<>(SELECT count(DISTINCT d) FROM unnest(NEW."allowedScopeDimensions") d) THEN RAISE EXCEPTION 'JOB_REGISTRY_SCOPE_INVALID'; END IF;
  FOR key,def IN SELECT * FROM jsonb_each(NEW."safeFieldSchema") LOOP IF key !~ '^[a-z][A-Za-z0-9_.-]{0,127}$' OR key ~* '(password|authorization|cookie|secret|token|totp|recovery|ciphertext|auth.?tag|nonce|credential|payment|request.?body|attachment)' OR def->>'type' NOT IN ('string','number','boolean') OR def->>'classification' NOT IN ('public_operational','masked') OR octet_length(def->>'label') NOT BETWEEN 1 AND 128 OR def->>'type'='string' AND COALESCE((def->>'maxBytes')::INTEGER,0)<=0 THEN RAISE EXCEPTION 'JOB_REGISTRY_SAFE_SCHEMA_INVALID'; END IF; END LOOP; RETURN NEW;
END $$;
CREATE TRIGGER "JobTypeRegistry_insert_admission" BEFORE INSERT ON "JobTypeRegistry" FOR EACH ROW EXECUTE FUNCTION validate_job_registry_insert_v1();
CREATE OR REPLACE FUNCTION guard_background_job_projection_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF to_jsonb(NEW)-ARRAY['state','priority','availableAt','leaseGeneration','leaseSecretDigest','leaseDigestKeyId','leaseExpiresAt'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','priority','availableAt','leaseGeneration','leaseSecretDigest','leaseDigestKeyId','leaseExpiresAt'] THEN RAISE EXCEPTION 'BACKGROUND_JOB_IMMUTABLE_IDENTITY' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "BackgroundJob_projection_guard" BEFORE UPDATE ON "BackgroundJob" FOR EACH ROW EXECUTE FUNCTION guard_background_job_projection_update();
CREATE TRIGGER "BackgroundJob_no_delete" BEFORE DELETE ON "BackgroundJob" FOR EACH ROW EXECUTE FUNCTION reject_job_immutable_mutation();
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['JobTypeRegistry','OutboxMessage','JobAuthorizationScopeRef','JobAttemptStarted','JobHeartbeatFact','JobAttemptOutcome','OutboxConsumerReceipt','ConsumerReceiptResult','OutboxAcknowledgement','DispatchFact','DeadLetterAdmission','JobReconciliation','JobAuditLink','JobFenceLossAudit','JobLeaseDigestKey','JobLeaseDigestKeyRevocation','JobRuntimeContextKey','JobRuntimeContextKeyRevocation'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_job_immutable_mutation()',t||'_append_only',t);
  END LOOP;
END $$;

-- A closed technical Audit V2 schema. This is evidence infrastructure, not a job/topic/handler/consumer seed.
INSERT INTO "AuditEventSchemaV2"("eventType","schemaVersion","ownerDomain","actorTypes","subjectTypes","actions","entityTypes","outcomes","sources","registryDigestVersion","registryDigest","authorizationScopeKind","scopeMatchMode","requiredGlobalGrant","allowGlobalReader","allowedScopeDimensions","scopeResolverId","scopeResolverVersion","authorizationPolicyVersion","retentionClass","fieldSchema","maxProjectionBytes")
VALUES ('jobs.core.transition',1,'jobs',ARRAY['runtime'],ARRAY['job'],ARRAY['jobs.enqueue','jobs.claim','jobs.reclaim','jobs.heartbeat','jobs.finalize','jobs.known_safe_fail','jobs.quarantine','jobs.reconcile','jobs.fence_loss'],ARRAY['BackgroundJob'],ARRAY['succeeded','failed','denied'],ARRAY['job'],1,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','global_security','all','jobs.read_security',false,ARRAY[]::TEXT[],'jobs-core-security-v1',1,1,'security_control','{"before":{},"after":{},"metadata":{"operation":{"type":"string","classification":"public_operational","label":"Operation","maxBytes":64},"reasonCode":{"type":"string","classification":"public_operational","label":"Reason code","maxBytes":64}}}'::jsonb,512);

CREATE OR REPLACE FUNCTION job_runtime_membership_ok(expected_group NAME) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE direct_count INTEGER; edge RECORD; BEGIN
  IF expected_group::TEXT NOT IN ('tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance') OR session_user='tyre_jobs_guard_owner' THEN RETURN false; END IF;
  SELECT count(*) INTO direct_count FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member WHERE member.rolname=session_user;
  IF direct_count<>1 THEN RETURN false; END IF;
  SELECT parent.rolname group_name,m.inherit_option,m.set_option,m.admin_option INTO edge FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid WHERE member.rolname=session_user;
  RETURN edge.group_name=expected_group::TEXT AND edge.inherit_option AND NOT edge.set_option AND NOT edge.admin_option
    AND pg_has_role(session_user,expected_group,'member') AND NOT pg_has_role(session_user,'tyre_jobs_guard_owner','member')
    AND NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=session_user AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls));
END $$;

CREATE OR REPLACE FUNCTION job_runtime_contract_digest_v1() RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
  SELECT rtrim(translate(encode(digest(convert_to(string_agg(object_identity||':'||definition,E'\n' ORDER BY object_identity),'UTF8'),'sha256'),'base64'),'+/','-_'),'=')
  FROM (SELECT p.oid::regprocedure::TEXT object_identity,pg_get_functiondef(p.oid) definition FROM pg_proc p
    WHERE p.proname LIKE 'job_%_v1' OR p.proname IN ('record_job_fence_loss')) s
$$;

CREATE OR REPLACE FUNCTION job_registry_digest_v1() RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
  SELECT rtrim(translate(encode(digest(convert_to(COALESCE(string_agg(to_jsonb(r)::TEXT,E'\n' ORDER BY r."jobType",r."schemaVersion"),'EMPTY'),'UTF8'),'sha256'),'base64'),'+/','-_'),'=') FROM public."JobTypeRegistry" r
$$;

CREATE OR REPLACE FUNCTION job_operation_digest_v1(operation TEXT, arguments JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT rtrim(translate(encode(digest(convert_to('tyre.jobs.operation.v1'||chr(10)||operation||chr(10)||arguments::TEXT,'UTF8'),'sha256'),'base64'),'+/','-_'),'=')
$$;

CREATE OR REPLACE FUNCTION job_issue_challenge_internal_v1(p_expected_group NAME,p_purpose TEXT,p_key_id TEXT,p_operation_digest TEXT)
RETURNS TABLE(challenge TEXT,challenge_txid BIGINT) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE control public."JobRuntimeContextKey"%ROWTYPE; proof TEXT; BEGIN
  IF NOT job_runtime_membership_ok(p_expected_group) OR p_operation_digest !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN; END IF;
  SELECT * INTO control FROM public."JobRuntimeContextKey" k WHERE k."keyId"=p_key_id AND k."purpose"=p_purpose AND k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp() AND NOT EXISTS(SELECT 1 FROM public."JobRuntimeContextKeyRevocation" r WHERE r."keyId"=k."keyId"); IF NOT FOUND THEN RETURN; END IF;
  challenge:=rtrim(translate(encode(gen_random_bytes(16),'base64'),'+/','-_'),'='); challenge_txid:=txid_current();
  proof:=rtrim(translate(encode(hmac(convert_to('tyre.jobs.db-challenge.v1'||chr(10)||p_purpose||chr(10)||session_user||chr(10)||p_key_id||chr(10)||p_operation_digest||chr(10)||challenge||chr(10)||challenge_txid::TEXT,'UTF8'),control."keyMaterial",'sha256'),'base64'),'+/','-_'),'=');
  PERFORM set_config('tyre.jobs.challenge_purpose',p_purpose,true); PERFORM set_config('tyre.jobs.challenge_key_id',p_key_id,true); PERFORM set_config('tyre.jobs.challenge_operation_digest',p_operation_digest,true); PERFORM set_config('tyre.jobs.challenge',challenge,true); PERFORM set_config('tyre.jobs.challenge_txid',challenge_txid::TEXT,true); PERFORM set_config('tyre.jobs.challenge_proof',proof,true); PERFORM set_config('tyre.jobs.challenge_consumed','false',true); RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION job_bind_context_internal_v1(p_expected_group NAME,p_purpose TEXT,p_key_id TEXT,p_viewer_id TEXT,p_session_id TEXT,p_operation_digest TEXT,p_issued_at_ms BIGINT,p_expires_at_ms BIGINT,p_nonce TEXT,p_signature TEXT,p_challenge TEXT,p_challenge_txid BIGINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE control public."JobRuntimeContextKey"%ROWTYPE; expected TEXT; proof TEXT; now_ms BIGINT:=floor(extract(epoch FROM clock_timestamp())*1000)::BIGINT; BEGIN
  IF NOT job_runtime_membership_ok(p_expected_group) OR p_viewer_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' OR p_session_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' OR p_operation_digest !~ '^[A-Za-z0-9_-]{43}$' OR p_nonce !~ '^[A-Za-z0-9_-]{22}$' OR p_signature !~ '^[A-Za-z0-9_-]{43}$' OR p_challenge !~ '^[A-Za-z0-9_-]{22}$' OR p_challenge_txid<>txid_current() OR current_setting('tyre.jobs.challenge_purpose',true) IS DISTINCT FROM p_purpose OR current_setting('tyre.jobs.challenge_key_id',true) IS DISTINCT FROM p_key_id OR current_setting('tyre.jobs.challenge_operation_digest',true) IS DISTINCT FROM p_operation_digest OR current_setting('tyre.jobs.challenge',true) IS DISTINCT FROM p_challenge OR current_setting('tyre.jobs.challenge_txid',true) IS DISTINCT FROM p_challenge_txid::TEXT OR current_setting('tyre.jobs.challenge_consumed',true) IS DISTINCT FROM 'false' THEN RETURN false; END IF;
  SELECT * INTO control FROM public."JobRuntimeContextKey" k WHERE k."keyId"=p_key_id AND k."purpose"=p_purpose AND k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp() AND NOT EXISTS(SELECT 1 FROM public."JobRuntimeContextKeyRevocation" r WHERE r."keyId"=k."keyId"); IF NOT FOUND OR p_issued_at_ms>now_ms+1000 OR p_expires_at_ms<=now_ms OR p_expires_at_ms-p_issued_at_ms>control."maxContextTtlSeconds"*1000 THEN RETURN false; END IF;
  expected:=rtrim(translate(encode(hmac(convert_to('tyre.jobs.db-challenge.v1'||chr(10)||p_purpose||chr(10)||session_user||chr(10)||p_key_id||chr(10)||p_operation_digest||chr(10)||p_challenge||chr(10)||p_challenge_txid::TEXT,'UTF8'),control."keyMaterial",'sha256'),'base64'),'+/','-_'),'='); IF expected IS DISTINCT FROM current_setting('tyre.jobs.challenge_proof',true) THEN RETURN false; END IF;
  expected:=rtrim(translate(encode(hmac(convert_to('tyre.jobs.db-context.v1'||chr(10)||p_purpose||chr(10)||session_user||chr(10)||p_key_id||chr(10)||p_viewer_id||chr(10)||p_session_id||chr(10)||p_operation_digest||chr(10)||p_issued_at_ms::TEXT||chr(10)||p_expires_at_ms::TEXT||chr(10)||p_nonce||chr(10)||p_challenge||chr(10)||p_challenge_txid::TEXT,'UTF8'),control."keyMaterial",'sha256'),'base64'),'+/','-_'),'='); IF expected<>p_signature THEN RETURN false; END IF;
  PERFORM set_config('tyre.jobs.challenge_consumed','true',true); PERFORM set_config('tyre.jobs.challenge_proof','',true);
  IF p_purpose='reader' AND NOT EXISTS(SELECT 1 FROM public."Admin" a JOIN public."StaffSession" s ON s."staffUserId"=a.id JOIN public."SecurityControl" c ON c.id=1 WHERE a.id=p_viewer_id AND s.id=p_session_id AND a.enabled AND a.status='active' AND s."revokedAt" IS NULL AND s."idleExpiresAt">clock_timestamp() AND s."absoluteExpiresAt">clock_timestamp() AND s."tokenVersionSnapshot"=a."tokenVersion" AND s."authContractVersion">=c."minimumAuthContractVersion" AND EXISTS(SELECT 1 FROM public."AdminRoleAssignment" ar JOIN public."RolePermission" rp ON rp."roleId"=ar."roleId" JOIN public."Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=a.id AND p.key='jobs.read')) THEN RETURN false; END IF;
  IF p_purpose<>'reader' AND (p_viewer_id<>session_user OR p_session_id<>'runtime') THEN RETURN false; END IF;
  proof:=rtrim(translate(encode(hmac(convert_to('tyre.jobs.db-bound.v1'||chr(10)||p_purpose||chr(10)||session_user||chr(10)||p_viewer_id||chr(10)||p_session_id||chr(10)||p_key_id||chr(10)||p_operation_digest||chr(10)||p_expires_at_ms::TEXT||chr(10)||txid_current()::TEXT,'UTF8'),control."keyMaterial",'sha256'),'base64'),'+/','-_'),'=');
  PERFORM set_config('tyre.jobs.context_purpose',p_purpose,true); PERFORM set_config('tyre.jobs.viewer_id',p_viewer_id,true); PERFORM set_config('tyre.jobs.session_id',p_session_id,true); PERFORM set_config('tyre.jobs.context_key_id',p_key_id,true); PERFORM set_config('tyre.jobs.operation_digest',p_operation_digest,true); PERFORM set_config('tyre.jobs.context_expires_ms',p_expires_at_ms::TEXT,true); PERFORM set_config('tyre.jobs.bound_proof',proof,true); RETURN true;
END $$;

CREATE OR REPLACE FUNCTION job_assert_runtime_v1(expected_group NAME,expected_purpose TEXT,expected_operation_digest TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE control public."JobRuntimeContextKey"%ROWTYPE; expected TEXT; actual TEXT; now_ms BIGINT:=floor(extract(epoch FROM clock_timestamp())*1000)::BIGINT; viewer TEXT; sess TEXT; expires_ms BIGINT; BEGIN
  IF NOT job_runtime_membership_ok(expected_group) THEN RAISE EXCEPTION 'JOB_RUNTIME_MEMBERSHIP_INVALID' USING ERRCODE='42501'; END IF;
  IF current_setting('tyre.jobs.context_purpose',true) IS DISTINCT FROM expected_purpose OR current_setting('tyre.jobs.operation_digest',true) IS DISTINCT FROM expected_operation_digest THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTEXT_INVALID' USING ERRCODE='42501'; END IF;
  viewer:=current_setting('tyre.jobs.viewer_id',true); sess:=current_setting('tyre.jobs.session_id',true); expires_ms:=NULLIF(current_setting('tyre.jobs.context_expires_ms',true),'')::BIGINT;
  SELECT * INTO control FROM public."JobRuntimeContextKey" k WHERE k."keyId"=current_setting('tyre.jobs.context_key_id',true) AND k."purpose"=expected_purpose AND k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp() AND NOT EXISTS(SELECT 1 FROM public."JobRuntimeContextKeyRevocation" r WHERE r."keyId"=k."keyId"); IF NOT FOUND OR expires_ms<=now_ms THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTEXT_INVALID' USING ERRCODE='42501'; END IF;
  expected:=rtrim(translate(encode(hmac(convert_to('tyre.jobs.db-bound.v1'||chr(10)||expected_purpose||chr(10)||session_user||chr(10)||viewer||chr(10)||sess||chr(10)||control."keyId"||chr(10)||expected_operation_digest||chr(10)||expires_ms::TEXT||chr(10)||txid_current()::TEXT,'UTF8'),control."keyMaterial",'sha256'),'base64'),'+/','-_'),'='); IF expected IS DISTINCT FROM current_setting('tyre.jobs.bound_proof',true) THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTEXT_INVALID' USING ERRCODE='42501'; END IF;
  actual:=job_runtime_contract_digest_v1(); IF control."runtimeContractDigest"<>actual OR control."registryDigest"<>job_registry_digest_v1() THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTRACT_DRIFT' USING ERRCODE='42501'; END IF;
END $$;

CREATE OR REPLACE FUNCTION job_producer_issue_challenge_v1(key_id TEXT,operation_digest TEXT) RETURNS TABLE(challenge TEXT,challenge_txid BIGINT) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ SELECT * FROM job_issue_challenge_internal_v1('tyre_jobs_producer','producer',key_id,operation_digest) $$;
CREATE OR REPLACE FUNCTION job_claimer_issue_challenge_v1(key_id TEXT,operation_digest TEXT) RETURNS TABLE(challenge TEXT,challenge_txid BIGINT) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ SELECT * FROM job_issue_challenge_internal_v1('tyre_jobs_claimer','claimer',key_id,operation_digest) $$;
CREATE OR REPLACE FUNCTION job_reader_issue_challenge_v1(key_id TEXT,operation_digest TEXT) RETURNS TABLE(challenge TEXT,challenge_txid BIGINT) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ SELECT * FROM job_issue_challenge_internal_v1('tyre_jobs_reader','reader',key_id,operation_digest) $$;
CREATE OR REPLACE FUNCTION job_producer_bind_context_v1(key_id TEXT,viewer_id TEXT,session_id TEXT,operation_digest TEXT,issued_at_ms BIGINT,expires_at_ms BIGINT,nonce TEXT,signature TEXT,challenge TEXT,challenge_txid BIGINT) RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ SELECT job_bind_context_internal_v1('tyre_jobs_producer','producer',key_id,viewer_id,session_id,operation_digest,issued_at_ms,expires_at_ms,nonce,signature,challenge,challenge_txid) $$;
CREATE OR REPLACE FUNCTION job_claimer_bind_context_v1(key_id TEXT,viewer_id TEXT,session_id TEXT,operation_digest TEXT,issued_at_ms BIGINT,expires_at_ms BIGINT,nonce TEXT,signature TEXT,challenge TEXT,challenge_txid BIGINT) RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ SELECT job_bind_context_internal_v1('tyre_jobs_claimer','claimer',key_id,viewer_id,session_id,operation_digest,issued_at_ms,expires_at_ms,nonce,signature,challenge,challenge_txid) $$;
CREATE OR REPLACE FUNCTION job_reader_bind_context_v1(key_id TEXT,viewer_id TEXT,session_id TEXT,operation_digest TEXT,issued_at_ms BIGINT,expires_at_ms BIGINT,nonce TEXT,signature TEXT,challenge TEXT,challenge_txid BIGINT) RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ SELECT job_bind_context_internal_v1('tyre_jobs_reader','reader',key_id,viewer_id,session_id,operation_digest,issued_at_ms,expires_at_ms,nonce,signature,challenge,challenge_txid) $$;

CREATE OR REPLACE FUNCTION job_runtime_key_attestation_v1(p_purpose TEXT,p_key_id TEXT)
RETURNS TABLE(key_digest TEXT,max_context_ttl_seconds INTEGER,runtime_contract_digest TEXT,registry_digest TEXT,operational_policy_digest TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ DECLARE expected_group NAME; BEGIN
  expected_group:=CASE p_purpose WHEN 'producer' THEN 'tyre_jobs_producer' WHEN 'claimer' THEN 'tyre_jobs_claimer' WHEN 'reader' THEN 'tyre_jobs_reader' ELSE NULL END; IF expected_group IS NULL OR NOT job_runtime_membership_ok(expected_group) THEN RETURN; END IF;
  RETURN QUERY SELECT rtrim(translate(encode(digest(k."keyMaterial",'sha256'),'base64'),'+/','-_'),'='),k."maxContextTtlSeconds",k."runtimeContractDigest",k."registryDigest",k."operationalPolicyDigest" FROM public."JobRuntimeContextKey" k WHERE k."purpose"=p_purpose AND k."keyId"=p_key_id AND k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp() AND NOT EXISTS(SELECT 1 FROM public."JobRuntimeContextKeyRevocation" r WHERE r."keyId"=k."keyId");
END $$;

CREATE OR REPLACE FUNCTION job_write_audit_v1(p_job_id UUID,p_operation TEXT,p_outcome TEXT,p_reason TEXT,p_correlation TEXT,p_causation TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE audit_id TEXT:=gen_random_uuid()::TEXT; metadata JSONB; BEGIN
  metadata:=jsonb_build_array(jsonb_build_object('key','operation','label','Operation','classification','public_operational','value',p_operation),jsonb_build_object('key','reasonCode','label','Reason code','classification','public_operational','value',COALESCE(p_reason,'NONE')));
  INSERT INTO public."AuditEventV2"("id","eventType","schemaVersion","registryDigest","occurredAt","actorId","actorType","subjectType","subjectId","action","entityType","entityId","authorizationScopeKind","scopeMatchMode","requiredGlobalGrant","scopeResolverId","scopeResolverVersion","authorizationPolicyVersion","outcome","reasonCode","safeMetadata","serverCorrelationId","causationId","source","retentionClass")
  VALUES(audit_id,'jobs.core.transition',1,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',clock_timestamp(),session_user,'runtime','job',p_job_id::TEXT,p_operation,'BackgroundJob',p_job_id::TEXT,'global_security','all','jobs.read_security','jobs-core-security-v1',1,1,p_outcome,p_reason,metadata,p_correlation,p_causation,'job','security_control');
  RETURN audit_id;
END $$;

-- The producer calls this inside the originating domain transaction. Unknown/disabled/unpublished definitions fail before writes.
CREATE OR REPLACE FUNCTION job_enqueue_v1(p_job_type TEXT,p_schema_version INTEGER,p_safe_payload JSONB,p_priority INTEGER,p_available_at TIMESTAMPTZ,p_deduplication_key TEXT,p_scope_refs JSONB,p_server_correlation_id TEXT,p_causation_id TEXT DEFAULT NULL,p_parent_job_id UUID DEFAULT NULL)
RETURNS TABLE(job_id UUID,message_id UUID,audit_event_id TEXT) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE reg public."JobTypeRegistry"%ROWTYPE; parent public."BackgroundJob"%ROWTYPE; parent_reg public."JobTypeRegistry"%ROWTYPE; j UUID:=gen_random_uuid(); m UUID:=gen_random_uuid(); origin UUID; d INTEGER; ancestry TEXT; input_digest TEXT; audit_id TEXT; scope JSONB; scope_count INTEGER:=0; transaction_count INTEGER; bytes INTEGER; origin_budget public."JobOriginBudget"%ROWTYPE; BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_producer','producer',job_operation_digest_v1('enqueue',jsonb_build_object('jobType',p_job_type,'schemaVersion',p_schema_version,'safePayload',p_safe_payload,'priority',p_priority,'availableAt',p_available_at,'deduplicationKey',p_deduplication_key,'scopeRefs',p_scope_refs,'serverCorrelationId',p_server_correlation_id,'causationId',p_causation_id,'parentJobId',p_parent_job_id)));
  SELECT * INTO reg FROM public."JobTypeRegistry" WHERE "jobType"=p_job_type AND "schemaVersion"=p_schema_version AND "published" AND "enqueueEnabled" FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_TYPE_NOT_AVAILABLE'; END IF;
  IF NOT job_safe_payload_valid_v1(p_safe_payload,reg."safeFieldSchema") OR jsonb_typeof(p_scope_refs)<>'array' THEN RAISE EXCEPTION 'JOB_SAFE_SCHEMA_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_scope_refs) s WHERE jsonb_typeof(s)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(s))<>2 OR NOT (s ?& ARRAY['dimension','id']) OR s->>'dimension'<>ALL(reg."allowedScopeDimensions") OR COALESCE(s->>'id','')='' OR octet_length(s->>'id')>128) OR p_scope_refs IS DISTINCT FROM COALESCE((SELECT jsonb_agg(s ORDER BY s->>'dimension',s->>'id') FROM jsonb_array_elements(p_scope_refs) s),'[]'::jsonb) THEN RAISE EXCEPTION 'JOB_SCOPE_INVALID'; END IF;
  bytes:=octet_length(p_safe_payload::TEXT); IF bytes>reg."maxPayloadBytes" OR bytes>reg."maxDerivedBytes" THEN RAISE EXCEPTION 'JOB_PAYLOAD_LIMIT'; END IF;
  input_digest:=translate(encode(digest(convert_to('tyre.ge/job-input/v1'||p_safe_payload::TEXT,'UTF8'),'sha256'),'base64'),'+/','-_'); input_digest:=rtrim(input_digest,'=');
  IF p_parent_job_id IS NULL THEN origin:=j; d:=0; ancestry:=translate(encode(digest(convert_to('tyre.ge/job-ancestry/v1'||j::TEXT,'UTF8'),'sha256'),'base64'),'+/','-_'); ancestry:=rtrim(ancestry,'=');
  ELSE SELECT * INTO parent FROM public."BackgroundJob" WHERE id=p_parent_job_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_ANCESTRY_INVALID'; END IF; origin:=parent."originJobId";d:=parent."depth"+1; SELECT * INTO parent_reg FROM public."JobTypeRegistry" WHERE ("jobType","schemaVersion","registryDigest")=(parent."jobType",parent."schemaVersion",parent."registryDigest"); IF d>reg."maxDepth" OR (SELECT count(*) FROM public."BackgroundJob" WHERE "parentJobId"=parent.id)>=parent_reg."maxChildFanout" THEN RAISE EXCEPTION 'JOB_FANOUT_OR_DEPTH_EXCEEDED'; END IF;
    ancestry:=translate(encode(digest(convert_to('tyre.ge/job-ancestry/v1'||origin::TEXT||':'||p_parent_job_id::TEXT||':'||j::TEXT,'UTF8'),'sha256'),'base64'),'+/','-_'); ancestry:=rtrim(ancestry,'='); END IF;
  INSERT INTO public."JobOriginBudget" VALUES(origin,0,0,0) ON CONFLICT DO NOTHING;
  SELECT * INTO origin_budget FROM public."JobOriginBudget" WHERE "originJobId"=origin FOR UPDATE;
  IF origin_budget."rowCount"+1>reg."maxOriginRows" OR origin_budget."derivedBytes"+bytes>reg."maxDerivedBytes" OR origin_budget."auditFactCount"+1>reg."maxAuditFacts" THEN RAISE EXCEPTION 'JOB_ORIGIN_BUDGET_EXCEEDED'; END IF;
  INSERT INTO public."JobTransactionBudget" VALUES(txid_current(),origin,1) ON CONFLICT("transactionId","originJobId") DO UPDATE SET "rowCount"=public."JobTransactionBudget"."rowCount"+1 RETURNING "rowCount" INTO transaction_count;
  IF transaction_count>reg."maxTransactionRows" THEN RAISE EXCEPTION 'JOB_TRANSACTION_BUDGET_EXCEEDED'; END IF;
  audit_id:=job_write_audit_v1(j,'jobs.enqueue','succeeded',NULL,p_server_correlation_id,p_causation_id);
  INSERT INTO public."OutboxMessage"("id","jobType","schemaVersion","registryDigest","ownerDomain","producerId","consumerId","inputDigest","safePayload","idempotencyNamespace","deduplicationKey","originJobId","parentJobId","depth","ancestryDigest","authorizationScopeKind","scopeMatchMode","requiredGlobalGrant","scopeResolverId","scopeResolverVersion","authorizationPolicyVersion","serverCorrelationId","causationId","originatingAuditEventId") VALUES(m,reg."jobType",reg."schemaVersion",reg."registryDigest",reg."ownerDomain",reg."producerId",reg."consumerId",input_digest,p_safe_payload,reg."ownerDomain"||':'||reg."jobType",p_deduplication_key,origin,p_parent_job_id,d,ancestry,reg."authorizationScopeKind",reg."scopeMatchMode",reg."requiredGlobalGrant",reg."scopeResolverId",reg."scopeResolverVersion",reg."authorizationPolicyVersion",p_server_correlation_id,p_causation_id,audit_id);
  INSERT INTO public."BackgroundJob"("id","outboxMessageId","jobType","schemaVersion","registryDigest","ownerDomain","safeSummary","inputDigest","originJobId","parentJobId","depth","ancestryDigest","authorizationScopeKind","scopeMatchMode","requiredGlobalGrant","scopeResolverId","scopeResolverVersion","authorizationPolicyVersion","priority","availableAt","serverCorrelationId","causationId","originatingAuditEventId") VALUES(j,m,reg."jobType",reg."schemaVersion",reg."registryDigest",reg."ownerDomain",p_safe_payload,input_digest,origin,p_parent_job_id,d,ancestry,reg."authorizationScopeKind",reg."scopeMatchMode",reg."requiredGlobalGrant",reg."scopeResolverId",reg."scopeResolverVersion",reg."authorizationPolicyVersion",p_priority,p_available_at,p_server_correlation_id,p_causation_id,audit_id);
  FOR scope IN SELECT value FROM jsonb_array_elements(p_scope_refs) LOOP INSERT INTO public."JobAuthorizationScopeRef" VALUES(j,scope->>'dimension',scope->>'id',scope_count); scope_count:=scope_count+1; END LOOP;
  IF reg."authorizationScopeKind"='resource_scoped' AND scope_count=0 OR reg."authorizationScopeKind"='global_operations' AND scope_count<>0 THEN RAISE EXCEPTION 'JOB_SCOPE_INVALID'; END IF;
  UPDATE public."JobOriginBudget" SET "rowCount"="rowCount"+1,"derivedBytes"="derivedBytes"+bytes,"auditFactCount"="auditFactCount"+1 WHERE "originJobId"=origin;
  INSERT INTO public."JobAuditLink" VALUES(j,audit_id,'enqueue',clock_timestamp()); RETURN QUERY SELECT j,m,audit_id;
END $$;

-- Claim never invokes a handler. It only commits the fenced projection/start/receipt/audit facts.
CREATE OR REPLACE FUNCTION job_claim_v1()
RETURNS TABLE(job_id UUID,attempt_started_id UUID,lease_generation INTEGER,lease_secret TEXT,lease_expires_at TIMESTAMPTZ,duplicate_receipt BOOLEAN) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE job public."BackgroundJob"%ROWTYPE; reg public."JobTypeRegistry"%ROWTYPE; msg public."OutboxMessage"%ROWTYPE; key public."JobLeaseDigestKey"%ROWTYPE; attempt UUID:=gen_random_uuid(); secret BYTEA; audit_id TEXT; existing public."OutboxConsumerReceipt"%ROWTYPE; BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_claimer','claimer',job_operation_digest_v1('claim','{}'::jsonb));
  SELECT j.* INTO job FROM public."BackgroundJob" j JOIN public."JobTypeRegistry" r ON (r."jobType",r."schemaVersion",r."registryDigest")=(j."jobType",j."schemaVersion",j."registryDigest") WHERE j."state"='queued' AND j."availableAt"<=clock_timestamp() AND r."handlerEnabled" AND NOT r."externalEffectCapable" ORDER BY j."priority" DESC,j."availableAt",j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF; SELECT * INTO reg FROM public."JobTypeRegistry" WHERE ("jobType","schemaVersion","registryDigest")=(job."jobType",job."schemaVersion",job."registryDigest"); SELECT * INTO msg FROM public."OutboxMessage" WHERE id=job."outboxMessageId";
  IF msg."consumerId" IS NOT NULL THEN SELECT * INTO existing FROM public."OutboxConsumerReceipt" WHERE "consumerId"=msg."consumerId" AND "messageId"=msg.id FOR UPDATE; IF FOUND THEN IF existing."inputDigest"<>msg."inputDigest" THEN RAISE EXCEPTION 'CONSUMER_RECEIPT_DIGEST_CONFLICT'; END IF; RETURN QUERY SELECT job.id,existing."attemptStartedId",existing."leaseGeneration",NULL::TEXT,NULL::TIMESTAMPTZ,true; RETURN; END IF; END IF;
  SELECT * INTO key FROM public."JobLeaseDigestKey" k WHERE k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp()+make_interval(secs=>reg."leaseSeconds") AND NOT EXISTS(SELECT 1 FROM public."JobLeaseDigestKeyRevocation" r WHERE r."keyId"=k."keyId") ORDER BY k."notBefore" DESC LIMIT 1 FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_LEASE_KEY_UNAVAILABLE'; END IF;
  secret:=gen_random_bytes(32); audit_id:=job_write_audit_v1(job.id,'jobs.claim','succeeded',NULL,job."serverCorrelationId",job."causationId");
  UPDATE public."BackgroundJob" SET "state"='processing',"leaseGeneration"="leaseGeneration"+1,"leaseSecretDigest"=hmac(convert_to('tyre.ge/job-lease/v1','UTF8')||secret,key."keyMaterial",'sha256'),"leaseDigestKeyId"=key."keyId","leaseExpiresAt"=clock_timestamp()+make_interval(secs=>reg."leaseSeconds") WHERE id=job.id;
  SELECT * INTO job FROM public."BackgroundJob" WHERE id=job.id; INSERT INTO public."JobAttemptStarted" VALUES(attempt,job.id,job."leaseGeneration",false,job."serverCorrelationId",job."causationId",audit_id,clock_timestamp());
  IF msg."consumerId" IS NOT NULL THEN INSERT INTO public."OutboxConsumerReceipt"("consumerId","messageId","inputDigest","attemptStartedId","leaseGeneration","handlerId","schemaVersion","idempotencyNamespace","originatingAuditEventId") VALUES(msg."consumerId",msg.id,msg."inputDigest",attempt,job."leaseGeneration",job."jobType",job."schemaVersion",msg."idempotencyNamespace",audit_id); END IF;
  INSERT INTO public."JobAuditLink" VALUES(job.id,audit_id,'claim',clock_timestamp()); RETURN QUERY SELECT job.id,attempt,job."leaseGeneration",encode(secret,'base64'),job."leaseExpiresAt",false;
END $$;

CREATE OR REPLACE FUNCTION job_reclaim_v1()
RETURNS TABLE(job_id UUID,attempt_started_id UUID,lease_generation INTEGER,lease_secret TEXT,lease_expires_at TIMESTAMPTZ) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE job public."BackgroundJob"%ROWTYPE; reg public."JobTypeRegistry"%ROWTYPE; key public."JobLeaseDigestKey"%ROWTYPE; attempt UUID:=gen_random_uuid(); secret BYTEA; audit_id TEXT; BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_claimer','claimer',job_operation_digest_v1('reclaim','{}'::jsonb));
  SELECT j.* INTO job FROM public."BackgroundJob" j JOIN public."JobTypeRegistry" r ON (r."jobType",r."schemaVersion",r."registryDigest")=(j."jobType",j."schemaVersion",j."registryDigest") WHERE j."state"='processing' AND j."leaseExpiresAt"<=clock_timestamp() AND r."handlerEnabled" AND r."reclaimable" AND NOT r."externalEffectCapable" AND NOT EXISTS(SELECT 1 FROM public."JobAttemptOutcome" o JOIN public."JobAttemptStarted" a ON a.id=o."attemptStartedId" WHERE a."jobId"=j.id AND a."leaseGeneration"=j."leaseGeneration") AND NOT EXISTS(SELECT 1 FROM public."OutboxConsumerReceipt" cr LEFT JOIN public."ConsumerReceiptResult" rr ON rr."receiptId"=cr.id WHERE cr."messageId"=j."outboxMessageId" AND rr.id IS NULL) ORDER BY j."leaseExpiresAt",j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF; SELECT * INTO reg FROM public."JobTypeRegistry" WHERE ("jobType","schemaVersion","registryDigest")=(job."jobType",job."schemaVersion",job."registryDigest");
  SELECT * INTO key FROM public."JobLeaseDigestKey" k WHERE k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp()+make_interval(secs=>reg."leaseSeconds") AND NOT EXISTS(SELECT 1 FROM public."JobLeaseDigestKeyRevocation" r WHERE r."keyId"=k."keyId") ORDER BY k."notBefore" DESC LIMIT 1 FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_LEASE_KEY_UNAVAILABLE'; END IF;
  secret:=gen_random_bytes(32); audit_id:=job_write_audit_v1(job.id,'jobs.reclaim','succeeded',NULL,job."serverCorrelationId",job."causationId");
  UPDATE public."BackgroundJob" SET "leaseGeneration"="leaseGeneration"+1,"leaseSecretDigest"=hmac(convert_to('tyre.ge/job-lease/v1','UTF8')||secret,key."keyMaterial",'sha256'),"leaseDigestKeyId"=key."keyId","leaseExpiresAt"=clock_timestamp()+make_interval(secs=>reg."leaseSeconds") WHERE id=job.id AND "state"='processing' AND "leaseGeneration"=job."leaseGeneration" AND "leaseExpiresAt"<=clock_timestamp(); IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF;
  SELECT * INTO job FROM public."BackgroundJob" WHERE id=job.id; INSERT INTO public."JobAttemptStarted" VALUES(attempt,job.id,job."leaseGeneration",true,job."serverCorrelationId",job."causationId",audit_id,clock_timestamp()); INSERT INTO public."JobAuditLink" VALUES(job.id,audit_id,'reclaim',clock_timestamp()); RETURN QUERY SELECT job.id,attempt,job."leaseGeneration",encode(secret,'base64'),job."leaseExpiresAt";
END $$;

CREATE OR REPLACE FUNCTION job_fence_match_v1(p_job_id UUID,p_generation INTEGER,p_secret TEXT) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT EXISTS(SELECT 1 FROM public."BackgroundJob" j JOIN public."JobLeaseDigestKey" k ON k."keyId"=j."leaseDigestKeyId" WHERE j.id=p_job_id AND j."state"='processing' AND j."leaseGeneration"=p_generation AND j."leaseExpiresAt">clock_timestamp() AND j."leaseSecretDigest"=hmac(convert_to('tyre.ge/job-lease/v1','UTF8')||decode(p_secret,'base64'),k."keyMaterial",'sha256') AND NOT EXISTS(SELECT 1 FROM public."JobAttemptOutcome" o JOIN public."JobAttemptStarted" a ON a.id=o."attemptStartedId" WHERE a."jobId"=j.id AND a."leaseGeneration"=p_generation))
$$;

CREATE OR REPLACE FUNCTION job_heartbeat_v1(p_job_id UUID,p_generation INTEGER,p_secret TEXT) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ DECLARE old_exp TIMESTAMPTZ; new_exp TIMESTAMPTZ; attempt UUID; audit_id TEXT; reg public."JobTypeRegistry"%ROWTYPE; job public."BackgroundJob"%ROWTYPE; BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_claimer','claimer',job_operation_digest_v1('heartbeat',jsonb_build_object('jobId',p_job_id,'generation',p_generation,'leaseProofDigest',encode(digest(convert_to(p_secret,'UTF8'),'sha256'),'hex')))); SELECT * INTO job FROM public."BackgroundJob" WHERE id=p_job_id FOR UPDATE; IF NOT job_fence_match_v1(p_job_id,p_generation,p_secret) THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF;
  SELECT * INTO reg FROM public."JobTypeRegistry" WHERE ("jobType","schemaVersion","registryDigest")=(job."jobType",job."schemaVersion",job."registryDigest"); old_exp:=job."leaseExpiresAt"; new_exp:=clock_timestamp()+make_interval(secs=>reg."leaseSeconds"); SELECT id INTO attempt FROM public."JobAttemptStarted" WHERE "jobId"=p_job_id AND "leaseGeneration"=p_generation; audit_id:=job_write_audit_v1(p_job_id,'jobs.heartbeat','succeeded',NULL,job."serverCorrelationId",job."causationId"); UPDATE public."BackgroundJob" SET "leaseExpiresAt"=new_exp WHERE id=p_job_id AND job_fence_match_v1(p_job_id,p_generation,p_secret); IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF; INSERT INTO public."JobHeartbeatFact"("attemptStartedId","leaseGeneration","previousLeaseExpiresAt","leaseExpiresAt","originatingAuditEventId") VALUES(attempt,p_generation,old_exp,new_exp,audit_id); INSERT INTO public."JobAuditLink" VALUES(p_job_id,audit_id,'heartbeat',clock_timestamp()); RETURN new_exp; END $$;

CREATE OR REPLACE FUNCTION job_finish_v1(p_job_id UUID,p_generation INTEGER,p_secret TEXT,p_terminal_kind TEXT,p_safe_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ DECLARE attempt UUID; audit_id TEXT; operation TEXT; job public."BackgroundJob"%ROWTYPE; receipt UUID; BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_claimer','claimer',job_operation_digest_v1('finish',jsonb_build_object('jobId',p_job_id,'generation',p_generation,'leaseProofDigest',encode(digest(convert_to(p_secret,'UTF8'),'sha256'),'hex'),'terminalKind',p_terminal_kind,'safeReason',p_safe_reason))); IF p_terminal_kind NOT IN ('succeeded','known_safe_failure','external_outcome_unknown','dead_lettered','cancelled_before_effect') THEN RAISE EXCEPTION 'JOB_TERMINAL_KIND_INVALID'; END IF;
  SELECT * INTO job FROM public."BackgroundJob" WHERE id=p_job_id FOR UPDATE; IF NOT job_fence_match_v1(p_job_id,p_generation,p_secret) THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF; SELECT id INTO attempt FROM public."JobAttemptStarted" WHERE "jobId"=p_job_id AND "leaseGeneration"=p_generation;
  operation:=CASE p_terminal_kind WHEN 'known_safe_failure' THEN 'jobs.known_safe_fail' WHEN 'external_outcome_unknown' THEN 'jobs.quarantine' WHEN 'dead_lettered' THEN 'jobs.quarantine' ELSE 'jobs.finalize' END; audit_id:=job_write_audit_v1(p_job_id,operation,'succeeded',p_safe_reason,job."serverCorrelationId",job."causationId");
  UPDATE public."BackgroundJob" SET "state"=p_terminal_kind,"leaseSecretDigest"=CASE WHEN p_terminal_kind='external_outcome_unknown' THEN "leaseSecretDigest" ELSE NULL END,"leaseDigestKeyId"=CASE WHEN p_terminal_kind='external_outcome_unknown' THEN "leaseDigestKeyId" ELSE NULL END,"leaseExpiresAt"=CASE WHEN p_terminal_kind='external_outcome_unknown' THEN "leaseExpiresAt" ELSE NULL END WHERE id=p_job_id AND job_fence_match_v1(p_job_id,p_generation,p_secret); IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF;
  INSERT INTO public."JobAttemptOutcome"("attemptStartedId","terminalKind","safeReasonCode","originatingAuditEventId") VALUES(attempt,p_terminal_kind,p_safe_reason,audit_id);
  SELECT id INTO receipt FROM public."OutboxConsumerReceipt" WHERE "attemptStartedId"=attempt; IF receipt IS NOT NULL THEN INSERT INTO public."ConsumerReceiptResult"("receiptId","terminalKind","safeResult","originatingAuditEventId") VALUES(receipt,p_terminal_kind,NULL,audit_id); END IF;
  INSERT INTO public."OutboxAcknowledgement"("messageId","attemptStartedId","terminalKind","originatingAuditEventId") VALUES(job."outboxMessageId",attempt,p_terminal_kind,audit_id);
  IF p_terminal_kind IN ('external_outcome_unknown','dead_lettered') THEN INSERT INTO public."DeadLetterAdmission"("jobId","attemptStartedId","safeReasonCode","originatingAuditEventId") VALUES(p_job_id,attempt,COALESCE(p_safe_reason,upper(p_terminal_kind)),audit_id); END IF;
  INSERT INTO public."JobAuditLink" VALUES(p_job_id,audit_id,operation,clock_timestamp()); END $$;

CREATE OR REPLACE FUNCTION job_finalize_v1(p_job_id UUID,p_generation INTEGER,p_secret TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ BEGIN PERFORM job_finish_v1(p_job_id,p_generation,p_secret,'succeeded',NULL); END $$;
CREATE OR REPLACE FUNCTION job_known_safe_fail_v1(p_job_id UUID,p_generation INTEGER,p_secret TEXT,p_safe_reason TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ BEGIN PERFORM job_finish_v1(p_job_id,p_generation,p_secret,'known_safe_failure',p_safe_reason); END $$;
CREATE OR REPLACE FUNCTION job_quarantine_v1(p_job_id UUID,p_generation INTEGER,p_secret TEXT,p_kind TEXT,p_safe_reason TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ BEGIN IF p_kind NOT IN ('external_outcome_unknown','dead_lettered') THEN RAISE EXCEPTION 'JOB_QUARANTINE_KIND_INVALID'; END IF; PERFORM job_finish_v1(p_job_id,p_generation,p_secret,p_kind,p_safe_reason); END $$;

CREATE OR REPLACE FUNCTION job_reconcile_v1(p_job_id UUID,p_generation INTEGER,p_secret TEXT,p_state TEXT,p_safe_reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ DECLARE job public."BackgroundJob"%ROWTYPE; audit_id TEXT; BEGIN PERFORM job_assert_runtime_v1('tyre_jobs_claimer','claimer',job_operation_digest_v1('reconcile',jsonb_build_object('jobId',p_job_id,'generation',p_generation,'leaseProofDigest',encode(digest(convert_to(p_secret,'UTF8'),'sha256'),'hex'),'state',p_state,'safeReason',p_safe_reason))); IF p_state NOT IN ('reconciling','reconciled_applied','reconciled_not_applied') THEN RAISE EXCEPTION 'JOB_RECONCILIATION_STATE_INVALID'; END IF; SELECT j INTO job FROM public."BackgroundJob" j JOIN public."JobLeaseDigestKey" k ON k."keyId"=j."leaseDigestKeyId" WHERE j.id=p_job_id AND j."state" IN ('external_outcome_unknown','reconciling') AND j."leaseGeneration"=p_generation AND j."leaseExpiresAt">clock_timestamp() AND j."leaseSecretDigest"=hmac(convert_to('tyre.ge/job-lease/v1','UTF8')||decode(p_secret,'base64'),k."keyMaterial",'sha256') FOR UPDATE OF j; IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF; audit_id:=job_write_audit_v1(p_job_id,'jobs.reconcile','succeeded',p_safe_reason,job."serverCorrelationId",job."causationId"); UPDATE public."BackgroundJob" SET "state"=p_state,"leaseSecretDigest"=CASE WHEN p_state='reconciling' THEN "leaseSecretDigest" ELSE NULL END,"leaseDigestKeyId"=CASE WHEN p_state='reconciling' THEN "leaseDigestKeyId" ELSE NULL END,"leaseExpiresAt"=CASE WHEN p_state='reconciling' THEN "leaseExpiresAt" ELSE NULL END WHERE id=p_job_id AND "state"=job."state" AND "leaseGeneration"=p_generation AND "leaseExpiresAt">clock_timestamp(); IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF; INSERT INTO public."JobReconciliation"("jobId","state","safeReasonCode","originatingAuditEventId") VALUES(p_job_id,p_state,p_safe_reason,audit_id); INSERT INTO public."JobAuditLink" VALUES(p_job_id,audit_id,'reconcile',clock_timestamp()); END $$;

CREATE OR REPLACE FUNCTION record_job_fence_loss(p_attempt_started_id UUID,p_generation INTEGER,p_operation TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ DECLARE a public."JobAttemptStarted"%ROWTYPE; j public."BackgroundJob"%ROWTYPE; audit_id TEXT; BEGIN PERFORM job_assert_runtime_v1('tyre_jobs_claimer','claimer',job_operation_digest_v1('fence_loss',jsonb_build_object('attemptStartedId',p_attempt_started_id,'generation',p_generation,'operation',p_operation))); IF p_operation NOT IN ('heartbeat','finalize','known_safe_fail','quarantine','reconcile') THEN RAISE EXCEPTION 'JOB_FENCE_OPERATION_INVALID'; END IF; SELECT * INTO a FROM public."JobAttemptStarted" WHERE id=p_attempt_started_id AND "leaseGeneration"=p_generation; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_ATTEMPT_INVALID'; END IF; IF EXISTS(SELECT 1 FROM public."JobFenceLossAudit" WHERE "attemptStartedId"=p_attempt_started_id AND "leaseGeneration"=p_generation AND operation=p_operation) THEN RETURN false; END IF; SELECT * INTO j FROM public."BackgroundJob" WHERE id=a."jobId"; audit_id:=job_write_audit_v1(j.id,'jobs.fence_loss','denied','LEASE_FENCE_LOST',j."serverCorrelationId",j."causationId"); INSERT INTO public."JobFenceLossAudit" VALUES(p_attempt_started_id,p_generation,p_operation,audit_id,clock_timestamp()); RETURN true; END $$;

-- One relation for every read surface. Literal jobs.read is joined from live assignment -> role permission.
CREATE OR REPLACE FUNCTION authorized_job_v1(p_viewer_id TEXT,p_session_id TEXT)
RETURNS SETOF public."BackgroundJob" LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public SET row_security=on AS $$ BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_reader','reader',job_operation_digest_v1('authorized_job',jsonb_build_object('viewerId',p_viewer_id,'sessionId',p_session_id)));
  IF current_setting('tyre.jobs.viewer_id',true) IS DISTINCT FROM p_viewer_id OR current_setting('tyre.jobs.session_id',true) IS DISTINCT FROM p_session_id THEN RETURN; END IF;
  RETURN QUERY SELECT j.* FROM public."BackgroundJob" j JOIN public."JobTypeRegistry" reg ON (reg."jobType",reg."schemaVersion",reg."registryDigest")=(j."jobType",j."schemaVersion",j."registryDigest")
  WHERE EXISTS(SELECT 1 FROM public."Admin" a JOIN public."StaffSession" s ON s."staffUserId"=a.id JOIN public."SecurityControl" sc ON sc.id=1 WHERE a.id=p_viewer_id AND s.id=p_session_id AND a.enabled AND a.status='active' AND s."revokedAt" IS NULL AND s."idleExpiresAt">clock_timestamp() AND s."absoluteExpiresAt">clock_timestamp() AND s."tokenVersionSnapshot"=a."tokenVersion" AND s."authContractVersion">=sc."minimumAuthContractVersion")
  AND j."authorizationScopeKind"<>'legacy_restricted'
  AND CASE
    WHEN j."authorizationScopeKind"='global_operations' THEN
      NOT EXISTS(SELECT 1 FROM public."JobAuthorizationScopeRef" sr WHERE sr."jobId"=j.id) AND j."scopeMatchMode"='all' AND
      EXISTS(SELECT 1 FROM public."AdminRoleAssignment" ar JOIN public."RolePermission" rp ON rp."roleId"=ar."roleId" JOIN public."Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=p_viewer_id AND ar."scopeType"='global' AND ar."scopeId"='' AND p.key='jobs.read') AND
      EXISTS(SELECT 1 FROM public."AdminRoleAssignment" ar JOIN public."RolePermission" rp ON rp."roleId"=ar."roleId" JOIN public."Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=p_viewer_id AND ar."scopeType"='global' AND ar."scopeId"='' AND p.key=j."requiredGlobalGrant")
    WHEN j."authorizationScopeKind"='resource_scoped' THEN EXISTS(SELECT 1 FROM public."JobAuthorizationScopeRef" sr WHERE sr."jobId"=j.id) AND ((j."scopeMatchMode"='all' AND NOT EXISTS(SELECT 1 FROM public."JobAuthorizationScopeRef" sr WHERE sr."jobId"=j.id AND NOT EXISTS(SELECT 1 FROM public."AdminRoleAssignment" ar JOIN public."RolePermission" rp ON rp."roleId"=ar."roleId" JOIN public."Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=p_viewer_id AND p.key='jobs.read' AND ar."scopeType"::TEXT=sr.dimension AND ar."scopeId"=sr."scopeId"))) OR (j."scopeMatchMode"='any' AND reg."allowAnyResourceScope" AND EXISTS(SELECT 1 FROM public."JobAuthorizationScopeRef" sr JOIN public."AdminRoleAssignment" ar ON ar."adminId"=p_viewer_id AND ar."scopeType"::TEXT=sr.dimension AND ar."scopeId"=sr."scopeId" JOIN public."RolePermission" rp ON rp."roleId"=ar."roleId" JOIN public."Permission" p ON p.id=rp."permissionId" AND p.key='jobs.read' WHERE sr."jobId"=j.id)) OR (reg."allowGlobalReader" AND EXISTS(SELECT 1 FROM public."AdminRoleAssignment" ar JOIN public."RolePermission" rp ON rp."roleId"=ar."roleId" JOIN public."Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=p_viewer_id AND ar."scopeType"='global' AND ar."scopeId"='' AND p.key='jobs.read')))
    WHEN j."authorizationScopeKind"='cross_scope' THEN j."scopeMatchMode"='all' AND NOT EXISTS(SELECT 1 FROM public."JobAuthorizationScopeRef" sr WHERE sr."jobId"=j.id AND NOT EXISTS(SELECT 1 FROM public."AdminRoleAssignment" ar JOIN public."RolePermission" rp ON rp."roleId"=ar."roleId" JOIN public."Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=p_viewer_id AND p.key='jobs.read' AND ar."scopeType"::TEXT=sr.dimension AND ar."scopeId"=sr."scopeId"))
    ELSE false END
  ; END $$;

CREATE OR REPLACE FUNCTION job_reader_list_v1(p_viewer_id TEXT,p_session_id TEXT,p_created_from TIMESTAMPTZ,p_created_to TIMESTAMPTZ,p_state TEXT,p_job_type TEXT,p_owner_domain TEXT,p_correlation TEXT,p_sort_field TEXT,p_sort_direction TEXT,p_limit INTEGER,p_last_sort_value TEXT,p_last_created_at TIMESTAMPTZ,p_last_job_id UUID)
RETURNS TABLE("jobId" UUID,"jobType" TEXT,"schemaVersion" INTEGER,"ownerDomain" TEXT,"state" TEXT,"priority" INTEGER,"createdAt" TIMESTAMPTZ,"availableAt" TIMESTAMPTZ,"serverCorrelationId" TEXT,"causationId" TEXT,"originatingAuditEventId" TEXT,"safeSummary" JSONB)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT j.id,j."jobType",j."schemaVersion",j."ownerDomain",j."state",j."priority",j."createdAt",j."availableAt",j."serverCorrelationId",j."causationId",j."originatingAuditEventId",j."safeSummary"
 FROM authorized_job_v1(p_viewer_id,p_session_id) j
 WHERE j."createdAt">=p_created_from AND j."createdAt"<=p_created_to AND (p_state IS NULL OR j."state"=p_state) AND (p_job_type IS NULL OR j."jobType"=p_job_type) AND (p_owner_domain IS NULL OR j."ownerDomain"=p_owner_domain) AND (p_correlation IS NULL OR j."serverCorrelationId"=p_correlation)
 AND (p_last_job_id IS NULL OR
   (p_sort_field='createdAt' AND ((p_sort_direction='asc' AND (j."createdAt",j.id)>(p_last_created_at,p_last_job_id)) OR (p_sort_direction='desc' AND (j."createdAt",j.id)<(p_last_created_at,p_last_job_id)))) OR
   (p_sort_field='availableAt' AND ((p_sort_direction='asc' AND (j."availableAt",j."createdAt",j.id)>((p_last_sort_value)::TIMESTAMPTZ,p_last_created_at,p_last_job_id)) OR (p_sort_direction='desc' AND (j."availableAt",j."createdAt",j.id)<((p_last_sort_value)::TIMESTAMPTZ,p_last_created_at,p_last_job_id)))) OR
   (p_sort_field='state' AND ((p_sort_direction='asc' AND (j."state",j."createdAt",j.id)>(p_last_sort_value,p_last_created_at,p_last_job_id)) OR (p_sort_direction='desc' AND (j."state",j."createdAt",j.id)<(p_last_sort_value,p_last_created_at,p_last_job_id)))) OR
   (p_sort_field='priority' AND ((p_sort_direction='asc' AND (j."priority",j."createdAt",j.id)>((p_last_sort_value)::INTEGER,p_last_created_at,p_last_job_id)) OR (p_sort_direction='desc' AND (j."priority",j."createdAt",j.id)<((p_last_sort_value)::INTEGER,p_last_created_at,p_last_job_id)))))
 ORDER BY
   CASE WHEN p_sort_field='createdAt' AND p_sort_direction='asc' THEN j."createdAt" END ASC,CASE WHEN p_sort_field='createdAt' AND p_sort_direction='desc' THEN j."createdAt" END DESC,
   CASE WHEN p_sort_field='availableAt' AND p_sort_direction='asc' THEN j."availableAt" END ASC,CASE WHEN p_sort_field='availableAt' AND p_sort_direction='desc' THEN j."availableAt" END DESC,
   CASE WHEN p_sort_field='state' AND p_sort_direction='asc' THEN j."state" END ASC,CASE WHEN p_sort_field='state' AND p_sort_direction='desc' THEN j."state" END DESC,
   CASE WHEN p_sort_field='priority' AND p_sort_direction='asc' THEN j."priority" END ASC,CASE WHEN p_sort_field='priority' AND p_sort_direction='desc' THEN j."priority" END DESC,
   CASE WHEN p_sort_direction='asc' THEN j."createdAt" END ASC,CASE WHEN p_sort_direction='desc' THEN j."createdAt" END DESC,
   CASE WHEN p_sort_direction='asc' THEN j.id END ASC,CASE WHEN p_sort_direction='desc' THEN j.id END DESC LIMIT p_limit
$$;

CREATE OR REPLACE FUNCTION job_reader_detail_v1(p_viewer_id TEXT,p_session_id TEXT,p_job_id UUID) RETURNS JSONB
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT jsonb_build_object('jobId',j.id,'jobType',j."jobType",'schemaVersion',j."schemaVersion",'ownerDomain',j."ownerDomain",'state',j."state",'priority',j."priority",'createdAt',j."createdAt",'availableAt',j."availableAt",'serverCorrelationId',j."serverCorrelationId",'causationId',j."causationId",'originatingAuditEventId',j."originatingAuditEventId",'safeSummary',j."safeSummary",'authorizationScopeKind',j."authorizationScopeKind",'scopeMatchMode',j."scopeMatchMode",'requiredGlobalGrant',j."requiredGlobalGrant",'scopeResolverId',j."scopeResolverId",'scopeResolverVersion',j."scopeResolverVersion",'authorizationPolicyVersion',j."authorizationPolicyVersion",'currentLeaseGeneration',j."leaseGeneration",'leaseExpiresAt',j."leaseExpiresAt",
 'authorizationScopeRefs',COALESCE((SELECT jsonb_agg(jsonb_build_object('dimension',s.dimension,'id',s."scopeId") ORDER BY s.ordinal) FROM public."JobAuthorizationScopeRef" s WHERE s."jobId"=j.id),'[]'::jsonb),
 'attempts',COALESCE((SELECT jsonb_agg(jsonb_build_object('attemptStartedId',a.id,'leaseGeneration',a."leaseGeneration",'startedAt',a."startedAt",'outcome',o."terminalKind",'outcomeAt',o."occurredAt",'safeReasonCode',o."safeReasonCode") ORDER BY a."leaseGeneration") FROM public."JobAttemptStarted" a LEFT JOIN public."JobAttemptOutcome" o ON o."attemptStartedId"=a.id WHERE a."jobId"=j.id),'[]'::jsonb),
 'reconciliations',COALESCE((SELECT jsonb_agg(jsonb_build_object('reconciliationId',r.id,'state',r.state,'occurredAt',r."createdAt",'safeReasonCode',r."safeReasonCode") ORDER BY r."createdAt",r.id) FROM public."JobReconciliation" r WHERE r."jobId"=j.id),'[]'::jsonb))
 FROM authorized_job_v1(p_viewer_id,p_session_id) j WHERE j.id=p_job_id
$$;

CREATE OR REPLACE FUNCTION job_reader_current_context_v1()
RETURNS TABLE(viewer_id TEXT,session_id TEXT,account_version INTEGER,token_version INTEGER,minimum_auth_contract_version INTEGER,security_control_version INTEGER,assignment_graph JSONB)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public SET row_security=on AS $$ DECLARE viewer TEXT:=current_setting('tyre.jobs.viewer_id',true); sess TEXT:=current_setting('tyre.jobs.session_id',true); BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_reader','reader',job_operation_digest_v1('authorized_job',jsonb_build_object('viewerId',viewer,'sessionId',sess)));
  RETURN QUERY SELECT a.id,s.id,a.version,a."tokenVersion",c."minimumAuthContractVersion",c.version,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('assignmentId',ar.id,'roleId',r.id,'roleVersion',r.version,'permission',p.key,'scopeType',ar."scopeType"::TEXT,'scopeId',ar."scopeId") ORDER BY ar.id,r.id,p.key,ar."scopeType"::TEXT,ar."scopeId") FROM public."AdminRoleAssignment" ar JOIN public."Role" r ON r.id=ar."roleId" JOIN public."RolePermission" rp ON rp."roleId"=r.id JOIN public."Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=a.id),'[]'::jsonb)
  FROM public."Admin" a JOIN public."StaffSession" s ON s."staffUserId"=a.id JOIN public."SecurityControl" c ON c.id=1 WHERE a.id=viewer AND s.id=sess AND a.enabled AND a.status='active' AND s."revokedAt" IS NULL AND s."idleExpiresAt">clock_timestamp() AND s."absoluteExpiresAt">clock_timestamp() AND s."tokenVersionSnapshot"=a."tokenVersion" AND s."authContractVersion">=c."minimumAuthContractVersion";
END $$;

CREATE OR REPLACE FUNCTION job_runtime_attestation_v1(expected_group NAME)
RETURNS TABLE(database_login TEXT,database_group TEXT,membership_valid BOOLEAN,runtime_contract_digest TEXT,registry_digest TEXT,protected_owner_count INTEGER,enabled_trigger_count INTEGER,guard_can_login BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ BEGIN
  IF expected_group::TEXT NOT IN ('tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance') THEN RETURN; END IF;
  RETURN QUERY SELECT session_user::TEXT,expected_group::TEXT,job_runtime_membership_ok(expected_group),job_runtime_contract_digest_v1(),job_registry_digest_v1(),
    (SELECT count(*)::INTEGER FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND r.rolname='tyre_jobs_guard_owner' AND c.relname=ANY(ARRAY['JobTypeRegistry','OutboxMessage','BackgroundJob','JobAuthorizationScopeRef','JobOriginBudget','JobTransactionBudget','JobAttemptStarted','JobHeartbeatFact','JobAttemptOutcome','OutboxConsumerReceipt','ConsumerReceiptResult','OutboxAcknowledgement','DispatchFact','DeadLetterAdmission','JobReconciliation','JobAuditLink','JobFenceLossAudit','JobLeaseDigestKey','JobLeaseDigestKeyRevocation','JobRuntimeContextKey','JobRuntimeContextKeyRevocation'])),
    (SELECT count(*)::INTEGER FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND t.tgenabled='O' AND c.relname=ANY(ARRAY['JobTypeRegistry','OutboxMessage','BackgroundJob','JobAuthorizationScopeRef','JobAttemptStarted','JobHeartbeatFact','JobAttemptOutcome','OutboxConsumerReceipt','ConsumerReceiptResult','OutboxAcknowledgement','DispatchFact','DeadLetterAdmission','JobReconciliation','JobAuditLink','JobFenceLossAudit','JobLeaseDigestKey','JobLeaseDigestKeyRevocation','JobRuntimeContextKey','JobRuntimeContextKeyRevocation'])),
    (SELECT rolcanlogin FROM pg_roles WHERE rolname='tyre_jobs_guard_owner');
END $$;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['JobTypeRegistry','OutboxMessage','BackgroundJob','JobAuthorizationScopeRef','JobOriginBudget','JobTransactionBudget','JobAttemptStarted','JobHeartbeatFact','JobAttemptOutcome','OutboxConsumerReceipt','ConsumerReceiptResult','OutboxAcknowledgement','DispatchFact','DeadLetterAdmission','JobReconciliation','JobAuditLink','JobFenceLossAudit','JobLeaseDigestKey','JobLeaseDigestKeyRevocation','JobRuntimeContextKey','JobRuntimeContextKeyRevocation'] LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO tyre_jobs_guard_owner',t);
  END LOOP;
END $$;
ALTER FUNCTION reject_job_immutable_mutation() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION guard_background_job_projection_update() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_safe_payload_valid_v1(JSONB,JSONB) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION validate_job_registry_insert_v1() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_runtime_membership_ok(NAME) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_runtime_contract_digest_v1() OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_registry_digest_v1() OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_operation_digest_v1(TEXT,JSONB) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_issue_challenge_internal_v1(NAME,TEXT,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_bind_context_internal_v1(NAME,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_assert_runtime_v1(NAME,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_write_audit_v1(UUID,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_producer_issue_challenge_v1(TEXT,TEXT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_claimer_issue_challenge_v1(TEXT,TEXT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_reader_issue_challenge_v1(TEXT,TEXT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_producer_bind_context_v1(TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_claimer_bind_context_v1(TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_reader_bind_context_v1(TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_runtime_attestation_v1(NAME) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_runtime_key_attestation_v1(TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_enqueue_v1(TEXT,INTEGER,JSONB,INTEGER,TIMESTAMPTZ,TEXT,JSONB,TEXT,TEXT,UUID) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_claim_v1() OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_reclaim_v1() OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_fence_match_v1(UUID,INTEGER,TEXT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_heartbeat_v1(UUID,INTEGER,TEXT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_finish_v1(UUID,INTEGER,TEXT,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_finalize_v1(UUID,INTEGER,TEXT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_known_safe_fail_v1(UUID,INTEGER,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_quarantine_v1(UUID,INTEGER,TEXT,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_reconcile_v1(UUID,INTEGER,TEXT,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION record_job_fence_loss(UUID,INTEGER,TEXT) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION authorized_job_v1(TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_reader_list_v1(TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TIMESTAMPTZ,UUID) OWNER TO tyre_jobs_guard_owner; ALTER FUNCTION job_reader_detail_v1(TEXT,TEXT,UUID) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_reader_current_context_v1() OWNER TO tyre_jobs_guard_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader,tyre_jobs_maintenance;
GRANT INSERT ON "AuditEventV2","AuditEventScopeRefV2" TO tyre_jobs_guard_owner;
GRANT SELECT ON "Admin","StaffSession","SecurityControl","AdminRoleAssignment","Role","RolePermission","Permission" TO tyre_jobs_guard_owner;
REVOKE ALL ON FUNCTION job_runtime_membership_ok(NAME),job_runtime_contract_digest_v1(),job_registry_digest_v1(),job_issue_challenge_internal_v1(NAME,TEXT,TEXT,TEXT),job_bind_context_internal_v1(NAME,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT),job_assert_runtime_v1(NAME,TEXT,TEXT),job_write_audit_v1(UUID,TEXT,TEXT,TEXT,TEXT,TEXT),job_fence_match_v1(UUID,INTEGER,TEXT),job_finish_v1(UUID,INTEGER,TEXT,TEXT,TEXT),job_operation_digest_v1(TEXT,JSONB),job_safe_payload_valid_v1(JSONB,JSONB),validate_job_registry_insert_v1(),job_producer_issue_challenge_v1(TEXT,TEXT),job_claimer_issue_challenge_v1(TEXT,TEXT),job_reader_issue_challenge_v1(TEXT,TEXT),job_producer_bind_context_v1(TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT),job_claimer_bind_context_v1(TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT),job_reader_bind_context_v1(TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT),job_runtime_key_attestation_v1(TEXT,TEXT),job_runtime_attestation_v1(NAME),job_enqueue_v1(TEXT,INTEGER,JSONB,INTEGER,TIMESTAMPTZ,TEXT,JSONB,TEXT,TEXT,UUID),job_claim_v1(),job_reclaim_v1(),job_heartbeat_v1(UUID,INTEGER,TEXT),job_finalize_v1(UUID,INTEGER,TEXT),job_known_safe_fail_v1(UUID,INTEGER,TEXT,TEXT),job_quarantine_v1(UUID,INTEGER,TEXT,TEXT,TEXT),job_reconcile_v1(UUID,INTEGER,TEXT,TEXT,TEXT),record_job_fence_loss(UUID,INTEGER,TEXT),authorized_job_v1(TEXT,TEXT),job_reader_list_v1(TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TIMESTAMPTZ,UUID),job_reader_detail_v1(TEXT,TEXT,UUID),job_reader_current_context_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION job_runtime_attestation_v1(NAME) TO tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader,tyre_jobs_maintenance;
GRANT EXECUTE ON FUNCTION job_operation_digest_v1(TEXT,JSONB),job_producer_issue_challenge_v1(TEXT,TEXT),job_producer_bind_context_v1(TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT) TO tyre_jobs_producer;
GRANT EXECUTE ON FUNCTION job_operation_digest_v1(TEXT,JSONB),job_claimer_issue_challenge_v1(TEXT,TEXT),job_claimer_bind_context_v1(TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT) TO tyre_jobs_claimer;
GRANT EXECUTE ON FUNCTION job_operation_digest_v1(TEXT,JSONB),job_reader_issue_challenge_v1(TEXT,TEXT),job_reader_bind_context_v1(TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT) TO tyre_jobs_reader;
GRANT EXECUTE ON FUNCTION job_runtime_key_attestation_v1(TEXT,TEXT) TO tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader;
GRANT EXECUTE ON FUNCTION job_enqueue_v1(TEXT,INTEGER,JSONB,INTEGER,TIMESTAMPTZ,TEXT,JSONB,TEXT,TEXT,UUID) TO tyre_jobs_producer;
GRANT EXECUTE ON FUNCTION job_claim_v1(),job_reclaim_v1(),job_heartbeat_v1(UUID,INTEGER,TEXT),job_finalize_v1(UUID,INTEGER,TEXT),job_known_safe_fail_v1(UUID,INTEGER,TEXT,TEXT),job_quarantine_v1(UUID,INTEGER,TEXT,TEXT,TEXT),job_reconcile_v1(UUID,INTEGER,TEXT,TEXT,TEXT),record_job_fence_loss(UUID,INTEGER,TEXT) TO tyre_jobs_claimer;
GRANT EXECUTE ON FUNCTION job_reader_list_v1(TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TIMESTAMPTZ,UUID),job_reader_detail_v1(TEXT,TEXT,UUID),job_reader_current_context_v1() TO tyre_jobs_reader;
-- Maintenance intentionally receives no executable runtime surface in 3C.

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM "JobTypeRegistry") OR EXISTS(SELECT 1 FROM "OutboxMessage") OR EXISTS(SELECT 1 FROM "BackgroundJob") THEN RAISE EXCEPTION '3C_ZERO_SEED_VIOLATION'; END IF;
END $$;
