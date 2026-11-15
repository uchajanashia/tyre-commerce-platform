import {
  Body,
  Controller,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { Request, Response } from "express";

import {
  MfaEnrollmentConfirmDto,
  MfaEnrollmentStartDto,
  StepUpDto,
} from "./dto/mfa.dto";
import {
  MfaEnrollmentConfirmResponseDto,
  MfaEnrollmentStartResponseDto,
  StepUpResponseDto,
} from "./dto/identity-response.dto";
import { IdentityAccessGuard, IdentityRequest } from "./identity-access.guard";
import { IDENTITY_CONFIG, IdentityConfig } from "./identity-config";
import { assertExactIdentityOrigin } from "./identity-http";
import { MfaService } from "./mfa.service";

@ApiTags("Admin MFA v1")
@Controller("admin/v1/mfa")
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  @Post("enrollment/start")
  @ApiOperation({
    operationId: "mfa.start",
    summary: "Start MFA enrollment from a supervised activation proof.",
  })
  @ApiCreatedResponse({ type: MfaEnrollmentStartResponseDto })
  start(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: MfaEnrollmentStartDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    return this.mfa.startEnrollment(dto.activationProof);
  }

  @Post("enrollment/confirm")
  @ApiOperation({
    operationId: "mfa.confirm",
    summary: "Confirm MFA enrollment and return one-time recovery codes.",
  })
  @ApiCreatedResponse({ type: MfaEnrollmentConfirmResponseDto })
  confirm(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: MfaEnrollmentConfirmDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    return this.mfa.confirmEnrollment(dto.enrollmentToken, dto.code);
  }
}

@ApiTags("Admin MFA v1")
@ApiBearerAuth()
@Controller("admin/v1/auth")
export class StepUpController {
  constructor(
    private readonly mfa: MfaService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  @Post("step-up")
  @UseGuards(IdentityAccessGuard)
  @ApiOperation({
    operationId: "step-up.step-up",
    summary: "Issue an action-bound one-time step-up proof.",
  })
  @ApiCreatedResponse({ type: StepUpResponseDto })
  stepUp(
    @Req() request: IdentityRequest & Request,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: StepUpDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    response.setHeader("Cache-Control", "no-store");
    return this.mfa.issueStepUp(
      request.user.id,
      request.user.sessionId,
      dto.requestedActionHash,
      dto.code,
    );
  }
}
