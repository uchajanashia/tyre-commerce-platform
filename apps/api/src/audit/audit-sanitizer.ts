const BLOCKED_KEY = /(password|passwordhash|authorization|cookie|secret|access_?token|refresh_?token|challenge_?token|tokenDigest|oneTimeUrl|totp|recovery_?code|ciphertext|authTag|nonce)/i;
const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2_000;

/** Defensive projection for audit payloads: deny secrets and cap amplification. */
export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.length <= MAX_STRING_LENGTH ? value : `${value.slice(0, MAX_STRING_LENGTH)}[truncated]`;
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[binary:${value.length} bytes]`;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeAuditValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !BLOCKED_KEY.test(key))
        .map(([key, entry]) => [key, sanitizeAuditValue(entry, depth + 1)]),
    );
  }
  return String(value);
}
