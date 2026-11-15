-- Increment 3B P1 remediation: the HTTP reader/writer runtime never connects
-- as the migration owner and cannot SELECT audit/RBAC base tables. All access
-- crosses narrow, signed-context SECURITY DEFINER functions owned by a
-- dedicated NOLOGIN guard role with a pinned search_path.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tyre_audit_v2_guard_owner') THEN
    CREATE ROLE tyre_audit_v2_guard_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE tyre_audit_v2_guard_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE tyre_audit_v2_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE tyre_audit_v2_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE tyre_audit_v2_guard_owner FROM tyre_audit_v2_reader, tyre_audit_v2_writer;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO tyre_audit_v2_guard_owner, tyre_audit_v2_reader, tyre_audit_v2_writer;

CREATE TABLE "AuditRuntimeContextKey" (
  "keyId" TEXT NOT NULL PRIMARY KEY,
  "keyMaterial" BYTEA NOT NULL,
  "notBefore" TIMESTAMPTZ NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "maxContextTtlSeconds" INTEGER NOT NULL,
  "maxPageSize" INTEGER NOT NULL,
  "maxTimeRangeSeconds" INTEGER NOT NULL,
  "maxFilters" INTEGER NOT NULL,
  "readerPolicyVersion" INTEGER NOT NULL,
  "queryPlanPolicyId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditRuntimeContextKey_material_check" CHECK (octet_length("keyMaterial") = 32),
  CONSTRAINT "AuditRuntimeContextKey_window_check" CHECK (
    "expiresAt" > "notBefore" AND "maxContextTtlSeconds" > 0 AND "maxPageSize" > 0 AND
    "maxTimeRangeSeconds" > 0 AND "maxFilters" > 0 AND "readerPolicyVersion" > 0
  ),
  CONSTRAINT "AuditRuntimeContextKey_id_check" CHECK ("keyId" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  CONSTRAINT "AuditRuntimeContextKey_plan_check" CHECK ("queryPlanPolicyId" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
);

CREATE TABLE "AuditRuntimeContextKeyRevocation" (
  "keyId" TEXT NOT NULL PRIMARY KEY,
  "revokedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reasonCode" TEXT NOT NULL,
  CONSTRAINT "AuditRuntimeContextKeyRevocation_key_fkey" FOREIGN KEY ("keyId")
    REFERENCES "AuditRuntimeContextKey"("keyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuditRuntimeContextKeyRevocation_reason_check" CHECK ("reasonCode" ~ '^[A-Z][A-Z0-9_]{0,63}$')
);

CREATE TABLE "AuditReaderPublishedSchema" (
  "eventType" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "registryDigest" TEXT NOT NULL,
  "publishedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditReaderPublishedSchema_pkey" PRIMARY KEY ("eventType", "schemaVersion", "registryDigest"),
  CONSTRAINT "AuditReaderPublishedSchema_registry_fkey" FOREIGN KEY ("eventType", "schemaVersion", "registryDigest")
    REFERENCES "AuditEventSchemaV2"("eventType", "schemaVersion", "registryDigest") ON DELETE RESTRICT ON UPDATE RESTRICT
);

INSERT INTO "AuditReaderPublishedSchema" ("eventType", "schemaVersion", "registryDigest")
VALUES ('audit.reader.cursor_rejected', 1, 'l-jcdhxxJW2iyRwvMiNTO2p-uEFoPqJJm3F2g-bbciM');

CREATE OR REPLACE FUNCTION reject_audit_runtime_control_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER "AuditRuntimeContextKey_append_only" BEFORE UPDATE OR DELETE ON "AuditRuntimeContextKey"
FOR EACH ROW EXECUTE FUNCTION reject_audit_runtime_control_mutation();
CREATE TRIGGER "AuditRuntimeContextKeyRevocation_append_only" BEFORE UPDATE OR DELETE ON "AuditRuntimeContextKeyRevocation"
FOR EACH ROW EXECUTE FUNCTION reject_audit_runtime_control_mutation();
CREATE TRIGGER "AuditReaderPublishedSchema_append_only" BEFORE UPDATE OR DELETE ON "AuditReaderPublishedSchema"
FOR EACH ROW EXECUTE FUNCTION reject_audit_runtime_control_mutation();

-- Ownership moves away from the migration/runtime login. The guard owner is
-- NOLOGIN and owns only the protected audit boundary.
ALTER TABLE "AuditEventSchemaV2" OWNER TO tyre_audit_v2_guard_owner;
ALTER TABLE "AuditEventV2" OWNER TO tyre_audit_v2_guard_owner;
ALTER TABLE "AuditEventScopeRefV2" OWNER TO tyre_audit_v2_guard_owner;
ALTER TABLE "AuditRuntimeContextKey" OWNER TO tyre_audit_v2_guard_owner;
ALTER TABLE "AuditRuntimeContextKeyRevocation" OWNER TO tyre_audit_v2_guard_owner;
ALTER TABLE "AuditReaderPublishedSchema" OWNER TO tyre_audit_v2_guard_owner;

GRANT SELECT ON "Admin", "StaffSession", "SecurityControl", "AdminRoleAssignment", "Role", "RolePermission", "Permission"
  TO tyre_audit_v2_guard_owner;
REVOKE ALL ON "AuditEventSchemaV2", "AuditEventV2", "AuditEventScopeRefV2",
  "AuditRuntimeContextKey", "AuditRuntimeContextKeyRevocation", "AuditReaderPublishedSchema"
  FROM PUBLIC, tyre_audit_v2_reader, tyre_audit_v2_writer;
REVOKE ALL ON "Admin", "StaffSession", "SecurityControl", "AdminRoleAssignment", "Role", "RolePermission", "Permission"
  FROM tyre_audit_v2_reader, tyre_audit_v2_writer;

CREATE OR REPLACE FUNCTION audit_base64url(value BYTEA)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, public
AS $$ SELECT rtrim(translate(encode(value, 'base64'), '+/', '-_'), '=') $$;

CREATE OR REPLACE FUNCTION audit_runtime_signature_payload_v1(
  context_kind TEXT, database_login TEXT, key_id TEXT, viewer_id TEXT, session_id TEXT,
  issued_at_epoch_ms BIGINT, expires_at_epoch_ms BIGINT, nonce TEXT
) RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, public
AS $$ SELECT 'tyre.audit.db-context.v1' || chr(10) || context_kind || chr(10) || database_login || chr(10) ||
  key_id || chr(10) || viewer_id || chr(10) || session_id || chr(10) || issued_at_epoch_ms::text || chr(10) ||
  expires_at_epoch_ms::text || chr(10) || nonce $$;

CREATE OR REPLACE FUNCTION audit_runtime_bind_internal_v1(
  expected_group_role TEXT, context_kind TEXT, key_id TEXT, viewer_id TEXT, session_id TEXT,
  issued_at_epoch_ms BIGINT, expires_at_epoch_ms BIGINT, nonce TEXT, signature TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  control public."AuditRuntimeContextKey"%ROWTYPE;
  expected_signature TEXT;
  now_ms BIGINT := floor(extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;
  proof TEXT;
BEGIN
  IF session_user = 'tyre_audit_v2_guard_owner' OR NOT pg_has_role(session_user, expected_group_role, 'member')
     OR context_kind NOT IN ('reader','writer') OR viewer_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
     OR session_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' OR nonce !~ '^[A-Za-z0-9_-]{22}$'
     OR signature !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN false; END IF;
  SELECT * INTO control FROM public."AuditRuntimeContextKey" k
    WHERE k."keyId" = key_id AND k."notBefore" <= clock_timestamp() AND k."expiresAt" > clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM public."AuditRuntimeContextKeyRevocation" r WHERE r."keyId" = k."keyId");
  IF NOT FOUND OR issued_at_epoch_ms > now_ms + 1000 OR expires_at_epoch_ms <= now_ms
     OR expires_at_epoch_ms - issued_at_epoch_ms > control."maxContextTtlSeconds" * 1000 THEN RETURN false; END IF;
  expected_signature := public.audit_base64url(public.hmac(convert_to(public.audit_runtime_signature_payload_v1(
    context_kind, session_user, key_id, viewer_id, session_id, issued_at_epoch_ms, expires_at_epoch_ms, nonce
  ), 'UTF8'), control."keyMaterial", 'sha256'));
  IF expected_signature <> signature THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."Admin" a JOIN public."StaffSession" s ON s."staffUserId" = a."id"
    JOIN public."SecurityControl" c ON c."id" = 1
    WHERE a."id" = viewer_id AND s."id" = session_id AND a."enabled" AND a."status" = 'active'
      AND s."revokedAt" IS NULL AND s."idleExpiresAt" > clock_timestamp() AND s."absoluteExpiresAt" > clock_timestamp()
      AND s."tokenVersionSnapshot" = a."tokenVersion" AND s."authContractVersion" >= c."minimumAuthContractVersion"
      AND (context_kind = 'writer' OR EXISTS (
        SELECT 1 FROM public."AdminRoleAssignment" ara
        JOIN public."RolePermission" rp ON rp."roleId" = ara."roleId"
        JOIN public."Permission" p ON p."id" = rp."permissionId"
        WHERE ara."adminId" = a."id" AND p."key" = 'audit.read'
      ))
  ) THEN RETURN false; END IF;
  proof := public.audit_base64url(public.hmac(convert_to('tyre.audit.db-bound.v1' || chr(10) || context_kind || chr(10) ||
    session_user || chr(10) || viewer_id || chr(10) || session_id || chr(10) || key_id || chr(10) ||
    expires_at_epoch_ms::text || chr(10) || txid_current()::text, 'UTF8'), control."keyMaterial", 'sha256'));
  PERFORM set_config('tyre.audit.context_kind', context_kind, true);
  PERFORM set_config('tyre.audit.viewer_id', viewer_id, true);
  PERFORM set_config('tyre.audit.session_id', session_id, true);
  PERFORM set_config('tyre.audit.key_id', key_id, true);
  PERFORM set_config('tyre.audit.expires_ms', expires_at_epoch_ms::text, true);
  PERFORM set_config('tyre.audit.bound_proof', proof, true);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION audit_reader_bind_context_v1(
  key_id TEXT, viewer_id TEXT, session_id TEXT, issued_at_epoch_ms BIGINT,
  expires_at_epoch_ms BIGINT, nonce TEXT, signature TEXT
) RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT public.audit_runtime_bind_internal_v1('tyre_audit_v2_reader','reader',key_id,viewer_id,session_id,
  issued_at_epoch_ms,expires_at_epoch_ms,nonce,signature) $$;

CREATE OR REPLACE FUNCTION audit_writer_bind_context_v1(
  key_id TEXT, viewer_id TEXT, session_id TEXT, issued_at_epoch_ms BIGINT,
  expires_at_epoch_ms BIGINT, nonce TEXT, signature TEXT
) RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT public.audit_runtime_bind_internal_v1('tyre_audit_v2_writer','writer',key_id,viewer_id,session_id,
  issued_at_epoch_ms,expires_at_epoch_ms,nonce,signature) $$;

CREATE OR REPLACE FUNCTION audit_runtime_bound_context_v1(expected_group_role TEXT, expected_kind TEXT)
RETURNS TABLE(viewer_id TEXT, session_id TEXT, key_id TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  control public."AuditRuntimeContextKey"%ROWTYPE;
  expected_proof TEXT;
  expires_ms BIGINT;
BEGIN
  IF NOT pg_has_role(session_user, expected_group_role, 'member')
     OR current_setting('tyre.audit.context_kind', true) IS DISTINCT FROM expected_kind THEN RETURN; END IF;
  viewer_id := current_setting('tyre.audit.viewer_id', true);
  session_id := current_setting('tyre.audit.session_id', true);
  key_id := current_setting('tyre.audit.key_id', true);
  BEGIN expires_ms := current_setting('tyre.audit.expires_ms', true)::BIGINT; EXCEPTION WHEN OTHERS THEN RETURN; END;
  SELECT * INTO control FROM public."AuditRuntimeContextKey" k WHERE k."keyId" = key_id
    AND k."notBefore" <= clock_timestamp() AND k."expiresAt" > clock_timestamp()
    AND NOT EXISTS (SELECT 1 FROM public."AuditRuntimeContextKeyRevocation" r WHERE r."keyId" = k."keyId");
  IF NOT FOUND OR expires_ms <= floor(extract(epoch FROM clock_timestamp()) * 1000)::BIGINT THEN RETURN; END IF;
  expected_proof := public.audit_base64url(public.hmac(convert_to('tyre.audit.db-bound.v1' || chr(10) || expected_kind || chr(10) ||
    session_user || chr(10) || viewer_id || chr(10) || session_id || chr(10) || key_id || chr(10) ||
    expires_ms::text || chr(10) || txid_current()::text, 'UTF8'), control."keyMaterial", 'sha256'));
  IF expected_proof IS DISTINCT FROM current_setting('tyre.audit.bound_proof', true) THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;

-- The old arbitrary-viewer relation becomes an internal definer primitive.
-- Every object reference is schema-qualified; callers never receive EXECUTE.
CREATE OR REPLACE FUNCTION authorized_audit_event_v2(viewer_id TEXT, viewer_session_id TEXT)
RETURNS TABLE("id" TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH valid_viewer AS (
    SELECT 1
    FROM public."Admin" a
    JOIN public."StaffSession" s ON s."staffUserId" = a."id" AND s."id" = viewer_session_id
    JOIN public."SecurityControl" c ON c."id" = 1
    WHERE a."id" = viewer_id AND a."enabled" = true AND a."status" = 'active'
      AND s."revokedAt" IS NULL AND s."idleExpiresAt" > CURRENT_TIMESTAMP
      AND s."absoluteExpiresAt" > CURRENT_TIMESTAMP
      AND s."tokenVersionSnapshot" = a."tokenVersion"
      AND s."authContractVersion" >= c."minimumAuthContractVersion"
  ), exact_grants AS (
    SELECT ara."id" AS assignment_id, ara."scopeType"::text AS scope_kind,
           ara."scopeId" AS scope_id, p."key" AS permission
    FROM public."AdminRoleAssignment" ara
    JOIN public."RolePermission" rp ON rp."roleId" = ara."roleId"
    JOIN public."Permission" p ON p."id" = rp."permissionId"
    WHERE ara."adminId" = viewer_id
  )
  SELECT e."id"
  FROM public."AuditEventV2" e
  JOIN public."AuditEventSchemaV2" reg ON reg."eventType" = e."eventType"
    AND reg."schemaVersion" = e."schemaVersion" AND reg."registryDigest" = e."registryDigest"
  WHERE EXISTS (SELECT 1 FROM valid_viewer)
    AND EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = 'audit.read')
    AND (
      (e."authorizationScopeKind" = 'resource_scoped'
       AND EXISTS (SELECT 1 FROM public."AuditEventScopeRefV2" r WHERE r."eventId" = e."id")
       AND (
         (e."scopeMatchMode" = 'all' AND NOT EXISTS (
           SELECT 1 FROM public."AuditEventScopeRefV2" r WHERE r."eventId" = e."id"
             AND NOT EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = 'audit.read'
               AND g.scope_kind = r."dimension" AND g.scope_id = r."scopeId")
         ))
         OR
         (e."scopeMatchMode" = 'any' AND EXISTS (
           SELECT 1 FROM public."AuditEventScopeRefV2" r JOIN exact_grants g
             ON g.permission = 'audit.read' AND g.scope_kind = r."dimension" AND g.scope_id = r."scopeId"
           WHERE r."eventId" = e."id"
         ))
         OR
         (reg."allowGlobalReader" AND EXISTS (SELECT 1 FROM exact_grants g
           WHERE g.permission = 'audit.read' AND g.scope_kind = 'global' AND g.scope_id = ''))
       ))
      OR
      (e."authorizationScopeKind" = 'global_security'
       AND NOT EXISTS (SELECT 1 FROM public."AuditEventScopeRefV2" r WHERE r."eventId" = e."id")
       AND EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = 'audit.read'
         AND g.scope_kind = 'global' AND g.scope_id = '')
       AND e."requiredGlobalGrant" IS NOT NULL
       AND EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = e."requiredGlobalGrant"
         AND g.scope_kind = 'global' AND g.scope_id = ''))
      OR
      (e."authorizationScopeKind" = 'cross_scope'
       AND e."scopeMatchMode" = 'all'
       AND EXISTS (SELECT 1 FROM public."AuditEventScopeRefV2" r WHERE r."eventId" = e."id")
       AND (
         NOT EXISTS (
           SELECT 1 FROM public."AuditEventScopeRefV2" r WHERE r."eventId" = e."id"
             AND NOT EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = 'audit.read'
               AND g.scope_kind = r."dimension" AND g.scope_id = r."scopeId")
         )
         OR
         (e."requiredGlobalGrant" IS NOT NULL
          AND EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = 'audit.read'
            AND g.scope_kind = 'global' AND g.scope_id = '')
          AND EXISTS (SELECT 1 FROM exact_grants g WHERE g.permission = e."requiredGlobalGrant"
            AND g.scope_kind = 'global' AND g.scope_id = ''))
       ))
    );
