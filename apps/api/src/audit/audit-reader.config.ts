import { Buffer } from 'node:buffer';

export interface AuditCursorKey {
  id: string;
  material: Buffer;
  state: 'issuing' | 'retiring';
  notBefore: number;
  verifyUntil: number;
  retiringSince?: number;
  revoked: boolean;
}

export interface AuditReaderConfig {
  requested: boolean;
  enabled: boolean;
  disabledReasons: string[];
  cursorMaxTtlSeconds?: number;
  maxPageSize?: number;
  maxTimeRangeSeconds?: number;
  maxFilters?: number;
  maxCursorBytes?: number;
  detailPaddingMs?: number;
  queryPlanPolicyId?: string;
  readerPolicyVersion?: number;
  cursorKeys?: AuditCursorKey[];
  readerDatabaseUrl?: string;
  readerDatabaseRole?: string;
  writerDatabaseUrl?: string;
  writerDatabaseRole?: string;
  runtimeContextKeyId?: string;
  runtimeContextKey?: Buffer;
  runtimeContextTtlSeconds?: number;
}

export const AUDIT_READER_CONFIG = Symbol('AUDIT_READER_CONFIG');

function requestedFlag(): boolean {
  const raw = (process.env.ADMIN_AUDIT_READER_ENABLED ?? 'false').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return false;
}

function positiveInteger(name: string, reasons: string[]): number | undefined {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    reasons.push(`${name}_REQUIRED`);
    return undefined;
  }
  return parsed;
}

function boundedIdentifier(name: string, reasons: string[]): string | undefined {
  const value = process.env[name]?.trim();
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    reasons.push(`${name}_REQUIRED`);
    return undefined;
  }
  return value;
}

interface ParsedAuditDatabaseUrl {
  username: string;
  password: string;
  target: string;
}

function parseAuditDatabaseUrl(raw: string | undefined): ParsedAuditDatabaseUrl | undefined {
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) return undefined;
    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    if (!username || !password) return undefined;
    parsed.username = '';
    parsed.password = '';
    return { username, password, target: parsed.toString() };
  } catch {
    return undefined;
  }
}

function parseKeyRing(maxTtlSeconds: number | undefined, reasons: string[]): AuditCursorKey[] | undefined {
  const raw = process.env.AUDIT_READER_CURSOR_KEY_RING_JSON?.trim();
  if (!raw) {
    reasons.push('AUDIT_READER_CURSOR_KEY_RING_JSON_REQUIRED');
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { keys?: Array<Record<string, unknown>> };
    if (!parsed || Object.keys(parsed).some((key) => key !== 'keys') || !Array.isArray(parsed.keys)) throw new Error();
    const ids = new Set<string>();
    const keys = parsed.keys.map((entry): AuditCursorKey => {
      if (Object.keys(entry).some((key) => !['id', 'key', 'state', 'notBefore', 'verifyUntil', 'retiringSince', 'revoked'].includes(key))) throw new Error();
      const id = typeof entry.id === 'string' ? entry.id : '';
      const encoded = typeof entry.key === 'string' ? entry.key : '';
      const material = Buffer.from(encoded, 'base64url');
      const state = entry.state;
      const notBefore = Date.parse(String(entry.notBefore));
      const verifyUntil = Date.parse(String(entry.verifyUntil));
      const retiringSince = entry.retiringSince === undefined ? undefined : Date.parse(String(entry.retiringSince));
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) || ids.has(id) ||
          material.length !== 32 || material.toString('base64url') !== encoded ||
          (state !== 'issuing' && state !== 'retiring') || !Number.isFinite(notBefore) ||
          !Number.isFinite(verifyUntil) || verifyUntil <= notBefore ||
          typeof entry.revoked !== 'boolean' ||
          (state === 'retiring' && (!Number.isFinite(retiringSince) || retiringSince! < notBefore || retiringSince! > verifyUntil))) throw new Error();
      ids.add(id);
      return { id, material, state, notBefore, verifyUntil, retiringSince, revoked: entry.revoked };
    });
    const now = Date.now();
    const issuing = keys.filter((key) => key.state === 'issuing' && !key.revoked);
    if (issuing.length !== 1 || !maxTtlSeconds || issuing[0].notBefore > now ||
        issuing[0].verifyUntil < now + maxTtlSeconds * 1_000 ||
        keys.some((key) => key.state === 'retiring' && key.retiringSince !== undefined &&
          key.verifyUntil - key.retiringSince > maxTtlSeconds * 1_000)) throw new Error();
    return keys;
  } catch {
    reasons.push('AUDIT_READER_CURSOR_KEY_RING_JSON_INVALID');
    return undefined;
  }
}

/** Missing/invalid owner values never acquire engineering defaults: an
 * explicitly requested reader simply remains unavailable. */
