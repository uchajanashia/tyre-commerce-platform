-- Phase B admin security foundation. This migration is additive and keeps the
-- legacy Admin.role column/API contract operational during the RBAC cutover.
-- Rollout order: apply this migration first, then replace/drain every old API
-- instance. The new strategy rejects missing `ver` unconditionally, so the
-- security cutover is complete only when no legacy instance remains serving.
-- Existing staff are intentionally required to sign in again at that point.
ALTER TABLE "Admin"
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  -- Epoch 1 is the auth cutover. Legacy JWTs did not carry `ver`, so they can
  -- never match this value after the new strategy is deployed.
  ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "Role" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Permission" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "description" TEXT,
  CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

CREATE TYPE "PermissionScopeType" AS ENUM ('global', 'warehouse', 'channel', 'company');

CREATE TABLE "RolePermission" (
  "roleId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionId")
);

CREATE TABLE "AdminRoleAssignment" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "scopeType" "PermissionScopeType" NOT NULL DEFAULT 'global',
  "scopeId" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminRoleAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdminRoleAssignment_scope_shape" CHECK (
    ("scopeType" = 'global' AND "scopeId" = '')
    OR ("scopeType" <> 'global' AND "scopeId" <> '')
  )
);

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT,
  "actorEmail" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "before" JSONB,
  "after" JSONB,
  "reason" TEXT,
  "correlationId" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "source" TEXT NOT NULL DEFAULT 'admin_api',
  "metadata" JSONB,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");
CREATE UNIQUE INDEX "AdminRoleAssignment_adminId_roleId_scopeType_scopeId_key"
  ON "AdminRoleAssignment"("adminId", "roleId", "scopeType", "scopeId");
CREATE INDEX "AdminRoleAssignment_roleId_idx" ON "AdminRoleAssignment"("roleId");
CREATE INDEX "AdminRoleAssignment_scopeType_scopeId_idx" ON "AdminRoleAssignment"("scopeType", "scopeId");
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");
CREATE INDEX "AuditEvent_actorId_occurredAt_idx" ON "AuditEvent"("actorId", "occurredAt");
CREATE INDEX "AuditEvent_entityType_entityId_occurredAt_idx" ON "AuditEvent"("entityType", "entityId", "occurredAt");
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");

ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey"
  FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminRoleAssignment" ADD CONSTRAINT "AdminRoleAssignment_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminRoleAssignment" ADD CONSTRAINT "AdminRoleAssignment_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The initial role deliberately receives wildcard access so every pre-existing
-- `role = admin` account behaves exactly as before. Future roles use granular keys.
INSERT INTO "Role" ("id", "key", "name", "description", "isSystem", "updatedAt")
VALUES
  ('legacy-admin', 'admin', 'Administrator', 'Backward-compatible administrator role', true, CURRENT_TIMESTAMP),
  ('legacy-deny', 'legacy-deny', 'Unassigned legacy account', 'No permissions; requires explicit role assignment', true, CURRENT_TIMESTAMP);

INSERT INTO "Permission" ("id", "key", "description") VALUES
  ('perm-wildcard', '*', 'All current and future permissions'),
  ('perm-catalog-read', 'catalog.read', 'Read the admin catalog'),
  ('perm-catalog-write', 'catalog.write', 'Create, change, and remove catalog records'),
  ('perm-catalog-media', 'catalog.media', 'Manage catalog media'),
  ('perm-admins-manage', 'admins.manage', 'Manage staff access'),
  ('perm-audit-read', 'audit.read', 'Read security and operations audit events');

INSERT INTO "RolePermission" ("roleId", "permissionId") VALUES ('legacy-admin', 'perm-wildcard');
INSERT INTO "AdminRoleAssignment" ("id", "adminId", "roleId", "scopeType", "scopeId")
SELECT 'legacy-' || "id", "id",
  CASE WHEN "role" = 'admin' THEN 'legacy-admin' ELSE 'legacy-deny' END,
  'global', ''
FROM "Admin";

-- Revoke existing JWTs regardless of which future code path changes a
-- password, role, or enabled state. Permission bundle edits take effect on the
-- next request because JwtStrategy resolves permissions from the database.
CREATE OR REPLACE FUNCTION revoke_admin_tokens_on_security_change()
RETURNS trigger AS $$
BEGIN
  IF NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash"
     OR NEW."role" IS DISTINCT FROM OLD."role"
     OR NEW."enabled" IS DISTINCT FROM OLD."enabled" THEN
    NEW."tokenVersion" := OLD."tokenVersion" + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Admin_revoke_tokens_on_security_change"
BEFORE UPDATE ON "Admin"
FOR EACH ROW EXECUTE FUNCTION revoke_admin_tokens_on_security_change();

-- Assignment changes revoke sessions. RolePermission edits are read from the
-- database on every request and therefore take effect immediately as well.
CREATE OR REPLACE FUNCTION revoke_admin_tokens_on_assignment_change()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "Admin" SET "tokenVersion" = "tokenVersion" + 1 WHERE "id" = NEW."adminId";
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE "Admin" SET "tokenVersion" = "tokenVersion" + 1 WHERE "id" = OLD."adminId";
    RETURN OLD;
  ELSE
    UPDATE "Admin" SET "tokenVersion" = "tokenVersion" + 1
    WHERE "id" IN (OLD."adminId", NEW."adminId");
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AdminRoleAssignment_revoke_tokens"
AFTER INSERT OR UPDATE OR DELETE ON "AdminRoleAssignment"
FOR EACH ROW EXECUTE FUNCTION revoke_admin_tokens_on_assignment_change();

-- Audit rows are immutable at the database boundary. Inserts remain available
-- to the API role; retention/archival must use a separately governed DB process.
CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
