import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Query params for GET /fitment/lookup. */
export class LookupFitmentQuery {
  @IsString()
  make!: string;

  @IsString()
  model!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  year!: number;

  @IsOptional()
  @IsString()
  trim?: string;
}
