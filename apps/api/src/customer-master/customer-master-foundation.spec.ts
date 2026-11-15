import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const apiRoot = resolve(__dirname, "..", "..");
const workspaceRoot = resolve(apiRoot, "..", "..");
const migration = readFileSync(
  resolve(
    apiRoot,
    "prisma",
    "migrations",
    "20260730304000_add_customer_master_foundation",
    "migration.sql",
  ),
  "utf8",
);
const rollback = readFileSync(
  resolve(apiRoot, "prisma", "rollback", "customer_master_foundation.rollback.sql"),
  "utf8",
);
const hardeningMigration = readFileSync(
  resolve(apiRoot, "prisma", "migrations", "20260730305000_harden_customer_master_and_runtime_login", "migration.sql"),
  "utf8",
);
const closureMigration = readFileSync(
  resolve(apiRoot, "prisma", "migrations", "20260730306000_close_runtime_acl_and_membership_boundary", "migration.sql"),
  "utf8",
);
const prismaService = readFileSync(resolve(apiRoot, "src", "prisma", "prisma.service.ts"), "utf8");
const productionCompose = readFileSync(resolve(workspaceRoot, "compose.production.yml"), "utf8");
const productionEnvironment = readFileSync(resolve(workspaceRoot, "deploy", ".env.production.example"), "utf8");

function filesBelow(root: string): string[] {
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

test("C0 migration creates exactly four database-owned fields and zero rows", () => {
  const create = migration.match(/CREATE TABLE "CustomerMaster" \(([\s\S]*?)\n\);/)?.[1];
  assert.ok(create);
  const columns = [...create.matchAll(/^\s+"([^"]+)"\s+(UUID|BIGINT|TIMESTAMPTZ\(6\))/gm)].map(
    ([, name]) => name,
  );
  assert.deepEqual(columns, ["id", "version", "createdAt", "updatedAt"]);
  assert.match(migration, /"id" UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
  assert.match(migration, /"version" BIGINT NOT NULL DEFAULT 1/);
  assert.match(migration, /CHECK \("version" > 0\)/);
  assert.match(migration, /CHECK \("updatedAt" >= "createdAt"\)/);
  assert.match(migration, /BEFORE INSERT OR UPDATE ON "CustomerMaster"/);
  assert.match(migration, /NEW\."version" := OLD\."version" \+ 1/);
  assert.doesNotMatch(migration, /INSERT INTO\s+"CustomerMaster"/i);
});

test("C0 table has an isolated NOLOGIN owner and grants no application access", () => {
  assert.match(migration, /CREATE ROLE tyre_customer_master_owner\s+NOLOGIN NOINHERIT NOSUPERUSER/);
  assert.match(migration, /ALTER TABLE "CustomerMaster" OWNER TO tyre_customer_master_owner/);
  assert.match(migration, /REVOKE ALL ON TABLE "CustomerMaster" FROM PUBLIC/);
  assert.doesNotMatch(migration, /GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]*CustomerMaster/i);
  assert.doesNotMatch(migration, /CREATE POLICY|ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE %I FROM %I/);
  assert.match(hardeningMigration, /CUSTOMER_MASTER_OWNER_REACHABLE_BY_LOGIN/);
  assert.match(hardeningMigration, /REVOKE ALL ON TABLE "CustomerMaster" FROM tyre_app_runtime, tyre_api_runtime/);
});

test("C0 rollback is empty-only and the forward migration is additive", () => {
  assert.match(rollback, /IF EXISTS \(SELECT 1 FROM public\."CustomerMaster"\)/);
  assert.match(rollback, /CUSTOMER_MASTER_ROLLBACK_REQUIRES_EMPTY_TABLE/);
  assert.match(rollback, /BEGIN;[\s\S]*LOCK TABLE public\."CustomerMaster" IN ACCESS EXCLUSIVE MODE;[\s\S]*DROP TABLE[\s\S]*COMMIT;/);
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE)\b/i);
  assert.doesNotMatch(
    migration,
    /\b(?:UPDATE|ALTER\s+TABLE)\s+"(?:Order|PaymentAttempt|Product)"/i,
  );
});

