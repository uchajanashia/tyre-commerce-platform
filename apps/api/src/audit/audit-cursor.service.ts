import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { canonicalJsonBytes, canonicalJsonText } from '../governance/canonical-json';
import { AUDIT_READER_CONFIG, AuditReaderConfig } from './audit-reader.config';

export interface AuditCursorPayload {
  cursorVersion: 'ac1';
  keyId: string;
  viewerId: string;
  sessionId: string;
  accountVersion: number;
  tokenVersion: number;
  minimumAuthContractVersion: number;
  securityControlVersion: number;
  authorizationGraphDigestVersion: 1;
  authorizationGraphDigest: string;
  readerPolicyVersion: number;
  normalizedFilterHash: string;
  sortField: 'occurredAt' | 'eventType' | 'outcome';
  sortDirection: 'asc' | 'desc';
  pageSize: number;
  asOfOccurredAt: string;
  lastSortValue: string;
  lastOccurredAt: string;
  lastEventId: string;
  issuedAt: string;
  expiresAt: string;
}

const PAYLOAD_KEYS = [
  'cursorVersion', 'keyId', 'viewerId', 'sessionId', 'accountVersion', 'tokenVersion',
  'minimumAuthContractVersion', 'securityControlVersion', 'authorizationGraphDigestVersion',
  'authorizationGraphDigest', 'readerPolicyVersion', 'normalizedFilterHash', 'sortField',
  'sortDirection', 'pageSize', 'asOfOccurredAt', 'lastSortValue', 'lastOccurredAt',
  'lastEventId', 'issuedAt', 'expiresAt',
].sort();

function canonicalPart(value: string, bytes: number, code: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(code);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== bytes || decoded.toString('base64url') !== value) throw new Error(code);
  return decoded;
}

export function auditDomainHash(domain: 'authorization-graph' | 'normalized-filter', value: unknown): string {
  return createHash('sha256')
    .update(Buffer.from(`tyre.ge/audit-${domain}/v1\n`, 'utf8'))
    .update(canonicalJsonBytes(value))
    .digest('base64url');
}

export function constantTimeAuditTextEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left, 'utf8').digest();
  const b = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(a, b);
}

@Injectable()
export class AuditCursorService {
  constructor(@Inject(AUDIT_READER_CONFIG) private readonly config: AuditReaderConfig) {}

