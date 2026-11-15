import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type {
  OperationsPage,
  OperationsRow,
  OperationsSummary,
} from "@tyre/shared";
export class OperationsDetailDto {
  @ApiProperty() label!: string;
  @ApiProperty() value!: string;
}
export class OperationsRowDto implements OperationsRow {
  @ApiPropertyOptional() currency?: string;
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() subtitle!: string;
  @ApiProperty() status!: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: "Whole GEL, not minor units",
  })
  amount!: number | null;
  @ApiProperty({ type: Number, nullable: true }) quantity!: number | null;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({ type: [OperationsDetailDto] }) details!: OperationsDetailDto[];
  @ApiPropertyOptional() modelId?: string;
  @ApiPropertyOptional() classification?: string;
  @ApiPropertyOptional() fulfillmentStatus?: string;
}
export class OperationsPageDto implements OperationsPage {
  @ApiProperty({ type: [OperationsRowDto] }) items!: OperationsRowDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
export class OrdersSummaryDto {
  @ApiProperty() total!: number;
  @ApiProperty() pending!: number;
  @ApiProperty() paid!: number;
  @ApiProperty() paidAmount!: number;
}
export class CatalogSummaryDto {
  @ApiProperty() products!: number;
  @ApiProperty() unknownStock!: number;
  @ApiProperty() withoutPhotos!: number;
}
export class OperationsSummaryDto implements OperationsSummary {
  @ApiProperty({ type: OrdersSummaryDto, nullable: true })
  orders!: OrdersSummaryDto | null;
  @ApiProperty({ type: CatalogSummaryDto, nullable: true })
  catalog!: CatalogSummaryDto | null;
  @ApiProperty() updatedAt!: string;
}
export class VehicleAssignedDto {
  @ApiProperty() classification!: string;
  @ApiProperty() updatedAt!: string;
}
