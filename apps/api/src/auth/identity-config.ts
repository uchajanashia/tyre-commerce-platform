import { createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';

export const IDENTITY_AUTH_CONTRACT_VERSION = 2;
export const IDENTITY_CONFIG = Symbol('IDENTITY_CONFIG');

export type KeyState = 'sign+verify' | 'encrypt+decrypt' | 'verify-only' | 'decrypt-only' | 'revoked';

export interface SymmetricKeyEntry {
  id: string;
  state: KeyState;
  key: Buffer;
}

export interface SymmetricKeyRing {
  currentKeyId: string;
  keys: ReadonlyMap<string, SymmetricKeyEntry>;
}

export interface JwtKeyEntry {
  id: string;
  state: 'sign+verify' | 'verify-only' | 'revoked';
  publicKey: KeyObject;
  privateKey?: KeyObject;
}

export interface JwtKeyRing {
  currentKeyId: string;
  keys: ReadonlyMap<string, JwtKeyEntry>;
}

export interface IdentityConfig {
  enabled: boolean;
  environment: 'development' | 'production' | 'test';
  adminPublicOrigin?: string;
  allowedOrigins: readonly string[];
  accessTokenTtlSeconds: number;
  clockToleranceSeconds: number;
  refreshIdleSeconds: number;
  refreshAbsoluteSeconds: number;
  refreshReceiptSeconds: number;
  jwtIssuer?: string;
  jwtAudience?: string;
  jwtKeys?: JwtKeyRing;
  digestKeys?: SymmetricKeyRing;
  csrfKeys?: SymmetricKeyRing;
  envelopeKeys?: SymmetricKeyRing;
  totpKeys?: SymmetricKeyRing;
  deliveryAdapter: 'disabled' | 'manual' | 'production';
  privilegedRoleKeys: readonly string[];
  privilegedRolePolicyReviewed: boolean;
  privilegedRolePolicyReviewId?: string;
  canonicalBackfillReviewed: boolean;
  keyCompromiseWorkflowsReviewed: boolean;
  operatorMode: boolean;
}

function bool(name: string, fallback = false): boolean {
  const value = (process.env[name] ?? String(fallback)).trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function environment(): IdentityConfig['environment'] {
  const value = (process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development').trim();
  if (value === 'development' || value === 'production' || value === 'test') return value;
  throw new Error('APP_ENV must be development, production or test.');
}

function exactOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  const defaults = ['http://localhost:4200', 'http://localhost:4300'];
  return (raw ? raw.split(',') : defaults).map((origin) => new URL(origin.trim()).origin);
}

function canonicalAdminOrigin(value: string, env: IdentityConfig['environment']): string {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('ADMIN_PUBLIC_ORIGIN must be a canonical origin without path, credentials, query or fragment.');
  }
  if (env === 'production' && url.protocol !== 'https:') {
    throw new Error('ADMIN_PUBLIC_ORIGIN must use HTTPS in production.');
  }
  if (env !== 'production' && url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Development HTTP ADMIN_PUBLIC_ORIGIN is allowed only on localhost.');
  }
  return url.origin;
}

function parseSymmetricRing(name: string, activeState: 'encrypt+decrypt' | 'sign+verify'): SymmetricKeyRing {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is required when ADMIN_IDENTITY_ENABLED=true.`);
  let parsed: { currentKeyId?: string; keys?: Array<{ id?: string; state?: KeyState; keyBase64?: string }> };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
  if (!parsed.currentKeyId || !Array.isArray(parsed.keys)) throw new Error(`${name} has an invalid key-ring shape.`);
  const keys = new Map<string, SymmetricKeyEntry>();
  for (const item of parsed.keys) {
    if (!item.id || !item.state || !item.keyBase64 || keys.has(item.id)) throw new Error(`${name} contains an invalid key entry.`);
    const allowedStates: KeyState[] = activeState === 'sign+verify'
      ? ['sign+verify', 'verify-only', 'revoked']
      : ['encrypt+decrypt', 'decrypt-only', 'revoked'];
    if (!allowedStates.includes(item.state)) throw new Error(`${name} contains a key state invalid for its purpose.`);
    const key = Buffer.from(item.keyBase64, 'base64');
    if (key.length !== 32 || key.toString('base64') !== item.keyBase64) throw new Error(`${name} keys must be canonical 32-byte base64 values.`);
    keys.set(item.id, { id: item.id, state: item.state, key });
  }
  const current = keys.get(parsed.currentKeyId);
  if (!current || current.state !== activeState) throw new Error(`${name} current key must be ${activeState}.`);
  return { currentKeyId: parsed.currentKeyId, keys };
}

function parseJwtRing(): JwtKeyRing {
  const raw = process.env.ADMIN_JWT_KEY_RING_JSON;
  if (!raw) throw new Error('ADMIN_JWT_KEY_RING_JSON is required when ADMIN_IDENTITY_ENABLED=true.');
  let parsed: {
    currentKeyId?: string;
    keys?: Array<{ id?: string; state?: JwtKeyEntry['state']; publicKeyPem?: string; privateKeyPem?: string }>;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error('ADMIN_JWT_KEY_RING_JSON must be valid JSON.');
  }
  if (!parsed.currentKeyId || !Array.isArray(parsed.keys)) throw new Error('ADMIN_JWT_KEY_RING_JSON has an invalid key-ring shape.');
  const keys = new Map<string, JwtKeyEntry>();
  for (const item of parsed.keys) {
    if (!item.id || !item.state || !item.publicKeyPem || keys.has(item.id)) throw new Error('ADMIN_JWT_KEY_RING_JSON contains an invalid key entry.');
    if (!['sign+verify', 'verify-only', 'revoked'].includes(item.state)) {
      throw new Error('ADMIN_JWT_KEY_RING_JSON contains an invalid lifecycle state.');
    }
    const publicKey = createPublicKey(item.publicKeyPem);
    if (publicKey.asymmetricKeyType !== 'rsa' || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) {
      throw new Error('Admin JWT keys must be RSA keys of at least 3072 bits.');
    }
    const privateKey = item.privateKeyPem ? createPrivateKey(item.privateKeyPem) : undefined;
    if (privateKey && privateKey.asymmetricKeyType !== 'rsa') throw new Error('Admin JWT private key must be RSA.');
    if (privateKey) {
      const derived = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
      const configured = publicKey.export({ type: 'spki', format: 'der' });
      if (!Buffer.from(derived).equals(Buffer.from(configured))) {
        throw new Error('Admin JWT private key does not match its configured public key.');
      }
    }
    keys.set(item.id, { id: item.id, state: item.state, publicKey, privateKey });
  }
  const current = keys.get(parsed.currentKeyId);
  if (!current || current.state !== 'sign+verify' || !current.privateKey) {
    throw new Error('Current admin JWT key must be sign+verify and include a private key.');
  }
  return { currentKeyId: parsed.currentKeyId, keys };
}

export function readIdentityConfig(): IdentityConfig {
  const env = environment();
  const enabled = bool('ADMIN_IDENTITY_ENABLED');
  const operatorMode = bool('ADMIN_IDENTITY_OPERATOR_MODE');
  const deliveryRaw = (process.env.IDENTITY_DELIVERY_ADAPTER ?? 'disabled').trim();
  if (deliveryRaw !== 'disabled' && deliveryRaw !== 'manual' && deliveryRaw !== 'production') {
    throw new Error('IDENTITY_DELIVERY_ADAPTER must be disabled, manual or production.');
  }
  const deliveryAdapter = deliveryRaw as IdentityConfig['deliveryAdapter'];
  if (!enabled) {
    return {
      enabled,
      environment: env,
      allowedOrigins: exactOrigins(),
      accessTokenTtlSeconds: 600,
      clockToleranceSeconds: 30,
      refreshIdleSeconds: 7 * 86_400,
      refreshAbsoluteSeconds: 30 * 86_400,
      refreshReceiptSeconds: 10,
      deliveryAdapter: 'disabled',
      privilegedRoleKeys: [],
      privilegedRolePolicyReviewed: false,
      canonicalBackfillReviewed: false,
      keyCompromiseWorkflowsReviewed: false,
      operatorMode,
    };
  }

  const originRaw = process.env.ADMIN_PUBLIC_ORIGIN?.trim();
  if (!originRaw) throw new Error('ADMIN_PUBLIC_ORIGIN is required when ADMIN_IDENTITY_ENABLED=true.');
  const adminPublicOrigin = canonicalAdminOrigin(originRaw, env);
  const allowedOrigins = exactOrigins();
  if (!allowedOrigins.includes(adminPublicOrigin)) throw new Error('ADMIN_PUBLIC_ORIGIN must be an exact allowlisted origin.');
  const privilegedRoleKeys = [...new Set(
    (process.env.ADMIN_PRIVILEGED_ROLE_KEYS ?? '').split(',').map((key) => key.trim()).filter(Boolean),
  )].sort();
  if (privilegedRoleKeys.length === 0) {
    throw new Error('ADMIN_PRIVILEGED_ROLE_KEYS must explicitly name every privileged role when identity v2 is enabled.');
  }
  const privilegedRolePolicyReviewed = bool('ADMIN_PRIVILEGED_ROLE_POLICY_REVIEWED');
  const canonicalBackfillReviewed = bool('ADMIN_IDENTITY_CANONICAL_BACKFILL_REVIEWED');
  const keyCompromiseWorkflowsReviewed = bool('ADMIN_IDENTITY_KEY_WORKFLOWS_REVIEWED');
  const privilegedRolePolicyReviewId = process.env.ADMIN_PRIVILEGED_ROLE_POLICY_REVIEW_ID?.trim();
  if (privilegedRolePolicyReviewed && !privilegedRolePolicyReviewId) {
    throw new Error('ADMIN_PRIVILEGED_ROLE_POLICY_REVIEW_ID is required when the D-05 policy is reviewed.');
  }
  if (env === 'production' && !operatorMode) {
    if (!privilegedRolePolicyReviewed || !privilegedRolePolicyReviewId) {
      throw new Error('Production identity v2 requires reviewed D-05 privileged-role policy metadata.');
    }
    if (!bool('ADMIN_IDENTITY_SAME_ORIGIN_PROXY_VERIFIED') || !bool('ADMIN_IDENTITY_P2_EVIDENCE_COMPLETE')) {
      throw new Error('Production identity v2 requires same-origin proxy and P2 evidence approval.');
    }
    if (!canonicalBackfillReviewed || !keyCompromiseWorkflowsReviewed) {
      throw new Error('Production identity v2 requires reviewed canonical-backfill and key-compromise workflows.');
    }
    if (deliveryAdapter !== 'production') throw new Error('Production identity v2 requires a production delivery adapter.');
    throw new Error('Production identity v2 remains disabled until a production delivery adapter is implemented and reviewed.');
  } else if (env !== 'production' && deliveryAdapter === 'production') {
    throw new Error('Production delivery adapter cannot be selected outside production.');
  }
  const jwtIssuer = process.env.ADMIN_JWT_ISSUER?.trim();
  const jwtAudience = process.env.ADMIN_JWT_AUDIENCE?.trim();
  if (!jwtIssuer || !jwtAudience) throw new Error('ADMIN_JWT_ISSUER and ADMIN_JWT_AUDIENCE are required.');
  const digestKeys = parseSymmetricRing('ADMIN_TOKEN_DIGEST_KEY_RING_JSON', 'sign+verify');
  const csrfKeys = parseSymmetricRing('ADMIN_CSRF_KEY_RING_JSON', 'sign+verify');
  const envelopeKeys = parseSymmetricRing('ADMIN_ENVELOPE_KEY_RING_JSON', 'encrypt+decrypt');
  const totpKeys = parseSymmetricRing('ADMIN_TOTP_KEY_RING_JSON', 'encrypt+decrypt');
  const materialOwners = new Map<string, string>();
  for (const [purpose, ring] of Object.entries({ digest: digestKeys, csrf: csrfKeys, envelope: envelopeKeys, totp: totpKeys })) {
    for (const entry of ring.keys.values()) {
      const fingerprint = entry.key.toString('hex');
      const owner = materialOwners.get(fingerprint);
      if (owner && owner !== purpose) throw new Error('Identity key material must not be reused across purposes or lifecycle states.');
      materialOwners.set(fingerprint, purpose);
    }
  }

  return {
    enabled,
    environment: env,
    adminPublicOrigin,
    allowedOrigins,
    accessTokenTtlSeconds: integer('ADMIN_ACCESS_TTL_SECONDS', 600, 60, 900),
    clockToleranceSeconds: integer('ADMIN_JWT_CLOCK_TOLERANCE_SECONDS', 30, 0, 30),
    refreshIdleSeconds: integer('ADMIN_REFRESH_IDLE_SECONDS', 7 * 86_400, 300, 7 * 86_400),
    refreshAbsoluteSeconds: integer('ADMIN_REFRESH_ABSOLUTE_SECONDS', 30 * 86_400, 3600, 30 * 86_400),
    refreshReceiptSeconds: integer('ADMIN_REFRESH_RECEIPT_SECONDS', 10, 1, 10),
    jwtIssuer,
    jwtAudience,
    jwtKeys: parseJwtRing(),
    digestKeys,
    csrfKeys,
    envelopeKeys,
    totpKeys,
    deliveryAdapter,
    privilegedRoleKeys,
    privilegedRolePolicyReviewed,
    canonicalBackfillReviewed,
    keyCompromiseWorkflowsReviewed,
    operatorMode,
    ...(privilegedRolePolicyReviewId ? { privilegedRolePolicyReviewId } : {}),
  };
}
