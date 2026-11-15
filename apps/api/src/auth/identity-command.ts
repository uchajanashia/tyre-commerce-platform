import { createHash } from 'node:crypto';

function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_CANONICAL_COMMAND');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  throw new Error('NON_CANONICAL_COMMAND');
}

export function canonicalCommand(value: unknown): string {
  return canonical(value);
}

export function commandHash(value: unknown): string {
  return createHash('sha256').update(canonicalCommand(value), 'utf8').digest('base64url');
}
