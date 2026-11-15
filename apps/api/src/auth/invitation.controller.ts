import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { Request, Response } from "express";

import {
  AcceptInvitationDto,
  CompletePasswordResetDto,
  OneTimeTokenDto,
  PasswordResetRequestDto,
} from "./dto/invitation.dto";
import {
  InvitationAcceptResponseDto,
  InvitationInspectResponseDto,
  PasswordResetAcceptedResponseDto,
  PasswordResetCompletedResponseDto,
} from "./dto/identity-response.dto";
import { IDENTITY_CONFIG, IdentityConfig } from "./identity-config";
import { assertExactIdentityOrigin } from "./identity-http";
import { InvitationService } from "./invitation.service";

@ApiTags("Admin Invitations v1")
@Controller("admin/v1/invitations")
export class InvitationController {
  constructor(
    private readonly invitations: InvitationService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  @Post("inspect")
  @HttpCode(200)
  @ApiOperation({
    operationId: "invitation.inspect",
    summary: "Inspect a one-time invitation without consuming it.",
  })
  @ApiOkResponse({ type: InvitationInspectResponseDto })
  inspect(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: OneTimeTokenDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    return this.invitations.inspect(dto.token);
  }

  @Post("accept")
  @HttpCode(200)
  @ApiOperation({
    operationId: "invitation.accept",
    summary: "Consumes a one-time invite from a fragment-to-body landing page.",
  })
  @ApiOkResponse({ type: InvitationAcceptResponseDto })
  accept(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: AcceptInvitationDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    return this.invitations.acceptInvite(dto.token, dto.password);
  }
}

@ApiTags("Admin Password Reset v1")
@Controller("admin/v1/auth/password-reset")
export class PasswordResetController {
  constructor(
    private readonly invitations: InvitationService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  @Post("request")
  @HttpCode(202)
  @ApiOperation({
    operationId: "password-reset.request",
    summary: "Return a non-enumerating password-reset admission result.",
  })
  @ApiAcceptedResponse({ type: PasswordResetAcceptedResponseDto })
  request(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: PasswordResetRequestDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    response.setHeader("Cache-Control", "no-store");
    return this.invitations.requestPasswordReset(dto.email, request.ip);
  }

  @Post("complete")
  @HttpCode(200)
  @ApiOperation({
    operationId: "password-reset.complete",
    summary: "Consume a password-reset token and revoke prior sessions.",
  })
  @ApiOkResponse({ type: PasswordResetCompletedResponseDto })
  complete(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: CompletePasswordResetDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    return this.invitations.completePasswordReset(dto.token, dto.newPassword);
  }
}
