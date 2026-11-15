-- Phase C0 security remediation. This is intentionally policy-neutral: it
-- hardens ownership and provisions only the existing API's database boundary.

DO $$
DECLARE membership RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tyre_customer_master_owner') THEN
    RAISE EXCEPTION 'CUSTOMER_MASTER_OWNER_REQUIRED';
  END IF;

  FOR membership IN
    SELECT granted.rolname AS granted_role, member.rolname AS member_role
    FROM pg_auth_members am
    JOIN pg_roles granted ON granted.oid = am.roleid
    JOIN pg_roles member ON member.oid = am.member
    WHERE granted.rolname = 'tyre_customer_master_owner'
       OR member.rolname = 'tyre_customer_master_owner'
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
  END LOOP;
END $$;

ALTER ROLE tyre_customer_master_owner
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

DO $$ BEGIN
  IF EXISTS (
    WITH RECURSIVE owner_members(member) AS (
      SELECT am.member FROM pg_auth_members am
      JOIN pg_roles r ON r.oid = am.roleid
      WHERE r.rolname = 'tyre_customer_master_owner'
      UNION
      SELECT am.member FROM pg_auth_members am
      JOIN owner_members inherited ON inherited.member = am.roleid
    )
    SELECT 1 FROM owner_members closure JOIN pg_roles r ON r.oid = closure.member
    WHERE r.rolcanlogin
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members am
    JOIN pg_roles r ON r.oid IN (am.roleid, am.member)
    WHERE r.rolname = 'tyre_customer_master_owner'
  ) THEN
    RAISE EXCEPTION 'CUSTOMER_MASTER_OWNER_REACHABLE_BY_LOGIN';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tyre_app_runtime') THEN
    CREATE ROLE tyre_app_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tyre_api_runtime') THEN
    CREATE ROLE tyre_api_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

ALTER ROLE tyre_app_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE tyre_api_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

DO $$
DECLARE membership RECORD;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS granted_role, member.rolname AS member_role
    FROM pg_auth_members am
    JOIN pg_roles granted ON granted.oid = am.roleid
    JOIN pg_roles member ON member.oid = am.member
    WHERE member.rolname IN ('tyre_api_runtime', 'tyre_app_runtime')
       OR granted.rolname = 'tyre_app_runtime'
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
  END LOOP;
END $$;

GRANT tyre_app_runtime TO tyre_api_runtime;
GRANT USAGE ON SCHEMA public TO tyre_app_runtime;

-- Exact existing application tables. CustomerMaster and the locked Audit V2 /
-- Jobs tables are deliberately absent; their dedicated role boundaries remain.
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

REVOKE ALL ON TABLE "CustomerMaster" FROM tyre_app_runtime, tyre_api_runtime;
REVOKE ALL ON FUNCTION customer_master_server_fields_v1() FROM tyre_app_runtime, tyre_api_runtime;

DO $$ BEGIN
  IF (SELECT count(*) FROM pg_auth_members am
      JOIN pg_roles granted ON granted.oid = am.roleid
      JOIN pg_roles member ON member.oid = am.member
      WHERE member.rolname = 'tyre_api_runtime'
        AND granted.rolname = 'tyre_app_runtime') <> 1
     OR EXISTS (
       SELECT 1 FROM pg_auth_members am
       JOIN pg_roles member ON member.oid = am.member
       JOIN pg_roles granted ON granted.oid = am.roleid
       WHERE member.rolname = 'tyre_api_runtime'
         AND granted.rolname <> 'tyre_app_runtime'
     )
     OR EXISTS (
       SELECT 1 FROM pg_auth_members am
       JOIN pg_roles member ON member.oid = am.member
       WHERE member.rolname = 'tyre_app_runtime'
     )
     OR has_table_privilege('tyre_api_runtime', 'public."CustomerMaster"', 'SELECT,INSERT,UPDATE,DELETE')
  THEN
    RAISE EXCEPTION 'API_RUNTIME_ROLE_ATTESTATION_FAILED';
  END IF;
END $$;