$$;

CREATE OR REPLACE FUNCTION audit_reader_runtime_contract_v1(requested_key_id TEXT)
RETURNS TABLE(
  database_login TEXT, database_group TEXT, key_id TEXT, key_digest TEXT, max_context_ttl_seconds INTEGER,
  max_page_size INTEGER, max_time_range_seconds INTEGER, max_filters INTEGER,
  reader_policy_version INTEGER, query_plan_policy_id TEXT
) LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT session_user::text, 'tyre_audit_v2_reader'::text, k."keyId",
    public.audit_base64url(public.digest(k."keyMaterial", 'sha256')), k."maxContextTtlSeconds",
    k."maxPageSize", k."maxTimeRangeSeconds", k."maxFilters", k."readerPolicyVersion", k."queryPlanPolicyId"
  FROM public."AuditRuntimeContextKey" k
  WHERE pg_has_role(session_user, 'tyre_audit_v2_reader', 'member')
    AND k."keyId" = requested_key_id
    AND k."notBefore" <= clock_timestamp() AND k."expiresAt" > clock_timestamp()
    AND NOT EXISTS (SELECT 1 FROM public."AuditRuntimeContextKeyRevocation" r WHERE r."keyId" = k."keyId");
$$;

CREATE OR REPLACE FUNCTION audit_writer_runtime_contract_v1(requested_key_id TEXT)
RETURNS TABLE(
  database_login TEXT, database_group TEXT, key_id TEXT, key_digest TEXT, max_context_ttl_seconds INTEGER
) LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT session_user::text, 'tyre_audit_v2_writer'::text, k."keyId",
    public.audit_base64url(public.digest(k."keyMaterial", 'sha256')), k."maxContextTtlSeconds"
  FROM public."AuditRuntimeContextKey" k
  WHERE pg_has_role(session_user, 'tyre_audit_v2_writer', 'member')
    AND k."keyId" = requested_key_id
    AND k."notBefore" <= clock_timestamp() AND k."expiresAt" > clock_timestamp()
    AND NOT EXISTS (SELECT 1 FROM public."AuditRuntimeContextKeyRevocation" r WHERE r."keyId" = k."keyId");
