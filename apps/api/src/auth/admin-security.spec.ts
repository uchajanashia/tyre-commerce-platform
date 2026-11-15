import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { derivePermissionGrants, hasPermissionGrant, RoleAssignmentProjection } from './permission-evaluator';
import { hasRequiredPermissions, isAuthorizedByMetadata } from './roles.guard';

function assignment(
  scopeType: RoleAssignmentProjection['scopeType'],
  scopeId: string,
  permissions: string[],
): RoleAssignmentProjection {
  return { scopeType, scopeId, role: { permissions: permissions.map((key) => ({ permission: { key } })) } };
}

describe('admin security foundation', () => {
  const originalSecret = process.env.JWT_SECRET;

  before(() => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough';
  });

  after(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  it('supports granular permission sets and legacy wildcard access', () => {
    assert.equal(hasRequiredPermissions(['catalog.read'], ['catalog.read']), true);
    assert.equal(hasRequiredPermissions(['catalog.read'], ['catalog.write']), false);
    assert.equal(hasRequiredPermissions(['*'], ['catalog.write', 'admins.manage']), true);
  });

  it('rejects disabled and token-version-revoked accounts', async () => {
    const base = {
      id: 'admin-1',
      email: 'admin@example.test',
      role: 'admin',
      enabled: true,
      tokenVersion: 3,
      roleAssignments: [],
    };
    let stored = base;
    const strategy = new JwtStrategy({
      admin: { findUnique: async () => stored },
    } as never);

    await assert.rejects(
      strategy.validate({ sub: base.id, email: base.email, role: base.role, ver: 2 }),
      UnauthorizedException,
    );
    stored = { ...base, enabled: false };
    await assert.rejects(
      strategy.validate({ sub: base.id, email: base.email, role: base.role, ver: 3 }),
      UnauthorizedException,
    );
  });

  it('accepts wildcard only through an explicit global role assignment', async () => {
    const admin = {
      id: 'admin-1',
      email: 'admin@example.test',
      role: 'admin',
      enabled: true,
      tokenVersion: 1,
      roleAssignments: [assignment('global', '', ['*'])],
    };
    const strategy = new JwtStrategy({
      admin: { findUnique: async () => admin },
    } as never);
    const result = await strategy.validate({ sub: admin.id, email: admin.email, role: admin.role, ver: 1 });
    assert.deepEqual(result.permissions, ['*']);
  });

  it('denies privileges when an assignment is missing instead of reviving legacy admin', async () => {
    const admin = {
      id: 'admin-1', email: 'admin@example.test', role: 'admin', enabled: true,
      tokenVersion: 1, roleAssignments: [],
    };
    const strategy = new JwtStrategy({ admin: { findUnique: async () => admin } } as never);
    const result = await strategy.validate({ sub: admin.id, email: admin.email, role: admin.role, ver: 1 });
    assert.deepEqual(result.permissions, []);
  });

  it('restricts deletion of assigned roles and backfills explicit assignments', () => {
    const migration = readFileSync(
      resolve(__dirname, '..', '..', 'prisma', 'migrations', '20260730180000_add_admin_security_foundation', 'migration.sql'),
      'utf8',
    );
    assert.match(migration, /CREATE TABLE "AdminRoleAssignment"/);
    assert.match(migration, /AdminRoleAssignment_roleId_fkey/);
    assert.match(migration, /REFERENCES "Role"\("id"\) ON DELETE RESTRICT/);
    assert.match(migration, /INSERT INTO "AdminRoleAssignment"[\s\S]+FROM "Admin"/);
    assert.match(migration, /AdminRoleAssignment_revoke_tokens/);
  });

  it('rejects every pre-cutover token that is missing the version claim', async () => {
    const admin = {
      id: 'admin-1',
      email: 'admin@example.test',
      role: 'admin',
      enabled: true,
      tokenVersion: 1,
      roleAssignments: [],
    };
    const strategy = new JwtStrategy({
      admin: { findUnique: async () => admin },
    } as never);
    await assert.rejects(
      strategy.validate({ sub: admin.id, email: admin.email, role: admin.role } as never),
      UnauthorizedException,
    );
  });

  it('does not grant wildcard to an assigned role with no permissions', async () => {
    const admin = {
      id: 'admin-1',
      email: 'admin@example.test',
      role: 'admin',
      enabled: true,
      tokenVersion: 1,
      roleAssignments: [assignment('global', '', [])],
    };
    const strategy = new JwtStrategy({
      admin: { findUnique: async () => admin },
    } as never);
    const result = await strategy.validate({ sub: admin.id, email: admin.email, role: admin.role, ver: 1 });
    assert.deepEqual(result.permissions, []);
  });

  it('does not flatten a warehouse-scoped wildcard into global access', async () => {
    const admin = {
      id: 'admin-1', email: 'admin@example.test', role: 'admin', enabled: true, tokenVersion: 1,
      roleAssignments: [assignment('warehouse', 'warehouse-1', ['*'])],
    };
    const strategy = new JwtStrategy({ admin: { findUnique: async () => admin } } as never);
    const result = await strategy.validate({ sub: admin.id, email: admin.email, role: admin.role, ver: 1 });
    assert.deepEqual(result.permissions, []);
  });

  it('defaults guarded routes to deny unless authorization metadata is explicit', () => {
    const user = {
      id: 'a', email: 'a@example.test', role: 'staff', enabled: true,
      permissions: [], permissionGrants: [],
    };
    assert.equal(isAuthorizedByMetadata({ user }), false);
    assert.equal(isAuthorizedByMetadata({ user, authenticatedOnly: true }), true);
    assert.equal(isAuthorizedByMetadata({ user, permissions: ['catalog.read'] }), false);
  });

  it('keeps the same reusable role isolated to each user warehouse assignment', () => {
    const userOne = derivePermissionGrants([assignment('warehouse', 'w-1', ['inventory.read'])]);
    const userTwo = derivePermissionGrants([assignment('warehouse', 'w-2', ['inventory.read'])]);
    assert.equal(hasPermissionGrant(userOne, 'inventory.read', { scopeType: 'warehouse', scopeId: 'w-1' }), true);
    assert.equal(hasPermissionGrant(userOne, 'inventory.read', { scopeType: 'warehouse', scopeId: 'w-2' }), false);
    assert.equal(hasPermissionGrant(userTwo, 'inventory.read', { scopeType: 'warehouse', scopeId: 'w-2' }), true);
  });

  it('combines multiple roles/scopes without leaking one scope into another', () => {
    const grants = derivePermissionGrants([
      assignment('warehouse', 'w-1', ['inventory.read']),
      assignment('channel', 'online', ['orders.read']),
      assignment('global', '', ['audit.read']),
    ]);
    assert.equal(hasPermissionGrant(grants, 'inventory.read', { scopeType: 'warehouse', scopeId: 'w-1' }), true);
    assert.equal(hasPermissionGrant(grants, 'orders.read', { scopeType: 'channel', scopeId: 'retail' }), false);
    assert.equal(hasPermissionGrant(grants, 'audit.read'), true);
  });

  it('honors wildcard only as a canonical global assignment', () => {
    const scopedWildcard = derivePermissionGrants([assignment('warehouse', 'w-1', ['*'])]);
    const globalWildcard = derivePermissionGrants([assignment('global', '', ['*'])]);
    assert.equal(hasPermissionGrant(scopedWildcard, 'inventory.adjust', { scopeType: 'warehouse', scopeId: 'w-1' }), false);
    assert.equal(hasPermissionGrant(globalWildcard, 'inventory.adjust', { scopeType: 'warehouse', scopeId: 'w-1' }), true);
    assert.equal(hasPermissionGrant(globalWildcard, 'admins.manage'), true);
  });

  it('does not issue a token if credentials change after password verification', async () => {
    const passwordHash = await bcrypt.hash('old-password', 4);
    let signed = false;
    const service = new AuthService(
      {
        admin: {
          findUnique: async () => ({
            id: 'admin-1',
            email: 'admin@example.test',
            passwordHash,
            role: 'admin',
            enabled: true,
            tokenVersion: 1,
          }),
          // Simulates a concurrent password/status/version change: the exact
          // verified snapshot no longer exists at the issuance fence.
          findFirst: async () => null,
        },
      } as never,
      {
        signAsync: async () => {
          signed = true;
          return 'must-not-be-issued';
        },
      } as never,
      {} as never,
    );

    await assert.rejects(service.login('admin@example.test', 'old-password'), UnauthorizedException);
    assert.equal(signed, false);
  });

  it('signs the exact verified token epoch after the issuance fence succeeds', async () => {
    const passwordHash = await bcrypt.hash('current-password', 4);
    const persisted = {
      id: 'admin-1',
      email: 'admin@example.test',
      passwordHash,
      role: 'admin',
      enabled: true,
      tokenVersion: 7,
      roleAssignments: [],
    };
    let signedPayload: unknown;
    const service = new AuthService(
      {
        admin: {
          findUnique: async () => persisted,
          findFirst: async () => persisted,
        },
      } as never,
      {
        signAsync: async (payload: unknown) => {
          signedPayload = payload;
          return 'signed-token';
        },
      } as never,
      {} as never,
    );

    const result = await service.login(persisted.email, 'current-password');
    assert.equal(result.accessToken, 'signed-token');
    assert.deepEqual(signedPayload, {
      sub: persisted.id,
      email: persisted.email,
      role: persisted.role,
      ver: 7,
    });
  });
});
