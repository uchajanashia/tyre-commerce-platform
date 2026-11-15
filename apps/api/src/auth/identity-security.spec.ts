import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { JwtService } from '@nestjs/jwt';

import {
  decryptAead,
  encryptAead,
  generateOpaqueToken,
  normalizeStaffEmail,
  parseOpaqueToken,
  tokenDigest,
  totpCode,
  verifyTokenDigest,
} from './identity-crypto';
import { IdentityConfig, SymmetricKeyRing } from './identity-config';
import { assertExactIdentityOrigin, refreshCookieName, refreshCookieOptions } from './identity-http';
import { IdentityJwtService } from './identity-jwt.service';
import { ARGON2_POLICY, PasswordKdfService, validatePasswordInput } from './password-kdf.service';

function ring(active: 'sign+verify' | 'encrypt+decrypt'): SymmetricKeyRing {
  return {
    currentKeyId: 'k1',
    keys: new Map([['k1', { id: 'k1', state: active, key: Buffer.alloc(32, 7) }]]),
  };
}

function config(environment: IdentityConfig['environment']): IdentityConfig {
  return {
    enabled: true,
    environment,
    adminPublicOrigin: environment === 'production' ? 'https://admin.example.test' : 'http://localhost:4300',
    allowedOrigins: [environment === 'production' ? 'https://admin.example.test' : 'http://localhost:4300'],
    accessTokenTtlSeconds: 600,
    clockToleranceSeconds: 30,
    refreshIdleSeconds: 604800,
    refreshAbsoluteSeconds: 2592000,
    refreshReceiptSeconds: 10,
    deliveryAdapter: 'disabled',
    privilegedRoleKeys: ['admin'],
    privilegedRolePolicyReviewed: false,
    canonicalBackfillReviewed: false,
    keyCompromiseWorkflowsReviewed: false,
    operatorMode: false,
  };
}

