-- Increment 3C implementation-security follow-up.
-- Additive only: migration 20260730300000 may already be applied and is not rewritten.

ALTER TABLE "JobTypeRegistry"
  ADD COLUMN "producerAction" TEXT,
  ADD COLUMN "requiredScopeKinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "minScopeRefCount" INTEGER,
  ADD COLUMN "maxScopeRefCount" INTEGER,
  ADD COLUMN "allowedChildJobTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "allowedChildOwnerDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "JobTypeRegistry" ALTER COLUMN "requiredScopeKinds" DROP DEFAULT,ALTER COLUMN "allowedChildJobTypes" DROP DEFAULT,ALTER COLUMN "allowedChildOwnerDomains" DROP DEFAULT;

ALTER TABLE "JobTypeRegistry" ADD CONSTRAINT "JobTypeRegistry_scope_v2_check" CHECK (
  "requiredScopeKinds" IS NULL OR (
    "producerAction"='enqueue' AND
    "minScopeRefCount">=0 AND "maxScopeRefCount">="minScopeRefCount" AND
    CASE "authorizationScopeKind"
      WHEN 'global_operations' THEN cardinality("requiredScopeKinds")=0 AND "minScopeRefCount"=0 AND "maxScopeRefCount"=0
      WHEN 'resource_scoped' THEN cardinality("requiredScopeKinds")>0 AND "minScopeRefCount">0
      WHEN 'cross_scope' THEN "scopeMatchMode"='all' AND cardinality("requiredScopeKinds")>=2 AND "minScopeRefCount"=cardinality("requiredScopeKinds") AND "maxScopeRefCount"=cardinality("requiredScopeKinds")
      WHEN 'legacy_restricted' THEN false
      ELSE false
    END
  )
) NOT VALID;

