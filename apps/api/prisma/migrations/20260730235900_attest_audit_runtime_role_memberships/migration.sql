-- Increment 3B follow-up: PostgreSQL role membership options are part of the
-- runtime trust boundary. INHERIT FALSE does not make a membership harmless
-- when SET TRUE still permits an explicit SET ROLE into a more powerful role.
DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 160000 THEN
    RAISE EXCEPTION 'AUDIT_RUNTIME_MEMBERSHIP_ATTESTATION_REQUIRES_POSTGRES_16';
  END IF;
END $$;

-- The two group roles must not themselves inherit or SET ROLE into any parent.
-- Remove such edges when the migration principal controls them; otherwise fail
-- instead of silently accepting externally owned privilege state.
DO $$
DECLARE
  edge RECORD;
  migration_is_superuser BOOLEAN;
BEGIN
  SELECT rolsuper INTO migration_is_superuser FROM pg_roles WHERE rolname = current_user;
  FOR edge IN
    SELECT parent.rolname AS parent_name, child.rolname AS child_name, m.grantor
    FROM pg_auth_members m
    JOIN pg_roles parent ON parent.oid = m.roleid
    JOIN pg_roles child ON child.oid = m.member
    WHERE child.rolname IN ('tyre_audit_v2_reader','tyre_audit_v2_writer')
  LOOP
    IF migration_is_superuser OR edge.grantor = (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN
      EXECUTE format('REVOKE %I FROM %I', edge.parent_name, edge.child_name);
    ELSE
      RAISE EXCEPTION 'AUDIT_RUNTIME_GROUP_HAS_EXTERNALLY_OWNED_PARENT_MEMBERSHIP';
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION audit_runtime_membership_contract_v1(expected_group TEXT)
RETURNS TABLE(
  database_login TEXT,
  database_group TEXT,
  server_version_num INTEGER,
  membership_graph JSONB,
  membership_graph_digest TEXT,
  contract_valid BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  login_oid OID;
BEGIN
  IF expected_group NOT IN ('tyre_audit_v2_reader','tyre_audit_v2_writer') THEN RETURN; END IF;
  SELECT oid INTO login_oid FROM pg_catalog.pg_roles WHERE rolname = session_user;
  IF login_oid IS NULL OR session_user IN (
    'tyre_audit_v2_guard_owner','tyre_audit_v2_reader','tyre_audit_v2_writer'
  ) THEN RETURN; END IF;

  RETURN QUERY
  WITH RECURSIVE membership_walk AS (
    SELECT
      m.member AS from_oid,
      m.roleid AS to_oid,
      child.rolname::TEXT AS from_name,
      parent.rolname::TEXT AS to_name,
      1 AS depth,
      m.inherit_option AS edge_inherit,
      m.set_option AS edge_set,
      m.admin_option AS edge_admin,
      m.inherit_option AS path_inherit,
      m.set_option AS path_set,
      m.admin_option AS path_admin,
      ARRAY[m.member,m.roleid]::OID[] AS path_oids,
      ARRAY[child.rolname::TEXT,parent.rolname::TEXT]::TEXT[] AS path_names,
      m.roleid = m.member AS cycle
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles child ON child.oid = m.member
    JOIN pg_catalog.pg_roles parent ON parent.oid = m.roleid
    WHERE m.member = login_oid

    UNION ALL

    SELECT
      m.member,
      m.roleid,
      child.rolname::TEXT,
      parent.rolname::TEXT,
      walk.depth + 1,
      m.inherit_option,
      m.set_option,
      m.admin_option,
      walk.path_inherit AND m.inherit_option,
      walk.path_set AND m.set_option,
      walk.path_admin OR m.admin_option,
      walk.path_oids || m.roleid,
      walk.path_names || parent.rolname::TEXT,
      m.roleid = ANY(walk.path_oids)
    FROM membership_walk walk
    JOIN pg_catalog.pg_auth_members m ON m.member = walk.to_oid
    JOIN pg_catalog.pg_roles child ON child.oid = m.member
    JOIN pg_catalog.pg_roles parent ON parent.oid = m.roleid
    WHERE NOT walk.cycle AND walk.depth < 32
  ), decorated AS (
    SELECT walk.*,
      walk.from_name || '>' || walk.to_name ||
      '|depth=' || walk.depth::TEXT ||
      '|inherit=' || walk.edge_inherit::TEXT ||
      '|set=' || walk.edge_set::TEXT ||
      '|admin=' || walk.edge_admin::TEXT ||
      '|pathInherit=' || walk.path_inherit::TEXT ||
      '|pathSet=' || walk.path_set::TEXT ||
      '|pathAdmin=' || walk.path_admin::TEXT ||
      '|cycle=' || walk.cycle::TEXT ||
      '|path=' || array_to_string(walk.path_names, '>') AS canonical_line
    FROM membership_walk walk
  ), aggregate_graph AS (
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object(
        'fromRole', d.from_name,
        'toRole', d.to_name,
        'depth', d.depth,
        'inheritOption', d.edge_inherit,
        'setOption', d.edge_set,
        'adminOption', d.edge_admin,
        'pathInheritCapable', d.path_inherit,
        'pathSetCapable', d.path_set,
        'pathAdminCapable', d.path_admin,
        'cycle', d.cycle,
        'path', to_jsonb(d.path_names)
      ) ORDER BY d.canonical_line COLLATE "C"), '[]'::JSONB) AS graph,
      COALESCE(string_agg(d.canonical_line, E'\n' ORDER BY d.canonical_line COLLATE "C"), '') AS graph_text,
      count(*)::INTEGER AS edge_count,
      bool_or(d.cycle) AS has_cycle,
      bool_or(d.path_set AND d.to_name <> expected_group) AS has_unapproved_set_path,
      bool_or(d.path_admin) AS has_admin_path,
      bool_or(d.depth = 32 AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members continuation WHERE continuation.member = d.to_oid
      )) AS truncated
    FROM decorated d
  )
  SELECT
    session_user::TEXT,
    expected_group,
    current_setting('server_version_num')::INTEGER,
    aggregate_graph.graph,
    public.audit_base64url(public.digest(convert_to(
      'tyre.audit.membership-graph.v1' || chr(10) || session_user || chr(10) || aggregate_graph.graph_text,
      'UTF8'
    ), 'sha256')),
    aggregate_graph.edge_count = 1
      AND NOT COALESCE(aggregate_graph.has_cycle, false)
      AND NOT COALESCE(aggregate_graph.has_unapproved_set_path, false)
      AND NOT COALESCE(aggregate_graph.has_admin_path, false)
      AND NOT COALESCE(aggregate_graph.truncated, false)
      AND EXISTS (
        SELECT 1 FROM decorated d
        WHERE d.depth = 1 AND d.from_name = session_user AND d.to_name = expected_group
          AND d.edge_inherit AND NOT d.edge_set AND NOT d.edge_admin
          AND d.path_inherit AND NOT d.path_set AND NOT d.path_admin AND NOT d.cycle
      )
  FROM aggregate_graph;
