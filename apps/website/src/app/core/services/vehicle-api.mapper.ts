/**
 * Mapping shim: the API's /fitment/* JSON → the website's existing Make/
 * VehicleModel/VehicleTrim interfaces, so pages/components stay unchanged
 * behind the FitmentDataService seam (mirrors fitment-api.mapper.ts).
 *
 * Ids are synthesized (Wheel-Size has no single global model/trim id): model
 * ids are `${makeSlug}__${modelSlug}`, trim ids add `__${year}__${trimSlug}`.
 * That keeps `getModel`/`getTrim` (single-id lookups the rest of the app
 * already relies on — deep links, cart metadata) working without a dedicated
 * "fetch by id" endpoint on the API.
 *
 * `visual` (the configurator's side-profile render + wheel-well anchors) has
 * no Wheel-Size equivalent — it's bespoke artwork this app authors per model.
 * Every API-sourced trim gets GENERIC_VISUAL, whose `sideProfileUrl` points at
 * a path that never resolves; car-stage.ts already treats a failed image load
 * as "no render available" and draws a neutral silhouette from the anchors
 * instead (see car-stage.ts's `carFailed` fallback), so the configurator still
 * works — it just shows a generic car outline until real artwork exists.
 */
import {
  Make,
  SpeedRating,
  VehicleModel,
  VehicleTireFitment,
  VehicleTrim,
  VehicleVisual,
} from '../models';
import makeLogoKeys from '../../../assets/makes/manifest.json';

const ID_SEP = '__';
const KNOWN_SPEED_RATINGS = new Set<SpeedRating>(['Q', 'R', 'S', 'T', 'H', 'V', 'W', 'Y']);

/** API slugs that intentionally differ from the matching make-logo filename. */
const MAKE_LOGO_ALIASES: Readonly<Record<string, string>> = {
  'great-wall': 'gwm',
  mercedes: 'mercedes-benz',
};
const AVAILABLE_MAKE_LOGO_KEYS = new Set<string>(makeLogoKeys);

const GENERIC_VISUAL: VehicleVisual = {
  sideProfileUrl: '/assets/cars/unavailable.png',
  stageWidthPx: 2400,
  groundY: 1212.5,
  frontWheel: { cx: 1815, cy: 985, rimRadiusPx: 157.7, oemSidewallPx: 69.8 },
  rearWheel: { cx: 585, cy: 985, rimRadiusPx: 157.7, oemSidewallPx: 69.8 },
};

export interface ApiFitmentMake {
  slug: string;
  name: string;
}

export interface ApiFitmentModel {
  slug: string;
  name: string;
}

export interface ApiFitmentTireSize {
  widthMm?: number;
  aspect?: number;
  rimDiameterInch: number;
  raw: string;
}

export interface ApiFitmentOemByRim {
  rimDiameterInch: number;
  front: ApiFitmentTireSize;
  rear?: ApiFitmentTireSize;
}

export interface ApiFitmentTrim {
  trimSlug: string;
  trimName: string;
  rimDiametersInch: number[];
  oemBySize: ApiFitmentOemByRim[];
  staggered: boolean;
  minLoadIndex: number;
  oemSpeedRating: string;
}

export interface ApiFitmentLookupResult {
  make: string;
  model: string;
  year: number;
  trims: ApiFitmentTrim[];
}

function makeLogoKey(makeSlug: string): string {
  return MAKE_LOGO_ALIASES[makeSlug] ?? makeSlug;
}

export function hasMakeLogo(make: ApiFitmentMake): boolean {
  return AVAILABLE_MAKE_LOGO_KEYS.has(makeLogoKey(make.slug));
}

export function buildModelId(makeSlug: string, modelSlug: string): string {
  return `${makeSlug}${ID_SEP}${modelSlug}`;
}

export function buildTrimId(
  makeSlug: string,
  modelSlug: string,
  year: number,
  trimSlug: string,
): string {
  return `${makeSlug}${ID_SEP}${modelSlug}${ID_SEP}${year}${ID_SEP}${trimSlug}`;
}

export function parseModelId(id: string): { makeSlug: string; modelSlug: string } | null {
  const [makeSlug, modelSlug] = id.split(ID_SEP);
  return makeSlug && modelSlug ? { makeSlug, modelSlug } : null;
}

export function parseTrimId(
  id: string,
): { makeSlug: string; modelSlug: string; year: number; trimSlug: string } | null {
  const [makeSlug, modelSlug, yearStr, trimSlug] = id.split(ID_SEP);
  const year = Number(yearStr);
  return makeSlug && modelSlug && trimSlug && Number.isFinite(year)
    ? { makeSlug, modelSlug, year, trimSlug }
    : null;
}

export function mapMake(m: ApiFitmentMake): Make {
  const logoKey = makeLogoKey(m.slug);
  return {
    id: m.slug,
    name: m.name,
    logoUrl: AVAILABLE_MAKE_LOGO_KEYS.has(logoKey) ? `/assets/makes/${logoKey}.webp` : '',
  };
}

export function mapModel(makeSlug: string, m: ApiFitmentModel): VehicleModel {
  return { id: buildModelId(makeSlug, m.slug), makeId: makeSlug, name: m.name };
}

function mapFitment(t: ApiFitmentTrim): VehicleTireFitment | null {
  const speedRating = t.oemSpeedRating?.toUpperCase() as SpeedRating | undefined;
  if (
    !Number.isFinite(t.minLoadIndex) ||
    t.minLoadIndex <= 0 ||
    !speedRating ||
    !KNOWN_SPEED_RATINGS.has(speedRating)
  ) {
    return null;
  }
  return {
    rimDiametersInch: t.rimDiametersInch,
    oemBySize: t.oemBySize,
    staggered: t.staggered,
    minLoadIndex: t.minLoadIndex,
    oemSpeedRating: speedRating,
  };
}

export function mapTrim(
  makeSlug: string,
  modelSlug: string,
  year: number,
  t: ApiFitmentTrim,
): VehicleTrim | null {
  const fitment = mapFitment(t);
  if (!fitment) return null;
  return {
    id: buildTrimId(makeSlug, modelSlug, year, t.trimSlug),
    modelId: buildModelId(makeSlug, modelSlug),
    name: t.trimName,
    fitment,
    visual: GENERIC_VISUAL,
  };
}

export function mapLookupResult(result: ApiFitmentLookupResult): VehicleTrim[] {
  return result.trims
    .map((t) => mapTrim(result.make, result.model, result.year, t))
    .filter((trim): trim is VehicleTrim => trim !== null);
}
