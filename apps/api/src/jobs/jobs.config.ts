import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { canonicalJsonBytes } from '../governance/canonical-json';

export interface JobCursorKey {
  id: string;
  material: Buffer;
  state: 'issuing' | 'retiring';
  notBefore: number;
  verifyUntil: number;
  retiringSince?: number;
  revoked: boolean;
}

export interface JobsConfig {
  requested: boolean;
  enabled: boolean;
  pollerEnabled: false;
  disabledReasons: string[];
  cursorKeys?: JobCursorKey[];
  cursorMaxTtlSeconds?: number;
  maxCursorBytes?: number;
  maxPageSize?: number;
  maxTimeRangeSeconds?: number;
  maxFilters?: number;
  detailPaddingMs?: number;
  readerPolicyVersion?: number;
  queryPlanPolicyId?: string;
  runtimeContractDigest?: string;
  registryDigest?: string;
  operationalPolicyDigest?: string;
  runtimeContextKeys?: Record<'producer' | 'claimer' | 'reader', { id: string; material: Buffer; ttlSeconds: number; principalId: string }>;
  boundaryDigests?: Record<'producer' | 'claimer' | 'reader' | 'maintenance', string>;
  databaseUrls?: Record<'producer' | 'claimer' | 'reader' | 'maintenance', string>;
  databaseRoles?: Record<'producer' | 'claimer' | 'reader' | 'maintenance', string>;
  operationalPolicy?: Record<string, unknown>;
}

export const JOBS_CONFIG = Symbol('JOBS_CONFIG');

const OPERATIONAL_INTEGERS = [
  'QUEUE_CAPACITY', 'PARTITION_CAPACITY', 'TOPIC_CAPACITY', 'ROOT_CAPACITY',
  'ENQUEUE_RATE', 'CLAIM_RATE', 'CONCURRENCY', 'CIRCUIT_FAILURE_THRESHOLD', 'CIRCUIT_OPEN_SECONDS',
  'MAX_PAGE_SIZE', 'MAX_TIME_RANGE_SECONDS', 'MAX_FILTERS', 'MAX_CURSOR_BYTES', 'MAX_PAYLOAD_BYTES',
  'MAX_ATTEMPTS', 'MAX_ERROR_BYTES', 'LEASE_SECONDS', 'HEARTBEAT_SECONDS', 'VISIBILITY_SECONDS',
  'DEAD_LETTER_RETENTION_SECONDS', 'RECEIPT_RETENTION_SECONDS', 'IDEMPOTENCY_RETENTION_SECONDS',
  'PARTITION_HORIZON_SECONDS', 'CLEANUP_BATCH_SIZE', 'CLEANUP_RATE', 'ALERT_QUEUE_DEPTH',
  'ALERT_OLDEST_AGE_SECONDS', 'RECOVERY_POINT_SECONDS', 'RECOVERY_TIME_SECONDS',
  'CURSOR_MAX_TTL_SECONDS', 'DETAIL_PADDING_MS', 'READER_POLICY_VERSION', 'RUNTIME_CONTEXT_TTL_SECONDS',
  'MAX_HEARTBEATS_PER_JOB', 'MAX_RECONCILIATIONS_PER_JOB', 'MAX_FENCE_LOSS_PER_MINUTE',
  'MAX_FACTS_PER_ORIGIN', 'MAX_AUDITS_PER_ORIGIN',
  'MAX_ATTEMPTS_PER_MINUTE', 'MAX_HEARTBEATS_PER_MINUTE', 'MAX_RECONCILIATIONS_PER_MINUTE',
  'MAX_FACTS_PER_MINUTE', 'MAX_AUDITS_PER_MINUTE',
] as const;

export function computeJobOperationalPolicyDigest(policy: Record<string, unknown>): string {
  return createHash('sha256')
    .update(Buffer.from('tyre.jobs.operational-policy.v1\n'))
    .update(canonicalJsonBytes(policy))
    .digest('base64url');
}

function positive(name: string, reasons: string[]): number | undefined {
  const raw = process.env[`JOBS_${name}`]?.trim();
  const value = raw ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value <= 0) reasons.push(`JOBS_${name}_REQUIRED`);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function identifier(name: string, reasons: string[]): string | undefined {
  const value = process.env[name]?.trim();
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) reasons.push(`${name}_REQUIRED`);
  return value && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : undefined;
}

function capacityMap(name: string, keyPattern: RegExp, reasons: string[]): Record<string, number> | undefined {
  try {
    const raw = process.env[name]?.trim();
    if (!raw) throw new Error();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    const entries = Object.entries(parsed as Record<string, unknown>).sort(([left],[right])=>left.localeCompare(right,'en',{usage:'sort'}));
    if (!entries.length || entries.some(([key,value])=>!keyPattern.test(key)||typeof value!=='number'||!Number.isSafeInteger(value)||value<=0||value>2147483647)) throw new Error();
    return Object.fromEntries(entries) as Record<string, number>;
  } catch {
    reasons.push(`${name}_INVALID`);
    return undefined;
  }
}

