-- Increment 3C implementation-security follow-up 20.
-- Prior migrations remain immutable.  This migration removes all trust in a
-- denormalized policy scalar unless it is exactly equal to the canonical JSON.

CREATE OR REPLACE FUNCTION job_policy_document_valid_v4(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE expected_keys TEXT[]:=ARRAY(
  SELECT x FROM unnest(ARRAY[
    'ALERT_OLDEST_AGE_SECONDS','ALERT_QUEUE_DEPTH','BACKOFF_SCHEDULE_ID','CIRCUIT_FAILURE_THRESHOLD','CIRCUIT_OPEN_SECONDS',
    'CLAIM_RATE','CLEANUP_BATCH_SIZE','CLEANUP_RATE','CONCURRENCY','CURSOR_MAX_TTL_SECONDS','DEAD_LETTER_RETENTION_SECONDS',
    'DETAIL_PADDING_MS','ENQUEUE_RATE','HEARTBEAT_SECONDS','IDEMPOTENCY_RETENTION_SECONDS','LEASE_SECONDS','MAX_ATTEMPTS',
    'MAX_ATTEMPTS_PER_MINUTE','MAX_AUDITS_PER_MINUTE','MAX_AUDITS_PER_ORIGIN','MAX_CURSOR_BYTES','MAX_ERROR_BYTES',
    'MAX_FACTS_PER_MINUTE','MAX_FACTS_PER_ORIGIN','MAX_FENCE_LOSS_PER_MINUTE','MAX_FILTERS','MAX_HEARTBEATS_PER_JOB',
    'MAX_HEARTBEATS_PER_MINUTE','MAX_PAGE_SIZE','MAX_PAYLOAD_BYTES','MAX_RECONCILIATIONS_PER_JOB',
    'MAX_RECONCILIATIONS_PER_MINUTE','MAX_TIME_RANGE_SECONDS','OPERATIONAL_POLICY_ID','PARTITION_CAPACITY',
    'PARTITION_CAPACITY_MAP','PARTITION_HORIZON_SECONDS','QUERY_PLAN_POLICY_ID','QUEUE_CAPACITY','READER_POLICY_VERSION',
    'RECEIPT_RETENTION_SECONDS','RECOVERY_POINT_SECONDS','RECOVERY_TIME_SECONDS','ROOT_CAPACITY','RUNTIME_CONTEXT_TTL_SECONDS',
    'TOPIC_CAPACITY','TOPIC_CAPACITY_MAP','VISIBILITY_SECONDS'
  ]::TEXT[]) x ORDER BY x COLLATE "C"
); actual_keys TEXT[]; key TEXT; item JSONB; BEGIN
  IF jsonb_typeof(value)<>'object' THEN RETURN false; END IF;
  SELECT array_agg(x ORDER BY x COLLATE "C") INTO actual_keys FROM jsonb_object_keys(value) x;
  IF actual_keys IS DISTINCT FROM expected_keys THEN RETURN false; END IF;
  FOR key,item IN SELECT * FROM jsonb_each(value) LOOP
    IF key IN ('BACKOFF_SCHEDULE_ID','OPERATIONAL_POLICY_ID','QUERY_PLAN_POLICY_ID') THEN
      IF jsonb_typeof(item)<>'string' OR (item #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN RETURN false; END IF;
    ELSIF key IN ('PARTITION_CAPACITY_MAP','TOPIC_CAPACITY_MAP') THEN
      IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))=0 THEN RETURN false; END IF;
    ELSE
      IF jsonb_typeof(item)<>'number' OR item::TEXT !~ '^[1-9][0-9]*$' OR (item::TEXT)::NUMERIC>2147483647 THEN RETURN false; END IF;
    END IF;
  END LOOP;
  FOR key,item IN SELECT * FROM jsonb_each(value->'PARTITION_CAPACITY_MAP') LOOP
    IF key !~ '^[a-z][a-z0-9_.:-]{0,127}$' OR jsonb_typeof(item)<>'number' OR item::TEXT !~ '^[1-9][0-9]*$' OR (item::TEXT)::NUMERIC>2147483647 THEN RETURN false; END IF;
  END LOOP;
  FOR key,item IN SELECT * FROM jsonb_each(value->'TOPIC_CAPACITY_MAP') LOOP
    IF key !~ '^[a-z][a-z0-9_.-]{0,127}@[1-9][0-9]{0,9}$' OR jsonb_typeof(item)<>'number' OR item::TEXT !~ '^[1-9][0-9]*$' OR (item::TEXT)::NUMERIC>2147483647 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION job_policy_scalars_valid_v4(p "JobOperationalPolicy") RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
  SELECT job_policy_document_valid_v4(p."policyDocument")
    AND p."operationalPolicyDigest"=job_operational_policy_digest_v3(p."policyDocument")
    AND p."maxAttemptsPerJob"=(p."policyDocument"->>'MAX_ATTEMPTS')::INTEGER
    AND p."maxHeartbeatsPerJob"=(p."policyDocument"->>'MAX_HEARTBEATS_PER_JOB')::INTEGER
    AND p."maxReconciliationsPerJob"=(p."policyDocument"->>'MAX_RECONCILIATIONS_PER_JOB')::INTEGER
    AND p."maxFenceLossPerMinute"=(p."policyDocument"->>'MAX_FENCE_LOSS_PER_MINUTE')::INTEGER
    AND p."maxAttemptsPerMinute"=(p."policyDocument"->>'MAX_ATTEMPTS_PER_MINUTE')::INTEGER
    AND p."maxHeartbeatsPerMinute"=(p."policyDocument"->>'MAX_HEARTBEATS_PER_MINUTE')::INTEGER
    AND p."maxReconciliationsPerMinute"=(p."policyDocument"->>'MAX_RECONCILIATIONS_PER_MINUTE')::INTEGER
    AND p."maxFactsPerMinute"=(p."policyDocument"->>'MAX_FACTS_PER_MINUTE')::INTEGER
    AND p."maxAuditsPerMinute"=(p."policyDocument"->>'MAX_AUDITS_PER_MINUTE')::INTEGER
    AND p."maxFactsPerOrigin"=(p."policyDocument"->>'MAX_FACTS_PER_ORIGIN')::INTEGER
    AND p."maxAuditsPerOrigin"=(p."policyDocument"->>'MAX_AUDITS_PER_ORIGIN')::INTEGER
    AND p."queueCapacity"=(p."policyDocument"->>'QUEUE_CAPACITY')::INTEGER
    AND p."partitionCapacity"=(p."policyDocument"->>'PARTITION_CAPACITY')::INTEGER
    AND p."topicCapacity"=(p."policyDocument"->>'TOPIC_CAPACITY')::INTEGER
    AND p."rootCapacity"=(p."policyDocument"->>'ROOT_CAPACITY')::INTEGER
    AND p."enqueueRatePerMinute"=(p."policyDocument"->>'ENQUEUE_RATE')::INTEGER
    AND p."claimRatePerMinute"=(p."policyDocument"->>'CLAIM_RATE')::INTEGER
    AND p."maxActiveLeases"=(p."policyDocument"->>'CONCURRENCY')::INTEGER
    AND p."circuitFailureThreshold"=(p."policyDocument"->>'CIRCUIT_FAILURE_THRESHOLD')::INTEGER
    AND p."circuitOpenSeconds"=(p."policyDocument"->>'CIRCUIT_OPEN_SECONDS')::INTEGER
