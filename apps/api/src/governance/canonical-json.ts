export type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) throw new TypeError('CANONICAL_JSON_LONE_SURROGATE');
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('CANONICAL_JSON_LONE_SURROGATE');
    }
  }
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('CANONICAL_JSON_NON_FINITE_NUMBER');
    // ECMAScript JSON number serialization is the RFC 8785 number representation.
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError('CANONICAL_JSON_UNSUPPORTED_VALUE');
  if (seen.has(value)) throw new TypeError('CANONICAL_JSON_CYCLE');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError('CANONICAL_JSON_SPARSE_ARRAY');
      }
      return `[${value.map((item) => serialize(item, seen)).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('CANONICAL_JSON_NON_PLAIN_OBJECT');
    const record = value as Record<string, unknown>;
    const symbols = Object.getOwnPropertySymbols(record);
    if (symbols.length !== 0) throw new TypeError('CANONICAL_JSON_SYMBOL_KEY');
    const keys = Object.keys(record).sort(); // RFC 8785: UTF-16 code-unit order.
    return `{${keys.map((key) => {
      assertUnicodeScalarString(key);
      return `${JSON.stringify(key)}:${serialize(record[key], seen)}`;
    }).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/** RFC 8785/JCS-equivalent UTF-8 bytes for the JSON value subset used by Governance. */
export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(serialize(value, new Set()), 'utf8');
}

export function canonicalJsonText(value: unknown): string {
  return canonicalJsonBytes(value).toString('utf8');
}
