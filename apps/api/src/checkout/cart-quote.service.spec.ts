import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import {
  buildCartQuote,
  validateCartLines,
  type QuoteProduct,
} from './cart-quote.service';

function product(overrides: Partial<QuoteProduct> = {}): QuoteProduct {
  return {
    id: 'tire-1',
    productType: 'tire',
    code: '000001',
    name: 'Road tire',
    retailPrice: 250,
    currency: 'GEL',
    stockQty: null,
    stockStatus: 'in_stock',
    isPublished: true,
    ...overrides,
  };
}

test('quotes authoritative unit price and quantity 1-4 without exposing exact stock', () => {
  const quote = buildCartQuote([{ productId: 'tire-1', quantity: 3 }], [
    product({ retailPrice: 275, stockQty: 3 }),
  ]);

  assert.equal(quote.total, 825);
  assert.equal(quote.currency, 'GEL');
  assert.equal(quote.allAvailable, true);
  assert.deepEqual(quote.items[0], {
    productId: 'tire-1',
    code: '000001',
    name: 'Road tire',
    quantity: 3,
    available: true,
    issue: null,
    unitPrice: 275,
    lineTotal: 825,
    currency: 'GEL',
  });
  assert.equal('stockQty' in quote.items[0]!, false);
  assert.equal('stockStatus' in quote.items[0]!, false);
});

test('rejects only the requested unavailable quantity without revealing the count', () => {
  const quote = buildCartQuote([{ productId: 'tire-1', quantity: 4 }], [
    product({ stockQty: 3 }),
  ]);

  assert.equal(quote.allAvailable, false);
  assert.equal(quote.total, 0);
  assert.equal(quote.items[0]?.issue, 'insufficient_quantity');
  assert.equal(quote.items[0]?.lineTotal, null);
});

test('uses explicit stored status as the temporary catalogue availability switch', () => {
  const available = buildCartQuote([{ productId: 'tire-1', quantity: 4 }], [
    product({ stockQty: null, stockStatus: 'limited' }),
  ]);
  const unavailable = buildCartQuote([{ productId: 'tire-1', quantity: 1 }], [
    product({ stockQty: null, stockStatus: 'out_of_stock' }),
  ]);

  assert.equal(available.items[0]?.available, true);
  assert.equal(unavailable.items[0]?.issue, 'out_of_stock');
});

test('distinguishes missing products and excludes unavailable lines from totals', () => {
  const quote = buildCartQuote(
    [
      { productId: 'missing', quantity: 1 },
      { productId: 'tire-1', quantity: 2 },
    ],
    [product({ retailPrice: 100 })],
  );

  assert.equal(quote.items[0]?.issue, 'not_found');
  assert.equal(quote.total, 200);
  assert.equal(quote.allAvailable, false);
});

test('does not sell non-tire catalogue products', () => {
  const quote = buildCartQuote([{ productId: 'tire-1', quantity: 1 }], [
    product({ productType: 'disk' }),
  ]);

  assert.equal(quote.allAvailable, false);
  assert.equal(quote.items[0]?.issue, 'not_found');
});

test('rejects invalid quantities and duplicate product lines', () => {
  assert.throws(
    () => validateCartLines([{ productId: 'tire-1', quantity: 5 }]),
    BadRequestException,
  );
  assert.throws(
    () =>
      validateCartLines([
        { productId: 'tire-1', quantity: 1 },
        { productId: 'tire-1', quantity: 2 },
      ]),
    /only once/,
  );
});
