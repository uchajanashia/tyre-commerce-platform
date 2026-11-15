import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class WorkflowCommandDto {
  @ApiProperty({ format: "uuid" }) @IsUUID("4") requestId!: string;
}
class ItemQuantityDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) orderItemId!: string;
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
}
export class ItemMovementDto extends WorkflowCommandDto {
  @ApiProperty({ type: [ItemQuantityDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => ItemQuantityDto)
  items!: ItemQuantityDto[];
}
export class RefundRequestDto extends WorkflowCommandDto {
  @ApiProperty({ description: "Amount in tetri", minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(10000000000)
  amountMinor!: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
export class StockCountDto extends WorkflowCommandDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  quantity!: number;
  @ApiProperty({ format: "date-time" })
  @IsDateString()
  expectedUpdatedAt!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
