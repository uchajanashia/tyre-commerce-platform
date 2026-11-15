import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sanitizeAuditValue } from './audit-sanitizer';

describe('sanitizeAuditValue', () => {
  it('removes secrets recursively while retaining useful change fields', () => {
    const sanitized = sanitizeAuditValue({
      name: 'Updated product',
      password: 'never-store-me',
      nested: { accessToken: 'never-store-me-either', price: 150 },
    });
    assert.deepEqual(sanitized, {
      name: 'Updated product',
      nested: { price: 150 },
    });
  });

  it('projects binary values and caps unbounded strings', () => {
    const sanitized = sanitizeAuditValue({ file: Buffer.alloc(4), note: 'x'.repeat(2_100) }) as {
      file: string;
      note: string;
    };
    assert.equal(sanitized.file, '[binary:4 bytes]');
    assert.match(sanitized.note, /\[truncated\]$/);
  });

  it('removes every identity-v2 secret field family', () => {
    assert.deepEqual(sanitizeAuditValue({
      challengeToken: 'challenge',
      tokenDigest: 'digest',
      oneTimeUrl: 'https://admin/#secret',
      totpSecret: 'totp',
      recoveryCode: 'code',
      ciphertext: 'ciphertext',
      authTag: 'tag',
      nonce: 'nonce',
      envelopeId: 'safe-envelope-id',
      tokenVersion: 4,
    }), { envelopeId: 'safe-envelope-id', tokenVersion: 4 });
  });
});
