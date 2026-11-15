export const PASSENGER_VEHICLE_CLASSIFICATIONS = [
  'vehicle-city-car',
  'vehicle-prius',
  'vehicle-compact',
  'vehicle-compact-sedan',
  'vehicle-sport-sedan',
  'vehicle-family-sedan',
  'vehicle-business-sedan',
  'vehicle-luxury-sedan',
  'vehicle-sport-coupe',
  'vehicle-performance-car',
  'vehicle-small-crossover',
  'vehicle-compact-crossover',
  'vehicle-popular-crossover',
  'vehicle-premium-crossover',
  'vehicle-coupe-suv',
  'vehicle-premium-suv',
  'vehicle-large-premium-suv',
  'vehicle-coupe-premium-suv',
  'vehicle-luxury-suv',
  'vehicle-range-rover',
  'vehicle-offroad-luxury',
  'vehicle-offroad',
  'vehicle-pickup',
  'vehicle-minivan',
  'vehicle-wrangler',
  'vehicle-small-cargo-van',
  'vehicle-premium-van',
  'vehicle-electric-compact',
] as const;

export const SCENE_VEHICLE_CLASSIFICATIONS = [
  'vehicle-cargo-van',
  'vehicle-suv-4x4',
  'vehicle-highway-truck',
  'vehicle-quarry-dump',
  'vehicle-backhoe',
  'vehicle-wheel-loader',
  'vehicle-skid-steer',
  'vehicle-forklift',
] as const;

export const VEHICLE_CLASSIFICATIONS = [
  ...PASSENGER_VEHICLE_CLASSIFICATIONS,
  ...SCENE_VEHICLE_CLASSIFICATIONS,
] as const;

export type PassengerVehicleClassification = (typeof PASSENGER_VEHICLE_CLASSIFICATIONS)[number];
export type SceneVehicleClassification = (typeof SCENE_VEHICLE_CLASSIFICATIONS)[number];
export type VehicleClassification = (typeof VEHICLE_CLASSIFICATIONS)[number];

const VALID_CLASSIFICATIONS = new Set<string>(VEHICLE_CLASSIFICATIONS);
const PASSENGER_ASSET_CLASSIFICATIONS = new Set<string>(PASSENGER_VEHICLE_CLASSIFICATIONS);

export function isVehicleClassification(value: unknown): value is VehicleClassification {
  return typeof value === 'string' && VALID_CLASSIFICATIONS.has(value);
}

export function isPassengerVehicleClassification(
  value: unknown,
): value is PassengerVehicleClassification {
  return typeof value === 'string' && PASSENGER_ASSET_CLASSIFICATIONS.has(value);
}

