import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditModule } from "../audit/audit.module";
import { CommerceReaderService } from "./commerce-reader.service";
import { InventoryReaderService } from "./inventory-reader.service";
import { CustomerContactReaderService } from "./customer-contact-reader.service";
import { VehicleVisualService } from "./vehicle-visual.service";
import { OperationsController } from "./operations.controller";

import { WorkflowCoreModule } from "./workflow-core.module";
import { CheckoutModule } from "../checkout/checkout.module";
import { WorkflowController } from "./workflow.controller";
import { WorkflowWorker } from "./workflow-worker.service";
import { RefundWorkflowService } from "./refund-workflow.service";

@Module({
  imports: [AuthModule, AuditModule, WorkflowCoreModule, CheckoutModule],
  controllers: [OperationsController, WorkflowController],
  providers: [
    WorkflowWorker,
    RefundWorkflowService,
    CommerceReaderService,
    InventoryReaderService,
    CustomerContactReaderService,
    VehicleVisualService,
  ],
})
export class OperationsModule {}
