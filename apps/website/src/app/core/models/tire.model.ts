/** Tire (product) — spec 04-data-model.md. Replaces the old Wheel model. */

import { SpeedRating, TireSize } from './fitment.model';

export type Season = 'summer' | 'winter' | 'all-season';

/**
 * Marketing tyre-type category (spec: catalog filter). Mirrors the backend's
 * CATEGORY_TO_SEASON (apps/api products.service.ts): each key selects the exact
 * raw `season` string in the catalog. 7 categories cover all 603 tyres.
 *
 * Marketing rule: lead with the word the customer searches for (summer /
 * all-season / winter), keep the technical code in parentheses so buyers still
 * pick correctly. Display order = mass-market first, niche SUV/off-road last.
 */
export type TyreCategory = 'summer' | 'all_season' | 'winter_at' | 'ms' | 'ht' | 'at' | 'mt';

/** Sidewall-stamp-style glyph ids rendered by SeasonSymbol (shared component). */
export type CategorySymbol =
  | 'sun'
  | 'sun-snow'
  | 'snowflake'
  | 'ms-letters'
  | 'road'
  | 'mountain'
  | 'mud-tread';

export interface TyreCategoryDef {
  key: TyreCategory;
  /** The exact raw `season` string this category maps to (source of truth). */
  season: string;
  /** Georgian chip label — the searched-for word, technical code in parens. */
  label: string;
  /** Helper text under the label. */
  subtitle: string;
  /** The MOOD theme this category drives when it is the first-selected filter
   *  (spec Part B: 7 categories → 3 themes). M+S maps to winter (locked).
   *  This is the ONLY field that touches the global 3-family climate theme. */
  theme: Season;
  /** The category's OWN identity color (1 of 7) — a `var(--cat-*)` reference
   *  (tokens.scss). LOCAL to the card badge/frame; independent of `theme`. */
  categoryColor: string;
  /** Symbol glyph on the card/hero badge — echoes real sidewall stampings. */
  symbol: CategorySymbol;
  /** Short Georgian badge label (symbol + label always shown together — never
   *  color alone, so categories stay distinguishable without color vision). */
  badgeLabel: string;
}

/**
 * The 7 categories in display order (mass-market → niche). Consumed by the
 * catalog chips (labels/order) and by the API mapper (season → key), so the
 * mapping lives in exactly one place on the frontend.
 *
 * TODO(A/T split): `winter_at` and `at` are split literally from the two source
 * strings "A/T" / "A/T-ყველა სეზონი" — there is no 3PMSF/snowflake field in the
 * data to verify the winter claim. Revisit if a real snow-rating flag is added.
 */
export const TYRE_CATEGORIES: readonly TyreCategoryDef[] = [
  { key: 'summer', season: 'ზაფხული', theme: 'summer', categoryColor: 'var(--cat-summer)', symbol: 'sun', badgeLabel: $localize`ზაფხულის`, label: $localize`ზაფხულის`, subtitle: $localize`თბილი ამინდი, მშრალი და სველი ასფალტი` },
  { key: 'all_season', season: 'ყველა სეზონი', theme: 'all-season', categoryColor: 'var(--cat-all-season)', symbol: 'sun-snow', badgeLabel: $localize`ყველა სეზონის`, label: $localize`ყველა სეზონის`, subtitle: $localize`მთელი წელი, ზომიერი კლიმატი` },
  { key: 'winter_at', season: 'A/T', theme: 'winter', categoryColor: 'var(--cat-winter-at)', symbol: 'snowflake', badgeLabel: $localize`ზამთრის A/T`, label: $localize`ზამთრის (A/T)`, subtitle: $localize`ცივი ამინდი და თოვლი — ჯიპისთვის` },
  { key: 'ms', season: 'M+S', theme: 'winter', categoryColor: 'var(--cat-ms)', symbol: 'ms-letters', badgeLabel: 'M+S', label: $localize`ტალახი და თოვლი (M+S)`, subtitle: $localize`ზამთრის ნიშნით, მსუბუქ თოვლში` },
  { key: 'ht', season: 'H/T', theme: 'all-season', categoryColor: 'var(--cat-ht)', symbol: 'road', badgeLabel: $localize`საგზაო H/T`, label: $localize`საგზაო (H/T)`, subtitle: $localize`ასფალტისთვის — რბილი და ჩუმი` },
  { key: 'at', season: 'A/T-ყველა სეზონი', theme: 'all-season', categoryColor: 'var(--cat-at)', symbol: 'mountain', badgeLabel: $localize`უნივერსალური A/T`, label: $localize`უნივერსალური (A/T)`, subtitle: $localize`ქალაქიც და მსუბუქი უგზოობაც` },
  { key: 'mt', season: 'M/T', theme: 'all-season', categoryColor: 'var(--cat-mt)', symbol: 'mud-tread', badgeLabel: $localize`უგზოობის M/T`, label: $localize`უგზოობის (M/T)`, subtitle: $localize`ტალახი და მძიმე რელიეფი` },
] as const;

