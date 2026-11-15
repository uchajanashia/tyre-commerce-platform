import type { RequestByOperation } from '@tyre/admin-api-client';
import {
  AuditEventDetail,
  AuditEventListResult,
  AuditEventOutcome,
  AuditEventSource,
  AuditEventSummary,
  AuditSafeField,
  AuditSafeFieldClassification,
  AuditScopeMatchMode,
  AuditScopeRef,
  AuditSortDirection,
  AuditSortField,
} from '@tyre/shared';

import { GovernanceApiError } from './governance-contract';

/** Admin intentionally uses the generated Audit query but leaves server-owned page sizing unset. */
export type AuditReaderRequest = Omit<
  NonNullable<RequestByOperation['audit-reader.list']['query']>,
  'pageSize'
>;

export const AUDIT_EVENT_OUTCOMES: readonly AuditEventOutcome[] = ['succeeded', 'failed', 'denied'];
export const AUDIT_EVENT_SOURCES: readonly AuditEventSource[] = [
  'admin_api',
  'job',
  'webhook',
  'import',
  'system',
];
export const AUDIT_SORT_FIELDS: readonly AuditSortField[] = ['occurredAt', 'eventType', 'outcome'];
export const AUDIT_SORT_DIRECTIONS: readonly AuditSortDirection[] = ['asc', 'desc'];

const SUMMARY_REQUIRED_KEYS = [
  'eventId',
  'eventType',
  'schemaVersion',
  'occurredAt',
  'actorId',
  'actorType',
  'subjectType',
  'action',
  'entityType',
  'outcome',
  'source',
  'retentionClass',
  'serverCorrelationId',
  'allowedActions',
] as const;
const SUMMARY_OPTIONAL_KEYS = [
  'subjectId',
  'entityId',
  'entityVersion',
  'approvalRequestId',
  'approvalExecutionId',
] as const;
const DETAIL_REQUIRED_KEYS = [
  ...SUMMARY_REQUIRED_KEYS,
  'authorizationScopeKind',
  'authorizationScopeRefs',
  'scopeMatchMode',
  'scopeResolverId',
  'scopeResolverVersion',
  'authorizationPolicyVersion',
  'before',
  'after',
  'metadata',
] as const;
const DETAIL_OPTIONAL_KEYS = [
  ...SUMMARY_OPTIONAL_KEYS,
  'reasonCode',
  'causationId',
  'clientRequestId',
  'bulkOperationId',
  'bulkItemId',
] as const;

export function decodeAuditEventList(value: unknown): AuditEventListResult {
  const record = requireRecord(value);
  assertExactKeys(record, ['items', 'asOfOccurredAt', 'allowedActions'], ['nextCursor']);
  const items = record['items'];
  if (!Array.isArray(items)) failContract();
  assertNoActions(record['allowedActions']);
  const nextCursor = optionalString(record, 'nextCursor');
  return {
    items: items.map((item) => decodeAuditEventSummary(item)),
    asOfOccurredAt: requiredString(record, 'asOfOccurredAt'),
    ...(nextCursor === undefined ? {} : { nextCursor }),
    allowedActions: [],
  };
}

export function decodeAuditEventDetail(value: unknown): AuditEventDetail {
  const record = requireRecord(value);
  assertExactKeys(record, DETAIL_REQUIRED_KEYS, DETAIL_OPTIONAL_KEYS);
  const summary = readAuditEventSummary(record);
  const refs = record['authorizationScopeRefs'];
  if (!Array.isArray(refs)) failContract();
  return {
    ...summary,
    authorizationScopeKind: requiredEnum(record, 'authorizationScopeKind', [
      'resource_scoped',
      'global_security',
      'cross_scope',
      'legacy_restricted',
    ]),
    authorizationScopeRefs: refs.map((ref) => readScopeRef(ref)),
    scopeMatchMode: requiredEnum<AuditScopeMatchMode>(record, 'scopeMatchMode', ['all', 'any']),
    scopeResolverId: requiredString(record, 'scopeResolverId'),
    scopeResolverVersion: requiredNumber(record, 'scopeResolverVersion'),
    authorizationPolicyVersion: requiredNumber(record, 'authorizationPolicyVersion'),
    ...optionalProperty(record, 'reasonCode'),
    before: readSafeFields(record, 'before'),
    after: readSafeFields(record, 'after'),
    metadata: readSafeFields(record, 'metadata'),
    ...optionalProperty(record, 'causationId'),
    ...optionalProperty(record, 'clientRequestId'),
    ...optionalProperty(record, 'bulkOperationId'),
    ...optionalProperty(record, 'bulkItemId'),
  };
}

