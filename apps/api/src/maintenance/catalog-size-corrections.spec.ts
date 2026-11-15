import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyCatalogSizeCorrection } from './catalog-size-corrections';

describe('catalog size corrections', () => {
  it('uses the parenthesized metric replacement', () => {
    const corrected = applyCatalogSizeCorrection({
      code: '002349',
      slug: '31x10-5r15-roadx-002349',
      brand: 'ROADX',
      productType: 'tire',
      vehicleClass: 'passenger',
      vehicleClassLabel: 'მსუბუქი',
      name: 'საბურავი 31x10.5R15 LT RXQUEST A/T-ROADX',
      size: '31x10.5R15',
      width: 10.5,
      profile: null,
      rimDiameter: 15,
      radius: 'R-15',
    });
    assert.equal(corrected.size, '265/70R15');
    assert.equal(corrected.width, 265);
    assert.equal(corrected.profile, 70);
    assert.equal(corrected.vehicleClass, 'passenger');
    assert.equal(corrected.slug, '265-70r15-roadx-002349');
  });

  it('normalizes /00 without creating a zero profile', () => {
    const corrected = applyCatalogSizeCorrection({
      code: '000758',
      slug: '12-00r20-annaite-000758',
      brand: 'ANNAITE',
      productType: 'tire',
      vehicleClass: 'truck',
      name: 'საბურავი 12/00R20 300-ANNAITE',
      size: '12/00R20',
      width: 12,
      profile: 0,
      rimDiameter: 20,
      radius: 'R-20',
    });
    assert.equal(corrected.size, '12.00R20');
    assert.equal(corrected.profile, null);
  });

  it('moves remaining inch-width tires out of passenger', () => {
    const corrected = applyCatalogSizeCorrection({
      code: '003895',
      slug: '6-50r15-roadx-003895',
      brand: 'ROADX',
      productType: 'tire',
      vehicleClass: 'passenger',
      vehicleClassLabel: 'მსუბუქი',
      name: 'საბურავი 6.50R15 LT RXQUEST C01-ROADX',
      size: '6.50R15',
      width: 6.5,
      profile: null,
      rimDiameter: 15,
      radius: 'R-15',
    });
    assert.equal(corrected.vehicleClass, 'truck');
    assert.equal(corrected.vehicleClassLabel, 'სატვირთო');
  });
});