/** The supplied, reviewed mapping. Keys are canonical storefront size strings. */
export const EXACT_VEHICLE_CLASS_BY_SIZE: Readonly<Record<string, VehicleClassification>> = {
  '175/70R12': 'vehicle-city-car',
  '165/60R14': 'vehicle-compact',
  '175/65R14C': 'vehicle-small-cargo-van',
  '175/70R14C': 'vehicle-small-cargo-van',
  '175/55R15': 'vehicle-city-car',
  '195/50R15': 'vehicle-compact',
  '195/70R15C': 'vehicle-small-cargo-van',
  '205/65R15C': 'vehicle-small-cargo-van',
  '205/70R15C': 'vehicle-small-cargo-van',
  '215/65R15C': 'vehicle-small-cargo-van',
  '215/70R15C': 'vehicle-small-cargo-van',
  '225/70R15C': 'vehicle-cargo-van',
  '255/70R15C': 'vehicle-wrangler',
  '185/75R16C': 'vehicle-cargo-van',
  '195/65R16C': 'vehicle-premium-van',
  '195/75R16C': 'vehicle-cargo-van',
  '205/65R16C': 'vehicle-premium-van',
  '205/75R16C': 'vehicle-cargo-van',
  '215/65R16C': 'vehicle-cargo-van',
  '215/75R16C': 'vehicle-cargo-van',
  '215/85R16': 'vehicle-wrangler',
  '225/65R16C': 'vehicle-cargo-van',
  '225/75R16C': 'vehicle-cargo-van',
  '235/65R16C': 'vehicle-cargo-van',
  '215/60R17C': 'vehicle-premium-van',
  '225/55R17C': 'vehicle-premium-van',
  '235/35R18': 'vehicle-sport-sedan',
  '255/35R18': 'vehicle-sport-coupe',
  '255/40R18': 'vehicle-business-sedan',
  '265/35R18': 'vehicle-performance-car',
  '205/55R19': 'vehicle-small-crossover',
  '225/55R19': 'vehicle-compact-crossover',
  '235/60R19': 'vehicle-popular-crossover',
  '235/65R19': 'vehicle-premium-suv',
  '265/30R19': 'vehicle-performance-car',
  '265/35R19': 'vehicle-sport-sedan',
  '275/30R19': 'vehicle-performance-car',
  '275/35R19': 'vehicle-sport-coupe',
  '285/30R19': 'vehicle-performance-car',
  '285/35R19': 'vehicle-performance-car',
  '195/55R20': 'vehicle-electric-compact',
  '225/30R20': 'vehicle-performance-car',
  '225/35R20': 'vehicle-sport-coupe',
  '235/45R20': 'vehicle-business-sedan',
  '235/50R20': 'vehicle-popular-crossover',
  '235/55R20': 'vehicle-premium-suv',
  '245/45R20': 'vehicle-premium-crossover',
  '245/50R20': 'vehicle-premium-crossover',
  '255/55R20': 'vehicle-range-rover',
  '275/35R20': 'vehicle-sport-coupe',
  '285/30R20': 'vehicle-performance-car',
  '295/30R20': 'vehicle-performance-car',
  '295/35R20': 'vehicle-coupe-premium-suv',
  '245/45R21': 'vehicle-premium-crossover',
  '255/45R21': 'vehicle-premium-suv',
  '265/45R21': 'vehicle-large-premium-suv',
  '295/30R21': 'vehicle-performance-car',
};

export interface NormalizedVehicleSize {
  width: number;
  profile: number;
  radius: number;
  commercial: boolean;
  key: string;
}

export interface VehicleResolverProduct {
  vehicleClassification?: unknown;
  productType?: unknown;
  vehicleClass?: unknown;
  catalogClass?: unknown;
  size?: unknown;
  width?: unknown;
  profile?: unknown;
  rimDiameter?: unknown;
  radius?: unknown;
  commercial?: unknown;
  application?: unknown;
  treadType?: unknown;
  season?: unknown;
  patternKey?: unknown;
  name?: unknown;
}

export type VehicleResolutionSource =
  | 'existing'
  | 'application'
  | 'exact-size'
  | 'range'
  | 'category-fallback'
  | 'absolute-fallback';

export interface VehicleClassResolution {
  classification: VehicleClassification;
  source: VehicleResolutionSource;
  reason: string;
  normalizedSize: string | null;
  usedAbsoluteFallback: boolean;
}

interface Rule {
  classification: PassengerVehicleClassification;
  radius: readonly [number, number];
  width: readonly [number, number];
  profile?: readonly [number, number];
}

const SPECIAL_RULES: readonly Rule[] = [
  { classification: 'vehicle-pickup', radius: [15, 18], width: [235, 325], profile: [65, 85] },
  { classification: 'vehicle-offroad', radius: [15, 18], width: [225, 285], profile: [65, 85] },
  { classification: 'vehicle-minivan', radius: [15, 18], width: [195, 235], profile: [55, 70] },
  { classification: 'vehicle-offroad-luxury', radius: [18, 22], width: [265, 315], profile: [50, 70] },
];

