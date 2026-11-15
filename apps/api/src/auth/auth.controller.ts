import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiCreatedResponse } from "@nestjs/swagger";

import {
  AdminAuditRequest,
  auditContextFromRequest,
} from "../audit/audit-context";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { LoginDto } from "./dto/login.dto";
import { AuthenticatedOnly } from "./permissions.decorator";
import { RolesGuard } from "./roles.guard";
import {
  LegacyLoginResponseDto,
  RevokedResponseDto,
} from "../common/dto/route-response.dto";

/**
 * Admin authentication. Tokens remain stateless, while the per-account
 * tokenVersion provides immediate all-session revocation without storing JWTs.
 * Admin accounts are created exclusively via scripts/create-admin.ts — no
 * public registration.
 */
@Controller("admin/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Throttled: 5 attempts per minute per IP (brute-force protection). */
  @Post("login")
  @ApiCreatedResponse({ type: LegacyLoginResponseDto })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  /** Self-service emergency logout: invalidates this token and all sibling JWTs. */
  @Post("revoke-sessions")
  @ApiCreatedResponse({ type: RevokedResponseDto })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @AuthenticatedOnly()
  revokeSessions(@Req() req: AdminAuditRequest) {
    return this.auth.revokeAllSessions(
      req.user.id,
      auditContextFromRequest(req),
    );
  }
}