$$;

CREATE OR REPLACE FUNCTION validate_job_operational_policy_v4() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
  IF NOT job_policy_document_valid_v4(NEW."policyDocument") THEN RAISE EXCEPTION 'JOB_OPERATIONAL_POLICY_DOCUMENT_INVALID'; END IF;
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

DROP TRIGGER "JobOperationalPolicy_validate_v3" ON "JobOperationalPolicy";
CREATE TRIGGER "JobOperationalPolicy_validate_v3" BEFORE INSERT ON "JobOperationalPolicy" FOR EACH ROW EXECUTE FUNCTION validate_job_operational_policy_v4();
CREATE OR REPLACE FUNCTION job_database_policy_digest_v4() RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE result TEXT; count_valid INTEGER; document JSONB; BEGIN
  SELECT count(*),min("operationalPolicyDigest") INTO count_valid,result FROM "JobOperationalPolicy" p WHERE job_policy_scalars_valid_v4(p);
  IF count_valid<>1 THEN RETURN NULL; END IF;
  SELECT "policyDocument" INTO document FROM "JobOperationalPolicy" WHERE "operationalPolicyDigest"=result;
  IF EXISTS(SELECT 1 FROM "JobTypeRegistry" r WHERE (r.published OR r."enqueueEnabled" OR r."handlerEnabled") AND (
      r."operationalPolicyDigest" IS DISTINCT FROM result OR r."partitionKey" IS NULL OR
      NOT (document->'PARTITION_CAPACITY_MAP' ? r."partitionKey") OR
      NOT (document->'TOPIC_CAPACITY_MAP' ? (r."jobType"||'@'||r."schemaVersion"::TEXT))
  )) THEN RETURN NULL; END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION job_database_policy_digest_v3() RETURNS TEXT
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public SET row_security=on AS $$ SELECT job_database_policy_digest_v4() $$;