function decodeAuditEventSummary(value: unknown): AuditEventSummary {
  const record = requireRecord(value);
  assertExactKeys(record, SUMMARY_REQUIRED_KEYS, SUMMARY_OPTIONAL_KEYS);
  return readAuditEventSummary(record);
}

function readAuditEventSummary(record: Record<string, unknown>): AuditEventSummary {
  assertNoActions(record['allowedActions']);
  return {
    eventId: requiredString(record, 'eventId'),
    eventType: requiredString(record, 'eventType'),
    schemaVersion: requiredNumber(record, 'schemaVersion'),
    occurredAt: requiredString(record, 'occurredAt'),
    actorId: requiredString(record, 'actorId'),
    actorType: requiredString(record, 'actorType'),
    subjectType: requiredString(record, 'subjectType'),
    ...optionalProperty(record, 'subjectId'),
    action: requiredString(record, 'action'),
    entityType: requiredString(record, 'entityType'),
    ...optionalProperty(record, 'entityId'),
    ...optionalProperty(record, 'entityVersion'),
    outcome: requiredEnum<AuditEventOutcome>(record, 'outcome', AUDIT_EVENT_OUTCOMES),
    source: requiredEnum<AuditEventSource>(record, 'source', AUDIT_EVENT_SOURCES),
    retentionClass: requiredString(record, 'retentionClass'),
    serverCorrelationId: requiredString(record, 'serverCorrelationId'),
    ...optionalProperty(record, 'approvalRequestId'),
    ...optionalProperty(record, 'approvalExecutionId'),
    allowedActions: [],
  };
}

function readSafeFields(record: Record<string, unknown>, key: string): AuditSafeField[] {
  const fields = record[key];
  if (!Array.isArray(fields)) failContract();
  return fields.map((field) => {
    const item = requireRecord(field);
    assertExactKeys(item, ['key', 'label', 'classification', 'value'], []);
    const value = item['value'];
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    )
      failContract();
    return {
      key: requiredString(item, 'key'),
      label: requiredString(item, 'label'),
      classification: requiredEnum<AuditSafeFieldClassification>(item, 'classification', [
        'public_operational',
        'masked',
      ]),
      value,
    };
  });
}

function readScopeRef(value: unknown): AuditScopeRef {
  const record = requireRecord(value);
  assertExactKeys(record, ['dimension', 'id'], []);
  return {
    dimension: requiredEnum(record, 'dimension', ['warehouse', 'channel', 'company']),
    id: requiredString(record, 'id'),
  };
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') failContract();
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  if (!(key in record)) return undefined;
  return requiredString(record, key);
}

function optionalProperty(
  record: Record<string, unknown>,
  key:
    | 'subjectId'
    | 'entityId'
    | 'entityVersion'
    | 'approvalRequestId'
    | 'approvalExecutionId'
    | 'reasonCode'
    | 'causationId'
    | 'clientRequestId'
    | 'bulkOperationId'
    | 'bulkItemId',
): Record<string, string> {
  const value = optionalString(record, key);
  return value === undefined ? {} : { [key]: value };
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

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) failContract();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  throw new GovernanceApiError('unavailable', 0, 'AUDIT_CONTRACT_DRIFT');
}
