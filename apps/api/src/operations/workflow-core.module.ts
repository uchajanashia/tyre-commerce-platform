import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { StockWorkflowService } from "./stock-workflow.service";
import { CustomerHistoryService } from "./customer-history.service";
@Module({
  imports: [AuditModule],
  providers: [StockWorkflowService, CustomerHistoryService],
  exports: [StockWorkflowService, CustomerHistoryService],
})
export class WorkflowCoreModule {}
