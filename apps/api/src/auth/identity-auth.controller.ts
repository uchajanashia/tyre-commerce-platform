import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from "@nestjs/swagger";
import type { Request, Response } from "express";

import {
  CompleteMfaChallengeDto,
  IdentityLoginDto,
} from "./dto/identity-auth.dto";
import { IdentitySessionListQueryDto } from "./dto/identity-query.dto";
import { IdentityAccessGuard, IdentityRequest } from "./identity-access.guard";
import { IdentityAuthService } from "./identity-auth.service";
import { IDENTITY_CONFIG, IdentityConfig } from "./identity-config";
import {
  assertExactIdentityOrigin,
  readCookie,
  refreshCookieName,
  refreshCookieOptions,
} from "./identity-http";
import { StaffSessionService } from "./staff-session.service";
import { RevokeAllDto } from "./dto/mfa.dto";
import {
  IdentityAuthenticatedLoginResponseDto,
  IdentityCompleteMfaResponseDto,
  IdentityCsrfResponseDto,
  IdentityMfaRequiredLoginResponseDto,
  IdentityRefreshResponseDto,
  IdentityRevokedResponseDto,
  IdentitySessionPageResponseDto,
  IdentitySessionRevocationResponseDto,
  IdentityStaffProjectionResponseDto,
} from "./dto/identity-response.dto";

@ApiTags("Admin Identity v1")
@ApiExtraModels(
  IdentityLoginDto,
  CompleteMfaChallengeDto,
  IdentityAuthenticatedLoginResponseDto,
  IdentityMfaRequiredLoginResponseDto,
)
@Controller("admin/v1/auth")
export class IdentityAuthController {
  constructor(
    private readonly identity: IdentityAuthService,
    private readonly sessions: StaffSessionService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  @Post("login")
  @HttpCode(200)
  @ApiOperation({
    operationId: "identity-auth.login",
    summary:
      "Password login; returns an authenticated or MFA-required discriminated union.",
  })
  @ApiOkResponse({
    description:
      "Refresh cookie is fixation-cleared and set only after full authentication.",
    schema: {
      oneOf: [
        { $ref: getSchemaPath(IdentityAuthenticatedLoginResponseDto) },
        { $ref: getSchemaPath(IdentityMfaRequiredLoginResponseDto) },
      ],
      discriminator: { propertyName: "status" },
    },
  })
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: IdentityLoginDto,
  ) {
    this.identity.assertEnabled();
    assertExactIdentityOrigin(request, this.config);
    this.clearRefreshCookie(response);
    const result = await this.identity.login(
      dto.email,
      dto.password,
      request.ip,
    );
    response.setHeader("Cache-Control", "no-store");
    if (result.status === "mfa_required") return result;
    this.setRefreshCookie(response, result.refreshToken);
    const { refreshToken: _secret, ...body } = result;
    return body;
  }

  @Post("mfa/challenge")
  @HttpCode(200)
  @ApiOperation({
    operationId: "identity-auth.complete-mfa",
    summary: "Complete the login MFA challenge.",
  })
  @ApiOkResponse({ type: IdentityCompleteMfaResponseDto })
  async completeMfa(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: CompleteMfaChallengeDto,
  ) {
    this.identity.assertEnabled();
    assertExactIdentityOrigin(request, this.config);
    this.clearRefreshCookie(response);
    const result = await this.identity.completeLoginMfa(
      dto.challengeToken,
      dto.code,
      request.ip,
    );
    this.setRefreshCookie(response, result.refreshToken);
    response.setHeader("Cache-Control", "no-store");
    const { refreshToken: _secret, ...body } = result;
    return body;
  }

  @Get("csrf")
  @ApiCookieAuth()
  @ApiOperation({
    operationId: "identity-auth.csrf",
    summary: "Issue a refresh-session-bound CSRF proof.",
  })
  @ApiOkResponse({ type: IdentityCsrfResponseDto })
  async csrf(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.identity.assertEnabled();
    assertExactIdentityOrigin(request, this.config);
    const refresh = this.refreshCookie(request);
    if (!refresh) throw new UnauthorizedException({ code: "INVALID_SESSION" });
    response.setHeader("Cache-Control", "no-store");
    return { csrfToken: await this.sessions.csrfProof(refresh) };
  }

