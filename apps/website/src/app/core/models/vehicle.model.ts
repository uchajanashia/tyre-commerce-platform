/** Vehicle hierarchy — spec 04-data-model.md (shape unchanged, tire-oriented fitment). */

import { VehicleTireFitment } from './fitment.model';
import { VehicleVisual } from './visual.model';

export interface Make {
  id: string; // "bmw"
  name: string; // "BMW"
  logoUrl: string;
}

export type BodyType = 'sedan' | 'coupe' | 'suv' | 'hatchback' | 'wagon' | 'pickup';

export interface VehicleModel {
  id: string; // "bmw-3-series-g20"
  makeId: string;
  name: string; // "3 Series"
  /** Generation code, e.g. "G20". Wheel-Size only resolves this once a year/trim
   *  is picked, so it's absent (never fabricated) for API-sourced models until then. */
  generation?: string;
  /** Absent until known — same reasoning as `generation`. */
  yearFrom?: number;
  yearTo?: number | null; // null = current
  bodyType?: BodyType;
}

export interface VehicleTrim {
  id: string; // "bmw-3-series-g20-320i"
  modelId: string;
  name: string; // "320i"
  /** decides which tires fit */
  fitment: VehicleTireFitment;
  /** configurator asset contract (05-configurator.md) */
  visual: VehicleVisual;
}