test("C0 follow-up normalizes reused runtime roles and rebuilds one exact PG16 membership", () => {
  assert.match(closureMigration, /granted\.rolname IN \('tyre_app_runtime', 'tyre_api_runtime'\)[\s\S]*member\.rolname IN \('tyre_app_runtime', 'tyre_api_runtime'\)/);
  assert.match(closureMigration, /REVOKE ALL PRIVILEGES ON SCHEMA %I FROM tyre_app_runtime, tyre_api_runtime/);
  assert.match(closureMigration, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM PUBLIC, tyre_app_runtime, tyre_api_runtime/);
  assert.match(closureMigration, /REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC, tyre_app_runtime, tyre_api_runtime/);
  assert.match(closureMigration, /REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC, tyre_app_runtime, tyre_api_runtime/);
  assert.match(closureMigration, /ALTER DEFAULT PRIVILEGES[\s\S]*REVOKE ALL ON TABLES FROM tyre_app_runtime, tyre_api_runtime/);
  assert.match(closureMigration, /GRANT tyre_app_runtime TO tyre_api_runtime\s+WITH ADMIN FALSE, INHERIT TRUE, SET FALSE/);
  assert.match(closureMigration, /ALTER ROLE tyre_app_runtime\s+NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE\s+NOREPLICATION NOBYPASSRLS/);
  assert.match(closureMigration, /ALTER ROLE tyre_api_runtime\s+LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE\s+NOREPLICATION NOBYPASSRLS/);
});

test("C0 exact allowlist denies Customer, Audit V2, Jobs, and excess Product privileges", () => {
  const ordinaryGrant = closureMigration.match(
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE([\s\S]*?)TO tyre_app_runtime;/,
  )?.[1];
  assert.ok(ordinaryGrant);
  const grantedTables = [...ordinaryGrant.matchAll(/"([^"]+)"/g)].map(([, name]) => name);
  assert.equal(grantedTables.length, 44);
  assert.equal(new Set(grantedTables).size, 44);
  assert.ok(grantedTables.includes("Product"));
  for (const locked of ["CustomerMaster", "AuditEventV2", "BackgroundJob"]) {
    assert.ok(!grantedTables.includes(locked));
    assert.match(closureMigration, new RegExp(`REVOKE ALL PRIVILEGES ON TABLE[\\s\\S]*"${locked}"`));
  }
  assert.match(closureMigration, /\('TRUNCATE'\),\('REFERENCES'\),\('TRIGGER'\)/);
  assert.match(closureMigration, /has_sequence_privilege/);
  assert.match(closureMigration, /has_function_privilege/);
});

test("startup recursively attests both membership directions and exact effective ACLs", () => {
  assert.match(prismaService, /WITH RECURSIVE[\s\S]*bidirectional_roles/);
  assert.match(prismaService, /am\.roleid = closure\.role_oid OR am\.member = closure\.role_oid/);
  assert.match(prismaService, /expected_privileges[\s\S]*actual_privileges/);
  assert.match(prismaService, /missingPrivileges/);
  assert.match(prismaService, /extraPrivileges/);
  assert.match(prismaService, /has_schema_privilege/);
  assert.match(prismaService, /has_table_privilege/);
  assert.match(prismaService, /has_sequence_privilege/);
  assert.match(prismaService, /has_function_privilege/);
  assert.match(prismaService, /am\.admin_option, am\.inherit_option, am\.set_option/);
});

test("production separates migration and runtime credentials and pins C0 off", () => {
  assert.match(productionCompose, /DATABASE_URL: \$\{MIGRATION_DATABASE_URL:\?MIGRATION_DATABASE_URL is required\}/);
  assert.match(productionCompose, /DATABASE_URL: \$\{DATABASE_URL:\?DATABASE_URL is required\}/);
  assert.match(productionCompose, /CUSTOMER_MASTER_FOUNDATION_ENABLED: "false"/);
  assert.match(productionEnvironment, /^MIGRATION_DATABASE_URL=postgresql:\/\/tyre:/m);
  assert.match(productionEnvironment, /^DATABASE_URL=postgresql:\/\/tyre_api_runtime:/m);
  assert.match(productionEnvironment, /^CUSTOMER_MASTER_FOUNDATION_ENABLED=false$/m);
});

test("C0 has no API, OpenAPI, generated-client, seed, event, handler, or Admin route exposure", () => {
  const forbiddenRoots = [
    resolve(apiRoot, "src", "app.module.ts"),
    resolve(apiRoot, "src", "admin"),
    resolve(apiRoot, "prisma", "seed.ts"),
    resolve(workspaceRoot, "apps", "adminka", "src", "app", "app.routes.ts"),
    resolve(workspaceRoot, "packages", "admin-api-client", "src"),
    resolve(workspaceRoot, "tools", "openapi"),
  ];
  const exposed = forbiddenRoots
    .flatMap((root) => filesBelow(root))
    .filter((path) => /\.(?:ts|json|mjs)$/.test(path))
    .filter((path) => /CustomerMaster|customer-master|customers\./i.test(readFileSync(path, "utf8")));
  assert.deepEqual(exposed, []);
  assert.equal(
    filesBelow(resolve(apiRoot, "src", "customer-master")).filter(
      (path) => !path.endsWith("customer-master-foundation.spec.ts"),
    ).length,
    0,
  );
});