CREATE TABLE "JobOperationalPolicy" (
  "operationalPolicyDigest" TEXT PRIMARY KEY,
  "maxAttemptsPerJob" INTEGER NOT NULL,
  "maxHeartbeatsPerJob" INTEGER NOT NULL,
  "maxReconciliationsPerJob" INTEGER NOT NULL,
  "maxFenceLossPerMinute" INTEGER NOT NULL,
  "maxAttemptsPerMinute" INTEGER NOT NULL,
  "maxHeartbeatsPerMinute" INTEGER NOT NULL,
  "maxReconciliationsPerMinute" INTEGER NOT NULL,
  "maxFactsPerMinute" INTEGER NOT NULL,
  "maxAuditsPerMinute" INTEGER NOT NULL,
  "maxFactsPerOrigin" INTEGER NOT NULL,
  "maxAuditsPerOrigin" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "JobOperationalPolicy_digest_check" CHECK ("operationalPolicyDigest" ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT "JobOperationalPolicy_limits_check" CHECK (
    "maxAttemptsPerJob">0 AND "maxHeartbeatsPerJob">0 AND "maxReconciliationsPerJob">0 AND
    "maxFenceLossPerMinute">0 AND "maxAttemptsPerMinute">0 AND "maxHeartbeatsPerMinute">0 AND
    "maxReconciliationsPerMinute">0 AND "maxFactsPerMinute">0 AND "maxAuditsPerMinute">0 AND
    "maxFactsPerOrigin">0 AND "maxAuditsPerOrigin">0
  )
);

ALTER TABLE "JobRuntimeContextKey"
  ADD COLUMN "runtimeLogin" TEXT,
  ADD COLUMN "principalId" TEXT,
  ADD COLUMN "boundaryDigest" TEXT;
ALTER TABLE "JobRuntimeContextKey" ADD CONSTRAINT "JobRuntimeContextKey_boundary_check" CHECK (
  "boundaryDigest" IS NULL OR (
    "runtimeLogin" ~ '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$' AND
    "principalId" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' AND
    "boundaryDigest" ~ '^[A-Za-z0-9_-]{43}$'
  )
) NOT VALID;

ALTER TABLE "JobOriginBudget"
  ADD COLUMN "rootJobType" TEXT,
  ADD COLUMN "rootRegistryDigest" TEXT,
  ADD COLUMN "maxRows" INTEGER,
  ADD COLUMN "maxDerivedBytes" INTEGER,
  ADD COLUMN "maxFacts" INTEGER,
  ADD COLUMN "maxAudits" INTEGER,
  ADD COLUMN "maxAttemptsPerJob" INTEGER,
  ADD COLUMN "maxHeartbeatsPerJob" INTEGER,
  ADD COLUMN "maxReconciliationsPerJob" INTEGER,
  ADD COLUMN "maxFenceLossPerMinute" INTEGER,
  ADD COLUMN "maxAttemptsPerMinute" INTEGER,
  ADD COLUMN "maxHeartbeatsPerMinute" INTEGER,
  ADD COLUMN "maxReconciliationsPerMinute" INTEGER,
  ADD COLUMN "maxFactsPerMinute" INTEGER,
  ADD COLUMN "maxAuditsPerMinute" INTEGER,
  ADD COLUMN "factCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "heartbeatCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reconciliationCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "fenceLossCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobOriginBudget" ADD CONSTRAINT "JobOriginBudget_v2_limits_check" CHECK (
  "maxRows" IS NULL OR (
    "maxRows">0 AND "maxDerivedBytes">0 AND "maxFacts">0 AND "maxAudits">0 AND
    "maxAttemptsPerJob">0 AND "maxHeartbeatsPerJob">0 AND "maxReconciliationsPerJob">0 AND
    "maxFenceLossPerMinute">0 AND "maxAttemptsPerMinute">0 AND "maxHeartbeatsPerMinute">0 AND
    "maxReconciliationsPerMinute">0 AND "maxFactsPerMinute">0 AND "maxAuditsPerMinute">0 AND
    "factCount">=0 AND "attemptCount">=0 AND
    "heartbeatCount">=0 AND "reconciliationCount">=0 AND "fenceLossCount">=0
  )
) NOT VALID;

ALTER TABLE "JobFenceLossAudit" ADD COLUMN "runtimeLogin" TEXT;

CREATE TABLE "JobOriginRateBucket" (
  "originJobId" UUID NOT NULL,
  "minuteBucket" TIMESTAMPTZ(6) NOT NULL,
  "attemptCount" INTEGER NOT NULL,
  "heartbeatCount" INTEGER NOT NULL,
  "reconciliationCount" INTEGER NOT NULL,
  "fenceLossCount" INTEGER NOT NULL,
  "factCount" INTEGER NOT NULL,
  "auditCount" INTEGER NOT NULL,
  PRIMARY KEY("originJobId","minuteBucket"),
  CHECK ("attemptCount">=0 AND "heartbeatCount">=0 AND "reconciliationCount">=0 AND "fenceLossCount">=0 AND "factCount">=0 AND "auditCount">=0)
);

CREATE OR REPLACE FUNCTION validate_job_registry_insert_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE key TEXT; def JSONB; BEGIN
  IF NEW."producerAction" IS DISTINCT FROM 'enqueue' OR NEW."requiredScopeKinds" IS NULL OR
     NEW."minScopeRefCount" IS NULL OR NEW."maxScopeRefCount" IS NULL OR
     NEW."allowedChildJobTypes" IS NULL OR NEW."allowedChildOwnerDomains" IS NULL THEN
    RAISE EXCEPTION 'JOB_REGISTRY_SECURITY_ENVELOPE_REQUIRED';
  END IF;
  IF NEW."requiredScopeKinds" IS DISTINCT FROM ARRAY(SELECT x FROM unnest(NEW."requiredScopeKinds") x ORDER BY x) OR
     NEW."allowedChildJobTypes" IS DISTINCT FROM ARRAY(SELECT x FROM unnest(NEW."allowedChildJobTypes") x ORDER BY x) OR
     NEW."allowedChildOwnerDomains" IS DISTINCT FROM ARRAY(SELECT x FROM unnest(NEW."allowedChildOwnerDomains") x ORDER BY x) OR
     EXISTS(SELECT 1 FROM unnest(NEW."requiredScopeKinds") x WHERE x NOT IN ('warehouse','channel','company')) OR
     EXISTS(SELECT 1 FROM unnest(NEW."allowedChildJobTypes") x WHERE x !~ '^[a-z][a-z0-9_.-]{0,127}$') OR
     EXISTS(SELECT 1 FROM unnest(NEW."allowedChildOwnerDomains") x WHERE x !~ '^[a-z][a-z0-9_.-]{0,127}$') OR
     cardinality(NEW."requiredScopeKinds")<>(SELECT count(DISTINCT x) FROM unnest(NEW."requiredScopeKinds") x) OR
     cardinality(NEW."allowedChildJobTypes")<>(SELECT count(DISTINCT x) FROM unnest(NEW."allowedChildJobTypes") x) OR
     cardinality(NEW."allowedChildOwnerDomains")<>(SELECT count(DISTINCT x) FROM unnest(NEW."allowedChildOwnerDomains") x) THEN
    RAISE EXCEPTION 'JOB_REGISTRY_SECURITY_ENVELOPE_INVALID';
  END IF;
  IF NEW."authorizationScopeKind"='global_operations' AND
       (cardinality(NEW."requiredScopeKinds")<>0 OR NEW."minScopeRefCount"<>0 OR NEW."maxScopeRefCount"<>0) OR
     NEW."authorizationScopeKind"='resource_scoped' AND
       (cardinality(NEW."requiredScopeKinds")=0 OR NEW."minScopeRefCount"<=0 OR NEW."maxScopeRefCount"<NEW."minScopeRefCount") OR
     NEW."authorizationScopeKind"='cross_scope' AND
       (NEW."scopeMatchMode"<>'all' OR NEW."requiredGlobalGrant" IS NULL OR cardinality(NEW."requiredScopeKinds")<2 OR NEW."minScopeRefCount"<>cardinality(NEW."requiredScopeKinds") OR NEW."maxScopeRefCount"<>cardinality(NEW."requiredScopeKinds")) OR
     NEW."authorizationScopeKind"='legacy_restricted' THEN RAISE EXCEPTION 'JOB_REGISTRY_SCOPE_INVALID'; END IF;
  IF NEW."requiredScopeKinds"<>NEW."allowedScopeDimensions" THEN RAISE EXCEPTION 'JOB_REGISTRY_SCOPE_INVALID'; END IF;
  FOR key,def IN SELECT * FROM jsonb_each(NEW."safeFieldSchema") LOOP
    IF key !~ '^[a-z][A-Za-z0-9_.-]{0,127}$' OR key ~* '(password|authorization|cookie|secret|token|totp|recovery|ciphertext|auth.?tag|nonce|credential|payment|request.?body|attachment)' OR def->>'type' NOT IN ('string','number','boolean') OR def->>'classification' NOT IN ('public_operational','masked') OR octet_length(def->>'label') NOT BETWEEN 1 AND 128 OR def->>'type'='string' AND COALESCE((def->>'maxBytes')::INTEGER,0)<=0 THEN RAISE EXCEPTION 'JOB_REGISTRY_SAFE_SCHEMA_INVALID'; END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION validate_job_scope_complete_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE target UUID; j "BackgroundJob"%ROWTYPE; r "JobTypeRegistry"%ROWTYPE; ref_count INTEGER; kind_count INTEGER; BEGIN
  IF TG_TABLE_NAME='BackgroundJob' THEN target:=COALESCE(NEW.id,OLD.id); ELSE target:=COALESCE(NEW."jobId",OLD."jobId"); END IF;
  SELECT * INTO j FROM "BackgroundJob" WHERE id=target;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO r FROM "JobTypeRegistry" WHERE ("jobType","schemaVersion","registryDigest")=(j."jobType",j."schemaVersion",j."registryDigest");
  IF r."requiredScopeKinds" IS NULL THEN RAISE EXCEPTION 'JOB_SCOPE_REGISTRY_LEGACY_DENIED'; END IF;
  SELECT count(*),count(DISTINCT dimension) INTO ref_count,kind_count FROM "JobAuthorizationScopeRef" WHERE "jobId"=target;
  IF j."authorizationScopeKind"<>r."authorizationScopeKind" OR j."scopeMatchMode"<>r."scopeMatchMode" OR
     ref_count<r."minScopeRefCount" OR ref_count>r."maxScopeRefCount" OR
     EXISTS(SELECT 1 FROM "JobAuthorizationScopeRef" s WHERE s."jobId"=target AND NOT s.dimension=ANY(r."requiredScopeKinds")) OR
     (j."authorizationScopeKind"='global_operations' AND ref_count<>0) OR
     (j."authorizationScopeKind"='resource_scoped' AND ref_count=0) OR
     (j."authorizationScopeKind"='cross_scope' AND (j."scopeMatchMode"<>'all' OR ref_count=0 OR kind_count<>cardinality(r."requiredScopeKinds") OR ref_count<>cardinality(r."requiredScopeKinds"))) OR
     j."authorizationScopeKind"='legacy_restricted' THEN RAISE EXCEPTION 'JOB_SCOPE_INCOMPLETE'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION job_enqueue_v1(p_job_type TEXT,p_schema_version INTEGER,p_safe_payload JSONB,p_priority INTEGER,p_available_at TIMESTAMPTZ,p_deduplication_key TEXT,p_scope_refs JSONB,p_server_correlation_id TEXT,p_causation_id TEXT DEFAULT NULL,p_parent_job_id UUID DEFAULT NULL)
RETURNS TABLE(job_id UUID,message_id UUID,audit_event_id TEXT) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE reg "JobTypeRegistry"%ROWTYPE; parent "BackgroundJob"%ROWTYPE; parent_reg "JobTypeRegistry"%ROWTYPE; root_reg "JobTypeRegistry"%ROWTYPE; policy "JobOperationalPolicy"%ROWTYPE; control "JobRuntimeContextKey"%ROWTYPE; j UUID:=gen_random_uuid(); m UUID:=gen_random_uuid(); origin UUID; d INTEGER; ancestry TEXT; input_digest TEXT; audit_id TEXT; scope JSONB; scope_count INTEGER; scope_kind_count INTEGER; transaction_count INTEGER; bytes INTEGER; expected_child_key TEXT; BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_producer','producer',job_operation_digest_v1('enqueue',jsonb_build_object('jobType',p_job_type,'schemaVersion',p_schema_version,'safePayload',p_safe_payload,'priority',p_priority,'availableAt',p_available_at,'deduplicationKey',p_deduplication_key,'scopeRefs',p_scope_refs,'serverCorrelationId',p_server_correlation_id,'causationId',p_causation_id,'parentJobId',p_parent_job_id)));
  SELECT * INTO control FROM "JobRuntimeContextKey" WHERE "keyId"=current_setting('tyre.jobs.context_key_id',true) AND purpose='producer' AND "runtimeLogin"=session_user;
  SELECT * INTO policy FROM job_current_policy_v2();
  IF NOT FOUND OR control."principalId" IS NULL THEN RAISE EXCEPTION 'JOB_OPERATIONAL_POLICY_REQUIRED'; END IF;
  SELECT * INTO reg FROM "JobTypeRegistry" WHERE "jobType"=p_job_type AND "schemaVersion"=p_schema_version AND published AND "enqueueEnabled" FOR SHARE;
  IF NOT FOUND OR reg."producerId"<>control."principalId" OR reg."producerAction"<>'enqueue' OR reg."requiredScopeKinds" IS NULL THEN RAISE EXCEPTION 'JOB_PRODUCER_CAPABILITY_DENIED'; END IF;
  IF NOT job_safe_payload_valid_v1(p_safe_payload,reg."safeFieldSchema") OR jsonb_typeof(p_scope_refs)<>'array' THEN RAISE EXCEPTION 'JOB_SAFE_SCHEMA_INVALID'; END IF;
  SELECT count(*),count(DISTINCT s->>'dimension') INTO scope_count,scope_kind_count FROM jsonb_array_elements(p_scope_refs) s;
  IF p_scope_refs IS DISTINCT FROM COALESCE((SELECT jsonb_agg(s ORDER BY s->>'dimension',s->>'id') FROM jsonb_array_elements(p_scope_refs) s),'[]'::jsonb) OR
     EXISTS(SELECT 1 FROM jsonb_array_elements(p_scope_refs) s WHERE jsonb_typeof(s)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(s))<>2 OR NOT (s ?& ARRAY['dimension','id']) OR NOT (s->>'dimension'=ANY(reg."requiredScopeKinds")) OR COALESCE(s->>'id','')='' OR octet_length(s->>'id')>128) OR
     scope_count<reg."minScopeRefCount" OR scope_count>reg."maxScopeRefCount" OR
     (reg."authorizationScopeKind"='global_operations' AND scope_count<>0) OR
     (reg."authorizationScopeKind"='resource_scoped' AND scope_count=0) OR
     (reg."authorizationScopeKind"='cross_scope' AND (reg."scopeMatchMode"<>'all' OR scope_count=0 OR scope_kind_count<>cardinality(reg."requiredScopeKinds") OR scope_count<>cardinality(reg."requiredScopeKinds"))) OR
     reg."authorizationScopeKind"='legacy_restricted' THEN RAISE EXCEPTION 'JOB_SCOPE_INVALID'; END IF;
  bytes:=octet_length(p_safe_payload::TEXT); IF bytes>reg."maxPayloadBytes" THEN RAISE EXCEPTION 'JOB_PAYLOAD_LIMIT'; END IF;
  input_digest:=rtrim(translate(encode(digest(convert_to('tyre.ge/job-input/v1'||p_safe_payload::TEXT,'UTF8'),'sha256'),'base64'),'+/','-_'),'=');
  IF p_parent_job_id IS NULL THEN
    origin:=j; d:=0; root_reg:=reg; ancestry:=rtrim(translate(encode(digest(convert_to('tyre.ge/job-ancestry/v1'||j::TEXT,'UTF8'),'sha256'),'base64'),'+/','-_'),'=');
    INSERT INTO "JobOriginBudget"("originJobId","rowCount","derivedBytes","auditFactCount","rootJobType","rootRegistryDigest","maxRows","maxDerivedBytes","maxFacts","maxAudits","maxAttemptsPerJob","maxHeartbeatsPerJob","maxReconciliationsPerJob","maxFenceLossPerMinute","maxAttemptsPerMinute","maxHeartbeatsPerMinute","maxReconciliationsPerMinute","maxFactsPerMinute","maxAuditsPerMinute")
    VALUES(origin,0,0,0,reg."jobType",reg."registryDigest",reg."maxOriginRows",reg."maxDerivedBytes",policy."maxFactsPerOrigin",LEAST(reg."maxAuditFacts",policy."maxAuditsPerOrigin"),LEAST(reg."maxAttempts",policy."maxAttemptsPerJob"),policy."maxHeartbeatsPerJob",policy."maxReconciliationsPerJob",policy."maxFenceLossPerMinute",policy."maxAttemptsPerMinute",policy."maxHeartbeatsPerMinute",policy."maxReconciliationsPerMinute",policy."maxFactsPerMinute",policy."maxAuditsPerMinute");
  ELSE
    SELECT * INTO parent FROM "BackgroundJob" WHERE id=p_parent_job_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_ANCESTRY_INVALID'; END IF;
    SELECT * INTO parent_reg FROM "JobTypeRegistry" WHERE ("jobType","schemaVersion","registryDigest")=(parent."jobType",parent."schemaVersion",parent."registryDigest");
    SELECT r.* INTO root_reg FROM "JobOriginBudget" b JOIN "JobTypeRegistry" r ON r."jobType"=b."rootJobType" AND r."registryDigest"=b."rootRegistryDigest" WHERE b."originJobId"=parent."originJobId" FOR UPDATE OF b;
    IF NOT FOUND OR NOT reg."jobType"=ANY(parent_reg."allowedChildJobTypes") OR NOT reg."ownerDomain"=ANY(parent_reg."allowedChildOwnerDomains") OR parent_reg."producerId"<>control."principalId" THEN RAISE EXCEPTION 'JOB_CHILD_CAPABILITY_DENIED'; END IF;
    origin:=parent."originJobId"; d:=parent.depth+1;
    IF d>root_reg."maxDepth" OR (SELECT count(*) FROM "BackgroundJob" WHERE "parentJobId"=parent.id)>=parent_reg."maxChildFanout" THEN RAISE EXCEPTION 'JOB_FANOUT_OR_DEPTH_EXCEEDED'; END IF;
    expected_child_key:=rtrim(translate(encode(digest(convert_to('tyre.jobs.child.v1'||chr(10)||parent.id::TEXT||chr(10)||reg."jobType"||chr(10)||reg."schemaVersion"::TEXT||chr(10)||input_digest,'UTF8'),'sha256'),'base64'),'+/','-_'),'=');
    IF p_deduplication_key<>expected_child_key THEN RAISE EXCEPTION 'JOB_CHILD_DEDUP_INVALID'; END IF;
    ancestry:=rtrim(translate(encode(digest(convert_to('tyre.ge/job-ancestry/v1'||origin::TEXT||':'||p_parent_job_id::TEXT||':'||j::TEXT,'UTF8'),'sha256'),'base64'),'+/','-_'),'=');
  END IF;
  INSERT INTO "JobTransactionBudget" VALUES(txid_current(),origin,1) ON CONFLICT("transactionId","originJobId") DO UPDATE SET "rowCount"="JobTransactionBudget"."rowCount"+1 RETURNING "rowCount" INTO transaction_count;
  IF transaction_count>root_reg."maxTransactionRows" THEN RAISE EXCEPTION 'JOB_TRANSACTION_BUDGET_EXCEEDED'; END IF;
  audit_id:=job_write_audit_v1(j,'jobs.enqueue','succeeded',NULL,p_server_correlation_id,p_causation_id);
  INSERT INTO "OutboxMessage"("id","jobType","schemaVersion","registryDigest","ownerDomain","producerId","consumerId","inputDigest","safePayload","idempotencyNamespace","deduplicationKey","originJobId","parentJobId","depth","ancestryDigest","authorizationScopeKind","scopeMatchMode","requiredGlobalGrant","scopeResolverId","scopeResolverVersion","authorizationPolicyVersion","serverCorrelationId","causationId","originatingAuditEventId") VALUES(m,reg."jobType",reg."schemaVersion",reg."registryDigest",reg."ownerDomain",reg."producerId",reg."consumerId",input_digest,p_safe_payload,reg."ownerDomain"||':'||reg."jobType",p_deduplication_key,origin,p_parent_job_id,d,ancestry,reg."authorizationScopeKind",reg."scopeMatchMode",reg."requiredGlobalGrant",reg."scopeResolverId",reg."scopeResolverVersion",reg."authorizationPolicyVersion",p_server_correlation_id,p_causation_id,audit_id);
  INSERT INTO "BackgroundJob"("id","outboxMessageId","jobType","schemaVersion","registryDigest","ownerDomain","safeSummary","inputDigest","originJobId","parentJobId","depth","ancestryDigest","authorizationScopeKind","scopeMatchMode","requiredGlobalGrant","scopeResolverId","scopeResolverVersion","authorizationPolicyVersion","priority","availableAt","serverCorrelationId","causationId","originatingAuditEventId") VALUES(j,m,reg."jobType",reg."schemaVersion",reg."registryDigest",reg."ownerDomain",p_safe_payload,input_digest,origin,p_parent_job_id,d,ancestry,reg."authorizationScopeKind",reg."scopeMatchMode",reg."requiredGlobalGrant",reg."scopeResolverId",reg."scopeResolverVersion",reg."authorizationPolicyVersion",p_priority,p_available_at,p_server_correlation_id,p_causation_id,audit_id);
  FOR scope IN SELECT value FROM jsonb_array_elements(p_scope_refs) LOOP INSERT INTO "JobAuthorizationScopeRef" VALUES(j,scope->>'dimension',scope->>'id',(SELECT count(*) FROM "JobAuthorizationScopeRef" WHERE "jobId"=j)); END LOOP;
  PERFORM job_reserve_origin_budget_v2(j,4+scope_count,bytes,3+scope_count,1,0,0,0,0);
  INSERT INTO "JobAuditLink" VALUES(j,audit_id,'enqueue',clock_timestamp());
  RETURN QUERY SELECT j,m,audit_id;
