import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import {
  CreateProductDto,
  CreateTireModelDto,
  ListTireModelsQuery,
  UpdateTireModelDto,
} from "./dto/tire-model.dto";
import { TireModelsAdminService } from "./tire-models-admin.service";
import {
  AdminProductResponseDto,
  AdminTireModelDetailResponseDto,
  AdminTireModelListItemResponseDto,
  AdminTireModelListResponseDto,
  DeletedResponseDto,
} from "../../common/dto/route-response.dto";

/** Tire-model CRUD + size creation. Size edit/delete live on /admin/products. */
@Controller("admin/tire-models")
@UseGuards(JwtAuthGuard, RolesGuard)
@Permissions("catalog.read")
export class TireModelsAdminController {
  constructor(private readonly models: TireModelsAdminService) {}

  @Get()
  @ApiOkResponse({ type: AdminTireModelListResponseDto })
  list(@Query() query: ListTireModelsQuery) {
    return this.models.list(query);
  }

  @Get(":id")
  @ApiOkResponse({ type: AdminTireModelDetailResponseDto })
  detail(@Param("id") id: string) {
    return this.models.detail(id);
  }

  @Post()
  @ApiCreatedResponse({ type: AdminTireModelListItemResponseDto })
  @Permissions("catalog.write")
  create(@Body() dto: CreateTireModelDto, @Req() req: AdminAuditRequest) {
    return this.models.createModel(dto, auditContextFromRequest(req));
  }

  @Patch(":id")
  @ApiOkResponse({ type: AdminTireModelListItemResponseDto })
  @Permissions("catalog.write")
  rename(
    @Param("id") id: string,
    @Body() dto: UpdateTireModelDto,
    @Req() req: AdminAuditRequest,
  ) {
    return this.models.renameModel(id, dto, auditContextFromRequest(req));
  }

  @Delete(":id")
  @ApiOkResponse({ type: DeletedResponseDto })
  @Permissions("catalog.write")
  remove(@Param("id") id: string, @Req() req: AdminAuditRequest) {
    return this.models.removeModel(id, auditContextFromRequest(req));
  }

  @Post(":id/products")
  @ApiCreatedResponse({ type: AdminProductResponseDto })
  @Permissions("catalog.write")
  createProduct(
    @Param("id") id: string,
    @Body() dto: CreateProductDto,
    @Req() req: AdminAuditRequest,
  ) {
    return this.models.createProduct(id, dto, auditContextFromRequest(req));
  }
}
