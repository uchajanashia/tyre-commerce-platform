import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deriveSizeSystem, isValidSizeClass } from './tire-size-system';

describe('tire size system', () => {
  it('keeps metric and inch-width formats separate', () => {
    assert.equal(deriveSizeSystem({ productType: 'tire', width: 265 }), 'metric');
    assert.equal(deriveSizeSystem({ productType: 'tire', width: 12 }), 'inch');
    assert.equal(deriveSizeSystem({ productType: 'tire', width: 31.5 }), 'inch');
    assert.equal(deriveSizeSystem({ productType: 'disk', width: 295 }), 'inch');
  });

  it('forbids inch-based tires in the passenger journey', () => {
    assert.equal(isValidSizeClass('tire', 'passenger', 'inch'), false);
    assert.equal(isValidSizeClass('tire', 'truck', 'inch'), true);
    assert.equal(isValidSizeClass('tire', 'passenger', 'metric'), true);
    assert.equal(isValidSizeClass('disk', 'passenger', 'inch'), true);
  });
});