const PASSENGER_RULES: readonly Rule[] = [
  { classification: 'vehicle-city-car', radius: [13, 13], width: [155, 175] },
  { classification: 'vehicle-compact', radius: [13, 13], width: [176, 185] },
  { classification: 'vehicle-city-car', radius: [14, 14], width: [155, 175], profile: [65, 80] },
  { classification: 'vehicle-compact', radius: [14, 14], width: [176, 185] },
  { classification: 'vehicle-compact-sedan', radius: [14, 14], width: [186, 205] },
  { classification: 'vehicle-city-car', radius: [15, 15], width: [155, 185], profile: [60, 75] },
  { classification: 'vehicle-prius', radius: [15, 15], width: [185, 195], profile: [55, 70] },
  { classification: 'vehicle-compact-sedan', radius: [15, 15], width: [196, 205] },
  { classification: 'vehicle-family-sedan', radius: [15, 15], width: [206, 215] },
  { classification: 'vehicle-small-crossover', radius: [15, 15], width: [216, 235] },
  { classification: 'vehicle-compact', radius: [16, 16], width: [155, 195] },
  { classification: 'vehicle-compact-sedan', radius: [16, 16], width: [196, 205], profile: [45, 60] },
  { classification: 'vehicle-family-sedan', radius: [16, 16], width: [206, 215], profile: [45, 65] },
  { classification: 'vehicle-business-sedan', radius: [16, 16], width: [216, 225], profile: [40, 60] },
  { classification: 'vehicle-small-crossover', radius: [16, 16], width: [226, 235] },
  { classification: 'vehicle-compact-crossover', radius: [16, 16], width: [236, 255] },
  { classification: 'vehicle-offroad', radius: [16, 16], width: [256, 325] },
  { classification: 'vehicle-sport-sedan', radius: [17, 17], width: [195, 215], profile: [40, 55] },
  { classification: 'vehicle-family-sedan', radius: [17, 17], width: [216, 225], profile: [45, 60] },
  { classification: 'vehicle-business-sedan', radius: [17, 17], width: [226, 235], profile: [40, 55] },
  { classification: 'vehicle-luxury-sedan', radius: [17, 17], width: [236, 245], profile: [35, 50] },
  { classification: 'vehicle-compact-crossover', radius: [17, 17], width: [236, 255], profile: [55, 65] },
  { classification: 'vehicle-popular-crossover', radius: [17, 17], width: [256, 275], profile: [45, 65] },
  { classification: 'vehicle-offroad', radius: [17, 17], width: [276, 325] },
  { classification: 'vehicle-sport-sedan', radius: [18, 18], width: [205, 225], profile: [35, 50] },
  { classification: 'vehicle-business-sedan', radius: [18, 18], width: [226, 235], profile: [40, 55] },
  { classification: 'vehicle-sport-coupe', radius: [18, 18], width: [236, 245], profile: [30, 45] },
  { classification: 'vehicle-premium-crossover', radius: [18, 18], width: [236, 255], profile: [45, 60] },
  { classification: 'vehicle-premium-suv', radius: [18, 18], width: [256, 275], profile: [45, 60] },
  { classification: 'vehicle-offroad-luxury', radius: [18, 18], width: [276, 325] },
  { classification: 'vehicle-sport-coupe', radius: [19, 19], width: [225, 245], profile: [30, 45] },
  { classification: 'vehicle-luxury-sedan', radius: [19, 19], width: [246, 255], profile: [30, 45] },
  { classification: 'vehicle-premium-crossover', radius: [19, 19], width: [236, 265], profile: [45, 60] },
  { classification: 'vehicle-coupe-suv', radius: [19, 19], width: [266, 285], profile: [40, 55] },
  { classification: 'vehicle-large-premium-suv', radius: [19, 19], width: [286, 325] },
  { classification: 'vehicle-performance-car', radius: [20, 20], width: [235, 245], profile: [30, 40] },
  { classification: 'vehicle-sport-coupe', radius: [20, 20], width: [246, 265], profile: [30, 40] },
  { classification: 'vehicle-luxury-sedan', radius: [20, 20], width: [246, 275], profile: [40, 50] },
  { classification: 'vehicle-coupe-suv', radius: [20, 20], width: [276, 285], profile: [35, 50] },
  { classification: 'vehicle-premium-suv', radius: [20, 20], width: [286, 295], profile: [40, 55] },
  { classification: 'vehicle-coupe-premium-suv', radius: [20, 20], width: [296, 315], profile: [35, 55] },
  { classification: 'vehicle-luxury-suv', radius: [20, 20], width: [316, 325] },
  { classification: 'vehicle-performance-car', radius: [21, 21], width: [245, 265], profile: [30, 40] },
  { classification: 'vehicle-coupe-premium-suv', radius: [21, 21], width: [266, 285], profile: [30, 45] },
  { classification: 'vehicle-luxury-suv', radius: [21, 21], width: [286, 305], profile: [35, 50] },
  { classification: 'vehicle-range-rover', radius: [21, 21], width: [306, 325] },
  { classification: 'vehicle-coupe-premium-suv', radius: [22, 22], width: [255, 275], profile: [30, 40] },
  { classification: 'vehicle-luxury-suv', radius: [22, 22], width: [276, 305], profile: [35, 50] },
  { classification: 'vehicle-range-rover', radius: [22, 22], width: [306, 325] },
  { classification: 'vehicle-coupe-premium-suv', radius: [23, 23], width: [275, 295], profile: [30, 45] },
  { classification: 'vehicle-range-rover', radius: [23, 23], width: [296, 325] },
];

