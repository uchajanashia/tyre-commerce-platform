import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";

import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { Permissions } from "../../auth/permissions.decorator";
import { RolesGuard } from "../../auth/roles.guard";
import {
  AdminAuditRequest,
  auditContextFromRequest,
} from "../../audit/audit-context";
import { BrandsAdminService } from "./brands-admin.service";
import { CreateBrandDto, UpdateBrandDto } from "./dto/brand.dto";
import {
  AdminBrandResponseDto,
  DeletedResponseDto,
} from "../../common/dto/route-response.dto";

/** Brand CRUD for the admin panel. The public GET /brands stays separate/untouched. */
@Controller("admin/brands")
@UseGuards(JwtAuthGuard, RolesGuard)
@Permissions("catalog.read")
export class BrandsAdminController {
  constructor(private readonly brands: BrandsAdminService) {}

  @Get()
  @ApiOkResponse({ type: [AdminBrandResponseDto] })
  list() {
    return this.brands.list();
  }

  @Post()
  @ApiCreatedResponse({ type: AdminBrandResponseDto })
  @Permissions("catalog.write")
  create(@Body() dto: CreateBrandDto, @Req() req: AdminAuditRequest) {
    return this.brands.create(dto.name, auditContextFromRequest(req));
  }

  @Patch(":id")
  @ApiOkResponse({ type: AdminBrandResponseDto })
  @Permissions("catalog.write")
  rename(
    @Param("id") id: string,
    @Body() dto: UpdateBrandDto,
    @Req() req: AdminAuditRequest,
  ) {
    return this.brands.rename(id, dto.name, auditContextFromRequest(req));
  }

  @Delete(":id")
  @ApiOkResponse({ type: DeletedResponseDto })
  @Permissions("catalog.write")
  remove(@Param("id") id: string, @Req() req: AdminAuditRequest) {
    return this.brands.remove(id, auditContextFromRequest(req));
  }
}