$$;

CREATE OR REPLACE FUNCTION audit_reader_current_context_v1()
RETURNS TABLE(
  viewer_id TEXT, session_id TEXT, account_version INTEGER, token_version INTEGER,
  minimum_auth_contract_version INTEGER, security_control_version INTEGER, assignment_graph JSONB
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE bound RECORD;
BEGIN
  SELECT * INTO bound FROM public.audit_runtime_bound_context_v1('tyre_audit_v2_reader','reader');
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
  SELECT a."id", s."id", a."version", a."tokenVersion", c."minimumAuthContractVersion", c."version",
    jsonb_build_object('assignments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'assignmentId', ara."id", 'roleId', ro."id", 'roleKey', ro."key", 'roleVersion', ro."version",
        'assignmentScopeKind', ara."scopeType"::text, 'assignmentScopeId', ara."scopeId",
        'permissions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'edge', ro."id" || ':' || p."id", 'permissionId', p."id", 'permissionKey', p."key"
        ) ORDER BY p."id") FROM public."RolePermission" rp JOIN public."Permission" p ON p."id" = rp."permissionId"
          WHERE rp."roleId" = ro."id"), '[]'::jsonb)
      ) ORDER BY ara."id") FROM public."AdminRoleAssignment" ara JOIN public."Role" ro ON ro."id" = ara."roleId"
      WHERE ara."adminId" = a."id"
    ), '[]'::jsonb))
  FROM public."Admin" a JOIN public."StaffSession" s ON s."staffUserId" = a."id" AND s."id" = bound.session_id
  JOIN public."SecurityControl" c ON c."id" = 1
  WHERE a."id" = bound.viewer_id AND a."enabled" AND a."status" = 'active' AND s."revokedAt" IS NULL
    AND s."idleExpiresAt" > clock_timestamp() AND s."absoluteExpiresAt" > clock_timestamp()
    AND s."tokenVersionSnapshot" = a."tokenVersion" AND s."authContractVersion" >= c."minimumAuthContractVersion";
