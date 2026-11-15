import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { VEHICLE_CLASSIFICATIONS } from "@tyre/shared";

export class OperationsQuery {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;
  @ApiPropertyOptional({ default: 25 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 25;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;
}
export class VehicleAssignmentDto {
  @ApiProperty({ enum: [...VEHICLE_CLASSIFICATIONS] })
  @IsIn([...VEHICLE_CLASSIFICATIONS])
  classification!: string;
  @ApiProperty()
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}