function database(raw: string | undefined): { user: string; password: string; target: string } | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return undefined;
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    if (!user || !password) return undefined;
    url.username = ''; url.password = '';
    return { user, password, target: url.toString() };
  } catch { return undefined; }
}

function keyRing(maxTtl: number | undefined, reasons: string[]): JobCursorKey[] | undefined {
  try {
    const raw = process.env.JOBS_CURSOR_KEY_RING_JSON?.trim();
    if (!raw) throw new Error();
    const object = JSON.parse(raw) as { keys?: Array<Record<string, unknown>> };
    if (!object || Object.keys(object).join() !== 'keys' || !Array.isArray(object.keys)) throw new Error();
    const seen = new Set<string>();
    const keys = object.keys.map((entry): JobCursorKey => {
      if (Object.keys(entry).some((key) => !['id','key','state','notBefore','verifyUntil','retiringSince','revoked'].includes(key))) throw new Error();
      const id = String(entry.id ?? '');
      const encoded = String(entry.key ?? '');
      const material = Buffer.from(encoded, 'base64url');
      const state = entry.state;
      const notBefore = Date.parse(String(entry.notBefore));
      const verifyUntil = Date.parse(String(entry.verifyUntil));
      const retiringSince = entry.retiringSince === undefined ? undefined : Date.parse(String(entry.retiringSince));
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) || seen.has(id) || material.length !== 32 ||
          material.toString('base64url') !== encoded || !['issuing','retiring'].includes(String(state)) ||
          !Number.isFinite(notBefore) || !Number.isFinite(verifyUntil) || verifyUntil <= notBefore ||
          typeof entry.revoked !== 'boolean' || (state === 'retiring' && !Number.isFinite(retiringSince))) throw new Error();
      seen.add(id);
      return { id, material, state: state as JobCursorKey['state'], notBefore, verifyUntil, retiringSince, revoked: entry.revoked };
    });
    const now = Date.now();
    const issuing = keys.filter((key) => key.state === 'issuing' && !key.revoked && key.notBefore <= now);
    if (!maxTtl || issuing.length !== 1 || issuing[0].verifyUntil < now + maxTtl * 1000 ||
        keys.some((key) => key.state === 'retiring' && key.retiringSince !== undefined && key.verifyUntil - key.retiringSince > maxTtl * 1000)) throw new Error();
    return keys;
  } catch {
    reasons.push('JOBS_CURSOR_KEY_RING_JSON_INVALID');
    return undefined;
  }
}

