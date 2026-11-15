import type { RequestByOperation } from '@tyre/admin-api-client';
import {
  JOB_AUTHORIZATION_SCOPE_KINDS,
  JOB_RECONCILIATION_STATES,
  JOB_SAFE_FIELD_CLASSIFICATIONS,
  JOB_SCOPE_DIMENSIONS,
  JOB_SCOPE_MATCH_MODES,
  JOB_SORT_DIRECTIONS,
  JOB_SORT_FIELDS,
  JOB_STATES,
  JOB_TERMINAL_KINDS,
  JobAttemptFact,
  JobAuthorizationScopeKind,
  JobDetail,
  JobListResult,
  JobReconciliationFact,
  JobSafeField,
  JobScopeMatchMode,
  JobScopeRef,
  JobState,
  JobSummary,
  JobTerminalKind,
} from '@tyre/shared';

import { GovernanceApiError } from './governance-contract';

/** Jobs reads consume the generated request contract directly. */
export type JobReaderRequest = NonNullable<RequestByOperation['jobs-reader.list']['query']>;

const SUMMARY_REQUIRED = [
  'jobId',
  'jobType',
  'schemaVersion',
  'ownerDomain',
  'state',
  'priority',
  'createdAt',
  'availableAt',
  'serverCorrelationId',
  'originatingAuditEventId',
  'safeSummary',
  'allowedActions',
] as const;
const SUMMARY_OPTIONAL = ['causationId'] as const;
const DETAIL_REQUIRED = [
  ...SUMMARY_REQUIRED,
  'authorizationScopeKind',
  'authorizationScopeRefs',
  'scopeMatchMode',
  'scopeResolverId',
  'scopeResolverVersion',
  'authorizationPolicyVersion',
  'currentLeaseGeneration',
  'attempts',
  'reconciliations',
] as const;
const DETAIL_OPTIONAL = [...SUMMARY_OPTIONAL, 'requiredGlobalGrant', 'leaseExpiresAt'] as const;

export function decodeJobList(value: unknown): JobListResult {
  const record = requireRecord(value);
  assertExactKeys(record, ['items', 'asOfCreatedAt', 'allowedActions'], ['nextCursor']);
  if (!Array.isArray(record['items'])) failContract();
  assertNoActions(record['allowedActions']);
  const nextCursor = optionalString(record, 'nextCursor');
  return {
    items: record['items'].map(decodeJobSummary),
    asOfCreatedAt: requiredString(record, 'asOfCreatedAt'),
    ...(nextCursor === undefined ? {} : { nextCursor }),
    allowedActions: [],
  };
}

export function decodeJobDetail(value: unknown): JobDetail {
  const record = requireRecord(value);
  assertExactKeys(record, DETAIL_REQUIRED, DETAIL_OPTIONAL);
  const refs = record['authorizationScopeRefs'];
  const attempts = record['attempts'];
  const reconciliations = record['reconciliations'];
  if (!Array.isArray(refs) || !Array.isArray(attempts) || !Array.isArray(reconciliations))
    failContract();
  return {
    ...readJobSummary(record),
    authorizationScopeKind: requiredEnum<JobAuthorizationScopeKind>(
      record,
      'authorizationScopeKind',
      JOB_AUTHORIZATION_SCOPE_KINDS,
    ),
    authorizationScopeRefs: refs.map(readScopeRef),
    scopeMatchMode: requiredEnum<JobScopeMatchMode>(
      record,
      'scopeMatchMode',
      JOB_SCOPE_MATCH_MODES,
    ),
    ...optionalProperty(record, 'requiredGlobalGrant'),
    scopeResolverId: requiredString(record, 'scopeResolverId'),
    scopeResolverVersion: requiredNumber(record, 'scopeResolverVersion'),
    authorizationPolicyVersion: requiredNumber(record, 'authorizationPolicyVersion'),
    currentLeaseGeneration: requiredNumber(record, 'currentLeaseGeneration'),
    ...optionalProperty(record, 'leaseExpiresAt'),
    attempts: attempts.map(readAttempt),
    reconciliations: reconciliations.map(readReconciliation),
  };
}

