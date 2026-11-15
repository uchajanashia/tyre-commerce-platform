import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Query,
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
  CreateStaffDto,
  CreateStaffPreviewDto,
  ReplaceStaffAssignmentsDto,
  ReplaceStaffAssignmentsPreviewDto,
  PreviewTargetSessionRevokeRequestDto,
  ResendStaffInvitationDto,
  RevokeTargetSessionDto,
  StaffActionDto,
  StaffActionPreviewDto,
} from "./dto/staff.dto";
import {
  StaffListQueryDto,
  TargetStaffSessionListQueryDto,
} from "./dto/identity-query.dto";
import {
  ActionHashPreviewResponseDto,
  RoleCatalogResponseDto,
  StaffAssignmentsMutationResponseDto,
  StaffAssignmentsPreviewResponseDto,
  StaffCreatePreviewResponseDto,
  StaffCreateResponseDto,
  StaffDetailResponseDto,
  StaffInvitationResendResponseDto,
  StaffListResponseDto,
  StaffMutationResponseDto,
  StaffTargetSessionPageResponseDto,
  StaffTargetSessionRevokedResponseDto,
} from "./dto/identity-response.dto";
import { IdentityAccessGuard, IdentityRequest } from "./identity-access.guard";
import { IDENTITY_CONFIG, IdentityConfig } from "./identity-config";
import { assertExactIdentityOrigin } from "./identity-http";
import { AuthenticatedOnly } from "./permissions.decorator";
import { RolesGuard } from "./roles.guard";
import { StaffAdminService } from "./staff-admin.service";

