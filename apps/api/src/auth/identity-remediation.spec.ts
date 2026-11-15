import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { Prisma } from '@prisma/client';

import { IdentityConfig } from './identity-config';
import { IdentityStartupService } from './identity-startup.service';
import { legacyJwtConfigured } from './legacy-auth-mode';
import { JwtAuthGuard } from './jwt-auth.guard';
import { assertTargetScope, canTargetScope } from './target-scope-policy';
import { StaffAdminService } from './staff-admin.service';

function config(enabled: boolean): IdentityConfig {
  return {
    enabled, environment: 'test', allowedOrigins: ['http://localhost:4300'],
    accessTokenTtlSeconds: 600, clockToleranceSeconds: 30, refreshIdleSeconds: 604800,
    refreshAbsoluteSeconds: 2592000, refreshReceiptSeconds: 10, deliveryAdapter: 'disabled',
    privilegedRoleKeys: ['admin'], privilegedRolePolicyReviewed: false,
    canonicalBackfillReviewed: false, keyCompromiseWorkflowsReviewed: false,
    operatorMode: false,
  };
}

describe('identity security review remediations', () => {
  it('allows public API startup when disabled identity tables are not installed', async () => {
    const missingTable = new Prisma.PrismaClientKnownRequestError('missing SecurityControl', {
      code: 'P2021',
      clientVersion: 'test',
    });
    const service = new IdentityStartupService(
      { securityControl: { findUnique: async () => Promise.reject(missingTable) } } as never,
      config(false),
      {} as never,
      {} as never,
    );

    await service.onModuleInit();
  });

  it('still fails closed when enabled identity tables are not installed', async () => {
    const missingTable = new Prisma.PrismaClientKnownRequestError('missing SecurityControl', {
      code: 'P2021',
      clientVersion: 'test',
    });
    const service = new IdentityStartupService(
      { securityControl: { findUnique: async () => Promise.reject(missingTable) } } as never,
      config(true),
      {} as never,
      {} as never,
    );

    await assert.rejects(service.onModuleInit(), (error: unknown) => error === missingTable);
  });

  it('requires legacy secret only for legacy module registration', () => {
    const before = process.env.JWT_SECRET;
    try {
      delete process.env.JWT_SECRET;
      assert.equal(legacyJwtConfigured(), false);
      process.env.JWT_SECRET = 'legacy-only';
      assert.equal(legacyJwtConfigured(), true);
    } finally {
      if (before === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = before;
    }
  });

  it('cannot boot legacy mode after the irreversible v2 marker', async () => {
    const service = new IdentityStartupService({
      securityControl: { findUnique: async () => ({ minimumAuthContractVersion: 2, sessionsEnforcedAt: new Date(), legacyJwtRevokedAt: new Date(), identityCanonicalizationVersion: 0 }) },
      } as never, config(false), { assertTotpKeyCoverage: async () => undefined, assertCompromiseReadiness: async () => undefined } as never, {} as never);
    await assert.rejects(service.onModuleInit(), /must remain true/);
  });

  it('boots the v2 path without JWT_SECRET and validates active TOTP key coverage', async () => {
    const before = process.env.JWT_SECRET;
    let coverageChecks = 0;
    try {
      delete process.env.JWT_SECRET;
      const service = new IdentityStartupService({
        securityControl: { findUnique: async () => ({ minimumAuthContractVersion: 2, sessionsEnforcedAt: new Date(), legacyJwtRevokedAt: new Date(), identityCanonicalizationVersion: 1, identityCanonicalizedAt: new Date(), identityCanonicalizationDigest: 'a'.repeat(64) }) },
        auditEvent: { findFirst: async () => ({ id: 'already-recorded' }) },
        } as never, config(true), {
          assertTotpKeyCoverage: async () => { coverageChecks += 1; }, assertCompromiseReadiness: async () => undefined,
        } as never, {} as never);
      await service.onModuleInit();
      assert.equal(coverageChecks, 1);
    } finally {
      if (before === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = before;
    }
  });

  it('fails closed before the exact runtime canonicalization marker exists', async () => {
    const service = new IdentityStartupService({
      securityControl: { findUnique: async () => ({
        minimumAuthContractVersion: 1, sessionsEnforcedAt: null, legacyJwtRevokedAt: null,
        identityCanonicalizationVersion: 0, identityCanonicalizedAt: null, identityCanonicalizationDigest: null,
      }) },
    } as never, config(true), {
      assertTotpKeyCoverage: async () => undefined, assertCompromiseReadiness: async () => undefined,
    } as never, {} as never);
    await assert.rejects(service.onModuleInit(), /canonicalization backfill marker/);
  });

  it('enforces every target scope while allowing a global grant', () => {
    const target = [{ scopeType: 'warehouse' as const, scopeId: 'w-1' }, { scopeType: 'company' as const, scopeId: 'c-1' }];
    const partial = { permissionGrants: [{ permission: 'staff.manage', scopeType: 'warehouse' as const, scopeId: 'w-1' }] };
    const complete = { permissionGrants: [
      ...partial.permissionGrants,
      { permission: 'staff.manage', scopeType: 'company' as const, scopeId: 'c-1' },
    ] };
    assert.equal(canTargetScope(partial, 'staff.manage', target), false);
    assert.throws(() => assertTargetScope(partial, 'staff.manage', target));
    assert.equal(canTargetScope(complete, 'staff.manage', target), true);
    assert.equal(canTargetScope({ permissionGrants: [{ permission: '*', scopeType: 'global', scopeId: '' }] }, 'staff.manage', target), true);
  });

  it('delegates legacy admin catalog routes to session-bound v2 authentication after cutover', async () => {
    const before = process.env.JWT_SECRET;
    let delegated = 0;
    try {
      delete process.env.JWT_SECRET;
      const guard = new JwtAuthGuard({ canActivate: async () => { delegated += 1; return true; } } as never, config(true));
      assert.equal(await guard.canActivate({} as never), true);
      assert.equal(delegated, 1);
    } finally {
      if (before === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = before;
    }
  });

  it('labels privileged roles fail-closed and derives their MFA requirement server-side', () => {
    const blocked = new StaffAdminService({} as never, {} as never, {} as never, {} as never, config(true));
    assert.deepEqual(blocked.roleAssignmentPolicy('admin'), {
      mfaRequired: true, assignmentAllowed: false, blockReasonCode: 'PRIVILEGED_ASSIGNMENT_POLICY_DISABLED',
    });
    const reviewedConfig = { ...config(true), privilegedRolePolicyReviewed: true, privilegedRolePolicyReviewId: 'D05-2026-07-30' };
    const allowed = new StaffAdminService({} as never, {} as never, {} as never, {} as never, reviewedConfig);
    assert.deepEqual(allowed.roleAssignmentPolicy('admin'), { mfaRequired: true, assignmentAllowed: true });
  });

  it('pins CAS, idempotency, epoch revocation, CSRF, and key lifecycle in executable sources', () => {
    const staff = readFileSync(resolve(__dirname, 'staff-admin.service.js'), 'utf8');
    const controller = readFileSync(resolve(__dirname, 'identity-auth.controller.js'), 'utf8');
    const sessions = readFileSync(resolve(__dirname, 'staff-session.service.js'), 'utf8');
    const throttle = readFileSync(resolve(__dirname, 'auth-throttle.service.js'), 'utf8');
    const keyLifecycle = readFileSync(resolve(__dirname, 'identity-key-lifecycle.service.js'), 'utf8');
    const brandsController = readFileSync(resolve(__dirname, '..', 'admin', 'brands', 'brands-admin.controller.js'), 'utf8');
    const tireController = readFileSync(resolve(__dirname, '..', 'admin', 'tire-models', 'tire-models-admin.controller.js'), 'utf8');
    assert.match(staff, /pg_advisory_xact_lock/);
    assert.match(staff, /STAFF_VERSION_CONFLICT/);
    assert.match(staff, /tokenVersion:\s*\{ increment: 1 \}/);
    assert.match(staff, /input\.mfaRequired \|\| requiresMfa/);
    assert.match(controller, /assertRefreshProofForSession/);
    assert.match(sessions, /refresh_revoked_token_reuse/);
    assert.match(sessions, /refresh_token_expired/);
    assert.match(throttle, /interval '5 minutes'[\s\S]+>= 5/);
    assert.match(keyLifecycle, /FOR UPDATE SKIP LOCKED/);
    assert.match(keyLifecycle, /revokeCompromisedTotpKey/);
    assert.match(brandsController, /JwtAuthGuard/);
    assert.match(tireController, /JwtAuthGuard/);
  });

  it('ships additive migration support for durable idempotency, throttle and key progress', () => {
    const migration = readFileSync(resolve(__dirname, '..', '..', 'prisma', 'migrations', '20260730230000_identity_security_review_fixes', 'migration.sql'), 'utf8');
    assert.match(migration, /step_up_account/);
    assert.match(migration, /CREATE TABLE "StaffMutationRequest"/);
    assert.match(migration, /CREATE TABLE "IdentityKeyRotation"/);
  });

  it('stages canonical identity for the exact runtime job and persists compromise/reissue state', () => {
    const identityMigration = readFileSync(resolve(__dirname, '..', '..', 'prisma', 'migrations', '20260730220000_add_identity_sessions_and_mfa', 'migration.sql'), 'utf8');
    const gateMigration = readFileSync(resolve(__dirname, '..', '..', 'prisma', 'migrations', '20260730231000_identity_production_enablement_gates', 'migration.sql'), 'utf8');
    assert.doesNotMatch(identityMigration, /SET "emailNormalized" = lower\(btrim/);
    assert.doesNotMatch(identityMigration, /ALTER COLUMN "emailNormalized" SET NOT NULL/);
    assert.match(identityMigration, /exact runtime/);
    assert.match(gateMigration, /identityCanonicalizationVersion/);
    assert.match(gateMigration, /CREATE TABLE "IdentityKeyCompromise"/);
    assert.match(gateMigration, /CREATE TABLE "IdentityArtifactReissue"/);
  });
});
