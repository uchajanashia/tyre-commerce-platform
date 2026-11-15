import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { CATALOG_CLASSES, type CatalogClass } from '../catalog-classification';

/** The 7 tyre-type category keys (see CATEGORY_TO_SEASON in products.service.ts). */
export const CATEGORY_KEYS = ['summer', 'all_season', 'winter_at', 'ms', 'ht', 'at', 'mt'] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

/** Coerce a query value to a finite number, or `undefined` for missing/garbage. */
function toFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** As {@link toFiniteNumber}, but only whole numbers survive (others → undefined). */
function toFiniteInt(value: unknown): number | undefined {
  const n = toFiniteNumber(value);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

/**
 * Query params for GET /products. Validated by the global ValidationPipe
 * (transform + whitelist), so unknown params are stripped and bad values 400
 * rather than crashing.
 */
export class ListProductsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 24;

  @IsOptional()
  @IsIn(['passenger', 'truck'])
  vehicleClass?: 'passenger' | 'truck';

  /** Storefront journey. Derived from real product fields; defaults in the UI. */
  @IsOptional()
  @IsIn([...CATALOG_CLASSES])
  catalogClass?: CatalogClass;

  @IsOptional()
  @IsIn(['tire', 'disk'])
  productType?: 'tire' | 'disk';

  @IsOptional()
  @IsIn(['summer', 'all_season', 'winter'])
  seasonGroup?: 'summer' | 'all_season' | 'winter';

  /**
   * Marketing tyre-type category (spec: catalog filter) — MULTI-select, OR-combined.
   * Accepts a comma-separated list, e.g. `?category=summer,ms`. Each key maps to a
   * raw `season` string via CATEGORY_TO_SEASON (products.service.ts). Order is
   * preserved (the frontend's "first-selected drives the theme"), though the query
   * itself is order-independent.
   */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((v) => v.trim()).filter(Boolean)
      : value,
  )
  @IsArray()
  @IsIn([...CATEGORY_KEYS], { each: true })
  category?: CategoryKey[];

  @IsOptional()
  @IsString()
  radius?: string;

  /**
   * Size search (exact-match). Each is applied only when a valid number is given;
   * garbage values coerce to `undefined` and are ignored rather than 400-ing.
   */
  // Section width, e.g. 205 (Float — fractional truck widths like 11.75 exist).
  @IsOptional()
  @Transform(({ value }) => toFiniteNumber(value))
  @IsNumber()
  width?: number;

  // Aspect ratio, e.g. 55 (Int; null on many commercial/truck rows).
  @IsOptional()
  @Transform(({ value }) => toFiniteInt(value))
  @IsInt()
  profile?: number;

  // Rim diameter in inches, e.g. 16 (Float — 19.5 / 22.5 exist). Numeric form of
  // the `radius` label, used by the size-search dropdown.
  @IsOptional()
  @Transform(({ value }) => toFiniteNumber(value))
  @IsNumber()
  rimDiameter?: number;

  /** Exact manufacturer/sidewall size, used by the inch-size picker. */
  @IsOptional()
  @IsString()
  size?: string;

  /** Brand id (slug) or brand name. */
  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === true || value === 'true'))
  @IsBoolean()
  commercial?: boolean;

  /** Free-text search across name / size / brand. */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['price_asc', 'price_desc'])
  sort?: 'price_asc' | 'price_desc';
}

/** Scope for live size facets. Every field is optional and exact-match. */
export class SizeFacetsQuery {
  @IsOptional()
  @IsIn([...CATALOG_CLASSES])
  catalogClass?: CatalogClass;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.split(',').map((v) => v.trim()).filter(Boolean)
      : value,
  )
  @IsArray()
  @IsIn([...CATEGORY_KEYS], { each: true })
  category?: CategoryKey[];

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @Transform(({ value }) => toFiniteNumber(value))
  @IsNumber()
  width?: number;

  @IsOptional()
  @Transform(({ value }) => toFiniteInt(value))
  @IsInt()
  profile?: number;

  @IsOptional()
  @Transform(({ value }) => toFiniteNumber(value))
  @IsNumber()
  rimDiameter?: number;
}
