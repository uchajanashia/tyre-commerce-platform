import assert from 'node:assert/strict';
import test from 'node:test';

import { catalogClassWhere, deriveCatalogClass } from './catalog-classification';

test('classification is derived from authoritative product fields', () => {
  assert.equal(
    deriveCatalogClass({ productType: 'tire', vehicleClass: 'passenger', sizeSystem: 'metric', application: 'ახალი/მსუბუქი' }),
    'passenger',
  );
  assert.equal(
    deriveCatalogClass({ productType: 'tire', vehicleClass: 'truck', sizeSystem: 'metric', application: 'წინა/ტრასა' }),
    'truck',
  );
  assert.equal(
    deriveCatalogClass({
      productType: 'tire',
      vehicleClass: 'truck',
      sizeSystem: 'inch',
      application: 'სპეცტექნიკა/ტრაქტორი',
    }),
    'special',
  );
  assert.equal(
    deriveCatalogClass({
      productType: 'disk',
      vehicleClass: 'truck',
      sizeSystem: 'inch',
      application: 'დისკი ახალი/სატვირთო',
    }),
    'disk',
  );
  assert.equal(
    deriveCatalogClass({
      productType: 'tire',
      vehicleClass: 'passenger',
      sizeSystem: 'inch',
      application: 'ახალი/მსუბუქი-LT',
    }),
    'truck',
  );
});

test('query predicates mirror the four public classes', () => {
  assert.deepEqual(catalogClassWhere('passenger'), {
    productType: 'tire',
    vehicleClass: 'passenger',
    sizeSystem: 'metric',
  });
  assert.deepEqual(catalogClassWhere('truck'), {
    productType: 'tire',
    application: { not: { startsWith: 'სპეცტექნიკა/' } },
    OR: [{ vehicleClass: 'truck' }, { sizeSystem: 'inch' }],
  });
  assert.deepEqual(catalogClassWhere('special'), {
    productType: 'tire',
    application: { startsWith: 'სპეცტექნიკა/' },
  });
  assert.deepEqual(catalogClassWhere('disk'), { productType: 'disk' });
});
