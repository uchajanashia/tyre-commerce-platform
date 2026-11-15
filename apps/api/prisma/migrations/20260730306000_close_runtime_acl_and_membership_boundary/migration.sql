-- Phase C0 final security closure. Migration 22 may already be recorded on a
-- populated database, so this additive migration normalizes both reused
-- runtime roles before rebuilding the ordinary API contract from zero.

ALTER ROLE tyre_app_runtime
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE tyre_api_runtime
  LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

-- Remove every inbound and outbound edge touching either reused role. This
-- severs direct and transitive proxy paths in both directions. PostgreSQL 16
-- membership options are rebuilt explicitly below.
DO $$
DECLARE membership RECORD;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS granted_role, member.rolname AS member_role
    FROM pg_auth_members am
    JOIN pg_roles granted ON granted.oid = am.roleid
    JOIN pg_roles member ON member.oid = am.member
    WHERE granted.rolname IN ('tyre_app_runtime', 'tyre_api_runtime')
       OR member.rolname IN ('tyre_app_runtime', 'tyre_api_runtime')
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
  END LOOP;
END $$;

-- Normalize all existing direct ACLs in every non-system schema before
-- granting the exact contract. PUBLIC must not provide a side door to raw
-- relations, sequences, functions, or schema mutation. Only public.USAGE is
-- retained as the ordinary lookup boundary.
DO $$
DECLARE schema_record RECORD;
BEGIN
  FOR schema_record IN
    SELECT nspname FROM pg_namespace
    WHERE nspname <> 'information_schema' AND nspname !~ '^pg_'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM tyre_app_runtime, tyre_api_runtime',
      schema_record.nspname
    );
    IF schema_record.nspname = 'public' THEN
      EXECUTE 'REVOKE CREATE ON SCHEMA public FROM PUBLIC';
    ELSE
      EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA %I FROM PUBLIC', schema_record.nspname);
    END IF;
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM PUBLIC, tyre_app_runtime, tyre_api_runtime',
      schema_record.nspname
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC, tyre_app_runtime, tyre_api_runtime',
      schema_record.nspname
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC, tyre_app_runtime, tyre_api_runtime',
      schema_record.nspname
    );
  END LOOP;
END $$;

-- Remove hostile pre-existing default ACLs granted directly to either runtime
-- role. Also prevent owners of current public objects (and this migration role)
-- from reintroducing PUBLIC function execution or runtime ACLs by default.
DO $$
DECLARE default_acl RECORD;
DECLARE object_words TEXT;
DECLARE schema_clause TEXT;
BEGIN
  FOR default_acl IN
    SELECT DISTINCT owner_role.rolname AS owner_name, d.defaclobjtype,
           d.defaclnamespace, n.nspname
    FROM pg_default_acl d
    JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    WHERE acl.grantee IN ('tyre_app_runtime'::regrole, 'tyre_api_runtime'::regrole)
  LOOP
    object_words := CASE default_acl.defaclobjtype
      WHEN 'r' THEN 'TABLES'
      WHEN 'S' THEN 'SEQUENCES'
      WHEN 'f' THEN 'FUNCTIONS'
      WHEN 'T' THEN 'TYPES'
      WHEN 'n' THEN 'SCHEMAS'
      ELSE NULL
    END;
    IF object_words IS NULL THEN
      RAISE EXCEPTION 'UNSUPPORTED_RUNTIME_DEFAULT_ACL_TYPE (%)', default_acl.defaclobjtype;
    END IF;
    schema_clause := CASE
      WHEN default_acl.defaclnamespace <> 0
        THEN format(' IN SCHEMA %I', default_acl.nspname)
      ELSE ''
    END;
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE ALL ON %s FROM tyre_app_runtime, tyre_api_runtime',
      default_acl.owner_name, schema_clause, object_words
    );
  END LOOP;
END $$;

DO $$
DECLARE owner_role RECORD;
BEGIN
  FOR owner_role IN
    SELECT DISTINCT r.rolname
    FROM pg_roles r
    WHERE r.oid = current_user::regrole
       OR EXISTS (
         SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relowner = r.oid AND n.nspname = 'public'
       )
       OR EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proowner = r.oid AND n.nspname = 'public'
       )
       OR EXISTS (
         SELECT 1 FROM pg_default_acl d
         CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
         WHERE d.defaclrole = r.oid
           AND acl.grantee IN ('tyre_app_runtime'::regrole, 'tyre_api_runtime'::regrole)
       )
  LOOP
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM tyre_app_runtime, tyre_api_runtime',
      owner_role.rolname
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM tyre_app_runtime, tyre_api_runtime',
      owner_role.rolname
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, tyre_app_runtime, tyre_api_runtime',
      owner_role.rolname
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SCHEMAS FROM tyre_app_runtime, tyre_api_runtime',
      owner_role.rolname
    );
  END LOOP;