END $$;

CREATE OR REPLACE FUNCTION authorized_job_v1(p_viewer_id TEXT,p_session_id TEXT)
RETURNS SETOF "BackgroundJob" LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public SET row_security=on AS $$ BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_reader','reader',job_operation_digest_v1('authorized_job',jsonb_build_object('viewerId',p_viewer_id,'sessionId',p_session_id)));
  IF current_setting('tyre.jobs.viewer_id',true) IS DISTINCT FROM p_viewer_id OR current_setting('tyre.jobs.session_id',true) IS DISTINCT FROM p_session_id THEN RETURN; END IF;
  RETURN QUERY SELECT j.* FROM "BackgroundJob" j JOIN "JobTypeRegistry" reg ON (reg."jobType",reg."schemaVersion",reg."registryDigest")=(j."jobType",j."schemaVersion",j."registryDigest")
  WHERE EXISTS(SELECT 1 FROM "Admin" a JOIN "StaffSession" s ON s."staffUserId"=a.id JOIN "SecurityControl" sc ON sc.id=1 WHERE a.id=p_viewer_id AND s.id=p_session_id AND a.enabled AND a.status='active' AND s."revokedAt" IS NULL AND s."idleExpiresAt">clock_timestamp() AND s."absoluteExpiresAt">clock_timestamp() AND s."tokenVersionSnapshot"=a."tokenVersion" AND s."authContractVersion">=sc."minimumAuthContractVersion")
    AND reg."requiredScopeKinds" IS NOT NULL AND j."authorizationScopeKind"<>'legacy_restricted'
    AND CASE
      WHEN j."authorizationScopeKind"='global_operations' THEN j."scopeMatchMode"='all' AND reg."minScopeRefCount"=0 AND NOT EXISTS(SELECT 1 FROM "JobAuthorizationScopeRef" s WHERE s."jobId"=j.id) AND
        EXISTS(SELECT 1 FROM "AdminRoleAssignment" ar JOIN "RolePermission" rp ON rp."roleId"=ar."roleId" JOIN "Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=p_viewer_id AND ar."scopeType"='global' AND ar."scopeId"='' AND p.key='jobs.read') AND
        EXISTS(SELECT 1 FROM "AdminRoleAssignment" ar JOIN "RolePermission" rp ON rp."roleId"=ar."roleId" JOIN "Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=p_viewer_id AND ar."scopeType"='global' AND ar."scopeId"='' AND p.key=j."requiredGlobalGrant")
      WHEN j."authorizationScopeKind"='resource_scoped' THEN
        (SELECT count(*) FROM "JobAuthorizationScopeRef" s WHERE s."jobId"=j.id) BETWEEN reg."minScopeRefCount" AND reg."maxScopeRefCount" AND
        NOT EXISTS(SELECT 1 FROM "JobAuthorizationScopeRef" s WHERE s."jobId"=j.id AND NOT s.dimension=ANY(reg."requiredScopeKinds")) AND
        ((j."scopeMatchMode"='all' AND NOT EXISTS(SELECT 1 FROM "JobAuthorizationScopeRef" s WHERE s."jobId"=j.id AND NOT EXISTS(SELECT 1 FROM "AdminRoleAssignment" ar JOIN "RolePermission" rp ON rp."roleId"=ar."roleId" JOIN "Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=p_viewer_id AND p.key='jobs.read' AND ar."scopeType"::TEXT=s.dimension AND ar."scopeId"=s."scopeId"))) OR
         (j."scopeMatchMode"='any' AND reg."allowAnyResourceScope" AND EXISTS(SELECT 1 FROM "JobAuthorizationScopeRef" s JOIN "AdminRoleAssignment" ar ON ar."adminId"=p_viewer_id AND ar."scopeType"::TEXT=s.dimension AND ar."scopeId"=s."scopeId" JOIN "RolePermission" rp ON rp."roleId"=ar."roleId" JOIN "Permission" p ON p.id=rp."permissionId" AND p.key='jobs.read' WHERE s."jobId"=j.id)) OR
         (reg."allowGlobalReader" AND EXISTS(SELECT 1 FROM "AdminRoleAssignment" ar JOIN "RolePermission" rp ON rp."roleId"=ar."roleId" JOIN "Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=p_viewer_id AND ar."scopeType"='global' AND ar."scopeId"='' AND p.key='jobs.read')))
      WHEN j."authorizationScopeKind"='cross_scope' THEN j."scopeMatchMode"='all' AND ((
        (SELECT count(*) FROM "JobAuthorizationScopeRef" s WHERE s."jobId"=j.id)=cardinality(reg."requiredScopeKinds") AND
        (SELECT count(DISTINCT s.dimension) FROM "JobAuthorizationScopeRef" s WHERE s."jobId"=j.id)=cardinality(reg."requiredScopeKinds") AND
        NOT EXISTS(SELECT 1 FROM "JobAuthorizationScopeRef" s WHERE s."jobId"=j.id AND NOT s.dimension=ANY(reg."requiredScopeKinds")) AND
        NOT EXISTS(SELECT 1 FROM "JobAuthorizationScopeRef" s WHERE s."jobId"=j.id AND NOT EXISTS(SELECT 1 FROM "AdminRoleAssignment" ar JOIN "RolePermission" rp ON rp."roleId"=ar."roleId" JOIN "Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=p_viewer_id AND p.key='jobs.read' AND ar."scopeType"::TEXT=s.dimension AND ar."scopeId"=s."scopeId") )) OR (
        EXISTS(SELECT 1 FROM "AdminRoleAssignment" ar JOIN "RolePermission" rp ON rp."roleId"=ar."roleId" JOIN "Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=p_viewer_id AND ar."scopeType"='global' AND ar."scopeId"='' AND p.key='jobs.read') AND
        EXISTS(SELECT 1 FROM "AdminRoleAssignment" ar JOIN "RolePermission" rp ON rp."roleId"=ar."roleId" JOIN "Permission" p ON p.id=rp."permissionId" WHERE ar."adminId"=p_viewer_id AND ar."scopeType"='global' AND ar."scopeId"='' AND p.key=j."requiredGlobalGrant")))
      ELSE false END;
END $$;

CREATE OR REPLACE FUNCTION job_claim_v1()
RETURNS TABLE(job_id UUID,attempt_started_id UUID,lease_generation INTEGER,lease_secret TEXT,lease_expires_at TIMESTAMPTZ,duplicate_receipt BOOLEAN) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE job "BackgroundJob"%ROWTYPE; reg "JobTypeRegistry"%ROWTYPE; budget "JobOriginBudget"%ROWTYPE; msg "OutboxMessage"%ROWTYPE; key "JobLeaseDigestKey"%ROWTYPE; attempt UUID:=gen_random_uuid(); secret BYTEA; audit_id TEXT; existing "OutboxConsumerReceipt"%ROWTYPE; attempt_count INTEGER; BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_claimer','claimer',job_operation_digest_v1('claim','{}'::jsonb));
  SELECT j.* INTO job FROM "BackgroundJob" j JOIN "JobTypeRegistry" r ON (r."jobType",r."schemaVersion",r."registryDigest")=(j."jobType",j."schemaVersion",j."registryDigest") JOIN "JobOriginBudget" b ON b."originJobId"=j."originJobId" WHERE j.state='queued' AND j."availableAt"<=clock_timestamp() AND r."handlerEnabled" AND NOT r."externalEffectCapable" AND b."maxAttemptsPerJob" IS NOT NULL ORDER BY j.priority DESC,j."availableAt",j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO reg FROM "JobTypeRegistry" WHERE ("jobType","schemaVersion","registryDigest")=(job."jobType",job."schemaVersion",job."registryDigest"); SELECT * INTO budget FROM "JobOriginBudget" WHERE "originJobId"=job."originJobId" FOR UPDATE; SELECT count(*) INTO attempt_count FROM "JobAttemptStarted" WHERE "jobId"=job.id;
  SELECT * INTO msg FROM "OutboxMessage" WHERE id=job."outboxMessageId";
  IF msg."consumerId" IS NOT NULL THEN SELECT * INTO existing FROM "OutboxConsumerReceipt" WHERE "consumerId"=msg."consumerId" AND "messageId"=msg.id FOR UPDATE; IF FOUND THEN IF existing."inputDigest"<>msg."inputDigest" THEN RAISE EXCEPTION 'CONSUMER_RECEIPT_DIGEST_CONFLICT'; END IF; RETURN QUERY SELECT job.id,existing."attemptStartedId",existing."leaseGeneration",NULL::TEXT,NULL::TIMESTAMPTZ,true; RETURN; END IF; END IF;
  IF attempt_count>=LEAST(reg."maxAttempts",budget."maxAttemptsPerJob") THEN
    SELECT id INTO attempt FROM "JobAttemptStarted" WHERE "jobId"=job.id ORDER BY "leaseGeneration" DESC LIMIT 1;
    IF attempt IS NULL THEN RAISE EXCEPTION 'JOB_ATTEMPT_EVIDENCE_INVALID'; END IF;
    PERFORM job_reserve_origin_budget_v2(job.id,3,0,2,1,0,0,0,0); audit_id:=job_write_audit_v1(job.id,'jobs.quarantine','succeeded','ATTEMPT_LIMIT',job."serverCorrelationId",job."causationId");
    UPDATE "BackgroundJob" SET state='dead_lettered',"leaseSecretDigest"=NULL,"leaseDigestKeyId"=NULL,"leaseExpiresAt"=NULL WHERE id=job.id AND state='queued';
    INSERT INTO "DeadLetterAdmission"("jobId","attemptStartedId","safeReasonCode","originatingAuditEventId") VALUES(job.id,attempt,'ATTEMPT_LIMIT',audit_id); INSERT INTO "JobAuditLink" VALUES(job.id,audit_id,'quarantine',clock_timestamp()); RETURN;
  END IF;
  SELECT * INTO key FROM "JobLeaseDigestKey" k WHERE k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp()+make_interval(secs=>reg."leaseSeconds") AND NOT EXISTS(SELECT 1 FROM "JobLeaseDigestKeyRevocation" r WHERE r."keyId"=k."keyId") ORDER BY k."notBefore" DESC LIMIT 1 FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_LEASE_KEY_UNAVAILABLE'; END IF;
  PERFORM job_reserve_origin_budget_v2(job.id,3+CASE WHEN msg."consumerId" IS NULL THEN 0 ELSE 1 END,0,2+CASE WHEN msg."consumerId" IS NULL THEN 0 ELSE 1 END,1,1,0,0,0);
  secret:=gen_random_bytes(32); audit_id:=job_write_audit_v1(job.id,'jobs.claim','succeeded',NULL,job."serverCorrelationId",job."causationId");
  UPDATE "BackgroundJob" SET state='processing',"leaseGeneration"="leaseGeneration"+1,"leaseSecretDigest"=hmac(convert_to('tyre.ge/job-lease/v1','UTF8')||secret,key."keyMaterial",'sha256'),"leaseDigestKeyId"=key."keyId","leaseExpiresAt"=clock_timestamp()+make_interval(secs=>reg."leaseSeconds") WHERE id=job.id;
  SELECT * INTO job FROM "BackgroundJob" WHERE id=job.id; INSERT INTO "JobAttemptStarted" VALUES(attempt,job.id,job."leaseGeneration",false,job."serverCorrelationId",job."causationId",audit_id,clock_timestamp());
  IF msg."consumerId" IS NOT NULL THEN INSERT INTO "OutboxConsumerReceipt"("consumerId","messageId","inputDigest","attemptStartedId","leaseGeneration","handlerId","schemaVersion","idempotencyNamespace","originatingAuditEventId") VALUES(msg."consumerId",msg.id,msg."inputDigest",attempt,job."leaseGeneration",job."jobType",job."schemaVersion",msg."idempotencyNamespace",audit_id); END IF;
  INSERT INTO "JobAuditLink" VALUES(job.id,audit_id,'claim',clock_timestamp()); RETURN QUERY SELECT job.id,attempt,job."leaseGeneration",encode(secret,'base64'),job."leaseExpiresAt",false;
END $$;

CREATE OR REPLACE FUNCTION job_reclaim_v1()
RETURNS TABLE(job_id UUID,attempt_started_id UUID,lease_generation INTEGER,lease_secret TEXT,lease_expires_at TIMESTAMPTZ) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE job "BackgroundJob"%ROWTYPE; reg "JobTypeRegistry"%ROWTYPE; budget "JobOriginBudget"%ROWTYPE; key "JobLeaseDigestKey"%ROWTYPE; attempt UUID:=gen_random_uuid(); secret BYTEA; audit_id TEXT; attempt_count INTEGER; BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_claimer','claimer',job_operation_digest_v1('reclaim','{}'::jsonb));
  SELECT j.* INTO job FROM "BackgroundJob" j JOIN "JobTypeRegistry" r ON (r."jobType",r."schemaVersion",r."registryDigest")=(j."jobType",j."schemaVersion",j."registryDigest") JOIN "JobOriginBudget" b ON b."originJobId"=j."originJobId" WHERE j.state='processing' AND j."leaseExpiresAt"<=clock_timestamp() AND r."handlerEnabled" AND r.reclaimable AND NOT r."externalEffectCapable" AND b."maxAttemptsPerJob" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "JobAttemptOutcome" o JOIN "JobAttemptStarted" a ON a.id=o."attemptStartedId" WHERE a."jobId"=j.id AND a."leaseGeneration"=j."leaseGeneration") AND NOT EXISTS(SELECT 1 FROM "OutboxConsumerReceipt" cr LEFT JOIN "ConsumerReceiptResult" rr ON rr."receiptId"=cr.id WHERE cr."messageId"=j."outboxMessageId" AND rr.id IS NULL) ORDER BY j."leaseExpiresAt",j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO reg FROM "JobTypeRegistry" WHERE ("jobType","schemaVersion","registryDigest")=(job."jobType",job."schemaVersion",job."registryDigest"); SELECT * INTO budget FROM "JobOriginBudget" WHERE "originJobId"=job."originJobId" FOR UPDATE; SELECT count(*) INTO attempt_count FROM "JobAttemptStarted" WHERE "jobId"=job.id;
  IF attempt_count>=LEAST(reg."maxAttempts",budget."maxAttemptsPerJob") THEN
    SELECT id INTO attempt FROM "JobAttemptStarted" WHERE "jobId"=job.id AND "leaseGeneration"=job."leaseGeneration";
    PERFORM job_reserve_origin_budget_v2(job.id,5,0,4,1,0,0,0,0); audit_id:=job_write_audit_v1(job.id,'jobs.quarantine','succeeded','ATTEMPT_LIMIT',job."serverCorrelationId",job."causationId");
    UPDATE "BackgroundJob" SET state='dead_lettered',"leaseSecretDigest"=NULL,"leaseDigestKeyId"=NULL,"leaseExpiresAt"=NULL WHERE id=job.id AND state='processing' AND "leaseGeneration"=job."leaseGeneration" AND "leaseExpiresAt"<=clock_timestamp(); IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF;
    INSERT INTO "JobAttemptOutcome"("attemptStartedId","terminalKind","safeReasonCode","originatingAuditEventId") VALUES(attempt,'dead_lettered','ATTEMPT_LIMIT',audit_id);
    INSERT INTO "OutboxAcknowledgement"("messageId","attemptStartedId","terminalKind","originatingAuditEventId") VALUES(job."outboxMessageId",attempt,'dead_lettered',audit_id);
    INSERT INTO "DeadLetterAdmission"("jobId","attemptStartedId","safeReasonCode","originatingAuditEventId") VALUES(job.id,attempt,'ATTEMPT_LIMIT',audit_id); INSERT INTO "JobAuditLink" VALUES(job.id,audit_id,'quarantine',clock_timestamp()); RETURN;
  END IF;
  SELECT * INTO key FROM "JobLeaseDigestKey" k WHERE k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp()+make_interval(secs=>reg."leaseSeconds") AND NOT EXISTS(SELECT 1 FROM "JobLeaseDigestKeyRevocation" r WHERE r."keyId"=k."keyId") ORDER BY k."notBefore" DESC LIMIT 1 FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_LEASE_KEY_UNAVAILABLE'; END IF;
  PERFORM job_reserve_origin_budget_v2(job.id,3,0,2,1,1,0,0,0); secret:=gen_random_bytes(32); audit_id:=job_write_audit_v1(job.id,'jobs.reclaim','succeeded',NULL,job."serverCorrelationId",job."causationId");
  UPDATE "BackgroundJob" SET "leaseGeneration"="leaseGeneration"+1,"leaseSecretDigest"=hmac(convert_to('tyre.ge/job-lease/v1','UTF8')||secret,key."keyMaterial",'sha256'),"leaseDigestKeyId"=key."keyId","leaseExpiresAt"=clock_timestamp()+make_interval(secs=>reg."leaseSeconds") WHERE id=job.id AND state='processing' AND "leaseGeneration"=job."leaseGeneration" AND "leaseExpiresAt"<=clock_timestamp(); IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF;
  SELECT * INTO job FROM "BackgroundJob" WHERE id=job.id; INSERT INTO "JobAttemptStarted" VALUES(attempt,job.id,job."leaseGeneration",true,job."serverCorrelationId",job."causationId",audit_id,clock_timestamp()); INSERT INTO "JobAuditLink" VALUES(job.id,audit_id,'reclaim',clock_timestamp()); RETURN QUERY SELECT job.id,attempt,job."leaseGeneration",encode(secret,'base64'),job."leaseExpiresAt";
END $$;

CREATE OR REPLACE FUNCTION job_heartbeat_v1(p_job_id UUID,p_generation INTEGER,p_secret TEXT) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE old_exp TIMESTAMPTZ; new_exp TIMESTAMPTZ; attempt UUID; audit_id TEXT; reg "JobTypeRegistry"%ROWTYPE; job "BackgroundJob"%ROWTYPE; b "JobOriginBudget"%ROWTYPE; BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_claimer','claimer',job_operation_digest_v1('heartbeat',jsonb_build_object('jobId',p_job_id,'generation',p_generation,'leaseProofDigest',encode(digest(convert_to(p_secret,'UTF8'),'sha256'),'hex'))));
  SELECT * INTO job FROM "BackgroundJob" WHERE id=p_job_id FOR UPDATE; IF NOT job_fence_match_v1(p_job_id,p_generation,p_secret) THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF;
  SELECT * INTO b FROM "JobOriginBudget" WHERE "originJobId"=job."originJobId" FOR UPDATE;
  IF (SELECT count(*) FROM "JobHeartbeatFact" h JOIN "JobAttemptStarted" a ON a.id=h."attemptStartedId" WHERE a."jobId"=p_job_id)>=b."maxHeartbeatsPerJob" THEN RAISE EXCEPTION 'JOB_HEARTBEAT_LIMIT'; END IF;
  PERFORM job_reserve_origin_budget_v2(p_job_id,3,0,2,1,0,1,0,0);
  SELECT * INTO reg FROM "JobTypeRegistry" WHERE ("jobType","schemaVersion","registryDigest")=(job."jobType",job."schemaVersion",job."registryDigest"); old_exp:=job."leaseExpiresAt"; new_exp:=clock_timestamp()+make_interval(secs=>reg."leaseSeconds"); SELECT id INTO attempt FROM "JobAttemptStarted" WHERE "jobId"=p_job_id AND "leaseGeneration"=p_generation;
  audit_id:=job_write_audit_v1(p_job_id,'jobs.heartbeat','succeeded',NULL,job."serverCorrelationId",job."causationId");
  UPDATE "BackgroundJob" SET "leaseExpiresAt"=new_exp WHERE id=p_job_id AND job_fence_match_v1(p_job_id,p_generation,p_secret); IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF;
  INSERT INTO "JobHeartbeatFact"("attemptStartedId","leaseGeneration","previousLeaseExpiresAt","leaseExpiresAt","originatingAuditEventId") VALUES(attempt,p_generation,old_exp,new_exp,audit_id); INSERT INTO "JobAuditLink" VALUES(p_job_id,audit_id,'heartbeat',clock_timestamp()); RETURN new_exp;
END $$;

CREATE OR REPLACE FUNCTION job_finish_v1(p_job_id UUID,p_generation INTEGER,p_secret TEXT,p_terminal_kind TEXT,p_safe_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE attempt UUID; audit_id TEXT; operation TEXT; job "BackgroundJob"%ROWTYPE; receipt UUID; row_delta INTEGER; BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_claimer','claimer',job_operation_digest_v1('finish',jsonb_build_object('jobId',p_job_id,'generation',p_generation,'leaseProofDigest',encode(digest(convert_to(p_secret,'UTF8'),'sha256'),'hex'),'terminalKind',p_terminal_kind,'safeReason',p_safe_reason)));
  IF p_terminal_kind NOT IN ('succeeded','known_safe_failure','external_outcome_unknown','dead_lettered','cancelled_before_effect') THEN RAISE EXCEPTION 'JOB_TERMINAL_KIND_INVALID'; END IF;
  SELECT * INTO job FROM "BackgroundJob" WHERE id=p_job_id FOR UPDATE; IF NOT job_fence_match_v1(p_job_id,p_generation,p_secret) THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF; SELECT id INTO attempt FROM "JobAttemptStarted" WHERE "jobId"=p_job_id AND "leaseGeneration"=p_generation;
  SELECT id INTO receipt FROM "OutboxConsumerReceipt" WHERE "attemptStartedId"=attempt;
  row_delta:=4+CASE WHEN receipt IS NULL THEN 0 ELSE 1 END+CASE WHEN p_terminal_kind IN ('external_outcome_unknown','dead_lettered') THEN 1 ELSE 0 END;
  PERFORM job_reserve_origin_budget_v2(p_job_id,row_delta,COALESCE(octet_length(p_safe_reason),0),row_delta-1,1,0,0,0,0);
  operation:=CASE p_terminal_kind WHEN 'known_safe_failure' THEN 'jobs.known_safe_fail' WHEN 'external_outcome_unknown' THEN 'jobs.quarantine' WHEN 'dead_lettered' THEN 'jobs.quarantine' ELSE 'jobs.finalize' END; audit_id:=job_write_audit_v1(p_job_id,operation,'succeeded',p_safe_reason,job."serverCorrelationId",job."causationId");
  UPDATE "BackgroundJob" SET state=p_terminal_kind,"leaseSecretDigest"=CASE WHEN p_terminal_kind='external_outcome_unknown' THEN "leaseSecretDigest" ELSE NULL END,"leaseDigestKeyId"=CASE WHEN p_terminal_kind='external_outcome_unknown' THEN "leaseDigestKeyId" ELSE NULL END,"leaseExpiresAt"=CASE WHEN p_terminal_kind='external_outcome_unknown' THEN "leaseExpiresAt" ELSE NULL END WHERE id=p_job_id AND job_fence_match_v1(p_job_id,p_generation,p_secret); IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF;
  INSERT INTO "JobAttemptOutcome"("attemptStartedId","terminalKind","safeReasonCode","originatingAuditEventId") VALUES(attempt,p_terminal_kind,p_safe_reason,audit_id);
  IF receipt IS NOT NULL THEN INSERT INTO "ConsumerReceiptResult"("receiptId","terminalKind","safeResult","originatingAuditEventId") VALUES(receipt,p_terminal_kind,NULL,audit_id); END IF;
  INSERT INTO "OutboxAcknowledgement"("messageId","attemptStartedId","terminalKind","originatingAuditEventId") VALUES(job."outboxMessageId",attempt,p_terminal_kind,audit_id);
  IF p_terminal_kind IN ('external_outcome_unknown','dead_lettered') THEN INSERT INTO "DeadLetterAdmission"("jobId","attemptStartedId","safeReasonCode","originatingAuditEventId") VALUES(p_job_id,attempt,COALESCE(p_safe_reason,upper(p_terminal_kind)),audit_id); END IF;
  INSERT INTO "JobAuditLink" VALUES(p_job_id,audit_id,operation,clock_timestamp());
END $$;

CREATE OR REPLACE FUNCTION job_reconcile_v1(p_job_id UUID,p_generation INTEGER,p_secret TEXT,p_state TEXT,p_safe_reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE job "BackgroundJob"%ROWTYPE; audit_id TEXT; b "JobOriginBudget"%ROWTYPE; BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_claimer','claimer',job_operation_digest_v1('reconcile',jsonb_build_object('jobId',p_job_id,'generation',p_generation,'leaseProofDigest',encode(digest(convert_to(p_secret,'UTF8'),'sha256'),'hex'),'state',p_state,'safeReason',p_safe_reason)));
  IF p_state NOT IN ('reconciling','reconciled_applied','reconciled_not_applied') THEN RAISE EXCEPTION 'JOB_RECONCILIATION_STATE_INVALID'; END IF;
  SELECT j INTO job FROM "BackgroundJob" j JOIN "JobLeaseDigestKey" k ON k."keyId"=j."leaseDigestKeyId" WHERE j.id=p_job_id AND j.state IN ('external_outcome_unknown','reconciling') AND j."leaseGeneration"=p_generation AND j."leaseExpiresAt">clock_timestamp() AND j."leaseSecretDigest"=hmac(convert_to('tyre.ge/job-lease/v1','UTF8')||decode(p_secret,'base64'),k."keyMaterial",'sha256') FOR UPDATE OF j; IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF;
  SELECT * INTO b FROM "JobOriginBudget" WHERE "originJobId"=job."originJobId" FOR UPDATE;
  IF (SELECT count(*) FROM "JobReconciliation" WHERE "jobId"=p_job_id)>=b."maxReconciliationsPerJob" THEN RAISE EXCEPTION 'JOB_RECONCILIATION_LIMIT'; END IF;
  PERFORM job_reserve_origin_budget_v2(p_job_id,3,COALESCE(octet_length(p_safe_reason),0),2,1,0,0,1,0);
  audit_id:=job_write_audit_v1(p_job_id,'jobs.reconcile','succeeded',p_safe_reason,job."serverCorrelationId",job."causationId");
  UPDATE "BackgroundJob" SET state=p_state,"leaseSecretDigest"=CASE WHEN p_state='reconciling' THEN "leaseSecretDigest" ELSE NULL END,"leaseDigestKeyId"=CASE WHEN p_state='reconciling' THEN "leaseDigestKeyId" ELSE NULL END,"leaseExpiresAt"=CASE WHEN p_state='reconciling' THEN "leaseExpiresAt" ELSE NULL END WHERE id=p_job_id AND state=job.state AND "leaseGeneration"=p_generation AND "leaseExpiresAt">clock_timestamp(); IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_FENCE_LOST'; END IF;
  INSERT INTO "JobReconciliation"("jobId",state,"safeReasonCode","originatingAuditEventId") VALUES(p_job_id,p_state,p_safe_reason,audit_id); INSERT INTO "JobAuditLink" VALUES(p_job_id,audit_id,'reconcile',clock_timestamp());
END $$;

CREATE OR REPLACE FUNCTION record_job_fence_loss(p_attempt_started_id UUID,p_generation INTEGER,p_operation TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE a "JobAttemptStarted"%ROWTYPE; j "BackgroundJob"%ROWTYPE; b "JobOriginBudget"%ROWTYPE; audit_id TEXT; recent INTEGER; BEGIN
  PERFORM job_assert_runtime_v1('tyre_jobs_claimer','claimer',job_operation_digest_v1('fence_loss',jsonb_build_object('attemptStartedId',p_attempt_started_id,'generation',p_generation,'operation',p_operation)));
  IF p_operation NOT IN ('heartbeat','finalize','known_safe_fail','quarantine','reconcile') THEN RAISE EXCEPTION 'JOB_FENCE_OPERATION_INVALID'; END IF;
  SELECT * INTO a FROM "JobAttemptStarted" WHERE id=p_attempt_started_id AND "leaseGeneration"=p_generation; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_ATTEMPT_INVALID'; END IF;
  SELECT * INTO j FROM "BackgroundJob" WHERE id=a."jobId"; SELECT * INTO b FROM "JobOriginBudget" WHERE "originJobId"=j."originJobId" FOR UPDATE;
  IF EXISTS(SELECT 1 FROM "JobFenceLossAudit" WHERE "attemptStartedId"=p_attempt_started_id AND "leaseGeneration"=p_generation AND operation=p_operation) THEN RETURN false; END IF;
  SELECT count(*) INTO recent FROM "JobFenceLossAudit" f JOIN "JobAttemptStarted" fa ON fa.id=f."attemptStartedId" JOIN "BackgroundJob" fj ON fj.id=fa."jobId" WHERE fj."originJobId"=j."originJobId" AND f."createdAt">=clock_timestamp()-interval '1 minute';
  IF recent>=b."maxFenceLossPerMinute" THEN RETURN false; END IF;
  PERFORM job_reserve_origin_budget_v2(j.id,2,0,1,1,0,0,0,1);
  audit_id:=job_write_audit_v1(j.id,'jobs.fence_loss','denied','LEASE_FENCE_LOST',j."serverCorrelationId",j."causationId");
  INSERT INTO "JobFenceLossAudit"("attemptStartedId","leaseGeneration",operation,"auditEventId","createdAt","runtimeLogin") VALUES(p_attempt_started_id,p_generation,p_operation,audit_id,clock_timestamp(),session_user); RETURN true;
END $$;

CREATE TRIGGER "JobOperationalPolicy_append_only" BEFORE UPDATE OR DELETE ON "JobOperationalPolicy" FOR EACH ROW EXECUTE FUNCTION reject_job_immutable_mutation();

CREATE CONSTRAINT TRIGGER "BackgroundJob_scope_complete_v2" AFTER INSERT OR UPDATE ON "BackgroundJob"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_job_scope_complete_v2();
CREATE CONSTRAINT TRIGGER "JobAuthorizationScopeRef_complete_v2" AFTER INSERT OR UPDATE OR DELETE ON "JobAuthorizationScopeRef"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_job_scope_complete_v2();

CREATE OR REPLACE FUNCTION job_runtime_boundary_digest_v2(expected_group NAME) RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
WITH protected(name) AS (SELECT unnest(ARRAY[
  'JobTypeRegistry','OutboxMessage','BackgroundJob','JobAuthorizationScopeRef','JobOriginBudget','JobTransactionBudget',
  'JobAttemptStarted','JobHeartbeatFact','JobAttemptOutcome','OutboxConsumerReceipt','ConsumerReceiptResult',
  'OutboxAcknowledgement','DispatchFact','DeadLetterAdmission','JobReconciliation','JobAuditLink','JobFenceLossAudit',
  'JobLeaseDigestKey','JobLeaseDigestKeyRevocation','JobRuntimeContextKey','JobRuntimeContextKeyRevocation','JobOperationalPolicy','JobOriginRateBucket'])),
snapshot AS (
  SELECT 'role:'||r.rolname||':'||r.rolcanlogin||':'||r.rolinherit||':'||r.rolsuper||':'||r.rolcreaterole||':'||r.rolcreatedb||':'||r.rolreplication||':'||r.rolbypassrls value
  FROM pg_roles r WHERE r.rolname=ANY(ARRAY[session_user::TEXT,expected_group::TEXT,'tyre_jobs_guard_owner','tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance'])
  UNION ALL
  SELECT 'member:'||member.rolname||'>'||parent.rolname||':'||m.inherit_option||':'||m.set_option||':'||m.admin_option
  FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
  WHERE member.rolname=ANY(ARRAY[session_user::TEXT,'tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance']) OR parent.rolname LIKE 'tyre_jobs_%'
  UNION ALL
  SELECT 'table:'||c.relname||':'||owner.rolname||':'||COALESCE(c.relacl::TEXT,'NULL')
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles owner ON owner.oid=c.relowner JOIN protected p ON p.name=c.relname WHERE n.nspname='public'
  UNION ALL
  SELECT 'constraint:'||c.relname||':'||con.conname||':'||pg_get_constraintdef(con.oid,true)
  FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN protected p ON p.name=c.relname WHERE n.nspname='public'
  UNION ALL
  SELECT 'index:'||t.relname||':'||i.relname||':'||ix.indisvalid||':'||ix.indisready||':'||pg_get_indexdef(i.oid)
  FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN protected p ON p.name=t.relname WHERE n.nspname='public'
  UNION ALL
  SELECT 'trigger:'||c.relname||':'||t.tgname||':'||t.tgenabled::TEXT||':'||t.tgtype::TEXT||':'||t.tgfoid::regprocedure::TEXT||':'||pg_get_functiondef(t.tgfoid)
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN protected p ON p.name=c.relname WHERE n.nspname='public' AND NOT t.tgisinternal
  UNION ALL
  SELECT 'function:'||p.oid::regprocedure::TEXT||':'||owner.rolname||':'||p.prosecdef||':'||COALESCE(p.proconfig::TEXT,'NULL')||':'||COALESCE(p.proacl::TEXT,'NULL')||':'||pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner
  WHERE n.nspname='public' AND (p.proname LIKE 'job!_%' ESCAPE '!' OR p.proname IN ('record_job_fence_loss','reject_job_immutable_mutation','validate_job_registry_insert_v1','validate_job_scope_complete_v2','guard_background_job_projection_update'))
)
SELECT rtrim(translate(encode(digest(convert_to(expected_group::TEXT||chr(10)||string_agg(value,chr(10) ORDER BY value),'UTF8'),'sha256'),'base64'),'+/','-_'),'=') FROM snapshot
$$;

CREATE OR REPLACE FUNCTION job_runtime_boundary_valid_v2(expected_group NAME) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE protected_tables TEXT[]:=ARRAY[
  'JobTypeRegistry','OutboxMessage','BackgroundJob','JobAuthorizationScopeRef','JobOriginBudget','JobTransactionBudget',
  'JobAttemptStarted','JobHeartbeatFact','JobAttemptOutcome','OutboxConsumerReceipt','ConsumerReceiptResult',
  'OutboxAcknowledgement','DispatchFact','DeadLetterAdmission','JobReconciliation','JobAuditLink','JobFenceLossAudit',
  'JobLeaseDigestKey','JobLeaseDigestKeyRevocation','JobRuntimeContextKey','JobRuntimeContextKeyRevocation','JobOperationalPolicy','JobOriginRateBucket'];
BEGIN
  IF NOT job_runtime_membership_ok(expected_group) OR has_schema_privilege(session_user,'public','CREATE') THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=ANY(ARRAY['tyre_jobs_guard_owner','tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance']) AND
      CASE WHEN rolname='tyre_jobs_guard_owner' THEN rolcanlogin OR rolinherit OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
           ELSE rolcanlogin OR rolinherit OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls END) THEN RETURN false; END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname=ANY(ARRAY['tyre_jobs_guard_owner','tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance']))<>5 THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM unnest(protected_tables) x WHERE NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND c.relname=x AND r.rolname='tyre_jobs_guard_owner')) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM unnest(protected_tables) x WHERE has_table_privilege(session_user,format('public.%I',x),'SELECT') OR has_table_privilege(session_user,format('public.%I',x),'INSERT') OR has_table_privilege(session_user,format('public.%I',x),'UPDATE') OR has_table_privilege(session_user,format('public.%I',x),'DELETE') OR has_table_privilege(session_user,format('public.%I',x),'TRUNCATE') OR has_table_privilege(session_user,format('public.%I',x),'REFERENCES') OR has_table_privilege(session_user,format('public.%I',x),'TRIGGER')) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND p.prosecdef AND (p.proname LIKE 'job!_%' ESCAPE '!' OR p.proname='record_job_fence_loss') AND (r.rolname<>'tyre_jobs_guard_owner' OR NOT (p.proconfig @> ARRAY['search_path=pg_catalog, public']::TEXT[]) OR NOT (p.proconfig @> ARRAY['row_security=on']::TEXT[]))) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'job!_%' ESCAPE '!' OR p.proname='record_job_fence_loss') AND has_function_privilege('public',p.oid,'EXECUTE')) THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='BackgroundJob' AND t.tgname='BackgroundJob_projection_guard' AND t.tgenabled='O' AND t.tgfoid='guard_background_job_projection_update()'::regprocedure) OR
     NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='BackgroundJob' AND t.tgname='BackgroundJob_scope_complete_v2' AND t.tgenabled='O' AND t.tgfoid='validate_job_scope_complete_v2()'::regprocedure) OR
     NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='JobAuthorizationScopeRef' AND t.tgname='JobAuthorizationScopeRef_complete_v2' AND t.tgenabled='O' AND t.tgfoid='validate_job_scope_complete_v2()'::regprocedure) OR
     NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='JobTypeRegistry' AND t.tgname='JobTypeRegistry_insert_admission' AND t.tgenabled='O' AND t.tgfoid='validate_job_registry_insert_v1()'::regprocedure) THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname='BackgroundJob_claim_idx' AND i.indisvalid AND i.indisready) OR
     NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public."OutboxConsumerReceipt"'::regclass AND c.contype='u' AND pg_get_constraintdef(c.oid) LIKE 'UNIQUE ("consumerId", "messageId")%') THEN RETURN false; END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION job_runtime_attestation_v2(expected_group NAME)
