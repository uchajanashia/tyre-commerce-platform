import { createHash } from 'node:crypto';

import { canonicalJsonBytes } from '../governance/canonical-json';

export type AuditFieldType = 'string' | 'number' | 'boolean';
export type AuditFieldClassification = 'public_operational' | 'masked' | 'restricted';

export interface AuditFieldDefinition {
  type: AuditFieldType;
  classification: AuditFieldClassification;
  label: string;
  maxBytes?: number;
}

export interface AuditEventSchemaDefinition {
  eventType: string;
  schemaVersion: number;
  ownerDomain: string;
  actorTypes: readonly string[];
  subjectTypes: readonly string[];
  actions: readonly string[];
  entityTypes: readonly string[];
  outcomes: readonly string[];
  sources: readonly string[];
  authorizationScopeKind: 'resource_scoped' | 'global_security' | 'cross_scope' | 'legacy_restricted';
  scopeMatchMode: 'all' | 'any';
  requiredGlobalGrant?: string;
  allowGlobalReader: boolean;
  allowedScopeDimensions: readonly ('warehouse' | 'channel' | 'company')[];
  scopeResolverId: string;
  scopeResolverVersion: number;
  authorizationPolicyVersion: number;
  retentionClass: string;
  fields: {
    before: Readonly<Record<string, AuditFieldDefinition>>;
    after: Readonly<Record<string, AuditFieldDefinition>>;
    metadata: Readonly<Record<string, AuditFieldDefinition>>;
  };
  maxProjectionBytes: number;
}

/**
 * Increment 3B intentionally registers only a non-PII platform-security event.
 * Domain V2 schemas remain unavailable until their owners approve exact event-
 * time scope and masking; callers cannot supply or extend this registry.
 */
export const AUDIT_EVENT_SCHEMAS = [{
  eventType: 'audit.reader.cursor_rejected',
  schemaVersion: 1,
  ownerDomain: 'audit',
  actorTypes: ['staff'],
  subjectTypes: ['audit_reader'],
  actions: ['audit.reader.cursor.validate'],
  entityTypes: ['AuditCursor'],
  outcomes: ['denied'],
  sources: ['admin_api'],
  authorizationScopeKind: 'global_security',
  scopeMatchMode: 'all',
  requiredGlobalGrant: 'audit.read_security',
  allowGlobalReader: false,
  allowedScopeDimensions: [],
  scopeResolverId: 'audit-reader-security-v1',
  scopeResolverVersion: 1,
  authorizationPolicyVersion: 1,
  retentionClass: 'security_control',
  fields: {
    before: {},
    after: {},
    metadata: {
      code: { type: 'string', classification: 'public_operational', label: 'Validation code', maxBytes: 64 },
      keyId: { type: 'string', classification: 'masked', label: 'Cursor key', maxBytes: 64 },
    },
  },
  maxProjectionBytes: 512,
}] as const satisfies readonly AuditEventSchemaDefinition[];

const SAFE_IDENTIFIER = /^[a-z][a-z0-9_.-]{0,127}$/;
const SAFE_FIELD_KEY = /^[a-z][A-Za-z0-9_.-]{0,127}$/;
const FORBIDDEN_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
const PROHIBITED_FIELD = /(password|authorization|cookie|secret|token|totp|recovery|ciphertext|auth.?tag|nonce|credential|request.?body|attachment)/i;

export function assertSafeAuditText(value: string, maxBytes: number, label: string): string {
  const normalized = value.normalize('NFC');
  // canonicalJsonBytes rejects lone surrogates; controls, bidi and zero-width
  // format characters are rejected rather than hidden in logs or UI.
  canonicalJsonBytes(normalized);
  if (FORBIDDEN_TEXT.test(normalized)) throw new Error(`AUDIT_UNSAFE_TEXT:${label}`);
  if (Buffer.byteLength(normalized, 'utf8') > maxBytes) throw new Error(`AUDIT_TEXT_TOO_LARGE:${label}`);
  return normalized;
}

function registrySemantic(schema: AuditEventSchemaDefinition): unknown {
  return {
    ...schema,
    actorTypes: [...schema.actorTypes],
    subjectTypes: [...schema.subjectTypes],
    actions: [...schema.actions],
    entityTypes: [...schema.entityTypes],
    outcomes: [...schema.outcomes],
    sources: [...schema.sources],
    allowedScopeDimensions: [...schema.allowedScopeDimensions],
  };
}

