import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { Request } from "express";

import {
  ApproveRecoveryRequestDto,
  CreateRecoveryRequestDto,
  RecoveryRequestPreviewDto,
} from "./dto/recovery.dto";
import {
  RecoveryApprovedResponseDto,
  RecoveryApprovalPreviewResponseDto,
  RecoveryRequestCreatedResponseDto,
  RecoveryRequestPreviewResponseDto,
} from "./dto/identity-response.dto";
import { IdentityAccessGuard, IdentityRequest } from "./identity-access.guard";
import { IDENTITY_CONFIG, IdentityConfig } from "./identity-config";
import { assertExactIdentityOrigin } from "./identity-http";
import { AuthenticatedOnly } from "./permissions.decorator";
import { RecoveryService } from "./recovery.service";
import { RolesGuard } from "./roles.guard";

@ApiTags("Admin Recovery v1")
@ApiBearerAuth()
@Controller("admin/v1")
@UseGuards(IdentityAccessGuard, RolesGuard)
export class RecoveryController {
  constructor(
    private readonly recovery: RecoveryService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  @Post("staff/:id/recovery-requests")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "recovery.request",
    summary: "Create a dual-control staff recovery request.",
  })
  @ApiCreatedResponse({ type: RecoveryRequestCreatedResponseDto })
  request(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Body() dto: CreateRecoveryRequestDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.recovery.request(
      request.user,
      id,
      dto.reasonCode,
      dto.reasonComment,
      dto.stepUpToken,
    );
  }

  @Post("staff/:id/recovery-requests/preview")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "recovery.preview-request",
    summary: "Preview a staff recovery request and its immutable snapshots.",
  })
  @ApiCreatedResponse({ type: RecoveryRequestPreviewResponseDto })
  previewRequest(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Body() dto: RecoveryRequestPreviewDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.recovery.previewRequest(
      request.user,
      id,
      dto.reasonCode,
      dto.reasonComment,
    );
  }

  @Post("recovery-requests/:id/approve")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "recovery.approve",
    summary: "Approve and execute an eligible dual-control recovery request.",
  })
  @ApiCreatedResponse({ type: RecoveryApprovedResponseDto })
  approve(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Body() dto: ApproveRecoveryRequestDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.recovery.approve(request.user, id, dto.stepUpToken);
  }

  @Get("recovery-requests/:id/approval-preview")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "recovery.preview-approval",
    summary: "Preview a recovery approval action hash.",
  })
  @ApiOkResponse({ type: RecoveryApprovalPreviewResponseDto })
  previewApproval(@Req() request: IdentityRequest, @Param("id") id: string) {
    return this.recovery.previewApproval(request.user, id);
  }
}