RETURNS TABLE(database_login TEXT,database_group TEXT,membership_valid BOOLEAN,boundary_valid BOOLEAN,runtime_contract_digest TEXT,registry_digest TEXT,boundary_digest TEXT,guard_can_login BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ BEGIN
  IF expected_group::TEXT NOT IN ('tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance') THEN RETURN; END IF;
  RETURN QUERY SELECT session_user::TEXT,expected_group::TEXT,job_runtime_membership_ok(expected_group),job_runtime_boundary_valid_v2(expected_group),job_runtime_contract_digest_v1(),job_registry_digest_v1(),job_runtime_boundary_digest_v2(expected_group),(SELECT rolcanlogin FROM pg_roles WHERE rolname='tyre_jobs_guard_owner');
END $$;

CREATE OR REPLACE FUNCTION job_current_policy_v2()
RETURNS SETOF "JobOperationalPolicy" LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public SET row_security=on AS $$
  SELECT p.* FROM "JobRuntimeContextKey" k JOIN "JobOperationalPolicy" p ON p."operationalPolicyDigest"=k."operationalPolicyDigest"
  WHERE k."keyId"=current_setting('tyre.jobs.context_key_id',true) AND k."runtimeLogin"=session_user AND k."boundaryDigest" IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION job_assert_runtime_v1(expected_group NAME,expected_purpose TEXT,expected_operation_digest TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE control "JobRuntimeContextKey"%ROWTYPE; expected TEXT; actual TEXT; now_ms BIGINT:=floor(extract(epoch FROM clock_timestamp())*1000)::BIGINT; viewer TEXT; sess TEXT; expires_ms BIGINT; BEGIN
  IF NOT job_runtime_boundary_valid_v2(expected_group) THEN RAISE EXCEPTION 'JOB_RUNTIME_BOUNDARY_INVALID' USING ERRCODE='42501'; END IF;
  IF current_setting('tyre.jobs.context_purpose',true) IS DISTINCT FROM expected_purpose OR current_setting('tyre.jobs.operation_digest',true) IS DISTINCT FROM expected_operation_digest THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTEXT_INVALID' USING ERRCODE='42501'; END IF;
  viewer:=current_setting('tyre.jobs.viewer_id',true); sess:=current_setting('tyre.jobs.session_id',true); expires_ms:=NULLIF(current_setting('tyre.jobs.context_expires_ms',true),'')::BIGINT;
  SELECT * INTO control FROM "JobRuntimeContextKey" k WHERE k."keyId"=current_setting('tyre.jobs.context_key_id',true) AND k."purpose"=expected_purpose AND k."runtimeLogin"=session_user AND k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp() AND NOT EXISTS(SELECT 1 FROM "JobRuntimeContextKeyRevocation" r WHERE r."keyId"=k."keyId");
  IF NOT FOUND OR control."boundaryDigest" IS NULL OR control."principalId" IS NULL OR expires_ms<=now_ms OR NOT EXISTS(SELECT 1 FROM "JobOperationalPolicy" p WHERE p."operationalPolicyDigest"=control."operationalPolicyDigest") THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTEXT_INVALID' USING ERRCODE='42501'; END IF;
  expected:=rtrim(translate(encode(hmac(convert_to('tyre.jobs.db-bound.v1'||chr(10)||expected_purpose||chr(10)||session_user||chr(10)||viewer||chr(10)||sess||chr(10)||control."keyId"||chr(10)||expected_operation_digest||chr(10)||expires_ms::TEXT||chr(10)||txid_current()::TEXT,'UTF8'),control."keyMaterial",'sha256'),'base64'),'+/','-_'),'=');
  IF expected IS DISTINCT FROM current_setting('tyre.jobs.bound_proof',true) THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTEXT_INVALID' USING ERRCODE='42501'; END IF;
  actual:=job_runtime_contract_digest_v1();
  IF control."runtimeContractDigest"<>actual OR control."registryDigest"<>job_registry_digest_v1() OR control."boundaryDigest"<>job_runtime_boundary_digest_v2(expected_group) THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTRACT_DRIFT' USING ERRCODE='42501'; END IF;
END $$;

CREATE OR REPLACE FUNCTION job_reserve_origin_budget_v2(p_job_id UUID,p_rows INTEGER,p_bytes INTEGER,p_facts INTEGER,p_audits INTEGER,p_attempts INTEGER,p_heartbeats INTEGER,p_reconciliations INTEGER,p_fence_losses INTEGER) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE origin UUID; b "JobOriginBudget"%ROWTYPE; rate "JobOriginRateBucket"%ROWTYPE; bucket TIMESTAMPTZ:=date_trunc('minute',clock_timestamp()); BEGIN
  SELECT "originJobId" INTO origin FROM "BackgroundJob" WHERE id=p_job_id;
  SELECT * INTO b FROM "JobOriginBudget" WHERE "originJobId"=origin FOR UPDATE;
  IF NOT FOUND OR b."maxRows" IS NULL OR b."rowCount"+p_rows>b."maxRows" OR b."derivedBytes"+p_bytes>b."maxDerivedBytes" OR b."factCount"+p_facts>b."maxFacts" OR b."auditFactCount"+p_audits>b."maxAudits" OR b."attemptCount"+p_attempts>b."maxAttemptsPerJob" OR b."heartbeatCount"+p_heartbeats>b."maxHeartbeatsPerJob" OR b."reconciliationCount"+p_reconciliations>b."maxReconciliationsPerJob" THEN RAISE EXCEPTION 'JOB_OPERATIONAL_BUDGET_EXCEEDED'; END IF;
  INSERT INTO "JobOriginRateBucket" VALUES(origin,bucket,0,0,0,0,0,0) ON CONFLICT DO NOTHING;
  SELECT * INTO rate FROM "JobOriginRateBucket" WHERE "originJobId"=origin AND "minuteBucket"=bucket FOR UPDATE;
  IF rate."attemptCount"+p_attempts>b."maxAttemptsPerMinute" OR rate."heartbeatCount"+p_heartbeats>b."maxHeartbeatsPerMinute" OR rate."reconciliationCount"+p_reconciliations>b."maxReconciliationsPerMinute" OR rate."fenceLossCount"+p_fence_losses>b."maxFenceLossPerMinute" OR rate."factCount"+p_facts>b."maxFactsPerMinute" OR rate."auditCount"+p_audits>b."maxAuditsPerMinute" THEN RAISE EXCEPTION 'JOB_OPERATIONAL_RATE_EXCEEDED'; END IF;
  UPDATE "JobOriginBudget" SET "rowCount"="rowCount"+p_rows,"derivedBytes"="derivedBytes"+p_bytes,"factCount"="factCount"+p_facts,"auditFactCount"="auditFactCount"+p_audits,"attemptCount"="attemptCount"+p_attempts,"heartbeatCount"="heartbeatCount"+p_heartbeats,"reconciliationCount"="reconciliationCount"+p_reconciliations,"fenceLossCount"="fenceLossCount"+p_fence_losses WHERE "originJobId"=origin;
  UPDATE "JobOriginRateBucket" SET "attemptCount"="attemptCount"+p_attempts,"heartbeatCount"="heartbeatCount"+p_heartbeats,"reconciliationCount"="reconciliationCount"+p_reconciliations,"fenceLossCount"="fenceLossCount"+p_fence_losses,"factCount"="factCount"+p_facts,"auditCount"="auditCount"+p_audits WHERE "originJobId"=origin AND "minuteBucket"=bucket;
END $$;

ALTER TABLE "JobOperationalPolicy" OWNER TO tyre_jobs_guard_owner;
ALTER TABLE "JobOriginRateBucket" OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION validate_job_registry_insert_v1() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION validate_job_scope_complete_v2() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_runtime_boundary_digest_v2(NAME) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_runtime_boundary_valid_v2(NAME) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_runtime_attestation_v2(NAME) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_current_policy_v2() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_reserve_origin_budget_v2(UUID,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_assert_runtime_v1(NAME,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_enqueue_v1(TEXT,INTEGER,JSONB,INTEGER,TIMESTAMPTZ,TEXT,JSONB,TEXT,TEXT,UUID) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION authorized_job_v1(TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_claim_v1() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_reclaim_v1() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_heartbeat_v1(UUID,INTEGER,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_finish_v1(UUID,INTEGER,TEXT,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_reconcile_v1(UUID,INTEGER,TEXT,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION record_job_fence_loss(UUID,INTEGER,TEXT) OWNER TO tyre_jobs_guard_owner;

REVOKE ALL ON "JobOperationalPolicy","JobOriginRateBucket" FROM PUBLIC,tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader,tyre_jobs_maintenance;
REVOKE ALL ON FUNCTION validate_job_scope_complete_v2(),job_runtime_boundary_digest_v2(NAME),job_runtime_boundary_valid_v2(NAME),job_runtime_attestation_v2(NAME),job_current_policy_v2(),job_reserve_origin_budget_v2(UUID,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION job_runtime_attestation_v2(NAME) TO tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader,tyre_jobs_maintenance;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM "JobTypeRegistry" WHERE "requiredScopeKinds" IS NULL) THEN
    RAISE NOTICE 'Existing 3C registry rows are fail-disabled until republished with the v2 security envelope.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION job_runtime_key_attestation_v2(p_purpose TEXT,p_key_id TEXT)
RETURNS TABLE(key_digest TEXT,max_context_ttl_seconds INTEGER,runtime_contract_digest TEXT,registry_digest TEXT,operational_policy_digest TEXT,runtime_login TEXT,principal_id TEXT,boundary_digest TEXT,boundary_valid BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE expected_group NAME; BEGIN
  expected_group:=CASE p_purpose WHEN 'producer' THEN 'tyre_jobs_producer' WHEN 'claimer' THEN 'tyre_jobs_claimer' WHEN 'reader' THEN 'tyre_jobs_reader' ELSE NULL END;
  IF expected_group IS NULL OR NOT job_runtime_boundary_valid_v2(expected_group) THEN RETURN; END IF;
  RETURN QUERY SELECT rtrim(translate(encode(digest(k."keyMaterial",'sha256'),'base64'),'+/','-_'),'='),k."maxContextTtlSeconds",k."runtimeContractDigest",k."registryDigest",k."operationalPolicyDigest",k."runtimeLogin",k."principalId",k."boundaryDigest",k."boundaryDigest"=job_runtime_boundary_digest_v2(expected_group)
  FROM "JobRuntimeContextKey" k WHERE k.purpose=p_purpose AND k."keyId"=p_key_id AND k."runtimeLogin"=session_user AND k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp() AND NOT EXISTS(SELECT 1 FROM "JobRuntimeContextKeyRevocation" r WHERE r."keyId"=k."keyId") AND EXISTS(SELECT 1 FROM "JobOperationalPolicy" p WHERE p."operationalPolicyDigest"=k."operationalPolicyDigest");
END $$;
ALTER FUNCTION job_runtime_key_attestation_v2(TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
REVOKE ALL ON FUNCTION job_runtime_key_attestation_v2(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION job_runtime_key_attestation_v2(TEXT,TEXT) TO tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader;