describe('identity v2 security primitives', () => {
  it('generates canonical 128-bit selectors and 256-bit secrets', () => {
    const first = generateOpaqueToken();
    const second = generateOpaqueToken();
    assert.equal(Buffer.from(first.selector, 'base64url').length, 16);
    assert.equal(Buffer.from(first.secret, 'base64url').length, 32);
    assert.notEqual(first.value, second.value);
    assert.deepEqual(parseOpaqueToken(first.value), first);
    assert.equal(parseOpaqueToken(`${first.value}.extra`), null);
  });

  it('purpose and subject separate keyed token digests', () => {
    const keys = ring('sign+verify');
    const token = generateOpaqueToken();
    const digest = tokenDigest(keys, 'k1', 'invite', token, 'staff-1');
    assert.equal(verifyTokenDigest(keys, 'k1', 'invite', token, 'staff-1', digest), true);
    assert.equal(verifyTokenDigest(keys, 'k1', 'password_reset', token, 'staff-1', digest), false);
    assert.equal(verifyTokenDigest(keys, 'k1', 'invite', token, 'staff-2', digest), false);
  });

  it('AES-256-GCM binds key id and every AAD component', () => {
    const keys = ring('encrypt+decrypt');
    const encrypted = encryptAead(keys, 'one-time-secret', ['entity', 'staff-1', 'invite', '1']);
    assert.equal(encrypted.nonce.length, 12);
    assert.equal(decryptAead(keys, encrypted, ['entity', 'staff-1', 'invite', '1']).toString(), 'one-time-secret');
    assert.throws(() => decryptAead(keys, encrypted, ['entity', 'staff-2', 'invite', '1']));
  });

  it('canonicalizes one staff identity across case, Unicode and IDNA states', () => {
    assert.equal(normalizeStaffEmail('  USER@BÜCHER.example  '), 'user@xn--bcher-kva.example');
    assert.equal(normalizeStaffEmail('ＦＯＯ@example.test'), 'foo@example.test');
    assert.throws(() => normalizeStaffEmail('a @example.test'), /INVALID_EMAIL/);
  });

  it('matches the RFC 6238 SHA-1 vector', () => {
    assert.equal(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1, 8), '94287082');
  });

  it('uses exact host-only cookie attributes and exact Origin rejection', () => {
    const production = config('production');
    assert.equal(refreshCookieName(production), '__Secure-tyre_admin_refresh');
    assert.deepEqual(refreshCookieOptions(production), {
      httpOnly: true, secure: true, sameSite: 'strict', path: '/admin/v1/auth',
    });
    assert.doesNotThrow(() => assertExactIdentityOrigin({ headers: { origin: 'https://admin.example.test' } } as never, production));
    assert.throws(() => assertExactIdentityOrigin({ headers: {} } as never, production));
    assert.throws(() => assertExactIdentityOrigin({ headers: { origin: 'null' } } as never, production));
    assert.throws(() => assertExactIdentityOrigin({ headers: { origin: 'https://api.example.test' } } as never, production));
  });

  it('pins access JWT to RS256, kid, issuer, audience and numeric-date bounds', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
    const jwtConfig: IdentityConfig = {
      ...config('test'),
      jwtIssuer: 'https://issuer.example.test',
      jwtAudience: 'tyre-admin',
      jwtKeys: {
        currentKeyId: 'jwt-1',
        keys: new Map([['jwt-1', { id: 'jwt-1', state: 'sign+verify', privateKey, publicKey }]]),
      },
    };
    const service = new IdentityJwtService(new JwtService(), jwtConfig, { isCompromised: async () => false } as never);
    const issued = await service.issue('staff-1', 'session-1', 7);
    const claims = await service.verify(issued.token);
    assert.equal(claims.sub, 'staff-1');
    assert.equal(claims.sid, 'session-1');
    assert.equal(claims.ver, 7);
    assert.equal(claims.exp - claims.iat, 600);

    const hsToken = await new JwtService({ secret: 'not-an-rsa-key' }).signAsync({
      sub: 'staff-1', sid: 'session-1', ver: 7, iss: jwtConfig.jwtIssuer, aud: jwtConfig.jwtAudience, jti: '0123456789abcdef',
    }, { algorithm: 'HS256', expiresIn: 600 });
    await assert.rejects(service.verify(hsToken), /Session is no longer valid/);
  });

  it('pins Argon2id parameters and verifies exact UTF-8 input without truncation', async () => {
    assert.deepEqual(ARGON2_POLICY, {
      algorithm: 'argon2id', version: 19, memoryCostKiB: 65536, timeCost: 3,
      parallelism: 1, saltBytes: 16, hashBytes: 32, maxConcurrent: 4, maxQueue: 32,
    });
    const service = new PasswordKdfService();
    const password = 'correct horse battery staple';
    const hash = await service.hash(password);
    assert.match(hash, /^\$argon2id\$v=19\$/);
    // PHC parameter order is not significant and can change between library
    // versions. Assert the actual cost parameters, not their serialization order.
    assert.deepEqual(Object.fromEntries(hash.split('$')[3].split(',').map(part => part.split('='))), {
      m: '65536', t: '3', p: '1',
    });
    assert.equal((await service.verify(hash, password)).valid, true);
    assert.equal((await service.verify(hash, `${password}x`)).valid, false);
    assert.throws(() => validatePasswordInput('short'));
    assert.throws(() => validatePasswordInput('x'.repeat(257)), /PASSWORD_TOO_LONG/);
  });

  it('migration carries row locks, partial uniqueness, ciphertext cleanup and monotonic cutover', () => {
    const migration = readFileSync(resolve(__dirname, '..', '..', 'prisma', 'migrations', '20260730220000_add_identity_sessions_and_mfa', 'migration.sql'), 'utf8');
    const rotation = readFileSync(resolve(__dirname, 'staff-session.service.js'), 'utf8');
    assert.match(migration, /StaffInvitation_one_active_purpose_key[\s\S]+WHERE "consumedAt" IS NULL/);
    assert.match(migration, /RefreshRotationReceipt_ciphertext_shape_check/);
    assert.match(migration, /SecurityControl_monotonic_update/);
    assert.match(migration, /contract v2 requires session and legacy JWT enforcement timestamps/);
    assert.match(rotation, /FOR UPDATE/);
    assert.match(rotation, /idempotent_replay/);
    assert.match(rotation, /familyOnly: true/);
  });
});
