import {
  EXACT_VEHICLE_CLASS_BY_SIZE,
  classifyVehicle,
  getVehicleImageFallbackChain,
  isVehicleClassification,
  normalizeVehicleSize,
  resolveVehicleClass,
  VEHICLE_CLASSIFICATIONS,
} from './vehicle-classification';

describe('vehicle classification', () => {
  it.each(Object.entries(EXACT_VEHICLE_CLASS_BY_SIZE))(
    '%s resolves to the reviewed exact class %s',
    (size, expected) => {
      const match = /^(\d+)\/(\d+)R([\d.]+)(C)?$/.exec(size)!;
      expect(classifyVehicle({
        width: Number(match[1]),
        profile: Number(match[2]),
        radius: `R${match[3]}${match[4] ?? ''}`,
      }).primary).toBe(expected);
    },
  );

  it('contains all 57 supplied exact mappings', () => {
    expect(Object.keys(EXACT_VEHICLE_CLASS_BY_SIZE)).toHaveLength(57);
  });

  it('normalizes spacing, casing, R-dash and commercial suffixes', () => {
    expect(normalizeVehicleSize({ width: '215', profile: '65', radius: 'r-16c' })).toEqual({
      width: 215,
      profile: 65,
      radius: 16,
      commercial: true,
      key: '215/65R16C',
    });
  });

  it('uses a valid existing classification before calculating from metadata or size', () => {
    expect(resolveVehicleClass({
      productType: 'tire', vehicleClass: 'passenger', size: '255/70R15C',
      vehicleClassification: 'vehicle-luxury-suv', treadType: 'A/T',
    })).toMatchObject({ classification: 'vehicle-luxury-suv', source: 'existing' });
  });

  it('routes the known 255/70R15C A/T product and 215/85R16 to Wrangler', () => {
    expect(resolveVehicleClass({
      productType: 'tire', vehicleClass: 'passenger', size: '255/70 R15C', treadType: 'A/T',
    }).classification).toBe('vehicle-wrangler');
    expect(resolveVehicleClass({
      productType: 'tire', vehicleClass: 'passenger', size: '215/85 R16', patternKey: 'RXQUEST A/T',
    }).classification).toBe('vehicle-wrangler');
  });

  it('routes an ordinary unmapped commercial/VAN product to cargo van', () => {
    expect(resolveVehicleClass({
      productType: 'tire', vehicleClass: 'passenger', size: '205/60 R16C', commercial: true,
      application: 'light VAN',
    })).toMatchObject({ classification: 'vehicle-cargo-van', source: 'category-fallback' });
  });

  it('honors premium reviewed mappings', () => {
    expect(resolveVehicleClass({ productType: 'tire', vehicleClass: 'passenger', size: '195/55R20' }).classification)
      .toBe('vehicle-electric-compact');
    expect(resolveVehicleClass({ productType: 'tire', vehicleClass: 'passenger', size: '255/55R20' }).classification)
      .toBe('vehicle-range-rover');
  });

  it('uses deterministic category and absolute fallbacks', () => {
    expect(resolveVehicleClass({
      productType: 'tire', vehicleClass: 'passenger', size: '205/60R24', season: 'H/T',
    })).toMatchObject({ classification: 'vehicle-popular-crossover', source: 'category-fallback' });
    expect(resolveVehicleClass({ size: 'not-a-size' })).toMatchObject({
      classification: 'vehicle-family-sedan', source: 'absolute-fallback', usedAbsoluteFallback: true,
    });
  });

  it.each([
    ['quarry application', 'vehicle-quarry-dump'],
    ['wheel loader E3/L3', 'vehicle-wheel-loader'],
    ['skid-steer SKS', 'vehicle-skid-steer'],
    ['forklift W-9', 'vehicle-forklift'],
    ['backhoe agricultural-industrial', 'vehicle-backhoe'],
  ] as const)('special metadata %s never falls back to a sedan', (application, expected) => {
    expect(resolveVehicleClass({ productType: 'tire', vehicleClass: 'truck', application }).classification)
      .toBe(expected);
  });

  it('uses a finite image fallback chain without recursion', () => {
    const chain = getVehicleImageFallbackChain('vehicle-electric-compact');
    expect(chain).toEqual([
      '/new_image/vehicle-electric-compact.webp',
      '/new_image/vehicle-compact.webp',
      '/new_image/vehicle-family-sedan.webp',
      '/assets/vehicle-scenes/neutral-wheel-studio/neutral-wheel-studio-body.webp',
    ]);
    expect(new Set(chain).size).toBe(chain.length);
  });

  it('registers all four new production codes without removing existing codes', () => {
    for (const classification of [
      'vehicle-wrangler', 'vehicle-small-cargo-van', 'vehicle-premium-van',
      'vehicle-electric-compact', 'vehicle-city-car', 'vehicle-prius', 'vehicle-offroad', 'vehicle-minivan',
    ]) {
      expect(isVehicleClassification(classification)).toBe(true);
    }
    expect(VEHICLE_CLASSIFICATIONS).toHaveLength(28);
  });
});
