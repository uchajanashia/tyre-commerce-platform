import {
  Body,
  Optional,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  OperationsPageDto,
  OperationsSummaryDto,
  VehicleAssignedDto,
} from "./operations-response.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { AuthenticatedOnly, Permissions } from "../auth/permissions.decorator";
import { hasPermissionGrant } from "../auth/permission-evaluator";
import {
  auditContextFromRequest,
  AdminAuditRequest,
} from "../audit/audit-context";
import { CommerceReaderService } from "./commerce-reader.service";
import { InventoryReaderService } from "./inventory-reader.service";
import { CustomerContactReaderService } from "./customer-contact-reader.service";
import { VehicleVisualService } from "./vehicle-visual.service";
import { OperationsQuery, VehicleAssignmentDto } from "./operations.query";

import { CustomerHistoryService } from "./customer-history.service";
import { workflowsEnabled } from "./workflow-policy";

@ApiTags("Internal operations")
@Controller("admin/v1/operations")
@UseGuards(JwtAuthGuard, RolesGuard)
export class OperationsController {
  constructor(
    private readonly commerce: CommerceReaderService,
    private readonly inventory: InventoryReaderService,
    private readonly customers: CustomerContactReaderService,
    private readonly visuals: VehicleVisualService,
    @Optional() private readonly history?: CustomerHistoryService,
  ) {}

  @Get("summary")
  @Header("Cache-Control", "no-store")
  @AuthenticatedOnly()
  @ApiOkResponse({ type: OperationsSummaryDto })
  @ApiOperation({
    summary: "Permission-filtered operational summary; whole GEL amounts",
  })
  async summary(@Req() req: AdminAuditRequest) {
    const [orders, catalog] = await Promise.all([
      hasPermissionGrant(req.user.permissionGrants, "orders.read")
        ? this.commerce.summary()
        : null,
      hasPermissionGrant(req.user.permissionGrants, "catalog.read")
        ? this.inventory.summary()
        : null,
    ]);
    return { orders, catalog, updatedAt: new Date().toISOString() };
  }
  @Get("orders")
  @Header("Cache-Control", "no-store")
  @Permissions("orders.read")
  @ApiOkResponse({ type: OperationsPageDto })
  orders(@Query() query: OperationsQuery) {
    return this.commerce.orders(query);
  }
  @Get("payments")
  @Header("Cache-Control", "no-store")
  @Permissions("payments.read")
  @ApiOkResponse({ type: OperationsPageDto })
  payments(@Query() query: OperationsQuery) {
    return this.commerce.payments(query);
  }
  @Get("inventory")
  @Header("Cache-Control", "no-store")
  @Permissions("inventory.read")
  @ApiOkResponse({ type: OperationsPageDto })
  inventoryList(@Query() query: OperationsQuery) {
    return this.inventory.list(query);
  }
  @Get("vehicles")
  @Header("Cache-Control", "no-store")
  @Permissions("catalog.read")
  @ApiOkResponse({ type: OperationsPageDto })
  vehicles(@Query() query: OperationsQuery) {
    return this.inventory.list(query, true);
  }
  @Get("customers")
  @Header("Cache-Control", "no-store")
  @Permissions("orders.contacts.read")
  @ApiOkResponse({ type: OperationsPageDto })
  contacts(@Query() query: OperationsQuery, @Req() req: AdminAuditRequest) {
    return workflowsEnabled()
      ? this.history!.list(query, auditContextFromRequest(req))
      : this.customers.list(query, auditContextFromRequest(req));
  }
  @Patch("vehicles/:id")
  @Header("Cache-Control", "no-store")
  @Permissions("catalog.write")
  @ApiOkResponse({ type: VehicleAssignedDto })
  assign(
    @Param("id") id: string,
    @Body() body: VehicleAssignmentDto,
    @Req() req: AdminAuditRequest,
  ) {
    return this.visuals.assign(id, body, auditContextFromRequest(req));
  }
}
