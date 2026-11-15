import { createHash, createHmac, randomBytes } from 'node:crypto';

import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { AUDIT_READER_CONFIG, AuditReaderConfig } from './audit-reader.config';

export type RestrictedAuditTransaction = Pick<Prisma.TransactionClient, '$queryRaw'>;

interface PrivilegeAttestation {
  databaseLogin: string;
  superuser: boolean;
  createRole: boolean;
  createDb: boolean;
  inheritRole: boolean;
  bypassRls: boolean;
  memberOfExpected: boolean;
  memberOfGuard: boolean;
  rawAuditSelect: boolean;
  rawRbacSelect: boolean;
  auditInsert: boolean;
  auditUpdate: boolean;
  auditDelete: boolean;
  rawScopeSelect: boolean;
  rawRegistrySelect: boolean;
  arbitraryAuthorizationExecute: boolean;
  guardCanLogin: boolean;
}

interface FunctionAttestation {
  functionName: string;
  owner: string;
  securityDefiner: boolean;
  settings: string[] | null;
}

interface ReaderRuntimeContract {
  databaseLogin: string;
  databaseGroup: string;
  keyId: string;
  keyDigest: string;
  maxContextTtlSeconds: number;
  maxPageSize: number;
  maxTimeRangeSeconds: number;
  maxFilters: number;
  readerPolicyVersion: number;
  queryPlanPolicyId: string;
}

interface BoundaryAttestation {
  protectedTableCount: number;
  protectedOwnerCount: number;
  expectedTriggerCount: number;
  enabledTriggerCount: number;
}

interface MembershipEdge {
  fromRole: string;
  toRole: string;
  depth: number;
  inheritOption: boolean;
  setOption: boolean;
  adminOption: boolean;
  pathInheritCapable: boolean;
  pathSetCapable: boolean;
  pathAdminCapable: boolean;
  cycle: boolean;
  path: string[];
}

interface MembershipAttestation {
  databaseLogin: string;
  databaseGroup: string;
  serverVersionNum: number;
  membershipGraph: MembershipEdge[];
  membershipGraphDigest: string;
  contractValid: boolean;
}

function signaturePayload(
  kind: 'reader' | 'writer', databaseLogin: string, keyId: string, viewerId: string, sessionId: string,
  issuedAt: number, expiresAt: number, nonce: string, challenge: string, challengeTxid: bigint,
): string {
  return ['tyre.audit.db-context.v2', kind, databaseLogin, keyId, viewerId, sessionId,
    String(issuedAt), String(expiresAt), nonce, challenge, String(challengeTxid)].join('\n');
}

function expectedMembershipDigest(databaseLogin: string, databaseGroup: string): string {
  const line = `${databaseLogin}>${databaseGroup}|depth=1|inherit=true|set=false|admin=false|` +
    `pathInherit=true|pathSet=false|pathAdmin=false|cycle=false|path=${databaseLogin}>${databaseGroup}`;
  return createHash('sha256')
    .update(`tyre.audit.membership-graph.v1\n${databaseLogin}\n${line}`, 'utf8')
    .digest('base64url');
}

@Injectable()
export class AuditDatabaseService implements OnModuleInit, OnModuleDestroy {
  private reader?: PrismaClient;
  private writer?: PrismaClient;

