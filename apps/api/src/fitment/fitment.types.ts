/** Shared shapes for the /fitment/* endpoints, independent of whether the data
 *  came from the Wheel-Size API, the Postgres cache, or FITMENT_MOCK data. */

export interface FitmentMake {
  slug: string;
  name: string;
}

export interface FitmentModel {
  slug: string;
  name: string;
}

/** Section width / aspect ratio / rim diameter — mirrors the website's TireSize contract. */
export interface FitmentTireSize {
  widthMm?: number;
  aspect?: number;
  rimDiameterInch: number;
  raw: string;
}

export interface FitmentOemByRim {
  rimDiameterInch: number;
  front: FitmentTireSize;
  rear?: FitmentTireSize;
}

export interface FitmentTrim {
  /** URL-safe identifier for this trim, unique within (make, model, year). */
  trimSlug: string;
  trimName: string;
  rimDiametersInch: number[];
  oemBySize: FitmentOemByRim[];
  staggered: boolean;
  minLoadIndex: number;
  oemSpeedRating: string;
}

export interface FitmentLookupResult {
  make: string;
  model: string;
  year: number;
  trims: FitmentTrim[];
}
