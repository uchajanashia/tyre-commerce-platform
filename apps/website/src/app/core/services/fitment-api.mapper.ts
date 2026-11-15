/**
 * Mapping shim: API Product/Brand → the website's existing Tire/Brand interfaces,
 * so pages and components stay UNCHANGED behind the FitmentDataService seam.
 *
 * Honors the reconciliation table in docs/03-DATA-MODEL.md:
 *  - `size`: the raw API string is the display source of truth (TireSize.raw);
 *    the structured {widthMm, aspect} are populated ONLY when the size parses as
 *    a clean passenger-metric form (e.g. "205/55R16"). For truck/commercial/disk
 *    sizes they are left undefined — never fabricated. rimDiameterInch always
 *    comes from the authoritative numeric `rimDiameter`.
 *  - price: `retailPrice` is the price the UI shows; wholesale does not exist here.
 *  - euLabel: the API has none → left absent (03-DATA-MODEL: never faked).
 *  - season: derived from `seasonGroup`.
 *  - load/speed: parsed from `loadSpeedIndex` where it cleanly yields a known
 *    rating; left undefined otherwise.
 *  - stock: public `availability` → a binary internal indicator; exact
 *    quantities are never mapped into the public storefront model.
 */
import { Brand, Season, SpeedRating, Tire, TireSize, TYRE_CATEGORIES, TyreCategory } from '../models';

/** Reverse of TYRE_CATEGORIES: exact raw `season` string → marketing category key. */
const SEASON_TO_CATEGORY: ReadonlyMap<string, TyreCategory> = new Map(
  TYRE_CATEGORIES.map((c) => [c.season, c.key]),
);

function modelMedia(p: ApiProduct): Tire['media'] {
  // Real model photos from the API (ordered: [0] = front/catalog, [1] = side).
  const front = p.photos?.[0];
  if (front !== undefined) {
    return {
      catalogUrl: front,
      sidewallUrl: p.photos?.[1] ?? front,
      gallery: [...(p.photos ?? [])],
    };
  }
  return { catalogUrl: '', sidewallUrl: '', gallery: [] };
}

export interface ApiBrand {
  id: string;
  name: string;
  defaultCountry: string | null;
  productCount?: number;
}

export interface ApiProduct {
  id: string;
  code: string;
  slug: string;
  productType: 'tire' | 'disk';
  vehicleClass: 'passenger' | 'truck';
  sizeSystem: 'metric' | 'inch';
  /** Derived storefront journey supplied by the API. */
  catalogClass: 'passenger' | 'truck' | 'special' | 'disk';
  vehicleClassification?: string | null;
  brandId: string;
  patternKey: string;
  size: string;
  width: number;
  profile: number | null;
  rimDiameter: number;
  radius: string;
  construction: string;
  commercial: boolean;
  overallDiameter: number | null;
  loadSpeedIndex: string | null;
  plyRating: string | null;
  treadType: string | null;
  application: string;
  season: string | null;
  seasonGroup: 'summer' | 'all_season' | 'winter' | null;
  country: string | null;
  unit: string;
  retailPrice: number;
  currency: string;
  /** Public API deliberately exposes no exact quantity or internal stock status. */
  availability: 'in_stock' | 'out_of_stock';
  name: string;
  brand?: { id: string; name: string; defaultCountry: string | null };
  /** Ordered model photo URLs ([0] = front, [1] = side); empty when none uploaded. */
  photos?: string[];
}

export interface ApiProductList {
  total: number;
  page: number;
  pageSize: number;
  items: ApiProduct[];
}

/** Clean passenger-metric prefix "WWW/AA…" (e.g. "205/55R16"). Inch widths like
 *  "12.5/80R18" or sizes without an aspect ("155R12C") intentionally do NOT match. */
const PASSENGER_METRIC = /^(\d{2,3})\/(\d{2,3})/;
const KNOWN_SPEED_RATINGS = new Set<SpeedRating>(['Q', 'R', 'S', 'T', 'H', 'V', 'W', 'Y']);

export function mapSize(p: ApiProduct): TireSize {
  const m = PASSENGER_METRIC.exec(p.size.trim());
  const widthMm = m ? Number(m[1]) : undefined;
  const aspect = m ? Number(m[2]) : undefined;
  return {
    rimDiameterInch: p.rimDiameter,
    raw: p.size,
    ...(widthMm !== undefined && Number.isFinite(widthMm) ? { widthMm } : {}),
    ...(aspect !== undefined && Number.isFinite(aspect) ? { aspect } : {}),
  };
}

export function parseLoadSpeed(raw: string | null): {
  loadIndex?: number;
  speedRating?: SpeedRating;
} {
  if (!raw) {
    return {};
  }
  const m = /(\d{2,3})(?:\/\d{2,3})?\s*([A-Za-z]{1,2})\s*$/.exec(raw.trim());
  if (!m) {
    return {};
  }
  const loadIndex = Number(m[1]);
  const letter = (m[2] ?? '').toUpperCase() as SpeedRating;
  return {
    ...(Number.isFinite(loadIndex) ? { loadIndex } : {}),
    ...(KNOWN_SPEED_RATINGS.has(letter) ? { speedRating: letter } : {}),
  };
}

export function mapSeason(group: ApiProduct['seasonGroup']): Season {
  switch (group) {
    case 'summer':
      return 'summer';
    case 'winter':
      return 'winter';
    case 'all_season':
      return 'all-season';
    default:
      // disks (null seasonGroup) — shown under the neutral "all-season" axis.
      return 'all-season';
  }
}

/** A short display model name: patternKey with the brand prefix / trailing "/" trimmed. */
export function deriveModel(p: ApiProduct): string {
  const brand = p.brand?.name ?? '';
  let model = (p.patternKey || p.name || '').trim();
  if (brand && model.toUpperCase().startsWith(brand.toUpperCase())) {
    model = model.slice(brand.length).trim();
  }
  model = model.replace(/[\\/\s]+$/g, '').trim();
  return model || p.size;
}

/** Preserve only the yes/no availability fact. Never fabricate or expose a count. */
export function stockToAvailability(availability: ApiProduct['availability']): 0 | 1 {
  return availability === 'out_of_stock' ? 0 : 1;
}

export function mapProduct(p: ApiProduct): Tire {
  const { loadIndex, speedRating } = parseLoadSpeed(p.loadSpeedIndex);
  const category = p.season != null ? SEASON_TO_CATEGORY.get(p.season) : undefined;
  return {
    id: p.id,
    productType: p.productType,
    catalogClass: p.catalogClass,
    sizeSystem: p.sizeSystem,
    ...(p.vehicleClassification ? { vehicleClassification: p.vehicleClassification } : {}),
    brandId: p.brandId,
    model: deriveModel(p),
    season: mapSeason(p.seasonGroup),
    ...(category ? { category } : {}),
    size: mapSize(p),
    priceGel: p.retailPrice,
    inStock: stockToAvailability(p.availability),
    // euLabel intentionally absent — the API has none and we never fabricate one.
    attributes: { runFlat: false },
    media: modelMedia(p),
    tags: [],
    ...(loadIndex !== undefined ? { loadIndex } : {}),
    ...(speedRating !== undefined ? { speedRating } : {}),
  };
}

export function mapBrand(b: ApiBrand): Brand {
  return {
    id: b.id,
    name: b.name,
    country: b.defaultCountry ?? '',
    logoUrl: '',
    // tier/story are absent — components tolerate their absence.
  };
}