END;
$$;

-- A bind starts with a database-issued, transaction-local random challenge.
-- Its guard proof is keyed, includes txid_current() and never leaves the DB.
CREATE OR REPLACE FUNCTION audit_runtime_issue_challenge_internal_v1(
  expected_group TEXT, context_kind TEXT, key_id TEXT
) RETURNS TABLE(challenge TEXT, challenge_txid BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  control public."AuditRuntimeContextKey"%ROWTYPE;
  membership_valid BOOLEAN;
  guard_proof TEXT;
BEGIN
  SELECT contract_valid INTO membership_valid
    FROM public.audit_runtime_membership_contract_v1(expected_group);
  IF NOT COALESCE(membership_valid, false) OR context_kind NOT IN ('reader','writer') THEN RETURN; END IF;
  SELECT * INTO control FROM public."AuditRuntimeContextKey" k
    WHERE k."keyId" = key_id AND k."notBefore" <= clock_timestamp() AND k."expiresAt" > clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM public."AuditRuntimeContextKeyRevocation" r WHERE r."keyId" = k."keyId");
  IF NOT FOUND THEN RETURN; END IF;
  challenge := public.audit_base64url(gen_random_bytes(16));
  challenge_txid := txid_current();
  guard_proof := public.audit_base64url(public.hmac(convert_to(
    'tyre.audit.db-challenge.v1' || chr(10) || context_kind || chr(10) || session_user || chr(10) ||
    key_id || chr(10) || challenge || chr(10) || challenge_txid::TEXT, 'UTF8'
  ), control."keyMaterial", 'sha256'));
  PERFORM set_config('tyre.audit.challenge_kind', context_kind, true);
  PERFORM set_config('tyre.audit.challenge_key_id', key_id, true);
  PERFORM set_config('tyre.audit.challenge', challenge, true);
  PERFORM set_config('tyre.audit.challenge_txid', challenge_txid::TEXT, true);
  PERFORM set_config('tyre.audit.challenge_proof', guard_proof, true);
  PERFORM set_config('tyre.audit.challenge_consumed', 'false', true);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION audit_reader_issue_challenge_v1(key_id TEXT)
