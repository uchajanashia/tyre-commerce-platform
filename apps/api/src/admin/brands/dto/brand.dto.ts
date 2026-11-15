import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

import type { CreateBrandRequest, UpdateBrandRequest } from '@tyre/shared';

export class CreateBrandDto implements CreateBrandRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;
}

export class UpdateBrandDto implements UpdateBrandRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;
}