export function readAuditReaderConfig(): AuditReaderConfig {
  const requested = requestedFlag();
  if (!requested) return { requested: false, enabled: false, disabledReasons: ['FLAG_FALSE'] };
  const reasons: string[] = [];
  if ((process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development').trim() === 'production') {
    reasons.push('PRODUCTION_HARD_DENY');
  }
  const cursorMaxTtlSeconds = positiveInteger('AUDIT_READER_CURSOR_MAX_TTL_SECONDS', reasons);
  const maxPageSize = positiveInteger('AUDIT_READER_MAX_PAGE_SIZE', reasons);
  const maxTimeRangeSeconds = positiveInteger('AUDIT_READER_MAX_TIME_RANGE_SECONDS', reasons);
  const maxFilters = positiveInteger('AUDIT_READER_MAX_FILTERS', reasons);
  const maxCursorBytes = positiveInteger('AUDIT_READER_MAX_CURSOR_BYTES', reasons);
  const detailPaddingMs = positiveInteger('AUDIT_READER_DETAIL_PADDING_MS', reasons);
  if (detailPaddingMs && detailPaddingMs > 60_000) reasons.push('AUDIT_READER_DETAIL_PADDING_MS_INVALID');
  const queryPlanPolicyId = boundedIdentifier('AUDIT_READER_QUERY_PLAN_POLICY_ID', reasons);
  const readerPolicyVersion = positiveInteger('AUDIT_READER_POLICY_VERSION', reasons);
  const cursorKeys = parseKeyRing(cursorMaxTtlSeconds, reasons);
  const readerDatabaseUrl = process.env.AUDIT_READER_DATABASE_URL?.trim();
  const writerDatabaseUrl = process.env.AUDIT_WRITER_DATABASE_URL?.trim();
  const readerDatabaseRole = boundedIdentifier('AUDIT_READER_DATABASE_ROLE', reasons);
  const writerDatabaseRole = boundedIdentifier('AUDIT_WRITER_DATABASE_ROLE', reasons);
  const runtimeContextKeyId = boundedIdentifier('AUDIT_RUNTIME_CONTEXT_KEY_ID', reasons);
  const runtimeContextTtlSeconds = positiveInteger('AUDIT_RUNTIME_CONTEXT_TTL_SECONDS', reasons);
  const encodedContextKey = process.env.AUDIT_RUNTIME_CONTEXT_KEY?.trim() ?? '';
  const runtimeContextKey = Buffer.from(encodedContextKey, 'base64url');
  const readerDatabase = parseAuditDatabaseUrl(readerDatabaseUrl);
  const writerDatabase = parseAuditDatabaseUrl(writerDatabaseUrl);
  const migrationDatabase = parseAuditDatabaseUrl(process.env.DATABASE_URL?.trim());
  if (!readerDatabase) reasons.push('AUDIT_READER_DATABASE_URL_REQUIRED');
  if (!writerDatabase) reasons.push('AUDIT_WRITER_DATABASE_URL_REQUIRED');
  if ((readerDatabaseUrl && readerDatabaseUrl === process.env.DATABASE_URL?.trim()) ||
      (writerDatabaseUrl && writerDatabaseUrl === process.env.DATABASE_URL?.trim())) reasons.push('AUDIT_DATABASE_URL_MUST_BE_DEDICATED');
  const forbiddenRuntimeRoles = new Set(['tyre_audit_v2_guard_owner', 'tyre_audit_v2_reader', 'tyre_audit_v2_writer']);
  if (!readerDatabaseRole || !writerDatabaseRole || readerDatabaseRole === writerDatabaseRole ||
      forbiddenRuntimeRoles.has(readerDatabaseRole) || forbiddenRuntimeRoles.has(writerDatabaseRole) ||
      readerDatabase?.username !== readerDatabaseRole || writerDatabase?.username !== writerDatabaseRole ||
      readerDatabaseUrl === writerDatabaseUrl || readerDatabase?.password === writerDatabase?.password ||
      (readerDatabase && writerDatabase && readerDatabase.target !== writerDatabase.target) ||
      migrationDatabase?.username === readerDatabaseRole || migrationDatabase?.username === writerDatabaseRole) {
    reasons.push('AUDIT_DATABASE_ROLE_INVALID');
  }
  if (runtimeContextKey.length !== 32 || runtimeContextKey.toString('base64url') !== encodedContextKey) {
    reasons.push('AUDIT_RUNTIME_CONTEXT_KEY_INVALID');
  }
  return {
    requested,
    enabled: reasons.length === 0,
    disabledReasons: reasons,
    cursorMaxTtlSeconds,
    maxPageSize,
    maxTimeRangeSeconds,
    maxFilters,
    maxCursorBytes,
    detailPaddingMs,
    queryPlanPolicyId,
    readerPolicyVersion,
    cursorKeys,
    readerDatabaseUrl,
    readerDatabaseRole,
    writerDatabaseUrl,
    writerDatabaseRole,
    runtimeContextKeyId,
    runtimeContextKey: runtimeContextKey.length === 32 ? runtimeContextKey : undefined,
    runtimeContextTtlSeconds,
  };
}
