import assert from 'node:assert/strict';
import test from 'node:test';

import { ConflictException } from '@nestjs/common';

import { assertOrderTransition } from './order-state';

test('allows the conservative provider-independent payment lifecycle', () => {
  assert.doesNotThrow(() => assertOrderTransition('draft', 'awaiting_payment'));
  assert.doesNotThrow(() => assertOrderTransition('awaiting_payment', 'paid'));
  assert.doesNotThrow(() => assertOrderTransition('awaiting_payment', 'failed'));
  assert.doesNotThrow(() => assertOrderTransition('failed', 'awaiting_payment'));
});

test('protects terminal states and same-state replay', () => {
  assert.throws(() => assertOrderTransition('paid', 'failed'), ConflictException);
  assert.throws(() => assertOrderTransition('cancelled', 'awaiting_payment'), ConflictException);
  assert.throws(() => assertOrderTransition('draft', 'draft'), ConflictException);
  assert.throws(() => assertOrderTransition('draft', 'paid'), ConflictException);
});