END $$;

GRANT tyre_app_runtime TO tyre_api_runtime
  WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
GRANT USAGE ON SCHEMA public TO tyre_app_runtime;

-- Exact ordinary-application allowlist: four DML privileges on 44 existing
-- Prisma tables. CustomerMaster, all Audit V2 objects, and all Jobs objects are
-- intentionally absent. No sequence or function privilege is contracted.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "Product", "Brand", "TireModel", "TireModelPhoto", "Admin",
  "StaffSession", "RefreshToken", "RefreshRotationReceipt", "StaffInvitation",
  "SecretDeliveryEnvelope", "SecretDeliveryOutbox", "MfaCredential",
  "MfaRecoveryCode", "AuthChallenge", "StaffRecoveryRequest",
  "AuthThrottleBucket", "StaffMutationRequest", "IdentityKeyRotation",
  "IdentityKeyCompromise", "IdentityArtifactReissue", "ActionIntent",
  "GovernanceIdempotencyRecord", "ApprovalPolicyProposal",
  "ApprovalBootstrapEvidenceAdmission", "ApprovalPolicyReviewDecision",
  "ApprovalPolicy", "ApprovalPolicyActivation", "ApprovalPolicyActiveSlot",
  "ApprovalRequest", "ApprovalDecision", "ApprovalExecution", "SecurityControl",
  "Role", "Permission", "RolePermission", "AdminRoleAssignment", "AuditEvent",
  "Order", "OrderItem", "PaymentAttempt", "PaymentEvent", "VehicleMake",
  "VehicleModel", "VehicleFitment"
TO tyre_app_runtime;

-- Named denials are kept explicit as a reviewable invariant in addition to the
-- revoke-all normalization above.
REVOKE ALL PRIVILEGES ON TABLE "CustomerMaster" FROM PUBLIC, tyre_app_runtime, tyre_api_runtime;
REVOKE ALL PRIVILEGES ON TABLE
  "AuditEventSchemaV2", "AuditEventV2", "AuditEventScopeRefV2",
  "AuditRuntimeContextKey", "AuditRuntimeContextKeyRevocation", "AuditReaderPublishedSchema"
FROM PUBLIC, tyre_app_runtime, tyre_api_runtime;
REVOKE ALL PRIVILEGES ON TABLE
  "JobTypeRegistry", "OutboxMessage", "BackgroundJob", "JobAuthorizationScopeRef",
  "JobOriginBudget", "JobTransactionBudget", "JobAttemptStarted", "JobHeartbeatFact",
  "JobAttemptOutcome", "OutboxConsumerReceipt", "ConsumerReceiptResult",
  "OutboxAcknowledgement", "DispatchFact", "DeadLetterAdmission", "JobReconciliation",
  "JobAuditLink", "JobFenceLossAudit", "JobLeaseDigestKey",
  "JobLeaseDigestKeyRevocation", "JobRuntimeContextKey",
  "JobRuntimeContextKeyRevocation", "JobOperationalPolicy", "JobCapacityReservation",
  "JobGlobalRateBucket", "JobCircuitState", "JobOriginRateBucket"
FROM PUBLIC, tyre_app_runtime, tyre_api_runtime;

