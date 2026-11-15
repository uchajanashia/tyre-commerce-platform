/**
 * Resolves which of the 9 vehicle scenes (or the neutral wheel studio) a
 * product's detail-page hero should render, per spec
 * docs/გაშვაბამდე მოსაგვარებელი საქმები/07-product-media-vehicles.md.
 *
 * The mapping is a VISUAL application class only — never a fitment claim
 * (matches vehicle-assets/qa-report.md's "remaining limitations" for every
 * scene). `PRODUCT_VEHICLE_MAP` is keyed by product code, which is the
 * catalog's own id (`apps/api/src/products/products.service.ts`: "id === code
 * in the catalog").
 */
import { Tire } from '@core/models';

import {
  PRODUCT_VEHICLE_MAP,
  VEHICLE_SCENE_BY_ID,
  VehicleScene,
  VehicleSceneAnchor,
} from '../content/vehicle-scenes.data';

const DISK_FALLBACK_SCENE_ID = 'neutral-wheel-studio';
const DEFAULT_VEHICLE_SCENE_ID = 'vehicle-passenger';

export interface ResolvedVehicleScene {
  scene: VehicleScene;
  /** null = show the product's own photo at every anchor (no axle distinction). */
  axleRole: string | null;
}

/** Codes absent from the 606-product mapping (mock/test fixtures, future
 *  catalog additions) fall back by catalogClass rather than inventing a role. */
export function resolveVehicleScene(
  tire: Pick<Tire, 'id' | 'catalogClass' | 'vehicleClassification'>,
): ResolvedVehicleScene {
  const mapped = PRODUCT_VEHICLE_MAP[tire.id];
  const scene = mapped ? VEHICLE_SCENE_BY_ID.get(mapped.vehicleId) : undefined;
  const classifiedScene = tire.vehicleClassification
    ? VEHICLE_SCENE_BY_ID.get(tire.vehicleClassification)
    : undefined;
  if (classifiedScene) {
    return { scene: classifiedScene, axleRole: mapped?.vehicleId === classifiedScene.id ? mapped.axleRole : null };
  }
  if (mapped && scene) {
    return { scene, axleRole: mapped.axleRole };
  }

  const fallbackId = tire.catalogClass === 'disk' ? DISK_FALLBACK_SCENE_ID : DEFAULT_VEHICLE_SCENE_ID;
  return { scene: VEHICLE_SCENE_BY_ID.get(fallbackId)!, axleRole: null };
}

/** catalog-vehicle-mapping.json's targetAxleRole vocabulary is finer-grained
 *  than the manifest's anchor axleRole (e.g. a highway-truck product is tagged
 *  "steer-front" / "drive-rear", but the anchor itself is just "steer" /
 *  "drive") — these are the same axle position, just named at different
 *  granularity by the two source files. */
const ROLE_ALIASES: Readonly<Record<string, string>> = {
  'steer-front': 'steer',
  'drive-rear': 'drive',
};

/** null productRole (axle undetermined / studio anchor) matches every anchor;
 *  the two grouped roles cover multi-anchor vehicles (trucks, front/rear pairs). */
export function anchorMatchesRole(anchor: VehicleSceneAnchor, productRole: string | null): boolean {
  if (productRole === null) {
    return true;
  }
  if (anchor.axleRole === productRole || anchor.axleRole === ROLE_ALIASES[productRole]) {
    return true;
  }
  if (productRole === 'front-or-rear' && (anchor.axleRole === 'front' || anchor.axleRole === 'rear')) {
    return true;
  }
  if (productRole === 'steer-or-drive' && (anchor.axleRole === 'steer' || anchor.axleRole === 'drive')) {
    return true;
  }
  return false;
}

/** Percentage of `base` — for positioning an anchor's cx/cy/diameter against
 *  the scene's fixed-aspect-ratio canvas (see VEHICLE_SCENE_CANVAS). */
export function scenePercent(value: number, base: number): number {
  return (value / base) * 100;
}

/**
 * CSS `background-size`/`background-position` percentages that crop a single
 * anchor's circular window out of the scene's full-canvas `fallbackUrl`
 * image, so an anchor showing a real product photo never also has the
 * generic fallback wheel visible behind/around it (they used to be two
 * separate full-canvas layers stacked on top of each other — a "tire on
 * tire" double-image look wherever the product photo didn't pixel-perfectly
 * cover the fallback's own wheel art at that same spot).
 *
 * Standard CSS crop-window derivation: for a div showing only the `2r × 2r`
 * region centered on (cx, cy) out of a `W × H` source image,
 * `background-size` must scale the full image so that `2r` source pixels
 * fill 100% of the div — i.e. `(W / 2r) * 100%` — and `background-position`
 * (a percentage resolves against `container size - background size`) must
 * pin the region's top-left corner (cx − r, cy − r) to the div's origin,
 * which reduces to `(cx − r) / (W − 2r) * 100%` (symmetric for y/H).
 */
export function fallbackWindowStyle(
  anchor: VehicleSceneAnchor,
  canvasWidth: number,
  canvasHeight: number,
): { sizeXPercent: number; sizeYPercent: number; posXPercent: number; posYPercent: number } {
  const diameter = anchor.outerRadius * 2;
  return {
    sizeXPercent: (canvasWidth / diameter) * 100,
    sizeYPercent: (canvasHeight / diameter) * 100,
    posXPercent: ((anchor.cx - anchor.outerRadius) / (canvasWidth - diameter)) * 100,
    posYPercent: ((anchor.cy - anchor.outerRadius) / (canvasHeight - diameter)) * 100,
  };
}
