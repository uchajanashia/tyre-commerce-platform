import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { domainToASCII } from 'node:url';

import { SymmetricKeyRing } from './identity-config';

export interface OpaqueToken {
  selector: string;
  secret: string;
  value: string;
}

export interface EncryptedValue {
  keyId: string;
  nonce: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function framed(parts: readonly string[]): Buffer {
  const encoded = parts.map((part) => Buffer.from(part, 'utf8'));
  const chunks: Buffer[] = [];
  for (const part of encoded) {
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(part.length);
    chunks.push(length, part);
  }
  return Buffer.concat(chunks);
}

export function generateOpaqueToken(): OpaqueToken {
  const selector = base64url(randomBytes(16));
  const secret = base64url(randomBytes(32));
  return { selector, secret, value: `${selector}.${secret}` };
}

export function parseOpaqueToken(value: string): OpaqueToken | null {
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [selector, secret] = parts;
  if (!/^[A-Za-z0-9_-]{22}$/.test(selector) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { selector, secret, value };
}

export function tokenDigest(
  ring: SymmetricKeyRing,
  keyId: string,
  purpose: string,
  token: Pick<OpaqueToken, 'selector' | 'secret'>,
  subjectId: string,
): string {
  const entry = ring.keys.get(keyId);
  if (!entry || entry.state === 'revoked') throw new Error('TOKEN_KEY_UNAVAILABLE');
  return createHmac('sha256', entry.key)
    .update(framed(['tyre.identity.token.v1', purpose, token.selector, token.secret, subjectId]))
    .digest('base64url');
}

export function verifyTokenDigest(
  ring: SymmetricKeyRing,
  keyId: string,
  purpose: string,
  token: Pick<OpaqueToken, 'selector' | 'secret'>,
  subjectId: string,
  expected: string,
): boolean {
  let actual: Buffer;
  let expectedBytes: Buffer;
  try {
    actual = Buffer.from(tokenDigest(ring, keyId, purpose, token, subjectId), 'base64url');
    expectedBytes = Buffer.from(expected, 'base64url');
  } catch {
    return false;
  }
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

export function keyedDigest(
  ring: SymmetricKeyRing,
  keyId: string,
  purpose: string,
  values: readonly string[],
): string {
  const entry = ring.keys.get(keyId);
  if (!entry || entry.state === 'revoked') throw new Error('DIGEST_KEY_UNAVAILABLE');
  return createHmac('sha256', entry.key)
    .update(framed(['tyre.identity.digest.v1', purpose, ...values]))
    .digest('base64url');
}

export function constantTimeTextEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function encryptAead(
  ring: SymmetricKeyRing,
  plaintext: Buffer | string,
  aadParts: readonly string[],
): EncryptedValue {
  const keyId = ring.currentKeyId;
  const entry = ring.keys.get(keyId);
  if (!entry || entry.state !== 'encrypt+decrypt') throw new Error('ENCRYPTION_KEY_UNAVAILABLE');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', entry.key, nonce);
  cipher.setAAD(framed(['tyre.identity.aead.v1', keyId, ...aadParts]));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { keyId, nonce, ciphertext, authTag: cipher.getAuthTag() };
}

export function decryptAead(
  ring: SymmetricKeyRing,
  encrypted: EncryptedValue,
  aadParts: readonly string[],
): Buffer {
  const entry = ring.keys.get(encrypted.keyId);
  if (!entry || entry.state === 'revoked') throw new Error('DECRYPTION_KEY_UNAVAILABLE');
  const decipher = createDecipheriv('aes-256-gcm', entry.key, encrypted.nonce);
  decipher.setAAD(framed(['tyre.identity.aead.v1', encrypted.keyId, ...aadParts]));
  decipher.setAuthTag(encrypted.authTag);
  return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
}

/**
 * Identity canonicalization (P2-1): trim surrounding Unicode whitespace, NFKC
 * normalize both parts, lowercase the exact local part, and convert the domain
 * to lower-case IDNA ASCII. The result is stored under a database binary unique
 * index, so every lifecycle state shares one identity.
 */
export function normalizeStaffEmail(input: string): string {
  const normalized = input.trim().normalize('NFKC');
  if (/\p{C}|\s/u.test(normalized)) throw new Error('INVALID_EMAIL');
  const at = normalized.lastIndexOf('@');
  if (at <= 0 || at !== normalized.indexOf('@') || at === normalized.length - 1) throw new Error('INVALID_EMAIL');
  const local = normalized.slice(0, at).normalize('NFKC').toLocaleLowerCase('en-US');
  const domain = domainToASCII(normalized.slice(at + 1).normalize('NFKC')).toLowerCase();
  if (!domain || local.length > 64 || Buffer.byteLength(`${local}@${domain}`) > 254) throw new Error('INVALID_EMAIL');
  return `${local}@${domain}`;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let offset = 0; offset < bits.length; offset += 5) {
    result += BASE32_ALPHABET[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, '0'), 2)];
  }
  return result;
}

function decodeBase32(value: string): Buffer {
  const canonical = value.replace(/=+$/u, '').toUpperCase();
  if (!/^[A-Z2-7]+$/.test(canonical)) throw new Error('INVALID_BASE32');
  let bits = '';
  for (const char of canonical) bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return number.toString().padStart(digits, '0');
}

export function matchTotpStep(secret: string, submitted: string, nowMs = Date.now(), window = 1): number | null {
  if (!/^\d{6}$/.test(submitted)) return null;
  const current = Math.floor(nowMs / 30_000);
  for (let delta = -window; delta <= window; delta += 1) {
    const step = current + delta;
    if (constantTimeTextEqual(totpCode(secret, step), submitted)) return step;
  }
  return null;
}
