import { ApiProperty } from "@nestjs/swagger";
import type {
  OrderWorkflow,
  WorkflowConfig,
  StockHistory,
  WorkflowItem,
  WorkflowRefund,
} from "@tyre/shared";
export class WorkflowConfigDto implements WorkflowConfig {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() refundsEnabled!: boolean;
  @ApiProperty() warehouse!: string;
}
export class WorkflowItemDto implements WorkflowItem {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() issued!: number;
  @ApiProperty() returned!: number;
}
export class WorkflowRefundDto implements WorkflowRefund {
  @ApiProperty() id!: string;
  @ApiProperty({ description: "Tetri" }) amountMinor!: number;
  @ApiProperty() state!: string;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class OrderWorkflowDto implements OrderWorkflow {
  @ApiProperty() id!: string;
  @ApiProperty() paymentStatus!: string;
  @ApiProperty() fulfillmentStatus!: string;
  @ApiProperty({ description: "Tetri" }) totalMinor!: number;
  @ApiProperty({ description: "Tetri" }) refundedMinor!: number;
  @ApiProperty({ description: "Tetri" }) refundableMinor!: number;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  expiresAt!: string | null;
  @ApiProperty({ type: [WorkflowItemDto] }) items!: WorkflowItemDto[];
  @ApiProperty({ type: [WorkflowRefundDto] }) refunds!: WorkflowRefundDto[];
}
export class StockHistoryDto implements StockHistory {
  @ApiProperty() id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() onHandDelta!: number;
  @ApiProperty() reservedDelta!: number;
  @ApiProperty() onHandAfter!: number;
  @ApiProperty() reservedAfter!: number;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
}
export class WorkflowSavedDto {
  @ApiProperty() ok!: boolean;
}
export class RefundQueuedDto {
  @ApiProperty() id!: string;
  @ApiProperty() state!: string;
}
