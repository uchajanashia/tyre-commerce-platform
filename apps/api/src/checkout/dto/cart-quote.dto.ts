import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CartQuoteLineDto {
  @IsString()
  @MaxLength(64)
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  quantity!: number;
}

export class CartQuoteRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => CartQuoteLineDto)
  items!: CartQuoteLineDto[];
}