  @Post("refresh")
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOperation({
    operationId: "identity-auth.refresh",
    summary: "Rotate the refresh token and issue a new access token.",
  })
  @ApiOkResponse({ type: IdentityRefreshResponseDto })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.identity.assertEnabled();
    assertExactIdentityOrigin(request, this.config);
    const refresh = this.refreshCookie(request);
    const csrf = this.header(request, "x-csrf-token");
    if (!refresh || !csrf) {
      this.clearRefreshCookie(response);
      throw new UnauthorizedException({ code: "INVALID_SESSION" });
    }
    try {
      const rotated = await this.sessions.rotate(refresh, csrf);
      this.setRefreshCookie(response, rotated.refreshToken);
      response.setHeader("Cache-Control", "no-store");
      return {
        accessToken: rotated.accessToken,
        accessExpiresAt: rotated.accessExpiresAt,
        rotationResult: rotated.rotationResult,
        staff: await this.identity.staffInfoFromSession(rotated.sessionId),
      };
    } catch (error) {
      this.clearRefreshCookie(response);
      throw error;
    }
  }

  @Post("logout")
  @HttpCode(200)
  @ApiOperation({
    operationId: "identity-auth.logout",
    summary: "Revoke the current refresh session.",
  })
  @ApiOkResponse({ type: IdentityRevokedResponseDto })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.identity.assertEnabled();
    assertExactIdentityOrigin(request, this.config);
    const refresh = this.refreshCookie(request);
    const csrf = this.header(request, "x-csrf-token");
    try {
      if (!refresh || !csrf)
        throw new UnauthorizedException({ code: "INVALID_SESSION" });
      await this.sessions.revokeByRefresh(refresh, csrf);
      return { revoked: true };
    } finally {
      this.clearRefreshCookie(response);
    }
  }

  @Get("me")
  @UseGuards(IdentityAccessGuard)
  @ApiOperation({
    operationId: "identity-auth.me",
    summary: "Return the current staff security projection.",
  })
  @ApiOkResponse({ type: IdentityStaffProjectionResponseDto })
  me(@Req() request: IdentityRequest) {
    return request.user;
  }

  @Get("sessions")
  @UseGuards(IdentityAccessGuard)
  @ApiOperation({
    operationId: "identity-auth.list-sessions",
    summary: "List the current staff member sessions.",
  })
  @ApiOkResponse({ type: IdentitySessionPageResponseDto })
  async listSessions(
    @Req() request: IdentityRequest,
    @Query() query: IdentitySessionListQueryDto,
  ) {
    const rows = await this.sessions.list(request.user.id, query.cursor, 25);
    const items = rows.slice(0, 25).map((row) => ({
      ...row,
      current: row.id === request.user.sessionId,
      revokedAt: row.revokedAt ?? undefined,
      deviceLabel: row.deviceLabel ?? undefined,
      browserFamily: row.browserFamily ?? undefined,
      osFamily: row.osFamily ?? undefined,
      mfaSatisfiedAt: row.mfaSatisfiedAt ?? undefined,
    }));
    return {
      items,
      nextCursor: rows.length > 25 ? items.at(-1)?.id : undefined,
      currentSessionId: request.user.sessionId,
    };
  }

  @Delete("sessions/:id")
  @UseGuards(IdentityAccessGuard)
  @ApiOperation({
    operationId: "identity-auth.revoke-session",
    summary: "Revoke one session owned by the current staff member.",
  })
  @ApiOkResponse({ type: IdentitySessionRevocationResponseDto })
  async revokeSession(
    @Req() request: IdentityRequest & Request,
    @Res({ passthrough: true }) response: Response,
    @Param("id") id: string,
  ) {
    assertExactIdentityOrigin(request, this.config);
    const refresh = this.refreshCookie(request);
    const csrf = this.header(request, "x-csrf-token");
    if (!refresh || !csrf)
      throw new UnauthorizedException({ code: "INVALID_SESSION" });
    await this.sessions.assertRefreshProofForSession(
      refresh,
      csrf,
      request.user.id,
      request.user.sessionId,
    );
    const revoked = await this.sessions.revokeSession(request.user.id, id);
    if (revoked && id === request.user.sessionId)
      this.clearRefreshCookie(response);
    return { revoked };
  }

  @Post("revoke-all")
  @UseGuards(IdentityAccessGuard)
  @ApiOperation({
    operationId: "identity-auth.revoke-all",
    summary: "Revoke all sessions after step-up verification.",
  })
  @ApiCreatedResponse({ type: IdentityRevokedResponseDto })
  async revokeAll(
    @Req() request: IdentityRequest & Request,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: RevokeAllDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    const refresh = this.refreshCookie(request);
    const csrf = this.header(request, "x-csrf-token");
    if (!refresh || !csrf)
      throw new UnauthorizedException({ code: "INVALID_SESSION" });
    await this.sessions.assertRefreshProofForSession(
      refresh,
      csrf,
      request.user.id,
      request.user.sessionId,
    );
    const result = await this.identity.revokeAllWithStepUp(
      request.user,
      dto.stepUpToken,
    );
    this.clearRefreshCookie(response);
    return result;
  }

  private refreshCookie(request: Request): string | undefined {
    return readCookie(request, refreshCookieName(this.config));
  }
  private setRefreshCookie(response: Response, value: string): void {
    response.cookie(refreshCookieName(this.config), value, {
      ...refreshCookieOptions(this.config),
      maxAge: this.config.refreshAbsoluteSeconds * 1000,
    });
  }
  private clearRefreshCookie(response: Response): void {
    response.cookie(refreshCookieName(this.config), "", {
      ...refreshCookieOptions(this.config),
      expires: new Date(0),
      maxAge: 0,
    });
  }
  private header(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