  constructor(@Inject(AUDIT_READER_CONFIG) private readonly config: AuditReaderConfig) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled) return;
    this.assertDedicatedConfiguration();
    this.reader = new PrismaClient({ datasourceUrl: this.config.readerDatabaseUrl! });
    this.writer = new PrismaClient({ datasourceUrl: this.config.writerDatabaseUrl! });
    try {
      await Promise.all([this.reader.$connect(), this.writer.$connect()]);
      await this.attestReader();
      await this.attestWriter();
    } catch (error) {
      await this.onModuleDestroy();
      this.reader = undefined;
      this.writer = undefined;
      throw error;
    }
  }

  private assertDedicatedConfiguration(): void {
    try {
      const reader = new URL(this.config.readerDatabaseUrl!);
      const writer = new URL(this.config.writerDatabaseUrl!);
      const readerLogin = decodeURIComponent(reader.username);
      const writerLogin = decodeURIComponent(writer.username);
      const readerPassword = decodeURIComponent(reader.password);
      const writerPassword = decodeURIComponent(writer.password);
      reader.username = ''; reader.password = '';
      writer.username = ''; writer.password = '';
      if (!readerLogin || !writerLogin || !readerPassword || !writerPassword ||
          readerLogin !== this.config.readerDatabaseRole || writerLogin !== this.config.writerDatabaseRole ||
          readerLogin === writerLogin || readerPassword === writerPassword ||
          this.config.readerDatabaseUrl === this.config.writerDatabaseUrl || reader.toString() !== writer.toString()) {
        throw new Error();
      }
    } catch {
      throw new Error('AUDIT_DATABASE_DEDICATED_CONFIGURATION_INVALID');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.reader?.$disconnect(), this.writer?.$disconnect()]);
  }

  async withReaderContext<T>(
    identity: { id: string; sessionId: string },
    operation: (tx: RestrictedAuditTransaction) => Promise<T>,
  ): Promise<T> {
    if (!this.reader || !this.config.enabled) throw new Error('AUDIT_READER_DISABLED');
    return this.reader.$transaction(async (tx) => {
      if (!await this.bind(tx, 'reader', this.config.readerDatabaseRole!, identity)) throw new Error('AUDIT_DB_CONTEXT_INVALID');
      return operation(tx);
    });
  }

  async recordCursorRejection(
    identity: { id: string; sessionId: string },
    code: 'INVALID_CURSOR' | 'BOUNDARY_MISMATCH',
    keyId?: string,
  ): Promise<void> {
    if (!this.writer || !this.config.enabled) return;
    await this.writer.$transaction(async (tx) => {
      if (!await this.bind(tx, 'writer', this.config.writerDatabaseRole!, identity)) {
        throw new Error('AUDIT_DB_CONTEXT_INVALID');
      }
      const [row] = await tx.$queryRaw<Array<{ eventId: string | null }>>`
        SELECT audit_writer_record_cursor_rejected_v1(${code}, ${keyId ?? null}) AS "eventId"
      `;
      if (!row?.eventId) throw new Error('AUDIT_DB_WRITE_REJECTED');
    });
  }

  private async bind(
    tx: RestrictedAuditTransaction,
    kind: 'reader' | 'writer',
    databaseLogin: string,
    identity: { id: string; sessionId: string },
  ): Promise<boolean> {
    const challengeRows = kind === 'reader'
      ? await tx.$queryRaw<Array<{ challenge: string; challengeTxid: bigint }>>`
          SELECT challenge, challenge_txid AS "challengeTxid"
          FROM audit_reader_issue_challenge_v1(${this.config.runtimeContextKeyId!})
        `
      : await tx.$queryRaw<Array<{ challenge: string; challengeTxid: bigint }>>`
          SELECT challenge, challenge_txid AS "challengeTxid"
          FROM audit_writer_issue_challenge_v1(${this.config.runtimeContextKeyId!})
        `;
    if (challengeRows.length !== 1) return false;
    const challenge = challengeRows[0];
    const issuedAt = Date.now();
    const expiresAt = issuedAt + this.config.runtimeContextTtlSeconds! * 1_000;
    const nonce = randomBytes(16).toString('base64url');
    const signature = createHmac('sha256', this.config.runtimeContextKey!)
      .update(signaturePayload(kind, databaseLogin, this.config.runtimeContextKeyId!, identity.id, identity.sessionId,
        issuedAt, expiresAt, nonce, challenge.challenge, challenge.challengeTxid), 'utf8').digest('base64url');
    const rows = kind === 'reader'
      ? await tx.$queryRaw<Array<{ bound: boolean }>>`
          SELECT audit_reader_bind_context_v1(
            ${this.config.runtimeContextKeyId!}, ${identity.id}, ${identity.sessionId}, ${issuedAt}, ${expiresAt}, ${nonce}, ${signature},
            ${challenge.challenge}, ${challenge.challengeTxid}
          ) AS bound
        `
      : await tx.$queryRaw<Array<{ bound: boolean }>>`
          SELECT audit_writer_bind_context_v1(
            ${this.config.runtimeContextKeyId!}, ${identity.id}, ${identity.sessionId}, ${issuedAt}, ${expiresAt}, ${nonce}, ${signature},
            ${challenge.challenge}, ${challenge.challengeTxid}
          ) AS bound
        `;
    return rows.length === 1 && rows[0].bound === true;
  }

  private async attestReader(): Promise<void> {
    const attestation = await this.roleAttestation(this.reader!, 'tyre_audit_v2_reader');
    this.assertRestrictedRole(attestation, this.config.readerDatabaseRole!, false);
    await this.attestMembership(this.reader!, this.config.readerDatabaseRole!, 'tyre_audit_v2_reader');
    const functions = await this.functionAttestation(this.reader!, [
      'audit_reader_bind_context_v1', 'audit_reader_runtime_contract_v1', 'audit_reader_current_context_v1',
      'audit_reader_list_v1', 'audit_reader_detail_v1', 'audit_runtime_membership_contract_v1',
      'audit_reader_issue_challenge_v1',
    ]);
    this.assertDefinerFunctions(functions, 7);
    const [contract] = await this.reader!.$queryRaw<ReaderRuntimeContract[]>`
      SELECT database_login AS "databaseLogin", database_group AS "databaseGroup", key_id AS "keyId",
        key_digest AS "keyDigest", max_context_ttl_seconds AS "maxContextTtlSeconds",
        max_page_size AS "maxPageSize", max_time_range_seconds AS "maxTimeRangeSeconds",
        max_filters AS "maxFilters", reader_policy_version AS "readerPolicyVersion",
        query_plan_policy_id AS "queryPlanPolicyId"
      FROM audit_reader_runtime_contract_v1(${this.config.runtimeContextKeyId!})
    `;
    if (!contract || contract.databaseLogin !== this.config.readerDatabaseRole || contract.databaseGroup !== 'tyre_audit_v2_reader' ||
        contract.keyId !== this.config.runtimeContextKeyId ||
        contract.keyDigest !== createHash('sha256').update(this.config.runtimeContextKey!).digest('base64url') ||
        contract.maxContextTtlSeconds !== this.config.runtimeContextTtlSeconds ||
        contract.maxPageSize !== this.config.maxPageSize || contract.maxTimeRangeSeconds !== this.config.maxTimeRangeSeconds ||
        contract.maxFilters !== this.config.maxFilters || contract.readerPolicyVersion !== this.config.readerPolicyVersion ||
        contract.queryPlanPolicyId !== this.config.queryPlanPolicyId) throw new Error('AUDIT_READER_DB_CONTRACT_MISMATCH');
    await this.attestBoundary(this.reader!);
  }

  private async attestWriter(): Promise<void> {
    const attestation = await this.roleAttestation(this.writer!, 'tyre_audit_v2_writer');
    this.assertRestrictedRole(attestation, this.config.writerDatabaseRole!, false);
    await this.attestMembership(this.writer!, this.config.writerDatabaseRole!, 'tyre_audit_v2_writer');
    const functions = await this.functionAttestation(this.writer!, [
      'audit_writer_bind_context_v1', 'audit_writer_runtime_contract_v1', 'audit_writer_record_cursor_rejected_v1',
      'audit_runtime_membership_contract_v1', 'audit_writer_issue_challenge_v1',
    ]);
    this.assertDefinerFunctions(functions, 5);
    const [contract] = await this.writer!.$queryRaw<Array<Pick<ReaderRuntimeContract,
      'databaseLogin' | 'databaseGroup' | 'keyId' | 'keyDigest' | 'maxContextTtlSeconds'>>>`
      SELECT database_login AS "databaseLogin", database_group AS "databaseGroup", key_id AS "keyId",
        key_digest AS "keyDigest", max_context_ttl_seconds AS "maxContextTtlSeconds"
      FROM audit_writer_runtime_contract_v1(${this.config.runtimeContextKeyId!})
    `;
    if (!contract || contract.databaseLogin !== this.config.writerDatabaseRole ||
        contract.databaseGroup !== 'tyre_audit_v2_writer' || contract.keyId !== this.config.runtimeContextKeyId ||
        contract.keyDigest !== createHash('sha256').update(this.config.runtimeContextKey!).digest('base64url') ||
        contract.maxContextTtlSeconds !== this.config.runtimeContextTtlSeconds) {
      throw new Error('AUDIT_WRITER_DB_CONTRACT_MISMATCH');
    }
    await this.attestBoundary(this.writer!);
  }

  private async roleAttestation(client: PrismaClient, expectedGroup: string): Promise<PrivilegeAttestation> {
    const [row] = await client.$queryRaw<PrivilegeAttestation[]>(Prisma.sql`
      SELECT current_user::text AS "databaseLogin", r.rolsuper AS superuser,
        r.rolcreaterole AS "createRole", r.rolcreatedb AS "createDb", r.rolinherit AS "inheritRole",
        r.rolbypassrls AS "bypassRls",
        pg_has_role(current_user, ${expectedGroup}, 'member') AS "memberOfExpected",
        pg_has_role(current_user, 'tyre_audit_v2_guard_owner', 'member') AS "memberOfGuard",
        has_table_privilege(current_user, 'public."AuditEventV2"', 'SELECT') AS "rawAuditSelect",
        has_table_privilege(current_user, 'public."AuditEventScopeRefV2"', 'SELECT') AS "rawScopeSelect",
        has_table_privilege(current_user, 'public."AuditEventSchemaV2"', 'SELECT') AS "rawRegistrySelect",
        has_table_privilege(current_user, 'public."Admin"', 'SELECT') AS "rawRbacSelect",
        has_function_privilege(current_user, 'public.authorized_audit_event_v2(text,text)', 'EXECUTE') AS "arbitraryAuthorizationExecute",
        (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'tyre_audit_v2_guard_owner') AS "guardCanLogin",
        has_table_privilege(current_user, 'public."AuditEventV2"', 'INSERT') AS "auditInsert",
        has_table_privilege(current_user, 'public."AuditEventV2"', 'UPDATE') AS "auditUpdate",
        has_table_privilege(current_user, 'public."AuditEventV2"', 'DELETE') AS "auditDelete"
      FROM pg_roles r WHERE r.rolname = current_user
    `);
    if (!row) throw new Error('AUDIT_DATABASE_ROLE_MISSING');
    return row;
  }

  private async attestMembership(client: PrismaClient, expectedLogin: string, expectedGroup: string): Promise<void> {
    const [row] = await client.$queryRaw<MembershipAttestation[]>`
      SELECT database_login AS "databaseLogin", database_group AS "databaseGroup",
        server_version_num AS "serverVersionNum", membership_graph AS "membershipGraph",
        membership_graph_digest AS "membershipGraphDigest", contract_valid AS "contractValid"
      FROM audit_runtime_membership_contract_v1(${expectedGroup})
    `;
    const edge = row?.membershipGraph?.[0];
    if (!row || row.databaseLogin !== expectedLogin || row.databaseGroup !== expectedGroup ||
        row.serverVersionNum < 160000 || !row.contractValid || row.membershipGraph.length !== 1 ||
        row.membershipGraphDigest !== expectedMembershipDigest(expectedLogin, expectedGroup) ||
        !edge || edge.fromRole !== expectedLogin || edge.toRole !== expectedGroup || edge.depth !== 1 ||
        !edge.inheritOption || edge.setOption || edge.adminOption || !edge.pathInheritCapable ||
        edge.pathSetCapable || edge.pathAdminCapable || edge.cycle ||
        edge.path.length !== 2 || edge.path[0] !== expectedLogin || edge.path[1] !== expectedGroup) {
      throw new Error('AUDIT_DATABASE_MEMBERSHIP_ATTESTATION_FAILED');
    }
  }

  private async attestBoundary(client: PrismaClient): Promise<void> {
    const [row] = await client.$queryRaw<BoundaryAttestation[]>`
      WITH protected_tables(name) AS (VALUES
        ('AuditEventSchemaV2'), ('AuditEventV2'), ('AuditEventScopeRefV2'),
        ('AuditRuntimeContextKey'), ('AuditRuntimeContextKeyRevocation'), ('AuditReaderPublishedSchema')
      ), expected_triggers(table_name, trigger_name) AS (VALUES
        ('AuditEventSchemaV2','AuditEventSchemaV2_append_only'),
        ('AuditEventSchemaV2','AuditEventSchemaV2_insert_admission'),
        ('AuditEventV2','AuditEventV2_append_only'),
        ('AuditEventV2','AuditEventV2_projection_admission'),
        ('AuditEventScopeRefV2','AuditEventScopeRefV2_append_only'),
        ('AuditEventScopeRefV2','AuditEventScopeRefV2_projection_admission'),
        ('AuditRuntimeContextKey','AuditRuntimeContextKey_append_only'),
        ('AuditRuntimeContextKeyRevocation','AuditRuntimeContextKeyRevocation_append_only'),
        ('AuditReaderPublishedSchema','AuditReaderPublishedSchema_append_only')
      )
      SELECT
        (SELECT count(*)::int FROM protected_tables) AS "protectedTableCount",
        (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          JOIN pg_roles r ON r.oid=c.relowner JOIN protected_tables p ON p.name=c.relname
          WHERE n.nspname='public' AND r.rolname='tyre_audit_v2_guard_owner') AS "protectedOwnerCount",
        (SELECT count(*)::int FROM expected_triggers) AS "expectedTriggerCount",
        (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace
          JOIN expected_triggers e ON e.table_name=c.relname AND e.trigger_name=t.tgname
          WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgenabled='O') AS "enabledTriggerCount"
    `;
    if (!row || row.protectedTableCount !== 6 || row.protectedOwnerCount !== 6 ||
        row.expectedTriggerCount !== 9 || row.enabledTriggerCount !== 9) {
      throw new Error('AUDIT_DATABASE_BOUNDARY_ATTESTATION_FAILED');
    }
  }

  private async functionAttestation(client: PrismaClient, names: string[]): Promise<FunctionAttestation[]> {
    return client.$queryRaw<FunctionAttestation[]>(Prisma.sql`
      SELECT p.proname::text AS "functionName", owner.rolname::text AS owner,
        p.prosecdef AS "securityDefiner", p.proconfig AS settings
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_roles owner ON owner.oid = p.proowner
      WHERE n.nspname = 'public' AND p.proname IN (${Prisma.join(names)})
    `);
  }

  private assertRestrictedRole(row: PrivilegeAttestation, expectedLogin: string, directInsertRequired: boolean): void {
    if (row.databaseLogin !== expectedLogin || row.superuser || row.createRole || row.createDb || !row.inheritRole || row.bypassRls ||
        !row.memberOfExpected || row.memberOfGuard || row.rawAuditSelect || row.rawRbacSelect ||
        row.rawScopeSelect || row.rawRegistrySelect || row.arbitraryAuthorizationExecute || row.guardCanLogin ||
        row.auditUpdate || row.auditDelete || row.auditInsert !== directInsertRequired) {
      throw new Error('AUDIT_DATABASE_ROLE_ATTESTATION_FAILED');
    }
  }

  private assertDefinerFunctions(rows: FunctionAttestation[], expectedCount: number): void {
    if (rows.length !== expectedCount || rows.some((row) => row.owner !== 'tyre_audit_v2_guard_owner' ||
      !row.securityDefiner || !row.settings?.includes('search_path=pg_catalog, public'))) {
      throw new Error('AUDIT_DATABASE_FUNCTION_ATTESTATION_FAILED');
    }
  }
}