export function auditRegistryDigest(schema: AuditEventSchemaDefinition): string {
  return createHash('sha256')
    .update(Buffer.from('tyre.ge/audit-registry/v1\n', 'utf8'))
    .update(canonicalJsonBytes(registrySemantic(schema)))
    .digest('base64url');
}

export function registeredAuditSchema(eventType: string, schemaVersion: number): AuditEventSchemaDefinition {
  const schema = AUDIT_EVENT_SCHEMAS.find((candidate) =>
    candidate.eventType === eventType && candidate.schemaVersion === schemaVersion,
  );
  if (!schema) throw new Error('AUDIT_SCHEMA_NOT_REGISTERED');
  validateRegistryDefinition(schema);
  return schema;
}

export function validateRegistryDefinition(schema: AuditEventSchemaDefinition): void {
  for (const value of [schema.eventType, schema.ownerDomain, schema.scopeResolverId, schema.retentionClass]) {
    if (!SAFE_IDENTIFIER.test(value)) throw new Error('AUDIT_INVALID_REGISTRY_IDENTIFIER');
  }
  if (!Number.isInteger(schema.schemaVersion) || schema.schemaVersion < 1 ||
      !Number.isInteger(schema.scopeResolverVersion) || schema.scopeResolverVersion < 1 ||
      !Number.isInteger(schema.authorizationPolicyVersion) || schema.authorizationPolicyVersion < 1 ||
      !Number.isInteger(schema.maxProjectionBytes) || schema.maxProjectionBytes < 1) {
    throw new Error('AUDIT_INVALID_REGISTRY_VERSION');
  }
  if (schema.authorizationScopeKind === 'cross_scope' && schema.scopeMatchMode !== 'all') {
    throw new Error('AUDIT_INVALID_CROSS_SCOPE_MODE');
  }
  if (schema.authorizationScopeKind === 'global_security' &&
      (!schema.requiredGlobalGrant || schema.allowedScopeDimensions.length !== 0)) {
    throw new Error('AUDIT_INVALID_GLOBAL_SCHEMA');
  }
  for (const section of Object.values(schema.fields)) {
    for (const [key, definition] of Object.entries(section)) {
      if (!SAFE_FIELD_KEY.test(key) || PROHIBITED_FIELD.test(key)) throw new Error('AUDIT_PROHIBITED_FIELD');
      assertSafeAuditText(definition.label, 128, `label:${key}`);
      if (definition.classification === 'restricted') {
        // D-09-dependent restricted/PII projections cannot be activated in 3B.
        throw new Error('AUDIT_RESTRICTED_FIELD_POLICY_UNAVAILABLE');
      }
      if (definition.type === 'string' && (!definition.maxBytes || definition.maxBytes < 1)) {
        throw new Error('AUDIT_STRING_CAP_REQUIRED');
      }
    }
  }
}

export type SafeAuditInput = Readonly<Record<string, string | number | boolean | null>>;
export interface StoredAuditField {
  key: string;
  label: string;
  classification: 'public_operational' | 'masked';
  value: string | number | boolean | null;
}

export function projectSafeAuditFields(
  schema: AuditEventSchemaDefinition,
  sectionName: 'before' | 'after' | 'metadata',
  input: SafeAuditInput | undefined,
): StoredAuditField[] {
  if (!input) return [];
  if (Object.getPrototypeOf(input) !== Object.prototype || Array.isArray(input)) throw new Error('AUDIT_FIELDS_MUST_BE_FLAT');
  const definitions = schema.fields[sectionName];
  const projected = Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, raw]) => {
    const definition = definitions[key];
    if (!definition) throw new Error('AUDIT_FIELD_NOT_REGISTERED');
    if (raw !== null && typeof raw !== definition.type) throw new Error('AUDIT_FIELD_TYPE_MISMATCH');
    let value = raw;
    if (typeof raw === 'string') value = assertSafeAuditText(raw, definition.maxBytes!, `${sectionName}.${key}`);
    if (typeof raw === 'number' && !Number.isFinite(raw)) throw new Error('AUDIT_NON_FINITE_NUMBER');
    if (definition.classification !== 'public_operational') value = '[masked]';
    return { key, label: definition.label, classification: definition.classification, value } as StoredAuditField;
  });
  return projected;
}

export function assertProjectionSize(schema: AuditEventSchemaDefinition, projection: unknown): void {
  if (canonicalJsonBytes(projection).length > schema.maxProjectionBytes) throw new Error('AUDIT_PROJECTION_TOO_LARGE');
}