function decodeJobSummary(value: unknown): JobSummary {
  const record = requireRecord(value);
  assertExactKeys(record, SUMMARY_REQUIRED, SUMMARY_OPTIONAL);
  return readJobSummary(record);
}

function readJobSummary(record: Record<string, unknown>): JobSummary {
  assertNoActions(record['allowedActions']);
  const fields = record['safeSummary'];
  if (!Array.isArray(fields)) failContract();
  return {
    jobId: requiredString(record, 'jobId'),
    jobType: requiredString(record, 'jobType'),
    schemaVersion: requiredNumber(record, 'schemaVersion'),
    ownerDomain: requiredString(record, 'ownerDomain'),
    state: requiredEnum<JobState>(record, 'state', JOB_STATES),
    priority: requiredNumber(record, 'priority'),
    createdAt: requiredString(record, 'createdAt'),
    availableAt: requiredString(record, 'availableAt'),
    serverCorrelationId: requiredString(record, 'serverCorrelationId'),
    originatingAuditEventId: requiredString(record, 'originatingAuditEventId'),
    ...optionalProperty(record, 'causationId'),
    safeSummary: fields.map(readSafeField),
    allowedActions: [],
  };
}

function readSafeField(value: unknown): JobSafeField {
  const record = requireRecord(value);
  assertExactKeys(record, ['key', 'label', 'classification', 'value'], []);
  const fieldValue = record['value'];
  if (
    fieldValue !== null &&
    typeof fieldValue !== 'string' &&
    typeof fieldValue !== 'number' &&
    typeof fieldValue !== 'boolean'
  )
    failContract();
  return {
    key: requiredString(record, 'key'),
    label: requiredString(record, 'label'),
    classification: requiredEnum(record, 'classification', JOB_SAFE_FIELD_CLASSIFICATIONS),
    value: fieldValue,
  };
}

function readScopeRef(value: unknown): JobScopeRef {
  const record = requireRecord(value);
  assertExactKeys(record, ['dimension', 'id'], []);
  return {
    dimension: requiredEnum(record, 'dimension', JOB_SCOPE_DIMENSIONS),
    id: requiredString(record, 'id'),
  };
}

function readAttempt(value: unknown): JobAttemptFact {
  const record = requireRecord(value);
  assertExactKeys(
    record,
    ['attemptStartedId', 'leaseGeneration', 'startedAt'],
    ['outcome', 'outcomeAt', 'safeReasonCode'],
  );
  return {
    attemptStartedId: requiredString(record, 'attemptStartedId'),
    leaseGeneration: requiredNumber(record, 'leaseGeneration'),
    startedAt: requiredString(record, 'startedAt'),
    ...optionalEnumProperty<JobTerminalKind>(record, 'outcome', JOB_TERMINAL_KINDS),
    ...optionalProperty(record, 'outcomeAt'),
    ...optionalProperty(record, 'safeReasonCode'),
  };
}

function readReconciliation(value: unknown): JobReconciliationFact {
  const record = requireRecord(value);
  assertExactKeys(record, ['reconciliationId', 'state', 'occurredAt', 'safeReasonCode'], []);
  return {
    reconciliationId: requiredString(record, 'reconciliationId'),
    state: requiredEnum(record, 'state', JOB_RECONCILIATION_STATES),
    occurredAt: requiredString(record, 'occurredAt'),
    safeReasonCode: requiredString(record, 'safeReasonCode'),
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) failContract();
  return value as Record<string, unknown>;
}
function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') failContract();
  return value;
}
function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  return key in record ? requiredString(record, key) : undefined;
}
function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) failContract();
  return value;
}
function requiredEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = record[key];
  for (const candidate of allowed) if (candidate === value) return candidate;
  failContract();
}
function optionalProperty(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = optionalString(record, key);
  return value === undefined ? {} : { [key]: value };
}
function optionalEnumProperty<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): Record<string, T> {
  return key in record ? { [key]: requiredEnum(record, key, allowed) } : {};
}
function assertNoActions(value: unknown): void {
  if (!Array.isArray(value) || value.length !== 0) failContract();
}
function assertExactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): void {
  for (const key of required) if (!(key in record)) failContract();
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) failContract();
}
function failContract(): never {
  throw new GovernanceApiError('unavailable', 0, 'JOBS_CONTRACT_DRIFT');
}
