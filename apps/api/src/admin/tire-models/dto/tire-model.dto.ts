import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import type { CreateProductRequest, CreateTireModelRequest, UpdateTireModelRequest } from '@tyre/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListTireModelsQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize = 20;

  /** Brand slug (Brand.id). */
  @IsOptional()
  @IsString()
  brand?: string;

  /** Case-insensitive name search. */
  @IsOptional()
  @IsString()
  q?: string;

  /** Photo-status filter for the adminka Photos view. */
  @IsOptional()
  @IsIn(['with', 'without'])
  photos?: 'with' | 'without';
}

export class CreateTireModelDto implements CreateTireModelRequest {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  brandId!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

export class UpdateTireModelDto implements UpdateTireModelRequest {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

export class CreateProductDto implements CreateProductRequest {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  width!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  profile?: number | null;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  rimDiameter!: number;

  @IsBoolean()
  commercial!: boolean;

  @IsIn(['radial', 'bias'])
  construction!: 'radial' | 'bias';

  @IsIn(['passenger', 'truck'])
  vehicleClass!: 'passenger' | 'truck';

  @IsOptional()
  @IsIn(['tire', 'disk'])
  productType?: 'tire' | 'disk';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  season?: string | null;

  @IsOptional()
  @IsIn(['summer', 'all_season', 'winter'])
  seasonGroup?: 'summer' | 'all_season' | 'winter' | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  loadSpeedIndex?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  plyRating?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  treadType?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  overallDiameter?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  country?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  retailPrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  wholesalePrice!: number;

  @IsOptional()
  @IsIn(['in_stock', 'limited', 'out_of_stock'])
  stockStatus?: 'in_stock' | 'limited' | 'out_of_stock';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQty?: number | null;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  size?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  application?: string;
}

/** All CreateProductDto fields optional except `code` (immutable SKU). */
export class UpdateProductDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  profile?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  rimDiameter?: number;

  @IsOptional()
  @IsBoolean()
  commercial?: boolean;

  @IsOptional()
  @IsIn(['radial', 'bias'])
  construction?: 'radial' | 'bias';

  @IsOptional()
  @IsIn(['passenger', 'truck'])
  vehicleClass?: 'passenger' | 'truck';

  @IsOptional()
  @IsIn(['tire', 'disk'])
  productType?: 'tire' | 'disk';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  season?: string | null;

  @IsOptional()
  @IsIn(['summer', 'all_season', 'winter'])
  seasonGroup?: 'summer' | 'all_season' | 'winter' | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  loadSpeedIndex?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  plyRating?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  treadType?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  overallDiameter?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  country?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  retailPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  wholesalePrice?: number;

  @IsOptional()
  @IsIn(['in_stock', 'limited', 'out_of_stock'])
  stockStatus?: 'in_stock' | 'limited' | 'out_of_stock';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQty?: number | null;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  size?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  application?: string;
}