END;
$$;

CREATE OR REPLACE FUNCTION audit_reader_list_v1(
  occurred_from TIMESTAMPTZ, occurred_to TIMESTAMPTZ, event_family TEXT, event_outcome TEXT,
  actor_id_filter TEXT, entity_type_filter TEXT, entity_id_filter TEXT, approval_request_filter TEXT,
  approval_execution_filter TEXT, correlation_filter TEXT, causation_filter TEXT,
  bulk_operation_filter TEXT, bulk_item_filter TEXT, source_filter TEXT, retention_filter TEXT,
  sort_field TEXT, sort_direction TEXT, as_of TIMESTAMPTZ, last_sort_value TEXT,
  last_occurred_at TIMESTAMPTZ, last_event_id TEXT, result_limit INTEGER
) RETURNS SETOF public."AuditEventV2" LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE bound RECORD; control public."AuditRuntimeContextKey"%ROWTYPE; filter_count INTEGER;
  parsed_last_sort_time TIMESTAMPTZ;
BEGIN
  SELECT * INTO bound FROM public.audit_runtime_bound_context_v1('tyre_audit_v2_reader','reader');
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO control FROM public."AuditRuntimeContextKey" WHERE "keyId" = bound.key_id;
  filter_count := num_nonnulls(event_family,event_outcome,actor_id_filter,entity_type_filter,entity_id_filter,
    approval_request_filter,approval_execution_filter,correlation_filter,causation_filter,bulk_operation_filter,
    bulk_item_filter,source_filter,retention_filter);
  IF occurred_from IS NULL OR occurred_to IS NULL OR occurred_from > occurred_to OR occurred_to > as_of
     OR extract(epoch FROM (occurred_to - occurred_from)) > control."maxTimeRangeSeconds"
     OR filter_count > control."maxFilters" OR result_limit < 1 OR result_limit > control."maxPageSize" + 1
     OR sort_field NOT IN ('occurredAt','eventType','outcome') OR sort_direction NOT IN ('asc','desc')
     OR (event_family IS NOT NULL AND event_family !~ '^[a-z][a-z0-9_.-]{0,127}$')
     OR num_nonnulls(last_event_id,last_sort_value,last_occurred_at) NOT IN (0,3)
     OR (last_event_id IS NOT NULL AND last_event_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$') THEN RETURN; END IF;
  IF sort_field = 'occurredAt' AND last_sort_value IS NOT NULL THEN
    BEGIN parsed_last_sort_time := last_sort_value::timestamptz; EXCEPTION WHEN OTHERS THEN RETURN; END;
  END IF;
  RETURN QUERY
  SELECT e.* FROM public."AuditEventV2" e
  JOIN public.authorized_audit_event_v2(bound.viewer_id,bound.session_id) auth ON auth."id" = e."id"
  JOIN public."AuditReaderPublishedSchema" pub ON pub."eventType" = e."eventType"
    AND pub."schemaVersion" = e."schemaVersion" AND pub."registryDigest" = e."registryDigest"
  WHERE e."occurredAt" >= occurred_from AND e."occurredAt" <= occurred_to AND e."occurredAt" <= as_of
    AND (event_family IS NULL OR e."eventType" = event_family OR e."eventType" LIKE event_family || '.%')
    AND (event_outcome IS NULL OR e."outcome" = event_outcome)
    AND (actor_id_filter IS NULL OR e."actorId" = actor_id_filter)
    AND (entity_type_filter IS NULL OR e."entityType" = entity_type_filter)
    AND (entity_id_filter IS NULL OR e."entityId" = entity_id_filter)
    AND (approval_request_filter IS NULL OR e."approvalRequestId" = approval_request_filter)
    AND (approval_execution_filter IS NULL OR e."approvalExecutionId" = approval_execution_filter)
    AND (correlation_filter IS NULL OR e."serverCorrelationId" = correlation_filter)
    AND (causation_filter IS NULL OR e."causationId" = causation_filter)
    AND (bulk_operation_filter IS NULL OR e."bulkOperationId" = bulk_operation_filter)
    AND (bulk_item_filter IS NULL OR e."bulkItemId" = bulk_item_filter)
    AND (source_filter IS NULL OR e."source" = source_filter)
    AND (retention_filter IS NULL OR e."retentionClass" = retention_filter)
    AND (last_event_id IS NULL OR
      (sort_direction = 'asc' AND (
        (sort_field = 'occurredAt' AND (e."occurredAt",e."occurredAt",e."id") > (parsed_last_sort_time,last_occurred_at,last_event_id)) OR
        (sort_field = 'eventType' AND (e."eventType",e."occurredAt",e."id") > (last_sort_value,last_occurred_at,last_event_id)) OR
        (sort_field = 'outcome' AND (e."outcome",e."occurredAt",e."id") > (last_sort_value,last_occurred_at,last_event_id))
      )) OR (sort_direction = 'desc' AND (
        (sort_field = 'occurredAt' AND (e."occurredAt",e."occurredAt",e."id") < (parsed_last_sort_time,last_occurred_at,last_event_id)) OR
        (sort_field = 'eventType' AND (e."eventType",e."occurredAt",e."id") < (last_sort_value,last_occurred_at,last_event_id)) OR
        (sort_field = 'outcome' AND (e."outcome",e."occurredAt",e."id") < (last_sort_value,last_occurred_at,last_event_id))
      )))
  ORDER BY
    CASE WHEN sort_direction='asc' AND sort_field='occurredAt' THEN e."occurredAt" END ASC,
    CASE WHEN sort_direction='asc' AND sort_field='eventType' THEN e."eventType" END ASC,
    CASE WHEN sort_direction='asc' AND sort_field='outcome' THEN e."outcome" END ASC,
    CASE WHEN sort_direction='desc' AND sort_field='occurredAt' THEN e."occurredAt" END DESC,
    CASE WHEN sort_direction='desc' AND sort_field='eventType' THEN e."eventType" END DESC,
    CASE WHEN sort_direction='desc' AND sort_field='outcome' THEN e."outcome" END DESC,
    CASE WHEN sort_direction='asc' THEN e."occurredAt" END ASC,
    CASE WHEN sort_direction='desc' THEN e."occurredAt" END DESC,
    CASE WHEN sort_direction='asc' THEN e."id" END ASC,
    CASE WHEN sort_direction='desc' THEN e."id" END DESC
  LIMIT result_limit;
END;
$$;

CREATE OR REPLACE FUNCTION audit_reader_detail_v1(event_id TEXT)
RETURNS TABLE(event JSONB, scope_refs JSONB) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE bound RECORD;
BEGIN
  SELECT * INTO bound FROM public.audit_runtime_bound_context_v1('tyre_audit_v2_reader','reader');
  IF NOT FOUND OR event_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' THEN RETURN; END IF;
  RETURN QUERY SELECT to_jsonb(e), COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'dimension',r."dimension",'scopeId',r."scopeId") ORDER BY r."ordinal")
    FROM public."AuditEventScopeRefV2" r WHERE r."eventId"=e."id"), '[]'::jsonb)
  FROM public."AuditEventV2" e
  JOIN public.authorized_audit_event_v2(bound.viewer_id,bound.session_id) auth ON auth."id"=e."id"
  JOIN public."AuditReaderPublishedSchema" pub ON pub."eventType"=e."eventType"
    AND pub."schemaVersion"=e."schemaVersion" AND pub."registryDigest"=e."registryDigest"
  WHERE e."id"=event_id LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION audit_writer_record_cursor_rejected_v1(validation_code TEXT, presented_key_id TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE bound RECORD; event_id TEXT := gen_random_uuid()::text;
BEGIN
  SELECT * INTO bound FROM public.audit_runtime_bound_context_v1('tyre_audit_v2_writer','writer');
  IF NOT FOUND OR validation_code NOT IN ('INVALID_CURSOR','BOUNDARY_MISMATCH')
     OR (presented_key_id IS NOT NULL AND presented_key_id !~ '^[A-Za-z0-9_-]{1,64}$') THEN RETURN NULL; END IF;
  INSERT INTO public."AuditEventV2" (
    "id","eventType","schemaVersion","registryDigestVersion","registryDigest","actorId","actorType","sessionId",
    "subjectType","action","entityType","authorizationScopeKind","scopeMatchMode","requiredGlobalGrant",
    "scopeResolverId","scopeResolverVersion","authorizationPolicyVersion","outcome","safeBefore","safeAfter",
    "safeMetadata","serverCorrelationId","source","retentionClass"
  ) VALUES (
    event_id,'audit.reader.cursor_rejected',1,1,'l-jcdhxxJW2iyRwvMiNTO2p-uEFoPqJJm3F2g-bbciM',
    bound.viewer_id,'staff',bound.session_id,'audit_reader','audit.reader.cursor.validate','AuditCursor',
    'global_security','all','audit.read_security','audit-reader-security-v1',1,1,'denied','[]'::jsonb,'[]'::jsonb,
    jsonb_build_array(jsonb_build_object('key','code','label','Validation code','classification','public_operational','value',validation_code)) ||
      CASE WHEN presented_key_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object(
        'key','keyId','label','Cursor key','classification','masked','value','[masked]')) END,
    gen_random_uuid()::text,'admin_api','security_control'
  );
  RETURN event_id;