-- Migration-time exact attestation. The runtime repeats this recursively on
-- startup/readiness so later drift is fatal.
DO $$
DECLARE violation_count BIGINT;
BEGIN
  WITH RECURSIVE
  runtime_roles(role_name, role_oid) AS (
    SELECT rolname, oid FROM pg_roles
    WHERE rolname IN ('tyre_app_runtime', 'tyre_api_runtime')
  ),
  connected(role_oid) AS (
    SELECT role_oid FROM runtime_roles
    UNION
    SELECT CASE WHEN am.roleid = c.role_oid THEN am.member ELSE am.roleid END
    FROM connected c
    JOIN pg_auth_members am ON am.roleid = c.role_oid OR am.member = c.role_oid
  ),
  expected_tables(table_name) AS (VALUES
    ('Product'),('Brand'),('TireModel'),('TireModelPhoto'),('Admin'),
    ('StaffSession'),('RefreshToken'),('RefreshRotationReceipt'),('StaffInvitation'),
    ('SecretDeliveryEnvelope'),('SecretDeliveryOutbox'),('MfaCredential'),
    ('MfaRecoveryCode'),('AuthChallenge'),('StaffRecoveryRequest'),
    ('AuthThrottleBucket'),('StaffMutationRequest'),('IdentityKeyRotation'),
    ('IdentityKeyCompromise'),('IdentityArtifactReissue'),('ActionIntent'),
    ('GovernanceIdempotencyRecord'),('ApprovalPolicyProposal'),
    ('ApprovalBootstrapEvidenceAdmission'),('ApprovalPolicyReviewDecision'),
    ('ApprovalPolicy'),('ApprovalPolicyActivation'),('ApprovalPolicyActiveSlot'),
    ('ApprovalRequest'),('ApprovalDecision'),('ApprovalExecution'),('SecurityControl'),
    ('Role'),('Permission'),('RolePermission'),('AdminRoleAssignment'),('AuditEvent'),
    ('Order'),('OrderItem'),('PaymentAttempt'),('PaymentEvent'),('VehicleMake'),
    ('VehicleModel'),('VehicleFitment')
  ),
  expected_privileges(role_name, object_kind, object_name, privilege_type) AS (
    SELECT r.role_name, 'schema', 'public', 'USAGE' FROM runtime_roles r
    UNION ALL
    SELECT r.role_name, 'table', 'public.' || t.table_name, p.privilege_type
    FROM runtime_roles r CROSS JOIN expected_tables t
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(privilege_type)
  ),
  actual_privileges(role_name, object_kind, object_name, privilege_type) AS (
    SELECT r.role_name, 'schema', n.nspname, p.privilege_type
    FROM runtime_roles r CROSS JOIN pg_namespace n
    CROSS JOIN (VALUES ('USAGE'),('CREATE')) p(privilege_type)
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND has_schema_privilege(r.role_name, n.oid, p.privilege_type)
    UNION ALL
    SELECT r.role_name, 'table', n.nspname || '.' || c.relname, p.privilege_type
    FROM runtime_roles r
    CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege_type)
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND c.relkind IN ('r','p','v','m','f')
      AND has_table_privilege(r.role_name, c.oid, p.privilege_type)
    UNION ALL
    SELECT r.role_name, 'sequence', n.nspname || '.' || c.relname, p.privilege_type
    FROM runtime_roles r
    CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('USAGE'),('SELECT'),('UPDATE')) p(privilege_type)
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND CASE WHEN c.relkind = 'S'
               THEN has_sequence_privilege(r.role_name, c.oid, p.privilege_type)
               ELSE false END
    UNION ALL
    SELECT r.role_name, 'function',
           n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
           'EXECUTE'
    FROM runtime_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
      AND has_function_privilege(r.role_name, p.oid, 'EXECUTE')
  ),
  privilege_diff AS (
    (SELECT * FROM expected_privileges EXCEPT SELECT * FROM actual_privileges)
    UNION ALL
    (SELECT * FROM actual_privileges EXCEPT SELECT * FROM expected_privileges)
  ),
  actual_memberships(granted_role, member_role, admin_option, inherit_option, set_option) AS (
    SELECT granted.rolname, member.rolname, am.admin_option, am.inherit_option, am.set_option
    FROM pg_auth_members am
    JOIN pg_roles granted ON granted.oid = am.roleid
    JOIN pg_roles member ON member.oid = am.member
    WHERE am.roleid IN (SELECT role_oid FROM connected)
       OR am.member IN (SELECT role_oid FROM connected)
  ),
  expected_memberships(granted_role, member_role, admin_option, inherit_option, set_option) AS (
    VALUES ('tyre_app_runtime'::name, 'tyre_api_runtime'::name, false, true, false)
  ),
  membership_diff AS (
    (SELECT * FROM expected_memberships EXCEPT SELECT * FROM actual_memberships)
    UNION ALL
    (SELECT * FROM actual_memberships EXCEPT SELECT * FROM expected_memberships)
  ),
  attribute_diff AS (
    SELECT 1 FROM pg_roles r
    WHERE (r.rolname = 'tyre_app_runtime' AND
           (r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR
            r.rolcreaterole OR r.rolreplication OR r.rolbypassrls))
       OR (r.rolname = 'tyre_api_runtime' AND
           (NOT r.rolcanlogin OR NOT r.rolinherit OR r.rolsuper OR r.rolcreatedb OR
            r.rolcreaterole OR r.rolreplication OR r.rolbypassrls))
  )
  SELECT (SELECT count(*) FROM privilege_diff)
       + (SELECT count(*) FROM membership_diff)
       + (SELECT count(*) FROM attribute_diff)
       + CASE WHEN (SELECT count(*) FROM runtime_roles) = 2 THEN 0 ELSE 1 END
  INTO violation_count;

  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'API_RUNTIME_EXACT_BOUNDARY_ATTESTATION_FAILED (%)', violation_count;
  END IF;
END $$;
