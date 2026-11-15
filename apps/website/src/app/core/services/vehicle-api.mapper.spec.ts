import { hasMakeLogo, mapLookupResult, mapMake } from './vehicle-api.mapper';

describe('vehicle API make mapping', () => {
  it('maps a regular API slug to its isolated vehicle-logo asset', () => {
    expect(mapMake({ slug: 'bmw', name: 'BMW' })).toEqual({
      id: 'bmw',
      name: 'BMW',
      logoUrl: '/assets/makes/bmw.webp',
    });
  });

  it('maps API slug aliases to their actual logo filenames', () => {
    expect(mapMake({ slug: 'great-wall', name: 'Great Wall' }).logoUrl).toBe(
      '/assets/makes/gwm.webp',
    );
    expect(mapMake({ slug: 'mercedes', name: 'Mercedes-Benz' }).logoUrl).toBe(
      '/assets/makes/mercedes-benz.webp',
    );
  });

  it('uses the generated asset manifest as the make availability source', () => {
    expect(hasMakeLogo({ slug: 'bmw', name: 'BMW' })).toBe(true);
    expect(hasMakeLogo({ slug: 'great-wall', name: 'Great Wall' })).toBe(true);
    expect(hasMakeLogo({ slug: 'aixam', name: 'Aixam' })).toBe(false);
    expect(mapMake({ slug: 'aixam', name: 'Aixam' }).logoUrl).toBe('');
  });
});

describe('vehicle API fitment safety mapping', () => {
  it('drops trims with incomplete safety requirements instead of inventing defaults', () => {
    expect(
      mapLookupResult({
        make: 'bmw',
        model: '3-series',
        year: 2024,
        trims: [
          {
            trimSlug: 'unsafe',
            trimName: 'Unsafe',
            rimDiametersInch: [18],
            oemBySize: [
              {
                rimDiameterInch: 18,
                front: { widthMm: 225, aspect: 45, rimDiameterInch: 18, raw: '225/45R18' },
              },
            ],
            staggered: false,
            minLoadIndex: 0,
            oemSpeedRating: 'UNKNOWN',
          },
        ],
      }),
    ).toEqual([]);
  });
});
