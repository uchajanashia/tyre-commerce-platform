import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { canonicalJsonBytes, canonicalJsonText } from '../governance/canonical-json';
import { JOBS_CONFIG, JobsConfig } from './jobs.config';

export interface JobCursorPayload {
  cursorVersion: 'jc1'; keyId: string; viewerId: string; sessionId: string;
  accountVersion: number; tokenVersion: number; minimumAuthContractVersion: number; securityControlVersion: number;
  authorizationGraphDigestVersion: 1; authorizationGraphDigest: string; readerPolicyVersion: number;
  normalizedFilterHash: string; sortField: 'createdAt'|'availableAt'|'state'|'priority'; sortDirection: 'asc'|'desc';
  pageSize: number; asOfCreatedAt: string; lastSortValue: string; lastCreatedAt: string; lastJobId: string;
  issuedAt: string; expiresAt: string;
}

const KEYS = ['cursorVersion','keyId','viewerId','sessionId','accountVersion','tokenVersion','minimumAuthContractVersion',
  'securityControlVersion','authorizationGraphDigestVersion','authorizationGraphDigest','readerPolicyVersion',
  'normalizedFilterHash','sortField','sortDirection','pageSize','asOfCreatedAt','lastSortValue','lastCreatedAt','lastJobId',
  'issuedAt','expiresAt'].sort();

export function jobDomainHash(domain: 'authorization-graph'|'normalized-filter', value: unknown): string {
  return createHash('sha256').update(`tyre.ge/jobs-${domain}/v1\n`).update(canonicalJsonBytes(value)).digest('base64url');
}
export function constantTimeJobTextEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

@Injectable()
export class JobCursorService {
  constructor(@Inject(JOBS_CONFIG) private readonly config: JobsConfig) {}
  issue(payload: Omit<JobCursorPayload,'cursorVersion'|'keyId'|'issuedAt'|'expiresAt'>, now = new Date()): string {
    this.enabled();
    const key = this.config.cursorKeys!.find((entry) => entry.state === 'issuing' && !entry.revoked)!;
    const full: JobCursorPayload = { cursorVersion:'jc1', keyId:key.id, ...payload, issuedAt:now.toISOString(),
      expiresAt:new Date(now.getTime()+this.config.cursorMaxTtlSeconds!*1000).toISOString() };
    this.assert(full as unknown as Record<string, unknown>, key.id, now);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key.material, nonce);
    cipher.setAAD(Buffer.from(`tyre.jobs.cursor.jc1\0${key.id}`));
    const body = Buffer.concat([cipher.update(canonicalJsonBytes(full)), cipher.final()]);
    return `jc1.${key.id}.${nonce.toString('base64url')}.${body.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
  }
  decrypt(token: string, now = new Date()): JobCursorPayload {
    this.enabled();
    if (typeof token !== 'string' || Buffer.byteLength(token) > this.config.maxCursorBytes!) throw new Error('INVALID_JOB_CURSOR');
    const parts = token.split('.');
    if (parts.length !== 5 || parts[0] !== 'jc1') throw new Error('INVALID_JOB_CURSOR');
    const key = this.config.cursorKeys!.find((entry) => entry.id === parts[1]);
    if (!key || key.revoked || key.notBefore > now.getTime() || key.verifyUntil < now.getTime()) throw new Error('INVALID_JOB_CURSOR');
    try {
      const nonce = Buffer.from(parts[2], 'base64url'); const body = Buffer.from(parts[3], 'base64url'); const tag = Buffer.from(parts[4], 'base64url');
      if (nonce.length !== 12 || tag.length !== 16 || nonce.toString('base64url') !== parts[2] || tag.toString('base64url') !== parts[4] || body.toString('base64url') !== parts[3]) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key.material, nonce);
      decipher.setAAD(Buffer.from(`tyre.jobs.cursor.jc1\0${key.id}`)); decipher.setAuthTag(tag);
      const text = Buffer.concat([decipher.update(body), decipher.final()]).toString();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (!parsed || Array.isArray(parsed) || Object.keys(parsed).sort().join('\0') !== KEYS.join('\0') || canonicalJsonText(parsed) !== text) throw new Error();
      this.assert(parsed, key.id, now); return parsed as unknown as JobCursorPayload;
    } catch { throw new Error('INVALID_JOB_CURSOR'); }
  }
  private assert(v: Record<string,unknown>, keyId: string, now: Date): void {
    const instant = (x: unknown) => {
      if (typeof x !== 'string') return NaN;
      const value = Date.parse(x);
      return Number.isFinite(value) && new Date(value).toISOString() === x ? value : NaN;
    };
    const issued=instant(v.issuedAt), expires=instant(v.expiresAt), asOf=instant(v.asOfCreatedAt), created=instant(v.lastCreatedAt);
    const ints=['accountVersion','tokenVersion','minimumAuthContractVersion','securityControlVersion','authorizationGraphDigestVersion','readerPolicyVersion','pageSize'];
    if (v.cursorVersion!=='jc1'||v.keyId!==keyId||!ints.every(k=>Number.isSafeInteger(v[k])&&(v[k] as number)>0)||
      !['createdAt','availableAt','state','priority'].includes(String(v.sortField))||!['asc','desc'].includes(String(v.sortDirection))||
      !/^[A-Za-z0-9_-]{43}$/.test(String(v.authorizationGraphDigest))||!/^[A-Za-z0-9_-]{43}$/.test(String(v.normalizedFilterHash))||
      !['viewerId','sessionId','lastSortValue','lastJobId'].every(k=>typeof v[k]==='string'&&(v[k] as string).length>0)||
      !Number.isFinite(issued)||!Number.isFinite(expires)||!Number.isFinite(asOf)||!Number.isFinite(created)||
      issued>now.getTime()||expires<=now.getTime()||asOf>issued||created>asOf||expires-issued>this.config.cursorMaxTtlSeconds!*1000||
      v.pageSize as number>this.config.maxPageSize!||v.readerPolicyVersion!==this.config.readerPolicyVersion||v.authorizationGraphDigestVersion!==1) throw new Error('INVALID_JOB_CURSOR');
  }
  private enabled() { if (!this.config.enabled) throw new Error('JOBS_READER_DISABLED'); }
}