RETURNS TABLE(challenge TEXT, challenge_txid BIGINT)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT * FROM public.audit_runtime_issue_challenge_internal_v1('tyre_audit_v2_reader','reader',key_id) $$;

CREATE OR REPLACE FUNCTION audit_writer_issue_challenge_v1(key_id TEXT)
RETURNS TABLE(challenge TEXT, challenge_txid BIGINT)
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT * FROM public.audit_runtime_issue_challenge_internal_v1('tyre_audit_v2_writer','writer',key_id) $$;

CREATE OR REPLACE FUNCTION audit_runtime_signature_payload_v2(
  context_kind TEXT, database_login TEXT, key_id TEXT, viewer_id TEXT, session_id TEXT,
  issued_at_epoch_ms BIGINT, expires_at_epoch_ms BIGINT, nonce TEXT,
  challenge TEXT, challenge_txid BIGINT
) RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, public
AS $$ SELECT 'tyre.audit.db-context.v2' || chr(10) || context_kind || chr(10) || database_login || chr(10) ||
  key_id || chr(10) || viewer_id || chr(10) || session_id || chr(10) || issued_at_epoch_ms::TEXT || chr(10) ||
  expires_at_epoch_ms::TEXT || chr(10) || nonce || chr(10) || challenge || chr(10) || challenge_txid::TEXT $$;

CREATE OR REPLACE FUNCTION audit_runtime_bind_internal_v2(
  expected_group_role TEXT, context_kind TEXT, key_id TEXT, viewer_id TEXT, session_id TEXT,
  issued_at_epoch_ms BIGINT, expires_at_epoch_ms BIGINT, nonce TEXT, signature TEXT,
  challenge TEXT, challenge_txid BIGINT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  control public."AuditRuntimeContextKey"%ROWTYPE;
  expected_challenge_proof TEXT;
  expected_signature TEXT;
  now_ms BIGINT := floor(extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;
  proof TEXT;
BEGIN
  IF NOT COALESCE((SELECT contract_valid
      FROM public.audit_runtime_membership_contract_v1(expected_group_role)), false)
     OR context_kind NOT IN ('reader','writer') OR viewer_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
     OR session_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' OR nonce !~ '^[A-Za-z0-9_-]{22}$'
     OR signature !~ '^[A-Za-z0-9_-]{43}$' OR challenge !~ '^[A-Za-z0-9_-]{22}$'
     OR challenge_txid <> txid_current()
     OR current_setting('tyre.audit.challenge_kind', true) IS DISTINCT FROM context_kind
     OR current_setting('tyre.audit.challenge_key_id', true) IS DISTINCT FROM key_id
     OR current_setting('tyre.audit.challenge', true) IS DISTINCT FROM challenge
     OR current_setting('tyre.audit.challenge_txid', true) IS DISTINCT FROM challenge_txid::TEXT
     OR current_setting('tyre.audit.challenge_consumed', true) IS DISTINCT FROM 'false'
  THEN RETURN false; END IF;

  SELECT * INTO control FROM public."AuditRuntimeContextKey" k
    WHERE k."keyId" = key_id AND k."notBefore" <= clock_timestamp() AND k."expiresAt" > clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM public."AuditRuntimeContextKeyRevocation" r WHERE r."keyId" = k."keyId");
  IF NOT FOUND OR issued_at_epoch_ms > now_ms + 1000 OR expires_at_epoch_ms <= now_ms
     OR expires_at_epoch_ms - issued_at_epoch_ms > control."maxContextTtlSeconds" * 1000 THEN RETURN false; END IF;

  expected_challenge_proof := public.audit_base64url(public.hmac(convert_to(
    'tyre.audit.db-challenge.v1' || chr(10) || context_kind || chr(10) || session_user || chr(10) ||
    key_id || chr(10) || challenge || chr(10) || challenge_txid::TEXT, 'UTF8'
  ), control."keyMaterial", 'sha256'));
  IF expected_challenge_proof IS DISTINCT FROM current_setting('tyre.audit.challenge_proof', true) THEN RETURN false; END IF;

  expected_signature := public.audit_base64url(public.hmac(convert_to(public.audit_runtime_signature_payload_v2(
    context_kind, session_user, key_id, viewer_id, session_id, issued_at_epoch_ms, expires_at_epoch_ms,
    nonce, challenge, challenge_txid
  ), 'UTF8'), control."keyMaterial", 'sha256'));
  IF expected_signature <> signature THEN RETURN false; END IF;

  -- Consume before identity evaluation. A valid signature has exactly one bind
  -- attempt in this transaction, regardless of success or failure afterwards.
  PERFORM set_config('tyre.audit.challenge_consumed', 'true', true);
  PERFORM set_config('tyre.audit.challenge_proof', '', true);

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
    expires_at_epoch_ms::TEXT || chr(10) || txid_current()::TEXT, 'UTF8'), control."keyMaterial", 'sha256'));
  PERFORM set_config('tyre.audit.context_kind', context_kind, true);
  PERFORM set_config('tyre.audit.viewer_id', viewer_id, true);
  PERFORM set_config('tyre.audit.session_id', session_id, true);
  PERFORM set_config('tyre.audit.key_id', key_id, true);
  PERFORM set_config('tyre.audit.expires_ms', expires_at_epoch_ms::TEXT, true);
  PERFORM set_config('tyre.audit.bound_proof', proof, true);
  RETURN true;