CREATE OR REPLACE FUNCTION job_current_policy_digest_v3() RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE result TEXT:=job_database_policy_digest_v4(); BEGIN
  IF result IS NULL OR NOT EXISTS(SELECT 1 FROM "JobRuntimeContextKey" k WHERE k."keyId"=current_setting('tyre.jobs.context_key_id',true) AND k."runtimeLogin"=session_user AND k."operationalPolicyDigest"=result) THEN RETURN NULL; END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION job_capacity_reserve_enqueue_v3(p_job_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE j "BackgroundJob"%ROWTYPE; r "JobTypeRegistry"%ROWTYPE; p "JobOperationalPolicy"%ROWTYPE; rate "JobGlobalRateBucket"%ROWTYPE; bucket TIMESTAMPTZ:=date_trunc('minute',clock_timestamp()); queue_limit INTEGER; partition_limit INTEGER; topic_limit INTEGER; root_limit INTEGER; enqueue_limit INTEGER; BEGIN
  SELECT * INTO j FROM "BackgroundJob" WHERE id=p_job_id; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_CAPACITY_JOB_INVALID'; END IF;
  SELECT * INTO r FROM "JobTypeRegistry" WHERE ("jobType","schemaVersion","registryDigest")=(j."jobType",j."schemaVersion",j."registryDigest");
  SELECT * INTO p FROM "JobOperationalPolicy" WHERE "operationalPolicyDigest"=r."operationalPolicyDigest" AND job_policy_scalars_valid_v4("JobOperationalPolicy");
  IF NOT FOUND OR r."operationalPolicyDigest" IS DISTINCT FROM job_current_policy_digest_v3() THEN RAISE EXCEPTION 'JOB_OPERATIONAL_POLICY_DRIFT'; END IF;
  queue_limit:=(p."policyDocument"->>'QUEUE_CAPACITY')::INTEGER;
  partition_limit:=LEAST((p."policyDocument"->>'PARTITION_CAPACITY')::INTEGER,(p."policyDocument"->'PARTITION_CAPACITY_MAP'->>r."partitionKey")::INTEGER);
  topic_limit:=LEAST((p."policyDocument"->>'TOPIC_CAPACITY')::INTEGER,(p."policyDocument"->'TOPIC_CAPACITY_MAP'->>(j."jobType"||'@'||j."schemaVersion"::TEXT))::INTEGER);
  root_limit:=(p."policyDocument"->>'ROOT_CAPACITY')::INTEGER; enqueue_limit:=(p."policyDocument"->>'ENQUEUE_RATE')::INTEGER;
  PERFORM job_capacity_lock_and_recover_v3(p."operationalPolicyDigest");
  IF EXISTS(SELECT 1 FROM "JobCircuitState" c WHERE (c."operationalPolicyDigest",c."jobType",c."schemaVersion")=(p."operationalPolicyDigest",j."jobType",j."schemaVersion") AND c."openUntil">clock_timestamp()) THEN RAISE EXCEPTION 'JOB_CIRCUIT_OPEN'; END IF;
  IF (SELECT count(*) FROM "JobCapacityReservation" q WHERE q."operationalPolicyDigest"=p."operationalPolicyDigest" AND q.state<>'released')>=queue_limit THEN RAISE EXCEPTION 'JOB_QUEUE_CAPACITY_EXCEEDED'; END IF;
  IF (SELECT count(*) FROM "JobCapacityReservation" q WHERE q."operationalPolicyDigest"=p."operationalPolicyDigest" AND q."partitionKey"=r."partitionKey" AND q.state<>'released')>=partition_limit THEN RAISE EXCEPTION 'JOB_PARTITION_CAPACITY_EXCEEDED'; END IF;
  IF (SELECT count(*) FROM "JobCapacityReservation" q WHERE q."operationalPolicyDigest"=p."operationalPolicyDigest" AND (q."jobType",q."schemaVersion")=(j."jobType",j."schemaVersion") AND q.state<>'released')>=topic_limit THEN RAISE EXCEPTION 'JOB_TOPIC_CAPACITY_EXCEEDED'; END IF;
  IF p_job_id=j."originJobId" AND (SELECT count(*) FROM "JobCapacityReservation" q WHERE q."operationalPolicyDigest"=p."operationalPolicyDigest" AND q."isRoot" AND q.state<>'released')>=root_limit THEN RAISE EXCEPTION 'JOB_ROOT_CAPACITY_EXCEEDED'; END IF;
  INSERT INTO "JobGlobalRateBucket"("operationalPolicyDigest","minuteBucket") VALUES(p."operationalPolicyDigest",bucket) ON CONFLICT DO NOTHING;
  SELECT * INTO rate FROM "JobGlobalRateBucket" WHERE ("operationalPolicyDigest","minuteBucket")=(p."operationalPolicyDigest",bucket) FOR UPDATE;
  IF rate."enqueueCount">=enqueue_limit THEN RAISE EXCEPTION 'JOB_ENQUEUE_RATE_EXCEEDED'; END IF;
  INSERT INTO "JobCapacityReservation"("jobId","operationalPolicyDigest","partitionKey","jobType","schemaVersion","originJobId","isRoot",state) VALUES(j.id,p."operationalPolicyDigest",r."partitionKey",j."jobType",j."schemaVersion",j."originJobId",j.id=j."originJobId",'queued');
  UPDATE "JobGlobalRateBucket" SET "enqueueCount"="enqueueCount"+1 WHERE ("operationalPolicyDigest","minuteBucket")=(p."operationalPolicyDigest",bucket);
END $$;

CREATE OR REPLACE FUNCTION job_capacity_reserve_claim_v3(p_job_id UUID,p_lease_expires_at TIMESTAMPTZ) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE r "JobCapacityReservation"%ROWTYPE; p "JobOperationalPolicy"%ROWTYPE; rate "JobGlobalRateBucket"%ROWTYPE; bucket TIMESTAMPTZ:=date_trunc('minute',clock_timestamp()); claim_limit INTEGER; concurrency_limit INTEGER; BEGIN
  SELECT * INTO r FROM "JobCapacityReservation" WHERE "jobId"=p_job_id; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_CAPACITY_RESERVATION_MISSING'; END IF;
  SELECT * INTO p FROM "JobOperationalPolicy" WHERE "operationalPolicyDigest"=r."operationalPolicyDigest" AND job_policy_scalars_valid_v4("JobOperationalPolicy");
  IF NOT FOUND OR p."operationalPolicyDigest" IS DISTINCT FROM job_current_policy_digest_v3() THEN RAISE EXCEPTION 'JOB_OPERATIONAL_POLICY_DRIFT'; END IF;
  claim_limit:=(p."policyDocument"->>'CLAIM_RATE')::INTEGER; concurrency_limit:=(p."policyDocument"->>'CONCURRENCY')::INTEGER;
  PERFORM job_capacity_lock_and_recover_v3(p."operationalPolicyDigest");
  IF EXISTS(SELECT 1 FROM "JobCircuitState" c WHERE (c."operationalPolicyDigest",c."jobType",c."schemaVersion")=(p."operationalPolicyDigest",r."jobType",r."schemaVersion") AND c."openUntil">clock_timestamp()) THEN RAISE EXCEPTION 'JOB_CIRCUIT_OPEN'; END IF;
  IF (SELECT count(*) FROM "JobCapacityReservation" q WHERE q."operationalPolicyDigest"=p."operationalPolicyDigest" AND q.state='leased' AND q."leaseExpiresAt">clock_timestamp())>=concurrency_limit THEN RAISE EXCEPTION 'JOB_CONCURRENCY_EXCEEDED'; END IF;
  INSERT INTO "JobGlobalRateBucket"("operationalPolicyDigest","minuteBucket") VALUES(p."operationalPolicyDigest",bucket) ON CONFLICT DO NOTHING;
  SELECT * INTO rate FROM "JobGlobalRateBucket" WHERE ("operationalPolicyDigest","minuteBucket")=(p."operationalPolicyDigest",bucket) FOR UPDATE;
  IF rate."claimCount">=claim_limit THEN RAISE EXCEPTION 'JOB_CLAIM_RATE_EXCEEDED'; END IF;
  UPDATE "JobCapacityReservation" SET state='leased',"leaseExpiresAt"=p_lease_expires_at,"releasedAt"=NULL WHERE "jobId"=p_job_id;
  UPDATE "JobGlobalRateBucket" SET "claimCount"="claimCount"+1 WHERE ("operationalPolicyDigest","minuteBucket")=(p."operationalPolicyDigest",bucket);
END $$;

CREATE OR REPLACE FUNCTION job_capacity_finish_v3(p_job_id UUID,p_terminal_kind TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE r "JobCapacityReservation"%ROWTYPE; p "JobOperationalPolicy"%ROWTYPE; failures INTEGER; failure_limit INTEGER; open_seconds INTEGER; BEGIN
  SELECT * INTO r FROM "JobCapacityReservation" WHERE "jobId"=p_job_id; IF NOT FOUND THEN RAISE EXCEPTION 'JOB_CAPACITY_RESERVATION_MISSING'; END IF;
  SELECT * INTO p FROM "JobOperationalPolicy" WHERE "operationalPolicyDigest"=r."operationalPolicyDigest" AND job_policy_scalars_valid_v4("JobOperationalPolicy");
  IF NOT FOUND OR p."operationalPolicyDigest" IS DISTINCT FROM job_current_policy_digest_v3() THEN RAISE EXCEPTION 'JOB_OPERATIONAL_POLICY_DRIFT'; END IF;
  failure_limit:=(p."policyDocument"->>'CIRCUIT_FAILURE_THRESHOLD')::INTEGER; open_seconds:=(p."policyDocument"->>'CIRCUIT_OPEN_SECONDS')::INTEGER;
  PERFORM job_capacity_lock_and_recover_v3(p."operationalPolicyDigest");
  INSERT INTO "JobCircuitState"("operationalPolicyDigest","jobType","schemaVersion") VALUES(p."operationalPolicyDigest",r."jobType",r."schemaVersion") ON CONFLICT DO NOTHING;
  IF p_terminal_kind IN ('known_safe_failure','dead_lettered') THEN
    UPDATE "JobCircuitState" SET "consecutiveFailures"="consecutiveFailures"+1,"updatedAt"=clock_timestamp() WHERE ("operationalPolicyDigest","jobType","schemaVersion")=(p."operationalPolicyDigest",r."jobType",r."schemaVersion") RETURNING "consecutiveFailures" INTO failures;
    IF failures>=failure_limit THEN UPDATE "JobCircuitState" SET "openUntil"=clock_timestamp()+make_interval(secs=>open_seconds) WHERE ("operationalPolicyDigest","jobType","schemaVersion")=(p."operationalPolicyDigest",r."jobType",r."schemaVersion"); END IF;
  ELSIF p_terminal_kind='succeeded' THEN UPDATE "JobCircuitState" SET "consecutiveFailures"=0,"openUntil"=NULL,"updatedAt"=clock_timestamp() WHERE ("operationalPolicyDigest","jobType","schemaVersion")=(p."operationalPolicyDigest",r."jobType",r."schemaVersion"); END IF;
  IF p_terminal_kind<>'external_outcome_unknown' THEN UPDATE "JobCapacityReservation" SET state='released',"leaseExpiresAt"=NULL,"releasedAt"=clock_timestamp() WHERE "jobId"=p_job_id; END IF;
END $$;

CREATE OR REPLACE FUNCTION job_runtime_boundary_digest_v4(expected_group NAME) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE policy_digest TEXT:=job_database_policy_digest_v4(); document JSONB; scalars JSONB; registry_map JSONB; BEGIN
  IF policy_digest IS NULL THEN RETURN NULL; END IF;
  SELECT p."policyDocument",jsonb_build_object(
    'maxAttemptsPerJob',p."maxAttemptsPerJob",'maxHeartbeatsPerJob',p."maxHeartbeatsPerJob",'maxReconciliationsPerJob',p."maxReconciliationsPerJob",'maxFenceLossPerMinute',p."maxFenceLossPerMinute",
    'maxAttemptsPerMinute',p."maxAttemptsPerMinute",'maxHeartbeatsPerMinute',p."maxHeartbeatsPerMinute",'maxReconciliationsPerMinute',p."maxReconciliationsPerMinute",'maxFactsPerMinute',p."maxFactsPerMinute",'maxAuditsPerMinute',p."maxAuditsPerMinute",
    'maxFactsPerOrigin',p."maxFactsPerOrigin",'maxAuditsPerOrigin',p."maxAuditsPerOrigin",'queueCapacity',p."queueCapacity",'partitionCapacity',p."partitionCapacity",'topicCapacity',p."topicCapacity",'rootCapacity',p."rootCapacity",
    'enqueueRatePerMinute',p."enqueueRatePerMinute",'claimRatePerMinute',p."claimRatePerMinute",'maxActiveLeases',p."maxActiveLeases",'circuitFailureThreshold',p."circuitFailureThreshold",'circuitOpenSeconds',p."circuitOpenSeconds"
  ) INTO document,scalars FROM "JobOperationalPolicy" p WHERE p."operationalPolicyDigest"=policy_digest;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('jobType',r."jobType",'schemaVersion',r."schemaVersion",'partitionKey',r."partitionKey",'operationalPolicyDigest',r."operationalPolicyDigest") ORDER BY r."jobType",r."schemaVersion"),'[]'::jsonb) INTO registry_map FROM "JobTypeRegistry" r;
  RETURN rtrim(translate(encode(digest(convert_to(job_runtime_boundary_digest_v3(expected_group)||chr(10)||policy_digest||chr(10)||job_canonical_json_v1(document)||chr(10)||job_canonical_json_v1(scalars)||chr(10)||job_canonical_json_v1(registry_map),'UTF8'),'sha256'),'base64'),'+/','-_'),'=');
