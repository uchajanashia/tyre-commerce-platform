import { Observable } from 'rxjs';

import { Brand, Make, Season, Tire, TyreCategory, VehicleModel, VehicleTrim } from '../models';

export type CatalogSort = 'price-asc' | 'price-desc';
export type CatalogClass = 'passenger' | 'truck' | 'special' | 'disk';

/** Server-side catalog page request (maps to the API's GET /products params). */
export interface TirePageQuery {
  page: number;
  pageSize: number;
  /** Server-derived storefront journey, backed by authoritative catalog fields. */
  catalogClass?: CatalogClass;
  /** maps to the API `seasonGroup` filter */
  season?: Season;
  /** marketing tyre-type categories (multi-select, OR-combined); order preserved.
   *  Maps to the API `category` filter (comma-separated). */
  category?: TyreCategory[];
  /** brand id, maps to the API `brand` filter */
  brand?: string;
  /** section width in mm, maps to the API `width` filter */
  width?: number;
  /** aspect ratio %, maps to the API `profile` filter */
  profile?: number;
  /** rim diameter in inches, maps to the API `rimDiameter` filter */
  diameter?: number;
  /** exact full sidewall size for inch/numeric/flotation formats */
  size?: string;
  /** maps to the API `sort` (price_asc / price_desc) */
  sort?: CatalogSort;
}

/** Distinct size values present in the catalog (feeds the size-search dropdowns). */
export interface SizeFacets {
  /** section widths in mm, ascending */
  widths: number[];
  /** aspect ratios %, ascending */
  profiles: number[];
  /** rim diameters in inches, ascending */
  diameters: number[];
  /** complete manufacturer labels for inch-based sizes */
  inchSizes: string[];
}

export interface SizeFacetQuery {
  catalogClass?: CatalogClass;
  category?: TyreCategory[];
  brand?: string;
  width?: number;
  profile?: number;
  diameter?: number;
}

/** One page of catalog results + the unfiltered/filtered total for the pager. */
export interface TirePage {
  items: Tire[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Data-access abstraction (spec 02-tech-stack.md).
 *
 * The abstract class itself is the DI token; production provides the HTTP
 * implementation. Observable returns keep the contract stable for consumers.
 */
export abstract class FitmentDataService {
  abstract getMakes(): Observable<Make[]>;
  abstract getModels(makeId: string): Observable<VehicleModel[]>;
  abstract getModel(modelId: string): Observable<VehicleModel | undefined>;
  /** Available model years — the wizard step between model and trim (real
   *  vehicle data has no trim independent of a year; see HttpFitmentDataService). */
  abstract getYears(makeId: string, modelId: string): Observable<number[]>;
  abstract getTrims(makeId: string, modelId: string, year?: number): Observable<VehicleTrim[]>;
  abstract getTrim(trimId: string): Observable<VehicleTrim | undefined>;
  abstract getBrands(): Observable<Brand[]>;
  abstract getBrand(brandId: string): Observable<Brand | undefined>;
  abstract getTires(): Observable<Tire[]>;
  abstract getTire(tireId: string): Observable<Tire | undefined>;

  /** One page of the catalog from the server (catalog pagination). */
  abstract getTiresPage(query: TirePageQuery): Observable<TirePage>;
  /** Distinct rim diameters (inches) for the size filter pills, independent of paging. */
  abstract getRadiusFacets(): Observable<number[]>;
  /** Distinct width / profile / diameter lists for the size-search dropdowns. */
  abstract getSizeFacets(query?: SizeFacetQuery): Observable<SizeFacets>;
}