/** 3C is fail-closed. Engineering supplies no operational or retention defaults. */
export function readJobsConfig(): JobsConfig {
  const requested = (process.env.ADMIN_JOBS_READER_ENABLED ?? 'false').trim().toLowerCase() === 'true';
  if (!requested) return { requested: false, enabled: false, pollerEnabled: false, disabledReasons: ['FLAG_FALSE'] };
  const reasons: string[] = [];
  if ((process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development').trim() === 'production') reasons.push('PRODUCTION_HARD_DENY');
  const operationalPolicy: Record<string, unknown> = {};
  for (const name of OPERATIONAL_INTEGERS) {
    const value = positive(name, reasons);
    if (value !== undefined) operationalPolicy[name] = value;
  }
  const backoff = identifier('JOBS_BACKOFF_SCHEDULE_ID', reasons);
  const policy = identifier('JOBS_OPERATIONAL_POLICY_ID', reasons);
  const queryPlanPolicyId = identifier('JOBS_QUERY_PLAN_POLICY_ID', reasons);
  const runtimeContractDigest = process.env.JOBS_RUNTIME_CONTRACT_DIGEST?.trim();
  if (!runtimeContractDigest || !/^[A-Za-z0-9_-]{43}$/.test(runtimeContractDigest)) reasons.push('JOBS_RUNTIME_CONTRACT_DIGEST_REQUIRED');
  const registryDigest = process.env.JOBS_REGISTRY_DIGEST?.trim();
  if (!registryDigest || !/^[A-Za-z0-9_-]{43}$/.test(registryDigest)) reasons.push('JOBS_REGISTRY_DIGEST_REQUIRED');
  if (backoff) operationalPolicy.BACKOFF_SCHEDULE_ID = backoff;
  if (policy) operationalPolicy.OPERATIONAL_POLICY_ID = policy;
  if (queryPlanPolicyId) operationalPolicy.QUERY_PLAN_POLICY_ID = queryPlanPolicyId;
  const partitionCapacityMap = capacityMap('JOBS_PARTITION_CAPACITY_MAP_JSON',/^[a-z][a-z0-9_.:-]{0,127}$/,reasons);
  const topicCapacityMap = capacityMap('JOBS_TOPIC_CAPACITY_MAP_JSON',/^[a-z][a-z0-9_.-]{0,127}@[1-9][0-9]{0,9}$/,reasons);
  if (partitionCapacityMap) operationalPolicy.PARTITION_CAPACITY_MAP = partitionCapacityMap;
  if (topicCapacityMap) operationalPolicy.TOPIC_CAPACITY_MAP = topicCapacityMap;

  const purposes = ['producer','claimer','reader','maintenance'] as const;
  const urls = {} as Record<typeof purposes[number], string>;
  const roles = {} as Record<typeof purposes[number], string>;
  const parsed: Array<ReturnType<typeof database>> = [];
  for (const purpose of purposes) {
    const upper = purpose.toUpperCase();
    const url = process.env[`JOBS_${upper}_DATABASE_URL`]?.trim();
    const role = identifier(`JOBS_${upper}_DATABASE_ROLE`, reasons);
    const db = database(url);
    if (!db) reasons.push(`JOBS_${upper}_DATABASE_URL_REQUIRED`);
    if (url) urls[purpose] = url;
    if (role) roles[purpose] = role;
    if (db && role !== db.user) reasons.push(`JOBS_${upper}_DATABASE_ROLE_MISMATCH`);
    parsed.push(db);
  }
  const valid = parsed.filter(Boolean) as NonNullable<(typeof parsed)[number]>[];
  if (new Set(Object.values(urls)).size !== purposes.length || new Set(Object.values(roles)).size !== purposes.length ||
      new Set(valid.map((value) => value.password)).size !== purposes.length ||
      (valid.length && new Set(valid.map((value) => value.target)).size !== 1)) reasons.push('JOBS_DATABASE_IDENTITIES_NOT_DISTINCT');
  const cursorMaxTtlSeconds = operationalPolicy.CURSOR_MAX_TTL_SECONDS as number | undefined;
  const cursorKeys = keyRing(cursorMaxTtlSeconds, reasons);
  const runtimeContextKeys = {} as NonNullable<JobsConfig['runtimeContextKeys']>;
  const boundaryDigests = {} as NonNullable<JobsConfig['boundaryDigests']>;
  const ttlSeconds = operationalPolicy.RUNTIME_CONTEXT_TTL_SECONDS as number | undefined;
  for (const purpose of ['producer','claimer','reader'] as const) {
    const upper = purpose.toUpperCase();
    const id = identifier(`JOBS_${upper}_CONTEXT_KEY_ID`, reasons);
    const encoded = process.env[`JOBS_${upper}_CONTEXT_KEY`]?.trim() ?? '';
    const material = Buffer.from(encoded,'base64url');
    const principalId = identifier(`JOBS_${upper}_PRINCIPAL_ID`, reasons);
    if (material.length !== 32 || material.toString('base64url') !== encoded) reasons.push(`JOBS_${upper}_CONTEXT_KEY_INVALID`);
    if (id && material.length === 32 && ttlSeconds && principalId) runtimeContextKeys[purpose] = { id, material, ttlSeconds, principalId };
  }
  for (const purpose of purposes) {
    const value = process.env[`JOBS_${purpose.toUpperCase()}_BOUNDARY_DIGEST`]?.trim();
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) reasons.push(`JOBS_${purpose.toUpperCase()}_BOUNDARY_DIGEST_REQUIRED`);
    else boundaryDigests[purpose] = value;
  }
  const operationalPolicyDigest = computeJobOperationalPolicyDigest(operationalPolicy);
  const configuredOperationalPolicyDigest = process.env.JOBS_OPERATIONAL_POLICY_DIGEST?.trim();
  if (!configuredOperationalPolicyDigest || !/^[A-Za-z0-9_-]{43}$/.test(configuredOperationalPolicyDigest)) {
    reasons.push('JOBS_OPERATIONAL_POLICY_DIGEST_REQUIRED');
  } else if (configuredOperationalPolicyDigest !== operationalPolicyDigest) {
    reasons.push('JOBS_OPERATIONAL_POLICY_DIGEST_MISMATCH');
  }
  return {
    requested, enabled: reasons.length === 0, pollerEnabled: false, disabledReasons: reasons,
    cursorKeys, cursorMaxTtlSeconds,
    maxCursorBytes: operationalPolicy.MAX_CURSOR_BYTES as number | undefined,
    maxPageSize: operationalPolicy.MAX_PAGE_SIZE as number | undefined,
    maxTimeRangeSeconds: operationalPolicy.MAX_TIME_RANGE_SECONDS as number | undefined,
    maxFilters: operationalPolicy.MAX_FILTERS as number | undefined,
    detailPaddingMs: operationalPolicy.DETAIL_PADDING_MS as number | undefined,
    readerPolicyVersion: operationalPolicy.READER_POLICY_VERSION as number | undefined,
    queryPlanPolicyId, runtimeContractDigest, registryDigest, operationalPolicyDigest, runtimeContextKeys, boundaryDigests,
    databaseUrls: urls, databaseRoles: roles, operationalPolicy,
  };
}
