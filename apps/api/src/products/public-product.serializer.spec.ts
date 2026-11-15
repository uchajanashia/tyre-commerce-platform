import assert from 'node:assert/strict';
import test from 'node:test';

import { serializePublicProduct, toPublicAvailability } from './public-product.serializer';
import { PUBLIC_PRODUCT_SOURCE_SELECT } from './products.service';

test('public product query never selects wholesale pricing', () => {
  assert.equal('wholesalePrice' in PUBLIC_PRODUCT_SOURCE_SELECT, false);
});

test('exact stock quantity is authoritative for public availability', () => {
  assert.equal(toPublicAvailability(0, 'in_stock'), 'out_of_stock');
  assert.equal(toPublicAvailability(1, 'out_of_stock'), 'in_stock');
  assert.equal(toPublicAvailability(8, 'limited'), 'in_stock');
});

test('stored stock status is used when exact quantity is not known', () => {
  assert.equal(toPublicAvailability(null, 'out_of_stock'), 'out_of_stock');
  assert.equal(toPublicAvailability(null, 'in_stock'), 'in_stock');
  assert.equal(toPublicAvailability(null, 'limited'), 'in_stock');
});

test('public serialization strips private inventory and preserves public data', () => {
  const result = serializePublicProduct(
    {
      id: '000001',
      code: '000001',
      productType: 'tire',
      vehicleClass: 'passenger',
      size: '195/55R20',
      retailPrice: 250,
      stockQty: 3,
      stockStatus: 'limited' as const,
      tireModel: { photos: [{ url: 'models/a.webp' }] },
    },
    (url) => `https://cdn.example/${url}`,
  );

  assert.deepEqual(result, {
    id: '000001',
    code: '000001',
    retailPrice: 250,
    productType: 'tire',
    vehicleClass: 'passenger',
    size: '195/55R20',
    vehicleClassification: 'vehicle-electric-compact',
    availability: 'in_stock',
    photos: ['https://cdn.example/models/a.webp'],
  });
  assert.equal('stockQty' in result, false);
  assert.equal('stockStatus' in result, false);
});

test('public serializer always supplies a deterministic vehicle classification', () => {
  const result = serializePublicProduct(
    {
      code: 'A-T', productType: 'tire', vehicleClass: 'passenger', size: '255/70R15C',
      treadType: 'A/T', stockQty: null, stockStatus: 'in_stock' as const,
    },
    (url) => url,
  );
  assert.equal(result.vehicleClassification, 'vehicle-wrangler');
});
