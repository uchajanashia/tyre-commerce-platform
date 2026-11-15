import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { canonicalJsonBytes } from './canonical-json';

export const GOVERNANCE_CANONICALIZATION_VERSION = 1;
export const GOVERNANCE_HASH_VERSION = 1;

export type GovernanceHashDomain =
  | 'approval/payload'
  | 'approval/target-set'
  | 'governance/query'
  | 'approval/policy'
  | 'identity/action-intent'
  | 'approval/evidence-set';

export function governanceHash(domain: GovernanceHashDomain, semantic: unknown, version = 1): string {
  if (version !== 1) throw new Error('UNSUPPORTED_HASH_VERSION');
  return createHash('sha256')
    .update(Buffer.from(`tyre.ge/${domain}/v${version}\n`, 'utf8'))
    .update(canonicalJsonBytes(semantic))
    .digest('base64url');
}

export function payloadHash(semantic: unknown): string { return governanceHash('approval/payload', semantic); }
export function targetSetHash(semantic: unknown): string { return governanceHash('approval/target-set', semantic); }
export function policyHash(semantic: unknown): string { return governanceHash('approval/policy', semantic); }
export function actionHash(semantic: unknown): string { return governanceHash('identity/action-intent', semantic); }
export function evidenceSetHash(semantic: unknown): string { return governanceHash('approval/evidence-set', semantic); }

export function idempotencyKeyHash(key: Buffer, actorId: string, actionType: string, rawKey: string): string {
  if (key.length !== 32) throw new Error('INVALID_IDEMPOTENCY_KEY_MATERIAL');
  return createHmac('sha256', key)
    .update(Buffer.from('tyre.ge/idempotency/v1\n', 'utf8'))
    .update(canonicalJsonBytes({ actorId, actionType, rawKey }))
    .digest('base64url');
}

/**
 * P2 closure: wire keys are canonical unpadded base64url encoding of 16-96
 * random bytes. This mechanically enforces the documented >=128-bit space.
 */
export function assertStrongIdempotencyKey(rawKey: string): Buffer {
  if (!/^[A-Za-z0-9_-]{22,128}$/.test(rawKey)) throw new Error('INVALID_IDEMPOTENCY_KEY');
  const decoded = Buffer.from(rawKey, 'base64url');
  if (decoded.length < 16 || decoded.length > 96 || decoded.toString('base64url') !== rawKey) {
    throw new Error('INVALID_IDEMPOTENCY_KEY');
  }
  return decoded;
}

function assertCanonicalTokenPart(value: string, decodedLength: number, code: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(code);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== decodedLength || decoded.toString('base64url') !== value) throw new Error(code);
  return decoded;
}

/**
 * P2 closure for the contract's byte ambiguity: selector/secret are decoded,
 * length-checked, then re-encoded as canonical unpadded base64url JSON strings.
 * The exact JCS input is therefore {"secret":"...","selector":"..."}.
 */
export function actionIntentTokenDigest(key: Buffer, selector: string, secret: string): string {
  if (key.length !== 32) throw new Error('INVALID_ACTION_INTENT_KEY_MATERIAL');
  assertCanonicalTokenPart(selector, 16, 'INVALID_ACTION_INTENT_SELECTOR');
  assertCanonicalTokenPart(secret, 32, 'INVALID_ACTION_INTENT_SECRET');
  return createHmac('sha256', key)
    .update(Buffer.from('tyre.ge/action-intent-token/v1\n', 'utf8'))
    .update(canonicalJsonBytes({ selector, secret }))
    .digest('base64url');
}

export function constantTimeDigestEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, 'base64url');
  const right = Buffer.from(expected, 'base64url');
  return left.length === right.length && timingSafeEqual(left, right);
}