END $$;

CREATE OR REPLACE FUNCTION job_runtime_boundary_valid_v4(expected_group NAME) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,public SET row_security=on AS $$
  SELECT job_runtime_boundary_valid_v3(expected_group) AND job_database_policy_digest_v4() IS NOT NULL AND job_runtime_boundary_digest_v4(expected_group) IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION job_runtime_attestation_v4(expected_group NAME)
RETURNS TABLE(database_login TEXT,database_group TEXT,membership_valid BOOLEAN,boundary_valid BOOLEAN,runtime_contract_digest TEXT,registry_digest TEXT,operational_policy_digest TEXT,boundary_digest TEXT,guard_can_login BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$ BEGIN
  IF expected_group::TEXT NOT IN ('tyre_jobs_producer','tyre_jobs_claimer','tyre_jobs_reader','tyre_jobs_maintenance') THEN RETURN; END IF;
  RETURN QUERY SELECT session_user::TEXT,expected_group::TEXT,job_runtime_membership_ok(expected_group),job_runtime_boundary_valid_v4(expected_group),job_runtime_contract_digest_v1(),job_registry_digest_v1(),job_database_policy_digest_v4(),job_runtime_boundary_digest_v4(expected_group),(SELECT rolcanlogin FROM pg_roles WHERE rolname='tyre_jobs_guard_owner');
END $$;

CREATE OR REPLACE FUNCTION job_runtime_key_attestation_v4(p_purpose TEXT,p_key_id TEXT)
RETURNS TABLE(key_digest TEXT,max_context_ttl_seconds INTEGER,runtime_contract_digest TEXT,registry_digest TEXT,operational_policy_digest TEXT,runtime_login TEXT,principal_id TEXT,boundary_digest TEXT,boundary_valid BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE expected_group NAME; database_policy TEXT; BEGIN
  expected_group:=CASE p_purpose WHEN 'producer' THEN 'tyre_jobs_producer' WHEN 'claimer' THEN 'tyre_jobs_claimer' WHEN 'reader' THEN 'tyre_jobs_reader' ELSE NULL END;
  database_policy:=job_database_policy_digest_v4();
  IF expected_group IS NULL OR database_policy IS NULL OR NOT job_runtime_boundary_valid_v4(expected_group) THEN RETURN; END IF;
  RETURN QUERY SELECT rtrim(translate(encode(digest(k."keyMaterial",'sha256'),'base64'),'+/','-_'),'='),k."maxContextTtlSeconds",k."runtimeContractDigest",k."registryDigest",k."operationalPolicyDigest",k."runtimeLogin",k."principalId",k."boundaryDigest",k."boundaryDigest"=job_runtime_boundary_digest_v4(expected_group)
    FROM "JobRuntimeContextKey" k WHERE k.purpose=p_purpose AND k."keyId"=p_key_id AND k."runtimeLogin"=session_user AND k."operationalPolicyDigest"=database_policy AND k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp() AND NOT EXISTS(SELECT 1 FROM "JobRuntimeContextKeyRevocation" r WHERE r."keyId"=k."keyId");
END $$;

CREATE OR REPLACE FUNCTION job_assert_runtime_v1(expected_group NAME,expected_purpose TEXT,expected_operation_digest TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE control "JobRuntimeContextKey"%ROWTYPE; expected TEXT; actual TEXT; policy_digest TEXT; now_ms BIGINT:=floor(extract(epoch FROM clock_timestamp())*1000)::BIGINT; viewer TEXT; sess TEXT; expires_ms BIGINT; BEGIN
  IF NOT job_runtime_boundary_valid_v4(expected_group) THEN RAISE EXCEPTION 'JOB_RUNTIME_BOUNDARY_INVALID' USING ERRCODE='42501'; END IF;
  IF current_setting('tyre.jobs.context_purpose',true) IS DISTINCT FROM expected_purpose OR current_setting('tyre.jobs.operation_digest',true) IS DISTINCT FROM expected_operation_digest THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTEXT_INVALID' USING ERRCODE='42501'; END IF;
  viewer:=current_setting('tyre.jobs.viewer_id',true); sess:=current_setting('tyre.jobs.session_id',true); expires_ms:=NULLIF(current_setting('tyre.jobs.context_expires_ms',true),'')::BIGINT;
  SELECT * INTO control FROM "JobRuntimeContextKey" k WHERE k."keyId"=current_setting('tyre.jobs.context_key_id',true) AND k.purpose=expected_purpose AND k."runtimeLogin"=session_user AND k."notBefore"<=clock_timestamp() AND k."expiresAt">clock_timestamp() AND NOT EXISTS(SELECT 1 FROM "JobRuntimeContextKeyRevocation" r WHERE r."keyId"=k."keyId");
  policy_digest:=job_database_policy_digest_v4();
  IF NOT FOUND OR control."boundaryDigest" IS NULL OR control."principalId" IS NULL OR expires_ms<=now_ms OR policy_digest IS NULL OR control."operationalPolicyDigest"<>policy_digest THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTEXT_INVALID' USING ERRCODE='42501'; END IF;
  expected:=rtrim(translate(encode(hmac(convert_to('tyre.jobs.db-bound.v1'||chr(10)||expected_purpose||chr(10)||session_user||chr(10)||viewer||chr(10)||sess||chr(10)||control."keyId"||chr(10)||expected_operation_digest||chr(10)||expires_ms::TEXT||chr(10)||txid_current()::TEXT,'UTF8'),control."keyMaterial",'sha256'),'base64'),'+/','-_'),'=');
  IF expected IS DISTINCT FROM current_setting('tyre.jobs.bound_proof',true) THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTEXT_INVALID' USING ERRCODE='42501'; END IF;
  actual:=job_runtime_contract_digest_v1();
  IF control."runtimeContractDigest"<>actual OR control."registryDigest"<>job_registry_digest_v1() OR control."boundaryDigest"<>job_runtime_boundary_digest_v4(expected_group) THEN RAISE EXCEPTION 'JOB_RUNTIME_CONTRACT_DRIFT' USING ERRCODE='42501'; END IF;
END $$;

ALTER FUNCTION job_policy_document_valid_v4(JSONB) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_policy_scalars_valid_v4("JobOperationalPolicy") OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION validate_job_operational_policy_v4() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_database_policy_digest_v4() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_database_policy_digest_v3() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_current_policy_digest_v3() OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_capacity_reserve_enqueue_v3(UUID) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_capacity_reserve_claim_v3(UUID,TIMESTAMPTZ) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_capacity_finish_v3(UUID,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_runtime_boundary_digest_v4(NAME) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_runtime_boundary_valid_v4(NAME) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_runtime_attestation_v4(NAME) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_runtime_key_attestation_v4(TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;
ALTER FUNCTION job_assert_runtime_v1(NAME,TEXT,TEXT) OWNER TO tyre_jobs_guard_owner;

REVOKE ALL ON FUNCTION job_policy_document_valid_v4(JSONB),job_policy_scalars_valid_v4("JobOperationalPolicy"),validate_job_operational_policy_v4(),job_database_policy_digest_v4(),job_runtime_boundary_digest_v4(NAME),job_runtime_boundary_valid_v4(NAME),job_runtime_attestation_v4(NAME),job_runtime_key_attestation_v4(TEXT,TEXT) FROM PUBLIC,tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader,tyre_jobs_maintenance;
GRANT EXECUTE ON FUNCTION job_runtime_attestation_v4(NAME) TO tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader,tyre_jobs_maintenance;
GRANT EXECUTE ON FUNCTION job_runtime_key_attestation_v4(TEXT,TEXT) TO tyre_jobs_producer,tyre_jobs_claimer,tyre_jobs_reader;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM "JobOperationalPolicy" p WHERE NOT job_policy_scalars_valid_v4(p)) THEN
    RAISE NOTICE 'Existing 3C v3 policy rows are fail-disabled until republished with exact v4 scalar and partition/topic-map bindings.';
  END IF;
END $$;