END;
$$;

-- Remove the replayable v1 bind entry points before granting the v2 signatures.
DROP FUNCTION audit_reader_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT);
DROP FUNCTION audit_writer_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT);
DROP FUNCTION audit_runtime_bind_internal_v1(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT);
DROP FUNCTION audit_runtime_signature_payload_v1(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT);

CREATE FUNCTION audit_reader_bind_context_v1(
  key_id TEXT, viewer_id TEXT, session_id TEXT, issued_at_epoch_ms BIGINT,
  expires_at_epoch_ms BIGINT, nonce TEXT, signature TEXT, challenge TEXT, challenge_txid BIGINT
) RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT public.audit_runtime_bind_internal_v2('tyre_audit_v2_reader','reader',key_id,viewer_id,session_id,
  issued_at_epoch_ms,expires_at_epoch_ms,nonce,signature,challenge,challenge_txid) $$;

CREATE FUNCTION audit_writer_bind_context_v1(
  key_id TEXT, viewer_id TEXT, session_id TEXT, issued_at_epoch_ms BIGINT,
  expires_at_epoch_ms BIGINT, nonce TEXT, signature TEXT, challenge TEXT, challenge_txid BIGINT
) RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT public.audit_runtime_bind_internal_v2('tyre_audit_v2_writer','writer',key_id,viewer_id,session_id,
  issued_at_epoch_ms,expires_at_epoch_ms,nonce,signature,challenge,challenge_txid) $$;

ALTER FUNCTION audit_runtime_membership_contract_v1(TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_runtime_issue_challenge_internal_v1(TEXT,TEXT,TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_reader_issue_challenge_v1(TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_writer_issue_challenge_v1(TEXT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_runtime_signature_payload_v2(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,BIGINT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_runtime_bind_internal_v2(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_reader_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT) OWNER TO tyre_audit_v2_guard_owner;
ALTER FUNCTION audit_writer_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT) OWNER TO tyre_audit_v2_guard_owner;

REVOKE ALL ON FUNCTION
  audit_runtime_membership_contract_v1(TEXT),
  audit_runtime_issue_challenge_internal_v1(TEXT,TEXT,TEXT),
  audit_reader_issue_challenge_v1(TEXT),
  audit_writer_issue_challenge_v1(TEXT),
  audit_runtime_signature_payload_v2(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,BIGINT),
  audit_runtime_bind_internal_v2(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT),
  audit_reader_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT),
  audit_writer_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_runtime_membership_contract_v1(TEXT) TO tyre_audit_v2_reader, tyre_audit_v2_writer;
GRANT EXECUTE ON FUNCTION audit_reader_issue_challenge_v1(TEXT),
  audit_reader_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT)
TO tyre_audit_v2_reader;
GRANT EXECUTE ON FUNCTION audit_writer_issue_challenge_v1(TEXT),
  audit_writer_bind_context_v1(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,TEXT,BIGINT)
TO tyre_audit_v2_writer;
