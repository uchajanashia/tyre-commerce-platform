import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canonicalJsonText } from './canonical-json';
import {
  actionIntentTokenDigest, assertStrongIdempotencyKey, governanceHash, idempotencyKeyHash,
} from './governance-hash';

describe('governance canonical JSON and hashes', () => {
  it('matches every normative unkeyed contract vector', () => {
    assert.equal(governanceHash('approval/payload', { actionType: 'test.noop', amountMinor: 100, currency: 'GEL' }), 'e8PwjAJTvwh819uM5myEsX3dF6gLN75d9i5WeJgAkvI');
    assert.equal(governanceHash('approval/target-set', { targets: [{ id: 'A', type: 'Test', version: 1 }] }), '2tG4n4glHLMEwF3jACyPe-7VK6gneqsmGDJgNu2TUwU');
    assert.equal(governanceHash('governance/query', { filters: { state: ['pending'] }, sort: [{ direction: 'asc', field: 'createdAt' }] }), 'JNxeFQmW7Yxd4g2rfhmnYri4JfcCXWt07ijLgNwGSFk');
    assert.equal(governanceHash('approval/policy', { actionType: 'test.noop', mode: 'disabled', requiredApproverCount: 0 }), '9A4CTNgpDGMkz4NgTMu6g_bfTznAti8ALBC1k9gTrEw');
    assert.equal(governanceHash('identity/action-intent', { action: 'approval.decide', correlationId: '00000000-0000-4000-8000-000000000001', intentId: 'intent-1', payloadHash: 'p', resource: { id: 'request-1', version: 2 }, sessionId: 'session-1', subjectId: 'staff-1' }), '2hUTw51m8D6mR0UCHje01Jju850_bfHVnwCb-vzFWt8');
  });

  it('matches the normative idempotency vector while enforcing stronger API wire entropy', () => {
    const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
    assert.equal(idempotencyKeyHash(key, 'staff-1', 'test.noop', '0123456789abcdef'), 'BgrgCktPi4dnxQDw6aj4wRrQTX65BucEqc34NmtWOjw');
    assert.throws(() => assertStrongIdempotencyKey('0123456789abcdef'), /INVALID_IDEMPOTENCY_KEY/);
    assert.equal(assertStrongIdempotencyKey(Buffer.alloc(16, 7).toString('base64url')).length, 16);
  });

  it('uses deterministic UTF-16 key order and rejects non-I-JSON values', () => {
    assert.equal(canonicalJsonText({ z: -0, a: '✓', nested: { b: 2, a: 1 } }), '{"a":"✓","nested":{"a":1,"b":2},"z":0}');
    assert.throws(() => canonicalJsonText({ invalid: Number.NaN }), /NON_FINITE/);
    assert.throws(() => canonicalJsonText({ invalid: '\ud800' }), /LONE_SURROGATE/);
  });

  it('pins exact P2 action-intent token encoding', () => {
    const key = Buffer.from(Array.from({ length: 32 }, (_, index) => 31 - index));
    const selector = Buffer.from(Array.from({ length: 16 }, (_, index) => index)).toString('base64url');
    const secret = Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString('base64url');
    assert.equal(actionIntentTokenDigest(key, selector, secret), 'FYWc-M882tUFsV3YUk6PvFgiGBRiq4VLgI8QDrrSsoE');
    assert.throws(() => actionIntentTokenDigest(key, `${selector}=`, secret), /INVALID_ACTION_INTENT_SELECTOR/);
  });
});