@ApiTags("Admin Staff v1")
@ApiBearerAuth()
@Controller("admin/v1/staff")
@UseGuards(IdentityAccessGuard, RolesGuard)
export class StaffAdminController {
  constructor(
    private readonly staff: StaffAdminService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  @Get()
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.list",
    summary: "List staff visible through the actor live scope grants.",
  })
  @ApiOkResponse({ type: StaffListResponseDto })
  async list(
    @Req() request: IdentityRequest,
    @Query() query: StaffListQueryDto,
  ) {
    const rows = await this.staff.list(
      request.user,
      query.cursor,
      25,
      query.status,
      query.q,
    );
    const items = rows.slice(0, 25).map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.displayName ?? undefined,
      status: row.status,
      enabled: row.enabled,
      version: row.version,
      mfaRequired: row.mfaRequired,
      mfaEnrolled: row.mfaCredentials.length > 0,
      assignments: row.roleAssignments.map(({ role, scopeType, scopeId }) => ({
        role,
        scopeType,
        scopeId,
      })),
      lastActivityAt: row.sessions[0]?.lastSeenAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    return {
      items,
      nextCursor: rows.length > 25 ? items.at(-1)?.id : undefined,
    };
  }

  @Post()
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.create",
    summary: "Create and invite a staff account after step-up verification.",
  })
  @ApiCreatedResponse({ type: StaffCreateResponseDto })
  create(
    @Req() request: IdentityRequest & Request,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() dto: CreateStaffDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.create(request.user, dto, idempotencyKey);
  }

  @Post("preview")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.preview-create",
    summary: "Preview the canonical staff creation action hash.",
  })
  @ApiCreatedResponse({ type: StaffCreatePreviewResponseDto })
  previewCreate(
    @Req() request: IdentityRequest & Request,
    @Body() dto: CreateStaffPreviewDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.previewCreate(request.user, dto);
  }

  @Get(":id")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.detail",
    summary: "Read one in-scope staff account.",
  })
  @ApiOkResponse({ type: StaffDetailResponseDto })
  detail(@Req() request: IdentityRequest, @Param("id") id: string) {
    return this.staff.detail(request.user, id);
  }

  @Post(":id/invitations/resend/preview")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.preview-resend",
    summary: "Preview an invitation resend action hash.",
  })
  @ApiCreatedResponse({ type: ActionHashPreviewResponseDto })
  previewResend(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Body() dto: StaffActionPreviewDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.previewResend(
      request.user,
      id,
      dto.expectedVersion,
      dto.reasonCode ?? "resend_requested",
      dto.reasonComment,
    );
  }

  @Post(":id/invitations/resend")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.resend",
    summary: "Reissue an invitation after CAS and step-up verification.",
  })
  @ApiCreatedResponse({ type: StaffInvitationResendResponseDto })
  resend(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() dto: ResendStaffInvitationDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.resendInvitation(request.user, id, dto, idempotencyKey);
  }

  @Get(":id/sessions")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.target-sessions",
    summary: "List sessions for an in-scope staff account.",
  })
  @ApiOkResponse({ type: StaffTargetSessionPageResponseDto })
  async targetSessions(
    @Req() request: IdentityRequest,
    @Param("id") id: string,
    @Query() query: TargetStaffSessionListQueryDto,
  ) {
    const rows = await this.staff.targetSessions(
      request.user,
      id,
      query.cursor,
      25,
    );
    return {
      items: rows.slice(0, 25),
      nextCursor: rows.length > 25 ? rows[24]?.id : undefined,
    };
  }

  @Post(":id/sessions/:sid/revoke/preview")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.preview-target-session-revoke",
    summary: "Preview a target-session revocation action hash.",
  })
  @ApiCreatedResponse({ type: ActionHashPreviewResponseDto })
  previewTargetSessionRevoke(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Param("sid") sid: string,
    @Body() dto: PreviewTargetSessionRevokeRequestDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.previewTargetSessionRevoke(
      request.user,
      id,
      sid,
      dto.expectedVersion,
    );
  }

  @Delete(":id/sessions/:sid")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.revoke-target-session",
    summary: "Revoke an in-scope staff session after step-up verification.",
  })
  @ApiOkResponse({ type: StaffTargetSessionRevokedResponseDto })
  revokeTargetSession(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Param("sid") sid: string,
    @Body() dto: RevokeTargetSessionDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.revokeTargetSession(
      request.user,
      id,
      sid,
      dto.expectedVersion,
      dto.stepUpToken,
    );
  }

  @Post(":id/activate")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.activate",
    summary: "Activate a staff account after CAS and step-up verification.",
  })
  @ApiCreatedResponse({ type: StaffMutationResponseDto })
  activate(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Body() dto: StaffActionDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.activate(
      request.user,
      id,
      dto.expectedVersion,
      dto.stepUpToken,
    );
  }

  @Post(":id/activate/preview")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.preview-activate",
    summary: "Preview a staff activation action hash.",
  })
  @ApiCreatedResponse({ type: ActionHashPreviewResponseDto })
  previewActivate(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Body() dto: StaffActionPreviewDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.previewTransition(
      request.user,
      id,
      "staff.activate",
      dto.expectedVersion,
    );
  }

  @Post(":id/disable")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.disable",
    summary: "Disable a staff account after CAS and step-up verification.",
  })
  @ApiCreatedResponse({ type: StaffMutationResponseDto })
  disable(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Body() dto: StaffActionDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.disable(
      request.user,
      id,
      dto.expectedVersion,
      dto.reasonCode,
      dto.reasonComment,
      dto.stepUpToken,
    );
  }

  @Post(":id/disable/preview")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.preview-disable",
    summary: "Preview a staff disable action hash.",
  })
  @ApiCreatedResponse({ type: ActionHashPreviewResponseDto })
  previewDisable(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Body() dto: StaffActionPreviewDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.previewTransition(
      request.user,
      id,
      "staff.disable",
      dto.expectedVersion,
      dto.reasonCode,
      dto.reasonComment,
    );
  }

  @Post(":id/reenable")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.reenable",
    summary: "Return a disabled staff account to supervised activation.",
  })
  @ApiCreatedResponse({ type: StaffMutationResponseDto })
  reenable(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Body() dto: StaffActionDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.reenable(
      request.user,
      id,
      dto.expectedVersion,
      dto.reasonCode,
      dto.reasonComment,
      dto.stepUpToken,
    );
  }

  @Post(":id/reenable/preview")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.preview-reenable",
    summary: "Preview a staff re-enable action hash.",
  })
  @ApiCreatedResponse({ type: ActionHashPreviewResponseDto })
  previewReenable(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Body() dto: StaffActionPreviewDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.previewTransition(
      request.user,
      id,
      "staff.reenable",
      dto.expectedVersion,
      dto.reasonCode,
      dto.reasonComment,
    );
  }

  @Put(":id/role-assignments")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.assignments",
    summary:
      "Replace scoped role assignments after CAS and step-up verification.",
  })
  @ApiOkResponse({ type: StaffAssignmentsMutationResponseDto })
  assignments(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Body() dto: ReplaceStaffAssignmentsDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.replaceAssignments(request.user, id, dto);
  }

  @Post(":id/role-assignments/preview")
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "staff-admin.preview-assignments",
    summary: "Preview a canonical role-assignment replacement.",
  })
  @ApiCreatedResponse({ type: StaffAssignmentsPreviewResponseDto })
  previewAssignments(
    @Req() request: IdentityRequest & Request,
    @Param("id") id: string,
    @Body() dto: ReplaceStaffAssignmentsPreviewDto,
  ) {
    assertExactIdentityOrigin(request, this.config);
    return this.staff.previewAssignments(
      request.user,
      id,
      dto.expectedVersion,
      dto.assignments,
    );
  }
}

@ApiTags("Admin Roles v1")
@ApiBearerAuth()
@Controller("admin/v1/roles")
@UseGuards(IdentityAccessGuard, RolesGuard)
export class RoleCatalogController {
  constructor(private readonly staff: StaffAdminService) {}

  @Get()
  @AuthenticatedOnly()
  @ApiOperation({
    operationId: "role-catalog.roles",
    summary: "List assignable roles and their policy state.",
  })
  @ApiOkResponse({ type: RoleCatalogResponseDto })
  async roles() {
    const roles = await this.staff.roles();
    return {
      items: roles.map((role) => ({
        id: role.id,
        key: role.key,
        name: role.name,
        description: role.description ?? undefined,
        isSystem: role.isSystem,
        permissions: role.permissions.map(({ permission }) => permission.key),
        ...this.staff.roleAssignmentPolicy(role.key),
      })),
      scopeTypes: ["global", "warehouse", "channel", "company"],
    };
  }
}