/** key → full def, for card/hero badge lookups (one shared map, built once). */
export const TYRE_CATEGORY_BY_KEY: ReadonlyMap<TyreCategory, TyreCategoryDef> = new Map(
  TYRE_CATEGORIES.map((c) => [c.key, c]),
);

/** EU tyre label — a premium spec surface (05/06). */
export interface EuTireLabel {
  /** rolling resistance / fuel efficiency */
  fuelEfficiency: 'A' | 'B' | 'C' | 'D' | 'E';
  wetGrip: 'A' | 'B' | 'C' | 'D' | 'E';
  /** exterior noise in dB */
  noiseDb: number;
  noiseClass: 'A' | 'B' | 'C';
}

export interface TireAttributes {
  runFlat: boolean;
  /** winter — accepts studs */
  studdable?: boolean;
  /** 3-Peak Mountain Snowflake — severe-snow cert (winter / some all-season) */
  threePMSF?: boolean;
  /** M+S marking */
  mudSnow?: boolean;
  treadDepthMm?: number;
}

export interface TireMedia {
  /** hero studio shot, 3/4 */
  catalogUrl: string;
  /** sidewall/contour view used to composite the on-car tire ring (05 contract) */
  sidewallUrl: string;
  /** top-down tread pattern (detail inset + 3D normal hint) */
  treadUrl?: string;
  /** 3D model (optional) */
  glbUrl?: string;
  gallery: string[];
}

export interface Tire {
  id: string;
  /** Present on API-backed products; legacy test fixtures omit it. */
  productType?: 'tire' | 'disk';
  /** Data-backed storefront journey returned by the API. */
  catalogClass?: 'passenger' | 'truck' | 'special' | 'disk';
  /** Source notation used by the catalog size picker. */
  sizeSystem?: 'metric' | 'inch';
  /** Optional passenger body key supplied by the backend. Valid values take
   *  precedence over the size-based frontend classifier. */
  vehicleClassification?: string;
  brandId: string;
  model: string; // "PrimaContact 7"
  season: Season;
  /** Marketing tyre-type category (catalog filter). Optional: absent on mock
   *  fixtures and derived from the raw API `season` string for real products. */
  category?: TyreCategory;
  size: TireSize;
  /** load index, table-mapped to kg (91 → 615 kg).
   *  Optional: absent when the real catalog's load/speed string doesn't parse. */
  loadIndex?: number;
  /** Optional: absent for non-passenger ratings the SpeedRating scale omits. */
  speedRating?: SpeedRating;
  /** per tire; UI leads with set-of-4 price */
  priceGel: number;
  inStock: number;
  /** Optional: the real catalog has no EU label — never fabricated (03-DATA-MODEL). */
  euLabel?: EuTireLabel;
  attributes: TireAttributes;
  media: TireMedia;
  /** 'flagship','touring','sport','eco','run-flat'... */
  tags: string[];
}
