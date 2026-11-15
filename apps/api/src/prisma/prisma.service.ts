import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export const ORDINARY_RUNTIME_TABLES = [
  'Product', 'Brand', 'TireModel', 'TireModelPhoto', 'Admin',
  'StaffSession', 'RefreshToken', 'RefreshRotationReceipt', 'StaffInvitation',
  'SecretDeliveryEnvelope', 'SecretDeliveryOutbox', 'MfaCredential',
  'MfaRecoveryCode', 'AuthChallenge', 'StaffRecoveryRequest',
  'AuthThrottleBucket', 'StaffMutationRequest', 'IdentityKeyRotation',
  'IdentityKeyCompromise', 'IdentityArtifactReissue', 'ActionIntent',
  'GovernanceIdempotencyRecord', 'ApprovalPolicyProposal',
  'ApprovalBootstrapEvidenceAdmission', 'ApprovalPolicyReviewDecision',
  'ApprovalPolicy', 'ApprovalPolicyActivation', 'ApprovalPolicyActiveSlot',
  'ApprovalRequest', 'ApprovalDecision', 'ApprovalExecution', 'SecurityControl',
  'Role', 'Permission', 'RolePermission', 'AdminRoleAssignment', 'AuditEvent',
  'Order', 'OrderItem', 'PaymentAttempt', 'PaymentEvent', 'VehicleMake',
  'VehicleModel', 'VehicleFitment',
] as const;

/**
 * Single point of database access for the whole API (per docs/05-CONVENTIONS.md:
 * "Prisma for all database access"). Inject this, never `new PrismaClient()`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      if ((process.env.APP_ENV ?? process.env.NODE_ENV) === 'production') {
        await this.assertRuntimeBoundary();
      }
      this.logger.log('Connected to the database.');
    } catch (err) {
      if ((process.env.APP_ENV ?? process.env.NODE_ENV) === 'production') {
        throw err;
      }
      // Foundation phase: the API must still boot (e.g. for /health) before the
      // local dev database exists. Prisma reconnects lazily on the first query.
      this.logger.warn(
        'Database not reachable yet — booting without a connection. ' +
          'Start it with "docker compose up -d db" and apply the migration. ' +
          `(${(err as Error).message})`,
      );
    }
  }

  /** Startup and readiness attestation for the primary API pool. */
  async assertRuntimeBoundary(): Promise<void> {
    const expectedTableValues = [...ORDINARY_RUNTIME_TABLES, "CommerceCustomer", "StockReservation", "OperationsCommand", "RefundRequest"]
      .map((name) => `('${name}')`)
      .join(',');
    const [boundary] = await this.$queryRawUnsafe<Array<{
      login: string;
      roleAttributeViolations: bigint;
      membershipViolations: bigint;
      missingPrivileges: bigint;
      extraPrivileges: bigint;
    }>>(`
      WITH RECURSIVE
      runtime_roles(role_name, role_oid) AS (
        SELECT rolname, oid FROM pg_roles
        WHERE rolname IN ('tyre_app_runtime', 'tyre_api_runtime')
      ),
      bidirectional_roles(role_oid) AS (
        SELECT role_oid FROM runtime_roles
        UNION
        SELECT CASE WHEN am.roleid = closure.role_oid THEN am.member ELSE am.roleid END
        FROM bidirectional_roles closure
        JOIN pg_auth_members am
          ON am.roleid = closure.role_oid OR am.member = closure.role_oid
      ),
      expected_tables(table_name) AS (VALUES ${expectedTableValues}),
      expected_privileges(role_name, object_kind, object_name, privilege_type) AS (
        SELECT r.role_name, 'schema', 'public', 'USAGE' FROM runtime_roles r
        UNION ALL
        SELECT r.role_name, 'table', 'public.' || t.table_name, p.privilege_type
        FROM runtime_roles r CROSS JOIN expected_tables t
        CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) p(privilege_type)
        UNION ALL
        SELECT r.role_name, 'table', 'public.StockMovement', p.privilege_type
        FROM runtime_roles r CROSS JOIN (VALUES ('SELECT'),('INSERT')) p(privilege_type)
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
        CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                           ('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege_type)
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
        FROM runtime_roles r
        CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
          AND has_function_privilege(r.role_name, p.oid, 'EXECUTE')
      ),
      actual_memberships(granted_role, member_role, admin_option, inherit_option, set_option) AS (
        SELECT granted.rolname, member.rolname,
               am.admin_option, am.inherit_option, am.set_option
        FROM pg_auth_members am
        JOIN pg_roles granted ON granted.oid = am.roleid
        JOIN pg_roles member ON member.oid = am.member
        WHERE am.roleid IN (SELECT role_oid FROM bidirectional_roles)
           OR am.member IN (SELECT role_oid FROM bidirectional_roles)
      ),
      expected_memberships(granted_role, member_role, admin_option, inherit_option, set_option) AS (
        VALUES ('tyre_app_runtime'::name, 'tyre_api_runtime'::name, false, true, false)
      ),
      missing_memberships AS (
        SELECT * FROM expected_memberships EXCEPT SELECT * FROM actual_memberships
      ),
      extra_memberships AS (
        SELECT * FROM actual_memberships EXCEPT SELECT * FROM expected_memberships
      ),
      attribute_violations AS (
        SELECT 1 FROM pg_roles r
        WHERE (r.rolname = 'tyre_app_runtime' AND
               (r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR
                r.rolcreaterole OR r.rolreplication OR r.rolbypassrls))
           OR (r.rolname = 'tyre_api_runtime' AND
               (NOT r.rolcanlogin OR NOT r.rolinherit OR r.rolsuper OR r.rolcreatedb OR
                r.rolcreaterole OR r.rolreplication OR r.rolbypassrls))
      )
      SELECT session_user AS login,
             (SELECT count(*) FROM attribute_violations)
               + CASE WHEN (SELECT count(*) FROM runtime_roles) = 2 THEN 0 ELSE 1 END
               AS "roleAttributeViolations",
             (SELECT count(*) FROM missing_memberships)
               + (SELECT count(*) FROM extra_memberships) AS "membershipViolations",
             (SELECT count(*) FROM (
                SELECT * FROM expected_privileges EXCEPT SELECT * FROM actual_privileges
              ) missing) AS "missingPrivileges",
             (SELECT count(*) FROM (
                SELECT * FROM actual_privileges EXCEPT SELECT * FROM expected_privileges
              ) extra) AS "extraPrivileges"
    `);

    if (!boundary || boundary.login !== 'tyre_api_runtime' ||
        Number(boundary.roleAttributeViolations) !== 0 ||
        Number(boundary.membershipViolations) !== 0 ||
        Number(boundary.missingPrivileges) !== 0 ||
        Number(boundary.extraPrivileges) !== 0) {
      throw new Error('DATABASE_RUNTIME_BOUNDARY_ATTESTATION_FAILED');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
