import { ApiProduct, mapProduct, stockToAvailability } from './fitment-api.mapper';

function product(overrides: Partial<ApiProduct> = {}): ApiProduct {
  return {
    id: '001',
    code: '001',
    slug: '001',
    productType: 'tire',
    vehicleClass: 'passenger',
    catalogClass: 'passenger',
    sizeSystem: 'metric',
    brandId: 'brand',
    patternKey: 'Model',
    size: '205/55R16',
    width: 205,
    profile: 55,
    rimDiameter: 16,
    radius: 'R-16',
    construction: 'R',
    commercial: false,
    overallDiameter: null,
    loadSpeedIndex: '91V',
    plyRating: null,
    treadType: null,
    application: 'მსუბუქი',
    season: 'ზაფხული',
    seasonGroup: 'summer',
    country: null,
    unit: 'ცალი',
    retailPrice: 250,
    currency: 'GEL',
    availability: 'in_stock',
    name: 'Brand Model 205/55R16',
    photos: [],
    ...overrides,
  };
}

describe('storefront availability mapping', () => {
  it('maps public availability to a binary storefront value', () => {
    expect(stockToAvailability('in_stock')).toBe(1);
    expect(stockToAvailability('out_of_stock')).toBe(0);
    expect(mapProduct(product({ availability: 'in_stock' })).inStock).toBe(1);
  });

  it('does not invent availability for an out-of-stock product', () => {
    expect(mapProduct(product({ availability: 'out_of_stock' })).inStock).toBe(0);
  });
});
