-- Increment 3C implementation-security follow-up 19.
-- Additive only: migrations 17 and 18 are deliberately left immutable.

ALTER TABLE "JobTypeRegistry"
  ADD COLUMN "operationalPolicyDigest" TEXT,
  ADD COLUMN "partitionKey" TEXT;

ALTER TABLE "JobOperationalPolicy"
  ADD COLUMN "policyDocument" JSONB,
  ADD COLUMN "queueCapacity" INTEGER,
  ADD COLUMN "partitionCapacity" INTEGER,
  ADD COLUMN "topicCapacity" INTEGER,
  ADD COLUMN "rootCapacity" INTEGER,
  ADD COLUMN "enqueueRatePerMinute" INTEGER,
  ADD COLUMN "claimRatePerMinute" INTEGER,
  ADD COLUMN "maxActiveLeases" INTEGER,
  ADD COLUMN "circuitFailureThreshold" INTEGER,
  ADD COLUMN "circuitOpenSeconds" INTEGER;

CREATE OR REPLACE FUNCTION job_canonical_json_v1(value JSONB) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE kind TEXT:=jsonb_typeof(value); result TEXT; BEGIN
  IF kind IN ('null','boolean','number') THEN RETURN value::TEXT; END IF;
  IF kind='string' THEN RETURN to_json(value #>> '{}')::TEXT; END IF;
  IF kind='array' THEN
    SELECT '['||COALESCE(string_agg(job_canonical_json_v1(item),',' ORDER BY ordinal),'')||']'
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY a(item,ordinal);
    RETURN result;
  END IF;
  IF kind='object' THEN
    SELECT '{'||COALESCE(string_agg(to_json(key)::TEXT||':'||job_canonical_json_v1(item),',' ORDER BY key COLLATE "C"),'')||'}'
      INTO result FROM jsonb_each(value) o(key,item);
    RETURN result;
  END IF;
  RAISE EXCEPTION 'JOB_POLICY_JSON_INVALID';
END $$;

CREATE OR REPLACE FUNCTION job_operational_policy_digest_v3(value JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT rtrim(translate(encode(digest(convert_to('tyre.jobs.operational-policy.v1'||chr(10)||job_canonical_json_v1(value),'UTF8'),'sha256'),'base64'),'+/','-_'),'=')
$$;

CREATE OR REPLACE FUNCTION validate_job_operational_policy_v3() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE expected_keys TEXT[]:=ARRAY(
  SELECT x FROM unnest(ARRAY[
    'ALERT_OLDEST_AGE_SECONDS','ALERT_QUEUE_DEPTH','BACKOFF_SCHEDULE_ID','CIRCUIT_FAILURE_THRESHOLD','CIRCUIT_OPEN_SECONDS',
    'CLAIM_RATE','CLEANUP_BATCH_SIZE','CLEANUP_RATE','CONCURRENCY','CURSOR_MAX_TTL_SECONDS','DEAD_LETTER_RETENTION_SECONDS',
    'DETAIL_PADDING_MS','ENQUEUE_RATE','HEARTBEAT_SECONDS','IDEMPOTENCY_RETENTION_SECONDS','LEASE_SECONDS','MAX_ATTEMPTS',
    'MAX_ATTEMPTS_PER_MINUTE','MAX_AUDITS_PER_MINUTE','MAX_AUDITS_PER_ORIGIN','MAX_CURSOR_BYTES','MAX_ERROR_BYTES',
    'MAX_FACTS_PER_MINUTE','MAX_FACTS_PER_ORIGIN','MAX_FENCE_LOSS_PER_MINUTE','MAX_FILTERS','MAX_HEARTBEATS_PER_JOB',
    'MAX_HEARTBEATS_PER_MINUTE','MAX_PAGE_SIZE','MAX_PAYLOAD_BYTES','MAX_RECONCILIATIONS_PER_JOB',
    'MAX_RECONCILIATIONS_PER_MINUTE','MAX_TIME_RANGE_SECONDS','OPERATIONAL_POLICY_ID','PARTITION_CAPACITY',
    'PARTITION_HORIZON_SECONDS','QUERY_PLAN_POLICY_ID','QUEUE_CAPACITY','READER_POLICY_VERSION','RECEIPT_RETENTION_SECONDS',
    'RECOVERY_POINT_SECONDS','RECOVERY_TIME_SECONDS','ROOT_CAPACITY','RUNTIME_CONTEXT_TTL_SECONDS','TOPIC_CAPACITY',
    'VISIBILITY_SECONDS'
  ]::TEXT[]) x ORDER BY x COLLATE "C"
); actual_keys TEXT[]; key TEXT; item JSONB; BEGIN
  IF jsonb_typeof(NEW."policyDocument")<>'object' THEN RAISE EXCEPTION 'JOB_OPERATIONAL_POLICY_DOCUMENT_REQUIRED'; END IF;
  SELECT array_agg(x ORDER BY x COLLATE "C") INTO actual_keys FROM jsonb_object_keys(NEW."policyDocument") x;
  IF actual_keys IS DISTINCT FROM expected_keys THEN RAISE EXCEPTION 'JOB_OPERATIONAL_POLICY_KEYS_INVALID'; END IF;
  FOR key,item IN SELECT * FROM jsonb_each(NEW."policyDocument") LOOP
    IF key IN ('BACKOFF_SCHEDULE_ID','OPERATIONAL_POLICY_ID','QUERY_PLAN_POLICY_ID') THEN
      IF jsonb_typeof(item)<>'string' OR (item #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN RAISE EXCEPTION 'JOB_OPERATIONAL_POLICY_VALUE_INVALID'; END IF;
    ELSE
      IF jsonb_typeof(item)<>'number' OR item::TEXT !~ '^[1-9][0-9]*$' OR (item::TEXT)::NUMERIC>9007199254740991 THEN RAISE EXCEPTION 'JOB_OPERATIONAL_POLICY_VALUE_INVALID'; END IF;
    END IF;
  END LOOP;
  IF NEW."operationalPolicyDigest" IS DISTINCT FROM job_operational_policy_digest_v3(NEW."policyDocument") THEN RAISE EXCEPTION 'JOB_OPERATIONAL_POLICY_DIGEST_INVALID'; END IF;
  NEW."queueCapacity":=(NEW."policyDocument"->>'QUEUE_CAPACITY')::INTEGER;
  NEW."partitionCapacity":=(NEW."policyDocument"->>'PARTITION_CAPACITY')::INTEGER;
  NEW."topicCapacity":=(NEW."policyDocument"->>'TOPIC_CAPACITY')::INTEGER;
  NEW."rootCapacity":=(NEW."policyDocument"->>'ROOT_CAPACITY')::INTEGER;
  NEW."enqueueRatePerMinute":=(NEW."policyDocument"->>'ENQUEUE_RATE')::INTEGER;
  NEW."claimRatePerMinute":=(NEW."policyDocument"->>'CLAIM_RATE')::INTEGER;
  NEW."maxActiveLeases":=(NEW."policyDocument"->>'CONCURRENCY')::INTEGER;
  NEW."circuitFailureThreshold":=(NEW."policyDocument"->>'CIRCUIT_FAILURE_THRESHOLD')::INTEGER;
  NEW."circuitOpenSeconds":=(NEW."policyDocument"->>'CIRCUIT_OPEN_SECONDS')::INTEGER;
  NEW."maxAttemptsPerJob":=(NEW."policyDocument"->>'MAX_ATTEMPTS')::INTEGER;
  NEW."maxHeartbeatsPerJob":=(NEW."policyDocument"->>'MAX_HEARTBEATS_PER_JOB')::INTEGER;
  NEW."maxReconciliationsPerJob":=(NEW."policyDocument"->>'MAX_RECONCILIATIONS_PER_JOB')::INTEGER;
  NEW."maxFenceLossPerMinute":=(NEW."policyDocument"->>'MAX_FENCE_LOSS_PER_MINUTE')::INTEGER;
  NEW."maxAttemptsPerMinute":=(NEW."policyDocument"->>'MAX_ATTEMPTS_PER_MINUTE')::INTEGER;
  NEW."maxHeartbeatsPerMinute":=(NEW."policyDocument"->>'MAX_HEARTBEATS_PER_MINUTE')::INTEGER;
  NEW."maxReconciliationsPerMinute":=(NEW."policyDocument"->>'MAX_RECONCILIATIONS_PER_MINUTE')::INTEGER;
  NEW."maxFactsPerMinute":=(NEW."policyDocument"->>'MAX_FACTS_PER_MINUTE')::INTEGER;
  NEW."maxAuditsPerMinute":=(NEW."policyDocument"->>'MAX_AUDITS_PER_MINUTE')::INTEGER;
  NEW."maxFactsPerOrigin":=(NEW."policyDocument"->>'MAX_FACTS_PER_ORIGIN')::INTEGER;
  NEW."maxAuditsPerOrigin":=(NEW."policyDocument"->>'MAX_AUDITS_PER_ORIGIN')::INTEGER;
  RETURN NEW;
END $$;

DROP TRIGGER "JobOperationalPolicy_append_only" ON "JobOperationalPolicy";
CREATE TRIGGER "JobOperationalPolicy_validate_v3" BEFORE INSERT ON "JobOperationalPolicy" FOR EACH ROW EXECUTE FUNCTION validate_job_operational_policy_v3();
CREATE TRIGGER "JobOperationalPolicy_append_only" BEFORE UPDATE OR DELETE ON "JobOperationalPolicy" FOR EACH ROW EXECUTE FUNCTION reject_job_immutable_mutation();

ALTER TABLE "JobOperationalPolicy" ADD CONSTRAINT "JobOperationalPolicy_capacity_v3_check" CHECK (
  "policyDocument" IS NULL OR (
    "operationalPolicyDigest"=job_operational_policy_digest_v3("policyDocument") AND
    "queueCapacity">0 AND "partitionCapacity">0 AND "topicCapacity">0 AND "rootCapacity">0 AND
    "enqueueRatePerMinute">0 AND "claimRatePerMinute">0 AND "maxActiveLeases">0 AND
    "circuitFailureThreshold">0 AND "circuitOpenSeconds">0
  )
) NOT VALID;

CREATE OR REPLACE FUNCTION validate_job_registry_policy_v3() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
  IF NEW."operationalPolicyDigest" IS NULL OR NEW."partitionKey" IS NULL OR
     NEW."partitionKey" !~ '^[a-z][a-z0-9_.:-]{0,127}$' OR
     NOT EXISTS(SELECT 1 FROM "JobOperationalPolicy" p WHERE p."operationalPolicyDigest"=NEW."operationalPolicyDigest" AND p."policyDocument" IS NOT NULL) THEN
    RAISE EXCEPTION 'JOB_REGISTRY_OPERATIONAL_POLICY_INVALID';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "JobTypeRegistry_policy_v3" BEFORE INSERT ON "JobTypeRegistry" FOR EACH ROW EXECUTE FUNCTION validate_job_registry_policy_v3();

CREATE TABLE "JobCapacityReservation" (
  "jobId" UUID PRIMARY KEY,
  "operationalPolicyDigest" TEXT NOT NULL,
  "partitionKey" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "originJobId" UUID NOT NULL,
  "isRoot" BOOLEAN NOT NULL,
  state TEXT NOT NULL,
  "leaseExpiresAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  "releasedAt" TIMESTAMPTZ(6),
  CHECK (state IN ('queued','leased','released')),
  CHECK ((state='leased')=("leaseExpiresAt" IS NOT NULL)),
  CHECK ((state='released')=("releasedAt" IS NOT NULL))
);
CREATE INDEX "JobCapacityReservation_global_idx" ON "JobCapacityReservation"("operationalPolicyDigest",state,"leaseExpiresAt");
CREATE INDEX "JobCapacityReservation_partition_idx" ON "JobCapacityReservation"("operationalPolicyDigest","partitionKey",state);
CREATE INDEX "JobCapacityReservation_topic_idx" ON "JobCapacityReservation"("operationalPolicyDigest","jobType","schemaVersion",state);
CREATE INDEX "JobCapacityReservation_origin_idx" ON "JobCapacityReservation"("operationalPolicyDigest","originJobId",state);

CREATE TABLE "JobGlobalRateBucket" (
  "operationalPolicyDigest" TEXT NOT NULL,
  "minuteBucket" TIMESTAMPTZ(6) NOT NULL,
  "enqueueCount" INTEGER NOT NULL DEFAULT 0,
  "claimCount" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY("operationalPolicyDigest","minuteBucket"),
  CHECK ("enqueueCount">=0 AND "claimCount">=0)
);

CREATE TABLE "JobCircuitState" (
  "operationalPolicyDigest" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "openUntil" TIMESTAMPTZ(6),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY("operationalPolicyDigest","jobType","schemaVersion"),
  CHECK ("consecutiveFailures">=0)
);

CREATE OR REPLACE FUNCTION guard_job_capacity_mutation_v3() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
  IF current_user<>'tyre_jobs_guard_owner' THEN RAISE EXCEPTION 'JOB_CAPACITY_GUARD_REQUIRED' USING ERRCODE='42501'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER "JobCapacityReservation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "JobCapacityReservation" FOR EACH ROW EXECUTE FUNCTION guard_job_capacity_mutation_v3();
CREATE TRIGGER "JobGlobalRateBucket_guard" BEFORE INSERT OR UPDATE OR DELETE ON "JobGlobalRateBucket" FOR EACH ROW EXECUTE FUNCTION guard_job_capacity_mutation_v3();
CREATE TRIGGER "JobCircuitState_guard" BEFORE INSERT OR UPDATE OR DELETE ON "JobCircuitState" FOR EACH ROW EXECUTE FUNCTION guard_job_capacity_mutation_v3();

CREATE OR REPLACE FUNCTION job_current_policy_digest_v3() RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE result TEXT; BEGIN
  SELECT p."operationalPolicyDigest" INTO result
  FROM "JobRuntimeContextKey" k JOIN "JobOperationalPolicy" p ON p."operationalPolicyDigest"=k."operationalPolicyDigest"
  WHERE k."keyId"=current_setting('tyre.jobs.context_key_id',true) AND k."runtimeLogin"=session_user
    AND p."policyDocument" IS NOT NULL AND p."operationalPolicyDigest"=job_operational_policy_digest_v3(p."policyDocument");
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION job_capacity_lock_and_recover_v3(policy_digest TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tyre.jobs.capacity.v3:'||policy_digest,0));
  UPDATE "JobCapacityReservation" r SET state='queued',"leaseExpiresAt"=NULL
    FROM "BackgroundJob" j WHERE r."jobId"=j.id AND r."operationalPolicyDigest"=policy_digest AND r.state='leased'
      AND r."leaseExpiresAt"<=clock_timestamp() AND j.state='processing' AND j."leaseExpiresAt"<=clock_timestamp();
  UPDATE "JobCapacityReservation" r SET state='released',"leaseExpiresAt"=NULL,"releasedAt"=clock_timestamp()
    FROM "BackgroundJob" j WHERE r."jobId"=j.id AND r."operationalPolicyDigest"=policy_digest AND r.state<>'released'
      AND j.state IN ('succeeded','known_safe_failure','dead_lettered','cancelled_before_effect','reconciled_applied','reconciled_not_applied');
  UPDATE "JobCircuitState" SET "consecutiveFailures"=0,"openUntil"=NULL,"updatedAt"=clock_timestamp()
    WHERE "operationalPolicyDigest"=policy_digest AND "openUntil" IS NOT NULL AND "openUntil"<=clock_timestamp();
END $$;

CREATE OR REPLACE FUNCTION job_capacity_reserve_enqueue_v3(p_job_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE j "BackgroundJob"%ROWTYPE; r "JobTypeRegistry"%ROWTYPE; p "JobOperationalPolicy"%ROWTYPE; rate "JobGlobalRateBucket"%ROWTYPE; bucket TIMESTAMPTZ:=date_trunc('minute',clock_timestamp()); BEGIN
  SELECT * INTO j FROM "BackgroundJob" WHERE id=p_job_id; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_CAPACITY_JOB_INVALID'; END IF;
  SELECT * INTO r FROM "JobTypeRegistry" WHERE ("jobType","schemaVersion","registryDigest")=(j."jobType",j."schemaVersion",j."registryDigest");
  SELECT * INTO p FROM "JobOperationalPolicy" WHERE "operationalPolicyDigest"=r."operationalPolicyDigest" AND "policyDocument" IS NOT NULL;
  IF NOT FOUND OR r."operationalPolicyDigest" IS DISTINCT FROM job_current_policy_digest_v3() OR p."operationalPolicyDigest"<>job_operational_policy_digest_v3(p."policyDocument") THEN RAISE EXCEPTION 'JOB_OPERATIONAL_POLICY_DRIFT'; END IF;
  PERFORM job_capacity_lock_and_recover_v3(p."operationalPolicyDigest");
  IF EXISTS(SELECT 1 FROM "JobCircuitState" c WHERE (c."operationalPolicyDigest",c."jobType",c."schemaVersion")=(p."operationalPolicyDigest",j."jobType",j."schemaVersion") AND c."openUntil">clock_timestamp()) THEN RAISE EXCEPTION 'JOB_CIRCUIT_OPEN'; END IF;
  IF (SELECT count(*) FROM "JobCapacityReservation" q WHERE q."operationalPolicyDigest"=p."operationalPolicyDigest" AND q.state<>'released')>=p."queueCapacity" THEN RAISE EXCEPTION 'JOB_QUEUE_CAPACITY_EXCEEDED'; END IF;
  IF (SELECT count(*) FROM "JobCapacityReservation" q WHERE q."operationalPolicyDigest"=p."operationalPolicyDigest" AND q."partitionKey"=r."partitionKey" AND q.state<>'released')>=p."partitionCapacity" THEN RAISE EXCEPTION 'JOB_PARTITION_CAPACITY_EXCEEDED'; END IF;
  IF (SELECT count(*) FROM "JobCapacityReservation" q WHERE q."operationalPolicyDigest"=p."operationalPolicyDigest" AND (q."jobType",q."schemaVersion")=(j."jobType",j."schemaVersion") AND q.state<>'released')>=p."topicCapacity" THEN RAISE EXCEPTION 'JOB_TOPIC_CAPACITY_EXCEEDED'; END IF;
  IF p_job_id=j."originJobId" AND (SELECT count(*) FROM "JobCapacityReservation" q WHERE q."operationalPolicyDigest"=p."operationalPolicyDigest" AND q."isRoot" AND q.state<>'released')>=p."rootCapacity" THEN RAISE EXCEPTION 'JOB_ROOT_CAPACITY_EXCEEDED'; END IF;
  INSERT INTO "JobGlobalRateBucket"("operationalPolicyDigest","minuteBucket") VALUES(p."operationalPolicyDigest",bucket) ON CONFLICT DO NOTHING;
  SELECT * INTO rate FROM "JobGlobalRateBucket" WHERE ("operationalPolicyDigest","minuteBucket")=(p."operationalPolicyDigest",bucket) FOR UPDATE;
  IF rate."enqueueCount">=p."enqueueRatePerMinute" THEN RAISE EXCEPTION 'JOB_ENQUEUE_RATE_EXCEEDED'; END IF;
  INSERT INTO "JobCapacityReservation"("jobId","operationalPolicyDigest","partitionKey","jobType","schemaVersion","originJobId","isRoot",state)
    VALUES(j.id,p."operationalPolicyDigest",r."partitionKey",j."jobType",j."schemaVersion",j."originJobId",j.id=j."originJobId",'queued');
  UPDATE "JobGlobalRateBucket" SET "enqueueCount"="enqueueCount"+1 WHERE ("operationalPolicyDigest","minuteBucket")=(p."operationalPolicyDigest",bucket);
END $$;

CREATE OR REPLACE FUNCTION job_capacity_reserve_claim_v3(p_job_id UUID,p_lease_expires_at TIMESTAMPTZ) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE r "JobCapacityReservation"%ROWTYPE; p "JobOperationalPolicy"%ROWTYPE; rate "JobGlobalRateBucket"%ROWTYPE; bucket TIMESTAMPTZ:=date_trunc('minute',clock_timestamp()); BEGIN
  SELECT * INTO r FROM "JobCapacityReservation" WHERE "jobId"=p_job_id; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_CAPACITY_RESERVATION_MISSING'; END IF;
  SELECT * INTO p FROM "JobOperationalPolicy" WHERE "operationalPolicyDigest"=r."operationalPolicyDigest";
  IF p."operationalPolicyDigest" IS DISTINCT FROM job_current_policy_digest_v3() THEN RAISE EXCEPTION 'JOB_OPERATIONAL_POLICY_DRIFT'; END IF;
  PERFORM job_capacity_lock_and_recover_v3(p."operationalPolicyDigest");
  IF EXISTS(SELECT 1 FROM "JobCircuitState" c WHERE (c."operationalPolicyDigest",c."jobType",c."schemaVersion")=(p."operationalPolicyDigest",r."jobType",r."schemaVersion") AND c."openUntil">clock_timestamp()) THEN RAISE EXCEPTION 'JOB_CIRCUIT_OPEN'; END IF;
  IF (SELECT count(*) FROM "JobCapacityReservation" q WHERE q."operationalPolicyDigest"=p."operationalPolicyDigest" AND q.state='leased' AND q."leaseExpiresAt">clock_timestamp())>=p."maxActiveLeases" THEN RAISE EXCEPTION 'JOB_CONCURRENCY_EXCEEDED'; END IF;
  INSERT INTO "JobGlobalRateBucket"("operationalPolicyDigest","minuteBucket") VALUES(p."operationalPolicyDigest",bucket) ON CONFLICT DO NOTHING;
  SELECT * INTO rate FROM "JobGlobalRateBucket" WHERE ("operationalPolicyDigest","minuteBucket")=(p."operationalPolicyDigest",bucket) FOR UPDATE;
  IF rate."claimCount">=p."claimRatePerMinute" THEN RAISE EXCEPTION 'JOB_CLAIM_RATE_EXCEEDED'; END IF;
  UPDATE "JobCapacityReservation" SET state='leased',"leaseExpiresAt"=p_lease_expires_at,"releasedAt"=NULL WHERE "jobId"=p_job_id;
  UPDATE "JobGlobalRateBucket" SET "claimCount"="claimCount"+1 WHERE ("operationalPolicyDigest","minuteBucket")=(p."operationalPolicyDigest",bucket);
END $$;

CREATE OR REPLACE FUNCTION job_capacity_extend_v3(p_job_id UUID,p_lease_expires_at TIMESTAMPTZ) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
  UPDATE "JobCapacityReservation" SET state='leased',"leaseExpiresAt"=p_lease_expires_at,"releasedAt"=NULL WHERE "jobId"=p_job_id AND "operationalPolicyDigest"=job_current_policy_digest_v3()
$$;

CREATE OR REPLACE FUNCTION job_capacity_finish_v3(p_job_id UUID,p_terminal_kind TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE r "JobCapacityReservation"%ROWTYPE; p "JobOperationalPolicy"%ROWTYPE; failures INTEGER; BEGIN
  SELECT * INTO r FROM "JobCapacityReservation" WHERE "jobId"=p_job_id; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_CAPACITY_RESERVATION_MISSING'; END IF;
  SELECT * INTO p FROM "JobOperationalPolicy" WHERE "operationalPolicyDigest"=r."operationalPolicyDigest";
  IF p."operationalPolicyDigest" IS DISTINCT FROM job_current_policy_digest_v3() THEN RAISE EXCEPTION 'JOB_OPERATIONAL_POLICY_DRIFT'; END IF;
  PERFORM job_capacity_lock_and_recover_v3(p."operationalPolicyDigest");
  INSERT INTO "JobCircuitState"("operationalPolicyDigest","jobType","schemaVersion") VALUES(p."operationalPolicyDigest",r."jobType",r."schemaVersion") ON CONFLICT DO NOTHING;
  IF p_terminal_kind IN ('known_safe_failure','dead_lettered') THEN
    UPDATE "JobCircuitState" SET "consecutiveFailures"="consecutiveFailures"+1,"updatedAt"=clock_timestamp()
      WHERE ("operationalPolicyDigest","jobType","schemaVersion")=(p."operationalPolicyDigest",r."jobType",r."schemaVersion") RETURNING "consecutiveFailures" INTO failures;
    IF failures>=p."circuitFailureThreshold" THEN UPDATE "JobCircuitState" SET "openUntil"=clock_timestamp()+make_interval(secs=>p."circuitOpenSeconds") WHERE ("operationalPolicyDigest","jobType","schemaVersion")=(p."operationalPolicyDigest",r."jobType",r."schemaVersion"); END IF;
  ELSIF p_terminal_kind='succeeded' THEN
    UPDATE "JobCircuitState" SET "consecutiveFailures"=0,"openUntil"=NULL,"updatedAt"=clock_timestamp() WHERE ("operationalPolicyDigest","jobType","schemaVersion")=(p."operationalPolicyDigest",r."jobType",r."schemaVersion");
  END IF;
  IF p_terminal_kind<>'external_outcome_unknown' THEN UPDATE "JobCapacityReservation" SET state='released',"leaseExpiresAt"=NULL,"releasedAt"=clock_timestamp() WHERE "jobId"=p_job_id; END IF;
END $$;

-- Preserve the reviewed v2 operation bodies behind v3 admission wrappers.  A
-- capacity failure occurs in the same transaction and therefore rolls back the
-- inner operation, its audit fact, and every reservation/rate mutation.
ALTER FUNCTION job_enqueue_v1(TEXT,INTEGER,JSONB,INTEGER,TIMESTAMPTZ,TEXT,JSONB,TEXT,TEXT,UUID) RENAME TO job_enqueue_internal_v3;
ALTER FUNCTION job_claim_v1() RENAME TO job_claim_internal_v3;
ALTER FUNCTION job_reclaim_v1() RENAME TO job_reclaim_internal_v3;
ALTER FUNCTION job_heartbeat_v1(UUID,INTEGER,TEXT) RENAME TO job_heartbeat_internal_v3;
ALTER FUNCTION job_finish_v1(UUID,INTEGER,TEXT,TEXT,TEXT) RENAME TO job_finish_internal_v3;
ALTER FUNCTION job_reconcile_v1(UUID,INTEGER,TEXT,TEXT,TEXT) RENAME TO job_reconcile_internal_v3;

CREATE OR REPLACE FUNCTION job_enqueue_v1(p_job_type TEXT,p_schema_version INTEGER,p_safe_payload JSONB,p_priority INTEGER,p_available_at TIMESTAMPTZ,p_deduplication_key TEXT,p_scope_refs JSONB,p_server_correlation_id TEXT,p_causation_id TEXT DEFAULT NULL,p_parent_job_id UUID DEFAULT NULL)
RETURNS TABLE(job_id UUID,message_id UUID,audit_event_id TEXT) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE result RECORD; BEGIN
  SELECT * INTO result FROM job_enqueue_internal_v3(p_job_type,p_schema_version,p_safe_payload,p_priority,p_available_at,p_deduplication_key,p_scope_refs,p_server_correlation_id,p_causation_id,p_parent_job_id);
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM job_capacity_reserve_enqueue_v3(result.job_id);
  RETURN QUERY SELECT result.job_id::UUID,result.message_id::UUID,result.audit_event_id::TEXT;
END $$;

CREATE OR REPLACE FUNCTION job_claim_v1()
RETURNS TABLE(job_id UUID,attempt_started_id UUID,lease_generation INTEGER,lease_secret TEXT,lease_expires_at TIMESTAMPTZ,duplicate_receipt BOOLEAN) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE result RECORD; policy_digest TEXT; BEGIN
  SELECT * INTO result FROM job_claim_internal_v3();
  IF NOT FOUND THEN policy_digest:=job_current_policy_digest_v3(); IF policy_digest IS NOT NULL THEN PERFORM job_capacity_lock_and_recover_v3(policy_digest); END IF; RETURN; END IF;
  IF NOT result.duplicate_receipt THEN PERFORM job_capacity_reserve_claim_v3(result.job_id,result.lease_expires_at); END IF;
  RETURN QUERY SELECT result.job_id::UUID,result.attempt_started_id::UUID,result.lease_generation::INTEGER,result.lease_secret::TEXT,result.lease_expires_at::TIMESTAMPTZ,result.duplicate_receipt::BOOLEAN;
END $$;

CREATE OR REPLACE FUNCTION job_reclaim_v1()
RETURNS TABLE(job_id UUID,attempt_started_id UUID,lease_generation INTEGER,lease_secret TEXT,lease_expires_at TIMESTAMPTZ) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE result RECORD; policy_digest TEXT; BEGIN
  SELECT * INTO result FROM job_reclaim_internal_v3();
  IF NOT FOUND THEN policy_digest:=job_current_policy_digest_v3(); IF policy_digest IS NOT NULL THEN PERFORM job_capacity_lock_and_recover_v3(policy_digest); END IF; RETURN; END IF;
  PERFORM job_capacity_reserve_claim_v3(result.job_id,result.lease_expires_at);
  RETURN QUERY SELECT result.job_id::UUID,result.attempt_started_id::UUID,result.lease_generation::INTEGER,result.lease_secret::TEXT,result.lease_expires_at::TIMESTAMPTZ;
END $$;

CREATE OR REPLACE FUNCTION job_heartbeat_v1(p_job_id UUID,p_generation INTEGER,p_secret TEXT) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ DECLARE expires_at TIMESTAMPTZ; BEGIN
  expires_at:=job_heartbeat_internal_v3(p_job_id,p_generation,p_secret); PERFORM job_capacity_extend_v3(p_job_id,expires_at); RETURN expires_at;
END $$;

CREATE OR REPLACE FUNCTION job_finish_v1(p_job_id UUID,p_generation INTEGER,p_secret TEXT,p_terminal_kind TEXT,p_safe_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ BEGIN
  PERFORM job_finish_internal_v3(p_job_id,p_generation,p_secret,p_terminal_kind,p_safe_reason); PERFORM job_capacity_finish_v3(p_job_id,p_terminal_kind);
END $$;

CREATE OR REPLACE FUNCTION job_reconcile_v1(p_job_id UUID,p_generation INTEGER,p_secret TEXT,p_state TEXT,p_safe_reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ BEGIN
  PERFORM job_reconcile_internal_v3(p_job_id,p_generation,p_secret,p_state,p_safe_reason);
  IF p_state IN ('reconciled_applied','reconciled_not_applied') THEN PERFORM job_capacity_finish_v3(p_job_id,p_state); END IF;
END $$;

CREATE OR REPLACE FUNCTION job_database_policy_digest_v3() RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE result TEXT; count_valid INTEGER; BEGIN
  SELECT count(*),min("operationalPolicyDigest") INTO count_valid,result FROM "JobOperationalPolicy"
    WHERE "policyDocument" IS NOT NULL AND "operationalPolicyDigest"=job_operational_policy_digest_v3("policyDocument");
  IF count_valid<>1 OR EXISTS(SELECT 1 FROM "JobTypeRegistry" WHERE (published OR "enqueueEnabled" OR "handlerEnabled") AND "operationalPolicyDigest" IS DISTINCT FROM result) THEN RETURN NULL; END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION job_runtime_boundary_digest_v3(expected_group NAME) RETURNS TEXT
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
WITH protected(name) AS (SELECT unnest(ARRAY[
  'JobTypeRegistry','OutboxMessage','BackgroundJob','JobAuthorizationScopeRef','JobOriginBudget','JobTransactionBudget',
  'JobAttemptStarted','JobHeartbeatFact','JobAttemptOutcome','OutboxConsumerReceipt','ConsumerReceiptResult',
  'OutboxAcknowledgement','DispatchFact','DeadLetterAdmission','JobReconciliation','JobAuditLink','JobFenceLossAudit',
  'JobLeaseDigestKey','JobLeaseDigestKeyRevocation','JobRuntimeContextKey','JobRuntimeContextKeyRevocation',
  'JobOperationalPolicy','JobOriginRateBucket','JobCapacityReservation','JobGlobalRateBucket','JobCircuitState',
  'AuditEventV2','AuditEventScopeRefV2','AuditEventSchemaV2','AuditRuntimeContextKey','AuditRuntimeContextKeyRevocation',
  'AuditReaderPublishedSchema','Admin','StaffSession','SecurityControl','AdminRoleAssignment','Role','RolePermission','Permission'
]::TEXT[])),
dependent_views AS (
  SELECT DISTINCT v.relname AS name FROM pg_class v JOIN pg_namespace vn ON vn.oid=v.relnamespace
  JOIN pg_rewrite rw ON rw.ev_class=v.oid JOIN pg_depend d ON d.objid=rw.oid
  JOIN pg_class base ON base.oid=d.refobjid JOIN pg_namespace bn ON bn.oid=base.relnamespace JOIN protected p ON p.name=base.relname
  WHERE vn.nspname='public' AND bn.nspname='public' AND v.relkind IN ('v','m')
), relations AS (SELECT name FROM protected UNION SELECT name FROM dependent_views),
trigger_functions AS (
  SELECT DISTINCT t.tgfoid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN relations r ON r.name=c.relname
  WHERE n.nspname='public' AND NOT t.tgisinternal
), snapshot(value) AS (
  SELECT 'role:'||r.rolname||':'||r.rolcanlogin||':'||r.rolinherit||':'||r.rolsuper||':'||r.rolcreaterole||':'||r.rolcreatedb||':'||r.rolreplication||':'||r.rolbypassrls
    FROM pg_roles r WHERE r.rolname=ANY(ARRAY[session_user::TEXT,expected_group::TEXT,'tyre_jobs_guard_owner','tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance','tyre_audit_guard_owner','tyre_audit_reader','tyre_audit_writer'])
  UNION ALL
  SELECT 'member:'||member.rolname||'>'||parent.rolname||':'||m.inherit_option||':'||m.set_option||':'||m.admin_option
    FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
    WHERE member.rolname=ANY(ARRAY[session_user::TEXT,'tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance']) OR parent.rolname LIKE 'tyre_jobs_%' OR parent.rolname LIKE 'tyre_audit_%'
  UNION ALL
  SELECT 'relation:'||c.relname||':'||c.relkind::TEXT||':'||owner.rolname||':'||COALESCE(c.relacl::TEXT,'NULL')||':'||CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) ELSE '' END
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles owner ON owner.oid=c.relowner JOIN relations r ON r.name=c.relname WHERE n.nspname='public'
  UNION ALL
  SELECT 'column:'||c.relname||':'||a.attnum||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull||':'||a.attidentity::TEXT||':'||a.attgenerated::TEXT||':'||COALESCE(pg_get_expr(d.adbin,d.adrelid),'NULL')||':'||COALESCE(coll.collname,'NULL')
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN relations r ON r.name=c.relname LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum LEFT JOIN pg_collation coll ON coll.oid=a.attcollation
    WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'acl:'||c.relname||':'||role_name||':'||privilege||':'||has_table_privilege(role_name,c.oid,privilege)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN relations r ON r.name=c.relname
    CROSS JOIN unnest(ARRAY[session_user::TEXT,'tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance']) role_name
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege WHERE n.nspname='public'
  UNION ALL
  SELECT 'constraint:'||c.relname||':'||con.conname||':'||con.convalidated||':'||pg_get_constraintdef(con.oid,true)
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN relations r ON r.name=c.relname WHERE n.nspname='public'
  UNION ALL
  SELECT 'index:'||t.relname||':'||i.relname||':'||owner.rolname||':'||COALESCE(i.relacl::TEXT,'NULL')||':'||ix.indisunique||':'||ix.indisvalid||':'||ix.indisready||':'||pg_get_indexdef(i.oid)
    FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_roles owner ON owner.oid=i.relowner JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN relations r ON r.name=t.relname WHERE n.nspname='public'
  UNION ALL
  SELECT 'trigger:'||c.relname||':'||t.tgname||':'||t.tgenabled::TEXT||':'||t.tgtype::TEXT||':'||t.tgfoid::regprocedure::TEXT||':'||pg_get_triggerdef(t.oid,true)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN relations r ON r.name=c.relname WHERE n.nspname='public' AND NOT t.tgisinternal
  UNION ALL
  SELECT 'function:'||p.oid::regprocedure::TEXT||':'||owner.rolname||':'||p.prosecdef||':'||COALESCE(p.proconfig::TEXT,'NULL')||':'||COALESCE(p.proacl::TEXT,'NULL')||':'||pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner
    WHERE n.nspname='public' AND (p.proname LIKE 'job!_%' ESCAPE '!' OR p.proname LIKE 'audit!_%' ESCAPE '!' OR p.proname='record_job_fence_loss' OR p.oid IN (SELECT tgfoid FROM trigger_functions))
  UNION ALL
  SELECT 'type:'||t.typname||':'||owner.rolname||':'||COALESCE(t.typacl::TEXT,'NULL')||':'||COALESCE((SELECT string_agg(e.enumlabel,',' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid),'')
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_roles owner ON owner.oid=t.typowner
    WHERE n.nspname='public' AND t.typname IN ('PermissionScopeType','StaffAccountStatus')
)
SELECT rtrim(translate(encode(digest(convert_to(expected_group::TEXT||chr(10)||session_user||chr(10)||string_agg(value,chr(10) ORDER BY value COLLATE "C"),'UTF8'),'sha256'),'base64'),'+/','-_'),'=') FROM snapshot
$$;

CREATE OR REPLACE FUNCTION job_runtime_boundary_valid_v3(expected_group NAME) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE protected_tables TEXT[]:=ARRAY[
  'JobTypeRegistry','OutboxMessage','BackgroundJob','JobAuthorizationScopeRef','JobOriginBudget','JobTransactionBudget','JobAttemptStarted','JobHeartbeatFact','JobAttemptOutcome','OutboxConsumerReceipt','ConsumerReceiptResult','OutboxAcknowledgement','DispatchFact','DeadLetterAdmission','JobReconciliation','JobAuditLink','JobFenceLossAudit','JobLeaseDigestKey','JobLeaseDigestKeyRevocation','JobRuntimeContextKey','JobRuntimeContextKeyRevocation','JobOperationalPolicy','JobOriginRateBucket','JobCapacityReservation','JobGlobalRateBucket','JobCircuitState','AuditEventV2','AuditEventScopeRefV2','AuditEventSchemaV2','AuditRuntimeContextKey','AuditRuntimeContextKeyRevocation','AuditReaderPublishedSchema','Admin','StaffSession','SecurityControl','AdminRoleAssignment','Role','RolePermission','Permission'
]; role_name TEXT; table_name TEXT; BEGIN
  IF expected_group::TEXT NOT IN ('tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance') OR NOT job_runtime_membership_ok(expected_group) OR has_schema_privilege(session_user,'public','CREATE') THEN RETURN false; END IF;
  IF job_database_policy_digest_v3() IS NULL THEN RETURN false; END IF;
  FOREACH role_name IN ARRAY ARRAY[session_user::TEXT,'tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance'] LOOP
    FOREACH table_name IN ARRAY protected_tables LOOP
      IF has_table_privilege(role_name,format('public.%I',table_name),'SELECT') OR has_table_privilege(role_name,format('public.%I',table_name),'INSERT') OR has_table_privilege(role_name,format('public.%I',table_name),'UPDATE') OR has_table_privilege(role_name,format('public.%I',table_name),'DELETE') OR has_table_privilege(role_name,format('public.%I',table_name),'TRUNCATE') OR has_table_privilege(role_name,format('public.%I',table_name),'REFERENCES') OR has_table_privilege(role_name,format('public.%I',table_name),'TRIGGER') THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND p.prosecdef AND (p.proname LIKE 'job!_%' ESCAPE '!' OR p.proname='record_job_fence_loss') AND (r.rolname<>'tyre_jobs_guard_owner' OR NOT (p.proconfig @> ARRAY['search_path=pg_catalog, public']::TEXT[]) OR NOT (p.proconfig @> ARRAY['row_security=on']::TEXT[]))) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'job!_%' ESCAPE '!' OR p.proname='record_job_fence_loss') AND has_function_privilege('public',p.oid,'EXECUTE')) THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public."JobOperationalPolicy"'::regclass AND t.tgname='JobOperationalPolicy_validate_v3' AND t.tgenabled='O') OR
     NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public."JobCapacityReservation"'::regclass AND t.tgname='JobCapacityReservation_guard' AND t.tgenabled='O') OR
     NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid='public."BackgroundJob_claim_idx"'::regclass AND i.indisvalid AND i.indisready) THEN RETURN false; END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION job_runtime_attestation_v3(expected_group NAME)
RETURNS TABLE(database_login TEXT,database_group TEXT,membership_valid BOOLEAN,boundary_valid BOOLEAN,runtime_contract_digest TEXT,registry_digest TEXT,operational_policy_digest TEXT,boundary_digest TEXT,guard_can_login BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ BEGIN
  IF expected_group::TEXT NOT IN ('tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance') THEN RETURN; END IF;
  RETURN QUERY SELECT session_user::TEXT,expected_group::TEXT,job_runtime_membership_ok(expected_group),job_runtime_boundary_valid_v3(expected_group),job_runtime_contract_digest_v1(),job_registry_digest_v1(),job_database_policy_digest_v3(),job_runtime_boundary_digest_v3(expected_group),(SELECT rolcanlogin FROM pg_roles WHERE rolname='tyre_jobs_guard_owner');
END $$;

CREATE OR REPLACE FUNCTION job_runtime_key_attestation_v3(p_purpose TEXT,p_key_id TEXT)
RETURNS TABLE(key_digest TEXT,max_context_ttl_seconds INTEGER,runtime_contract_digest TEXT,registry_digest TEXT,operational_policy_digest TEXT,runtime_login TEXT,principal_id TEXT,boundary_digest TEXT,boundary_valid BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE expected_group NAME; database_policy TEXT; BEGIN
  expected_group:=CASE p_purpose WHEN 'producer' THEN 'tyre_jobs_producer' WHEN 'claimer' THEN 'tyre_jobs_claimer' WHEN 'reader' THEN 'tyre_jobs_reader' ELSE NULL END;
  database_policy:=job_database_policy_digest_v3();
  IF expected_group IS NULL OR database_policy IS NULL OR NOT job_runtime_boundary_valid_v3(expected_group) THEN RETURN; END IF;
  RETURN QUERY SELECT rtrim(translate(encode(digest(k."keyMaterial",'sha256'),'base64'),'+/','-_'),'='),k."maxContextTtlSeconds",k."runtimeContractDigest",k."registryDigest",k."operationalPolicyDigest",k."runtimeLogin",k."principalId",k."boundaryDigest",k."boundaryDigest"=job_runtime_boundary_digest_v3(expected_group)
    FROM "JobRuntimeContextKey" k WHERE k.purpose=p_purpose AND k."keyId"=p_key_id AND k."runtimeLogin"=session_user AND k."operationalPolicyDigest"=database_policy AND k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp() AND NOT EXISTS(SELECT 1 FROM "JobRuntimeContextKeyRevocation" r WHERE r."keyId"=k."keyId");
END $$;

CREATE OR REPLACE FUNCTION job_assert_runtime_v1(expected_group NAME,expected_purpose TEXT,expected_operation_digest TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE control "JobRuntimeContextKey"%ROWTYPE; expected TEXT; actual TEXT; policy_digest TEXT; now_ms BIGINT:=floor(extract(epoch FROM clock_timestamp())*1000)::BIGINT; viewer TEXT; sess TEXT; expires_ms BIGINT; BEGIN
  IF NOT job_runtime_boundary_valid_v3(expected_group) THEN RAISE EXCEPTION 'JOB_RUNTIME_BOUNDARY_INVALID' USING ERRCODE='42501'; END IF;
  IF current_setting('tyre.jobs.context_purpose',true) IS DISTINCT FROM expected_purpose OR current_setting('tyre.jobs.operation_digest',true) IS DISTINCT FROM expected_operation_digest THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTEXT_INVALID' USING ERRCODE='42501'; END IF;
  viewer:=current_setting('tyre.jobs.viewer_id',true); sess:=current_setting('tyre.jobs.session_id',true); expires_ms:=NULLIF(current_setting('tyre.jobs.context_expires_ms',true),'')::BIGINT;
  SELECT * INTO control FROM "JobRuntimeContextKey" k WHERE k."keyId"=current_setting('tyre.jobs.context_key_id',true) AND k.purpose=expected_purpose AND k."runtimeLogin"=session_user AND k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp() AND NOT EXISTS(SELECT 1 FROM "JobRuntimeContextKeyRevocation" r WHERE r."keyId"=k."keyId");
  policy_digest:=job_database_policy_digest_v3();
  IF NOT FOUND OR control."boundaryDigest" IS NULL OR control."principalId" IS NULL OR expires_ms<=now_ms OR policy_digest IS NULL OR control."operationalPolicyDigest"<>policy_digest THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTEXT_INVALID' USING ERRCODE='42501'; END IF;
  expected:=rtrim(translate(encode(hmac(convert_to('tyre.jobs.db-bound.v1'||chr(10)||expected_purpose||chr(10)||session_user||chr(10)||viewer||chr(10)||sess||chr(10)||control."keyId"||chr(10)||expected_operation_digest||chr(10)||expires_ms::TEXT||chr(10)||txid_current()::TEXT,'UTF8'),control."keyMaterial",'sha256'),'base64'),'+/','-_'),'=');
  IF expected IS DISTINCT FROM current_setting('tyre.jobs.bound_proof',true) THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTEXT_INVALID' USING ERRCODE='42501'; END IF;
  actual:=job_runtime_contract_digest_v1();
  IF control."runtimeContractDigest"<>actual OR control."registryDigest"<>job_registry_digest_v1() OR control."boundaryDigest"<>job_runtime_boundary_digest_v3(expected_group) THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTRACT_DRIFT' USING ERRCODE='42501'; END IF;
END $$;

ALTER TABLE "JobCapacityReservation" OWNER TO tyre_jobs_guard_owner;
ALTER TABLE "JobGlobalRateBucket" OWNER TO tyre_jobs_guard_owner;
ALTER TABLE "JobCircuitState" OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_canonical_json_v1(JSONB) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_operational_policy_digest_v3(JSONB) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION validate_job_operational_policy_v3() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION validate_job_registry_policy_v3() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION guard_job_capacity_mutation_v3() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_current_policy_digest_v3() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_database_policy_digest_v3() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_capacity_lock_and_recover_v3(TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_capacity_reserve_enqueue_v3(UUID) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_capacity_reserve_claim_v3(UUID,TIMESTAMPTZ) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_capacity_extend_v3(UUID,TIMESTAMPTZ) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_capacity_finish_v3(UUID,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_enqueue_internal_v3(TEXT,INTEGER,JSONB,INTEGER,TIMESTAMPTZ,TEXT,JSONB,TEXT,TEXT,UUID) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_claim_internal_v3() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_reclaim_internal_v3() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_heartbeat_internal_v3(UUID,INTEGER,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_finish_internal_v3(UUID,INTEGER,TEXT,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_reconcile_internal_v3(UUID,INTEGER,TEXT,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_enqueue_v1(TEXT,INTEGER,JSONB,INTEGER,TIMESTAMPTZ,TEXT,JSONB,TEXT,TEXT,UUID) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_claim_v1() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_reclaim_v1() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_heartbeat_v1(UUID,INTEGER,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_finish_v1(UUID,INTEGER,TEXT,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_reconcile_v1(UUID,INTEGER,TEXT,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_runtime_boundary_digest_v3(NAME) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_runtime_boundary_valid_v3(NAME) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_runtime_attestation_v3(NAME) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_runtime_key_attestation_v3(TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_assert_runtime_v1(NAME,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;

REVOKE ALL ON "JobCapacityReservation","JobGlobalRateBucket","JobCircuitState" FROM PUBLIC,tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader,tyre_jobs_maintenance;
REVOKE ALL ON FUNCTION job_canonical_json_v1(JSONB),job_operational_policy_digest_v3(JSONB),validate_job_operational_policy_v3(),validate_job_registry_policy_v3(),guard_job_capacity_mutation_v3(),job_current_policy_digest_v3(),job_database_policy_digest_v3(),job_capacity_lock_and_recover_v3(TEXT),job_capacity_reserve_enqueue_v3(UUID),job_capacity_reserve_claim_v3(UUID,TIMESTAMPTZ),job_capacity_extend_v3(UUID,TIMESTAMPTZ),job_capacity_finish_v3(UUID,TEXT),job_enqueue_internal_v3(TEXT,INTEGER,JSONB,INTEGER,TIMESTAMPTZ,TEXT,JSONB,TEXT,TEXT,UUID),job_claim_internal_v3(),job_reclaim_internal_v3(),job_heartbeat_internal_v3(UUID,INTEGER,TEXT),job_finish_internal_v3(UUID,INTEGER,TEXT,TEXT,TEXT),job_reconcile_internal_v3(UUID,INTEGER,TEXT,TEXT,TEXT),job_runtime_boundary_digest_v3(NAME),job_runtime_boundary_valid_v3(NAME),job_runtime_attestation_v3(NAME),job_runtime_key_attestation_v3(TEXT,TEXT) FROM PUBLIC,tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader,tyre_jobs_maintenance;
REVOKE ALL ON FUNCTION job_enqueue_v1(TEXT,INTEGER,JSONB,INTEGER,TIMESTAMPTZ,TEXT,JSONB,TEXT,TEXT,UUID),job_claim_v1(),job_reclaim_v1(),job_heartbeat_v1(UUID,INTEGER,TEXT),job_finish_v1(UUID,INTEGER,TEXT,TEXT,TEXT),job_reconcile_v1(UUID,INTEGER,TEXT,TEXT,TEXT) FROM PUBLIC,tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader,tyre_jobs_maintenance;
GRANT EXECUTE ON FUNCTION job_runtime_attestation_v3(NAME) TO tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader,tyre_jobs_maintenance;
GRANT EXECUTE ON FUNCTION job_runtime_key_attestation_v3(TEXT,TEXT) TO tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader;
GRANT EXECUTE ON FUNCTION job_enqueue_v1(TEXT,INTEGER,JSONB,INTEGER,TIMESTAMPTZ,TEXT,JSONB,TEXT,TEXT,UUID) TO tyre_jobs_producer;
GRANT EXECUTE ON FUNCTION job_claim_v1(),job_reclaim_v1(),job_heartbeat_v1(UUID,INTEGER,TEXT),job_reconcile_v1(UUID,INTEGER,TEXT,TEXT,TEXT) TO tyre_jobs_claimer;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM "JobOperationalPolicy" WHERE "policyDocument" IS NULL) OR EXISTS(SELECT 1 FROM "JobTypeRegistry" WHERE "operationalPolicyDigest" IS NULL OR "partitionKey" IS NULL) THEN
    RAISE NOTICE 'Legacy 3C policy/registry rows are fail-disabled until republished with the v3 canonical capacity envelope.';
  END IF;
END $$;
