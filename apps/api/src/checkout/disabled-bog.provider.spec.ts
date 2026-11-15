import assert from 'node:assert/strict';
import test from 'node:test';

import { ServiceUnavailableException } from '@nestjs/common';

import { DisabledBogPaymentProvider } from './disabled-bog.provider';

test('BOG provider cannot initialize payment without the official integration', () => {
  const provider = new DisabledBogPaymentProvider();
  assert.equal(provider.enabled, false);
  assert.throws(
    () =>
      provider.initialize({
        attemptId: 'attempt-1',
        orderPublicToken: 'opaque',
        amount: 100,
        currency: 'GEL',
      }),
    ServiceUnavailableException,
  );
});

test('BOG callback verification is disabled rather than guessed', () => {
  const provider = new DisabledBogPaymentProvider();
  assert.throws(
    () => provider.verifyCallback(Buffer.from('{}'), { 'content-type': 'application/json' }),
    ServiceUnavailableException,
  );
});
