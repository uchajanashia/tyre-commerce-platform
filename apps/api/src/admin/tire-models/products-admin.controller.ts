import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";

import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { Permissions } from "../../auth/permissions.decorator";
import { RolesGuard } from "../../auth/roles.guard";
import {
  AdminAuditRequest,
  auditContextFromRequest,
} from "../../audit/audit-context";
import { UpdateProductDto } from "./dto/tire-model.dto";
import { TireModelsAdminService } from "./tire-models-admin.service";
import {
  AdminProductResponseDto,
  DeletedResponseDto,
} from "../../common/dto/route-response.dto";

/** Single-size (Product row) edit/delete. Creation goes through the parent
 *  model (POST /admin/tire-models/:id/products); moving a product between
 *  models is deliberately not supported in this phase. */
@Controller("admin/products")
@UseGuards(JwtAuthGuard, RolesGuard)
@Permissions("catalog.write")
export class ProductsAdminController {
  constructor(private readonly models: TireModelsAdminService) {}

  @Patch(":id")
  @ApiOkResponse({ type: AdminProductResponseDto })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
    @Req() req: AdminAuditRequest,
  ) {
    return this.models.updateProduct(id, dto, auditContextFromRequest(req));
  }

  @Delete(":id")
  @ApiOkResponse({ type: DeletedResponseDto })
  remove(@Param("id") id: string, @Req() req: AdminAuditRequest) {
    return this.models.removeProduct(id, auditContextFromRequest(req));
  }
}