const VARIATIONS: Readonly<Record<string, readonly PassengerVehicleClassification[]>> = {
  '195/65R15': ['vehicle-prius', 'vehicle-compact', 'vehicle-compact-sedan'],
  '205/55R16': ['vehicle-compact-sedan', 'vehicle-family-sedan', 'vehicle-prius'],
  '225/45R18': ['vehicle-sport-sedan', 'vehicle-business-sedan', 'vehicle-sport-coupe'],
  '235/55R19': ['vehicle-premium-crossover', 'vehicle-coupe-suv', 'vehicle-premium-suv'],
  '275/40R20': ['vehicle-coupe-suv', 'vehicle-premium-suv', 'vehicle-coupe-premium-suv'],
  '315/35R22': ['vehicle-range-rover', 'vehicle-luxury-suv', 'vehicle-coupe-premium-suv'],
};

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeVehicleSizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toUpperCase().replace(/\s+/g, '').replace(/R-/g, 'R');
  const match = /^(\d{3})\/(\d{2})R(\d{2}(?:\.5)?)(C)?$/.exec(normalized);
  if (!match) return null;
  return `${Number(match[1])}/${Number(match[2])}R${Number(match[3])}${match[4] ? 'C' : ''}`;
}

export function normalizeVehicleSize(product: VehicleResolverProduct): NormalizedVehicleSize | null {
  const fromSize = normalizeVehicleSizeString(product.size);
  if (fromSize) {
    const match = /^(\d+)\/(\d+)R([\d.]+)(C)?$/.exec(fromSize)!;
    return {
      width: Number(match[1]),
      profile: Number(match[2]),
      radius: Number(match[3]),
      commercial: Boolean(match[4]),
      key: fromSize,
    };
  }

  const width = numeric(product.width);
  const profile = numeric(product.profile);
  const rawRadius = String(product.radius ?? product.rimDiameter ?? '').toUpperCase();
  const radius = numeric(rawRadius.replace(/R-?/g, '').replace(/C/g, ''));
  if (width === null || profile === null || radius === null || width <= 0 || profile <= 0 || radius <= 0) {
    return null;
  }
  const commercial = product.commercial === true || rawRadius.includes('C');
  return { width, profile, radius, commercial, key: `${width}/${profile}R${radius}${commercial ? 'C' : ''}` };
}

function matches(rule: Rule, size: NormalizedVehicleSize): boolean {
  return size.radius >= rule.radius[0] && size.radius <= rule.radius[1]
    && size.width >= rule.width[0] && size.width <= rule.width[1]
    && (!rule.profile || (size.profile >= rule.profile[0] && size.profile <= rule.profile[1]));
}

export function classifyVehicleSize(size: NormalizedVehicleSize): {
  primary: VehicleClassification;
  alternatives: VehicleClassification[];
  source: 'exact-size' | 'range';
} | null {
  const exact = EXACT_VEHICLE_CLASS_BY_SIZE[size.key];
  if (exact) return { primary: exact, alternatives: [], source: 'exact-size' };
  if (size.commercial) return null;
  const variation = VARIATIONS[size.key];
  if (variation) return { primary: variation[0]!, alternatives: [...variation.slice(1)], source: 'range' };
  const candidates = [...SPECIAL_RULES, ...PASSENGER_RULES]
    .filter((rule) => matches(rule, size))
    .map((rule) => rule.classification)
    .filter((classification, index, all) => all.indexOf(classification) === index);
  return candidates.length ? { primary: candidates[0]!, alternatives: candidates.slice(1), source: 'range' } : null;
}

function metadataText(product: VehicleResolverProduct): string {
  return [product.application, product.treadType, product.season, product.patternKey, product.name]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toUpperCase();
}