  issue(payload: Omit<AuditCursorPayload, 'cursorVersion' | 'keyId' | 'issuedAt' | 'expiresAt'>, now = new Date()): string {
    this.assertEnabled();
    const key = this.config.cursorKeys!.find((candidate) => candidate.state === 'issuing' && !candidate.revoked)!;
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.config.cursorMaxTtlSeconds! * 1_000).toISOString();
    if (key.notBefore > now.getTime() || key.verifyUntil < Date.parse(expiresAt)) throw new Error('AUDIT_CURSOR_KEY_UNAVAILABLE');
    const full: AuditCursorPayload = { cursorVersion: 'ac1', keyId: key.id, ...payload, issuedAt, expiresAt };
    this.assertPayload(full as unknown as Record<string, unknown>, key.id, now);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key.material, nonce);
    cipher.setAAD(Buffer.from(`tyre.audit.cursor.ac1\0${key.id}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(canonicalJsonBytes(full)), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `ac1.${key.id}.${nonce.toString('base64url')}.${ciphertext.toString('base64url')}.${tag.toString('base64url')}`;
  }

  decrypt(token: string, now = new Date()): AuditCursorPayload {
    this.assertEnabled();
    if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') > this.config.maxCursorBytes!) throw new Error('INVALID_AUDIT_CURSOR');
    const parts = token.split('.');
    if (parts.length !== 5 || parts[0] !== 'ac1' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(parts[1])) {
      throw new Error('INVALID_AUDIT_CURSOR');
    }
    const key = this.config.cursorKeys!.find((candidate) => candidate.id === parts[1]);
    if (!key || key.revoked || key.notBefore > now.getTime() || key.verifyUntil < now.getTime()) throw new Error('INVALID_AUDIT_CURSOR');
    try {
      const nonce = canonicalPart(parts[2], 12, 'INVALID_AUDIT_CURSOR');
      const ciphertext = canonicalPart(parts[3], Buffer.from(parts[3], 'base64url').length, 'INVALID_AUDIT_CURSOR');
      const tag = canonicalPart(parts[4], 16, 'INVALID_AUDIT_CURSOR');
      const decipher = createDecipheriv('aes-256-gcm', key.material, nonce);
      decipher.setAAD(Buffer.from(`tyre.audit.cursor.ac1\0${key.id}`, 'utf8'));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      const parsed = JSON.parse(plaintext) as Record<string, unknown>;
      if (!parsed || Array.isArray(parsed) || Object.keys(parsed).sort().join('\0') !== PAYLOAD_KEYS.join('\0') ||
          canonicalJsonText(parsed) !== plaintext) throw new Error();
      this.assertPayload(parsed, key.id, now);
      return parsed as unknown as AuditCursorPayload;
    } catch {
      throw new Error('INVALID_AUDIT_CURSOR');
    }
  }

  private assertPayload(value: Record<string, unknown>, keyId: string, now: Date): void {
    const strings = ['viewerId','sessionId','authorizationGraphDigest','normalizedFilterHash','asOfOccurredAt',
      'lastSortValue','lastOccurredAt','lastEventId','issuedAt','expiresAt'];
    const integers = ['accountVersion','tokenVersion','minimumAuthContractVersion','securityControlVersion',
      'authorizationGraphDigestVersion','readerPolicyVersion','pageSize'];
    const canonicalInstant = (candidate: unknown): number => {
      if (typeof candidate !== 'string') return NaN;
      const parsed = Date.parse(candidate);
      return Number.isFinite(parsed) && new Date(parsed).toISOString() === candidate ? parsed : NaN;
    };
    const issuedAt = canonicalInstant(value.issuedAt);
    const expiresAt = canonicalInstant(value.expiresAt);
    const asOf = canonicalInstant(value.asOfOccurredAt);
    const lastOccurredAt = canonicalInstant(value.lastOccurredAt);
    const lastSortValue = value.sortField === 'occurredAt' ? canonicalInstant(value.lastSortValue) : NaN;
    const boundedId = (candidate: unknown) => typeof candidate === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(candidate);
    if (value.cursorVersion !== 'ac1' || value.keyId !== keyId ||
        !strings.every((field) => typeof value[field] === 'string' && (value[field] as string).length > 0) ||
        !integers.every((field) => Number.isSafeInteger(value[field]) && (value[field] as number) > 0) ||
        !boundedId(value.viewerId) || !boundedId(value.sessionId) || !boundedId(value.lastEventId) ||
        !/^[A-Za-z0-9_-]{43}$/.test(String(value.authorizationGraphDigest)) ||
        !/^[A-Za-z0-9_-]{43}$/.test(String(value.normalizedFilterHash)) ||
        !['occurredAt','eventType','outcome'].includes(String(value.sortField)) ||
        !['asc','desc'].includes(String(value.sortDirection)) ||
        !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(asOf) ||
        !Number.isFinite(lastOccurredAt) || issuedAt > now.getTime() || expiresAt <= now.getTime() ||
        lastOccurredAt > asOf || asOf > issuedAt || issuedAt >= expiresAt ||
        expiresAt - issuedAt > this.config.cursorMaxTtlSeconds! * 1_000 ||
        (value.sortField === 'occurredAt' && (!Number.isFinite(lastSortValue) || lastSortValue !== lastOccurredAt)) ||
        (value.sortField === 'eventType' && !/^[a-z][a-z0-9_.-]{0,127}$/.test(String(value.lastSortValue))) ||
        (value.sortField === 'outcome' && !['succeeded','failed','denied'].includes(String(value.lastSortValue))) ||
        value.pageSize as number > this.config.maxPageSize! || value.readerPolicyVersion !== this.config.readerPolicyVersion ||
        value.authorizationGraphDigestVersion !== 1) throw new Error();
  }

  private assertEnabled(): void {
    if (!this.config.enabled) throw new Error('AUDIT_READER_DISABLED');
  }
}
