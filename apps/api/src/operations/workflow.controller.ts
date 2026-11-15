import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOkResponse, ApiCreatedResponse } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { AuthenticatedOnly, Permissions } from "../auth/permissions.decorator";
import {
  AdminAuditRequest,
  auditContextFromRequest,
} from "../audit/audit-context";
import { PrismaService } from "../prisma/prisma.service";
import { StockWorkflowService } from "./stock-workflow.service";
import {
  RefundWorkflowService,
  refundBudget,
  refundsEnabled,
} from "./refund-workflow.service";
import { CustomerHistoryService } from "./customer-history.service";
import { OperationsQuery } from "./operations.query";
import {
  ItemMovementDto,
  RefundRequestDto,
  StockCountDto,
  WorkflowCommandDto,
} from "./workflow.dto";
import { requireWorkflows, workflowsEnabled } from "./workflow-policy";
import { OrderWorkflow, StockHistory, WorkflowConfig } from "@tyre/shared";

import {
  WorkflowConfigDto,
  OrderWorkflowDto,
  StockHistoryDto,
  WorkflowSavedDto,
  RefundQueuedDto,
} from "./workflow-response.dto";
import { OperationsPageDto } from "./operations-response.dto";

@ApiTags("Internal operations")
@Controller("admin/v1/operations")
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkflowController {
  constructor(
    private readonly db: PrismaService,
    private readonly stock: StockWorkflowService,
    private readonly refunds: RefundWorkflowService,
    private readonly customers: CustomerHistoryService,
  ) {}
  @ApiOkResponse({ type: WorkflowConfigDto })
  @Get("config")
  @Header("Cache-Control", "no-store")
  @AuthenticatedOnly()
  config(): WorkflowConfig {
    return {
      enabled: workflowsEnabled(),
      refundsEnabled: refundsEnabled(),
      warehouse: "მთავარი საწყობი",
    };
  }
  @ApiOkResponse({ type: OrderWorkflowDto })
  @Get("orders/:id/workflow")
  @Header("Cache-Control", "no-store")
  @Permissions("orders.read")
  async order(@Param("id") id: string): Promise<OrderWorkflow> {
    requireWorkflows();
    return this.db.$transaction(async (tx) => {
      const order = await this.stock.lockOrder(tx, id);
      return {
        id,
        paymentStatus: order.status,
        fulfillmentStatus: order.fulfillmentStatus,
        totalMinor: order.total * 100,
        refundedMinor: Number(order.refundedMinor),
        refundableMinor: Math.max(
          0,
          refundBudget(order.total, order.refundedMinor, order.refunds),
        ),
        expiresAt: order.reservationExpiresAt?.toISOString() ?? null,
        items: order.items.map((i) => ({
          id: i.id,
          name: i.productName,
          code: i.productCode,
          quantity: i.quantity,
          issued: i.issuedQty,
          returned: i.returnedQty,
        })),
        refunds: order.refunds.map((r) => ({
          id: r.id,
          amountMinor: Number(r.amountMinor),
          state: r.state,
          reason: r.reason,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    });
  }
  @ApiCreatedResponse({ type: WorkflowSavedDto })
  @Post("orders/:id/allocate")
  @Header("Cache-Control", "no-store")
  @Permissions("orders.fulfill")
  allocate(
    @Param("id") id: string,
    @Body() dto: WorkflowCommandDto,
    @Req() req: AdminAuditRequest,
  ) {
    return this.stock.allocate(id, dto.requestId, auditContextFromRequest(req));
  }
  @ApiCreatedResponse({ type: WorkflowSavedDto })
  @Post("orders/:id/issue")
  @Header("Cache-Control", "no-store")
  @Permissions("orders.fulfill")
  issue(
    @Param("id") id: string,
    @Body() dto: ItemMovementDto,
    @Req() req: AdminAuditRequest,
  ) {
    return this.stock.move(
      id,
      dto.requestId,
      dto.items,
      "issue",
      auditContextFromRequest(req),
    );
  }
  @ApiCreatedResponse({ type: WorkflowSavedDto })
  @Post("orders/:id/return")
  @Header("Cache-Control", "no-store")
  @Permissions("orders.fulfill")
  returnGoods(
    @Param("id") id: string,
    @Body() dto: ItemMovementDto,
    @Req() req: AdminAuditRequest,
  ) {
    return this.stock.move(
      id,
      dto.requestId,
      dto.items,
      "return",
      auditContextFromRequest(req),
    );
  }
  @ApiCreatedResponse({ type: RefundQueuedDto })
  @Post("orders/:id/refunds")
  @Header("Cache-Control", "no-store")
  @Roles("admin")
  @Permissions("payments.refund")
  refund(
    @Param("id") id: string,
    @Body() dto: RefundRequestDto,
    @Req() req: AdminAuditRequest,
  ) {
    return this.refunds.request(
      id,
      dto.requestId,
      dto.amountMinor,
      dto.reason,
      auditContextFromRequest(req),
    );
  }
  @ApiCreatedResponse({ type: WorkflowSavedDto })
  @Post("inventory/:id/count")
  @Header("Cache-Control", "no-store")
  @Permissions("inventory.write")
  count(
    @Param("id") id: string,
    @Body() dto: StockCountDto,
    @Req() req: AdminAuditRequest,
  ) {
    return this.stock.count(
      id,
      dto.quantity,
      dto.expectedUpdatedAt,
      dto.requestId,
      dto.reason,
      auditContextFromRequest(req),
    );
  }
  @ApiOkResponse({ type: [StockHistoryDto] })
  @Get("inventory/:id/history")
  @Header("Cache-Control", "no-store")
  @Permissions("inventory.read")
  async movements(
    @Param("id") id: string,
    @Query() query: OperationsQuery,
  ): Promise<StockHistory[]> {
    requireWorkflows();
    const rows = await this.db.stockMovement.findMany({
      where: { productId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      onHandDelta: r.onHandDelta,
      reservedDelta: r.reservedDelta,
      onHandAfter: r.onHandAfter,
      reservedAfter: r.reservedAfter,
      createdAt: r.createdAt.toISOString(),
    }));
  }
  @ApiOkResponse({ type: OperationsPageDto })
  @Get("customers/:id/history")
  @Header("Cache-Control", "no-store")
  @Permissions("orders.contacts.read", "orders.read")
  history(
    @Param("id") id: string,
    @Query() query: OperationsQuery,
    @Req() req: AdminAuditRequest,
  ) {
    return this.customers.history(id, query, auditContextFromRequest(req));
  }
}