function applicationClassification(product: VehicleResolverProduct, size: NormalizedVehicleSize | null): VehicleClassification | null {
  const text = metadataText(product);
  if (/FORKLIFT|W-?9|ჩანგლ/.test(text)) return 'vehicle-forklift';
  if (/SKID[ -]?STEER|\bSKS\b/.test(text)) return 'vehicle-skid-steer';
  if (/WHEEL[ -]?LOADER|\bE3\b|\bL3\b|დამტვირთ/.test(text)) return 'vehicle-wheel-loader';
  if (/BACKHOE|AGRICULT|INDUSTRIAL|ექსკავ|სასოფლო|ინდუსტრ/.test(text)) return 'vehicle-backhoe';
  if (/QUARRY|კარიერ/.test(text)) return 'vehicle-quarry-dump';
  if (/HIGHWAY|STEER|DRIVE|TRAILER|მაგისტრალ/.test(text) && product.vehicleClass === 'truck') return 'vehicle-highway-truck';
  if (/(^|[^A-Z])(?:A\/T|M\/T)(?:[^A-Z]|$)/.test(text)) {
    if (size?.key === '255/70R15C' || size?.key === '215/85R16') return 'vehicle-wrangler';
    return 'vehicle-offroad';
  }
  return null;
}

function categoryFallback(product: VehicleResolverProduct, size: NormalizedVehicleSize | null): VehicleClassification | null {
  const text = metadataText(product);
  if (/FORKLIFT|W-?9|ჩანგლ/.test(text)) return 'vehicle-forklift';
  if (/SKID[ -]?STEER|\bSKS\b/.test(text)) return 'vehicle-skid-steer';
  if (/WHEEL[ -]?LOADER|\bE3\b|\bL3\b|დამტვირთ/.test(text)) return 'vehicle-wheel-loader';
  if (/QUARRY|კარიერ/.test(text)) return 'vehicle-quarry-dump';
  if (/BACKHOE|AGRICULT|INDUSTRIAL|ექსკავ|სასოფლო|ინდუსტრ/.test(text)) return 'vehicle-backhoe';
  if (product.vehicleClass === 'truck' || product.catalogClass === 'truck') return 'vehicle-highway-truck';
  if (/(^|[^A-Z])(?:A\/T|M\/T)(?:[^A-Z]|$)/.test(text)) return 'vehicle-offroad';
  if (size?.commercial || product.commercial === true || /\bVAN\b/.test(text)) return 'vehicle-cargo-van';
  if (/H\/T|SUV|CROSSOVER/.test(text)) return 'vehicle-popular-crossover';
  if (size && size.profile <= 40) return 'vehicle-sport-sedan';
  if (product.productType === 'tire' || product.catalogClass === 'passenger' || product.vehicleClass === 'passenger') {
    return 'vehicle-family-sedan';
  }
  return null;
}

export function resolveVehicleClass(
  product: VehicleResolverProduct,
  availableClassifications: ReadonlySet<string> = VALID_CLASSIFICATIONS,
): VehicleClassResolution {
  const normalized = normalizeVehicleSize(product);
  const normalizedSize = normalized?.key ?? null;
  if (isVehicleClassification(product.vehicleClassification)
    && availableClassifications.has(product.vehicleClassification)) {
    return { classification: product.vehicleClassification, source: 'existing', reason: 'valid-existing-classification', normalizedSize, usedAbsoluteFallback: false };
  }
  const application = applicationClassification(product, normalized);
  if (application && availableClassifications.has(application)) {
    return { classification: application, source: 'application', reason: 'explicit-application-or-pattern', normalizedSize, usedAbsoluteFallback: false };
  }
  const passengerSizing = product.vehicleClass !== 'truck'
    && product.catalogClass !== 'truck'
    && product.catalogClass !== 'special';
  if (normalized && passengerSizing) {
    const sizeResolution = classifyVehicleSize(normalized);
    if (sizeResolution && availableClassifications.has(sizeResolution.primary)) {
      return { classification: sizeResolution.primary, source: sizeResolution.source, reason: `${sizeResolution.source}:${normalized.key}`, normalizedSize, usedAbsoluteFallback: false };
    }
  }
  const fallback = categoryFallback(product, normalized);
  if (fallback && availableClassifications.has(fallback)) {
    return { classification: fallback, source: 'category-fallback', reason: `category:${fallback}`, normalizedSize, usedAbsoluteFallback: false };
  }
  return { classification: 'vehicle-family-sedan', source: 'absolute-fallback', reason: 'absolute-renderer-fallback', normalizedSize, usedAbsoluteFallback: true };
}