END;
$$;

-- Every definer entry point is owned by the NOLOGIN guard and has an exact
-- search_path. Raw/internal functions are not executable by runtime roles.
ALTER FUNCTION audit_base64url(BYTEA) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_runtime_signature_payload_v1(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_runtime_bind_internal_v1(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_reader_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_writer_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_runtime_bound_context_v1(TEXT,TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION authorized_audit_event_v2(TEXT,TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_reader_runtime_contract_v1(TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_writer_runtime_contract_v1(TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_reader_current_context_v1() OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_reader_list_v1(TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TIMESTAMPTZ,TEXT,INTEGER) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_reader_detail_v1(TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_writer_record_cursor_rejected_v1(TEXT,TEXT) OWNER TO tyre_audit_v2_guard_owner;

-- Trigger admission executes with the locked owner while runtime logins retain
-- no direct table access. All pre-existing audit helpers receive a pinned path.
ALTER FUNCTION reject_audit_v2_mutation() SET search_path = pg_catalog, public;
ALTER FUNCTION reject_audit_v2_mutation() OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_v2_safe_text(TEXT,INTEGER) SET search_path = pg_catalog, public;
ALTER FUNCTION audit_v2_safe_text(TEXT,INTEGER) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_v2_projection_is_valid(JSONB,JSONB) SET search_path = pg_catalog, public;
ALTER FUNCTION audit_v2_projection_is_valid(JSONB,JSONB) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION validate_audit_registry_v2_insert() SECURITY DEFINER;
ALTER FUNCTION validate_audit_registry_v2_insert() SET search_path = pg_catalog, public;
ALTER FUNCTION validate_audit_registry_v2_insert() OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION validate_audit_event_v2_projection(TEXT) SECURITY DEFINER;
ALTER FUNCTION validate_audit_event_v2_projection(TEXT) SET search_path = pg_catalog, public;
ALTER FUNCTION validate_audit_event_v2_projection(TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION validate_audit_event_v2_projection_trigger() SECURITY DEFINER;
ALTER FUNCTION validate_audit_event_v2_projection_trigger() SET search_path = pg_catalog, public;
ALTER FUNCTION validate_audit_event_v2_projection_trigger() OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION reject_audit_runtime_control_mutation() SET search_path = pg_catalog, public;
ALTER FUNCTION reject_audit_runtime_control_mutation() OWNER TO tyre_audit_v2_guard_owner;

REVOKE ALL ON FUNCTION
  audit_base64url(BYTEA),
  audit_runtime_signature_payload_v1(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT),
  audit_runtime_bind_internal_v1(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT),
  audit_reader_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT),
  audit_writer_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT),
  audit_runtime_bound_context_v1(TEXT,TEXT),
  authorized_audit_event_v2(TEXT,TEXT),
  audit_reader_runtime_contract_v1(TEXT),
  audit_writer_runtime_contract_v1(TEXT),
  audit_reader_current_context_v1(),
  audit_reader_list_v1(TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TIMESTAMPTZ,TEXT,INTEGER),
  audit_reader_detail_v1(TEXT),
  audit_writer_record_cursor_rejected_v1(TEXT,TEXT),
  validate_audit_registry_v2_insert(),
  validate_audit_event_v2_projection(TEXT),
  validate_audit_event_v2_projection_trigger()
FROM PUBLIC;
REVOKE ALL ON FUNCTION authorized_audit_event_v2(TEXT,TEXT) FROM tyre_audit_v2_reader, tyre_audit_v2_writer;
GRANT EXECUTE ON FUNCTION audit_reader_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT),
  audit_reader_runtime_contract_v1(TEXT), audit_reader_current_context_v1(),
  audit_reader_list_v1(TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT,TIMESTAMPTZ,TEXT,INTEGER),
  audit_reader_detail_v1(TEXT) TO tyre_audit_v2_reader;
GRANT EXECUTE ON FUNCTION audit_writer_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT),
  audit_writer_runtime_contract_v1(TEXT), audit_writer_record_cursor_rejected_v1(TEXT,TEXT) TO tyre_audit_v2_writer;
