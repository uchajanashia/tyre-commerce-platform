import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";

import { PublicAdmin } from "../auth/auth.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthenticatedOnly } from "../auth/permissions.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { LegacyAdminResponseDto } from "../common/dto/route-response.dto";

/**
 * Guarded /admin namespace. Every future admin CRUD controller lives in this
 * module behind the same JwtAuthGuard + RolesGuard chain; the public catalog
 * controllers (/products, /brands, /filters) stay unguarded and untouched.
 */
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@AuthenticatedOnly()
export class AdminController {
  /** Proves the guard chain end-to-end: returns the authenticated admin. */
  @Get("me")
  @ApiOkResponse({ type: LegacyAdminResponseDto })
  me(@Req() req: { user: PublicAdmin }): PublicAdmin {
    return req.user;
  }
}
