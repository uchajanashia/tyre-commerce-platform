import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  PermissionScopeType,
  Prisma,
  StaffAccountStatus,
} from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { commandHash } from "./identity-command";
import { normalizeStaffEmail } from "./identity-crypto";
import { keyedDigest } from "./identity-crypto";
import { InvitationService } from "./invitation.service";
import { MfaService } from "./mfa.service";
import { IDENTITY_CONFIG, IdentityConfig } from "./identity-config";
import { PermissionGrant } from "./permission-evaluator";
import { assertTargetScope, canTargetScope } from "./target-scope-policy";

export interface StaffAssignmentInput {
  roleId: string;
  scopeType: PermissionScopeType;
  scopeId: string;
}

interface StaffActor {
  id: string;
  email: string;
  sessionId: string;
  permissionGrants: PermissionGrant[];
}

@Injectable()
export class StaffAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  async list(
    actor: StaffActor,
    cursor?: string,
    take = 25,
    status?: StaffAccountStatus,
    q?: string,
  ) {
    const bounded = Math.max(1, Math.min(take, 50));
    const query = this.normalizeSearchQuery(q);
    const where: Prisma.AdminWhereInput = {
      ...(status ? { status } : {}),
      ...(query
        ? { OR: [{ id: query }, { emailNormalized: { contains: query } }] }
        : {}),
    };
    if (cursor) {
      this.assertCursor(cursor);
      const cursorTarget = await this.prisma.admin.findFirst({
        where: { AND: [where, { id: cursor }] },
        select: { roleAssignments: true },
      });
      if (
        !cursorTarget ||
        !canTargetScope(actor, "staff.read", cursorTarget.roleAssignments)
      ) {
        throw new BadRequestException({ code: "INVALID_CURSOR" });
      }
    }
    return this.prisma.admin
      .findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 201,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          enabled: true,
          version: true,
          mfaRequired: true,
          createdAt: true,
          updatedAt: true,
          mfaCredentials: {
            where: { status: "confirmed" },
            select: { id: true },
          },
          roleAssignments: {
            include: { role: { select: { id: true, key: true, name: true } } },
          },
          sessions: {
            where: { revokedAt: null },
            orderBy: { lastSeenAt: "desc" },
            take: 1,
            select: { lastSeenAt: true },
          },
        },
      })
      .then((rows) =>
        rows
          .filter((row) =>
            canTargetScope(actor, "staff.read", row.roleAssignments),
          )
          .slice(0, bounded + 1),
      );
  }

  async detail(actor: StaffActor, targetId: string) {
    const staff = await this.prisma.admin.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        enabled: true,
        version: true,
        tokenVersion: true,
        mfaRequired: true,
        createdAt: true,
        updatedAt: true,
        mfaCredentials: {
          where: { status: "confirmed" },
          select: { id: true, confirmedAt: true },
        },
        roleAssignments: {
          include: { role: { select: { id: true, key: true, name: true } } },
        },
      },
    });
    if (!staff) throw new NotFoundException({ code: "STAFF_NOT_FOUND" });
    assertTargetScope(actor, "staff.read", staff.roleAssignments);
    return staff;
  }

  async targetSessions(
    actor: StaffActor,
    targetId: string,
    cursor?: string,
    take = 25,
  ) {
    const target = await this.prisma.admin.findUnique({
      where: { id: targetId },
      include: { roleAssignments: true },
    });
    if (!target) throw new NotFoundException({ code: "STAFF_NOT_FOUND" });
    assertTargetScope(actor, "sessions.manage", target.roleAssignments);
    const bounded = Math.max(1, Math.min(take, 50));
    if (cursor) {
      this.assertCursor(cursor);
      const cursorRow = await this.prisma.staffSession.findFirst({
        where: { id: cursor, staffUserId: targetId },
        select: { id: true },
      });
      if (!cursorRow) throw new BadRequestException({ code: "INVALID_CURSOR" });
    }
    return this.prisma.staffSession.findMany({
      where: { staffUserId: targetId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: bounded + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
        revokedAt: true,
        deviceLabel: true,
        browserFamily: true,
        osFamily: true,
        mfaSatisfiedAt: true,
        authMethod: true,
      },
    });
  }

  roles() {
    return this.prisma.role.findMany({
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isSystem: true,
        permissions: { select: { permission: { select: { key: true } } } },
      },
    });
  }

  roleAssignmentPolicy(roleKey: string) {
    const mfaRequired = this.config.privilegedRoleKeys.includes(roleKey);
    const assignmentAllowed =
      !mfaRequired || this.config.privilegedRolePolicyReviewed;
    return {
      mfaRequired,
      assignmentAllowed,
      ...(!assignmentAllowed
        ? { blockReasonCode: "PRIVILEGED_ASSIGNMENT_POLICY_DISABLED" }
        : {}),
    };
  }

  async previewCreate(
    actor: StaffActor,
    input: {
      email: string;
      displayName?: string;
      mfaRequired: boolean;
      assignments: StaffAssignmentInput[];
    },
  ) {
    const emailNormalized = normalizeStaffEmail(input.email);
    const assignments = this.canonicalAssignments(input.assignments);
    const { requiresMfa } = await this.validateRoles(this.prisma, assignments);
    assertTargetScope(actor, "staff.manage", assignments);
    const mfaRequired = input.mfaRequired || requiresMfa;
    const command = this.createCommand(
      emailNormalized,
      input.displayName,
      mfaRequired,
      assignments,
    );
    return {
      requestedActionHash: commandHash(command),
      emailNormalized,
      assignments,
      mfaRequired,
    };
  }

  async previewTransition(
    actor: StaffActor,
    targetId: string,
    actionName: "staff.activate" | "staff.disable" | "staff.reenable",
    expectedVersion: number,
    reasonCode?: string,
    reasonComment?: string,
  ) {
    await this.assertTargetById(actor, "staff.manage", targetId);
    const command = this.transitionCommand(
      actionName,
      targetId,
      expectedVersion,
      reasonCode,
      reasonComment,
    );
    return { requestedActionHash: commandHash(command) };
  }

  async previewAssignments(
    actor: StaffActor,
    targetId: string,
    expectedVersion: number,
    assignmentsInput: StaffAssignmentInput[],
  ) {
    const assignments = this.canonicalAssignments(assignmentsInput);
    const { requiresMfa } = await this.validateRoles(this.prisma, assignments);
    await this.assertTargetById(actor, "roles.assign", targetId);
    assertTargetScope(actor, "roles.assign", assignments);
    const command = this.assignmentCommand(
      targetId,
      expectedVersion,
      assignments,
    );
    return {
      requestedActionHash: commandHash(command),
      assignments,
      mfaRequired: requiresMfa,
    };
  }

  async create(
    actor: StaffActor,
    input: {
      email: string;
      displayName?: string;
      mfaRequired: boolean;
      assignments: StaffAssignmentInput[];
      stepUpToken: string;
    },
    idempotencyKey: string,
  ) {
    const emailNormalized = normalizeStaffEmail(input.email);
    const assignments = this.canonicalAssignments(input.assignments);
    return this.prisma.$transaction(async (tx) => {
      const { requiresMfa } = await this.validateRoles(tx, assignments);
      assertTargetScope(actor, "staff.manage", assignments);
      const mfaRequired = input.mfaRequired || requiresMfa;
      const action = this.createCommand(
        emailNormalized,
        input.displayName,
        mfaRequired,
        assignments,
      );
      const payloadHash = commandHash(action);
      const keyHash = this.idempotencyKeyHash(actor.id, idempotencyKey);
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${keyHash}))`,
      );
      const replay = await tx.staffMutationRequest.findUnique({
        where: {
          actorId_action_idempotencyKeyHash: {
            actorId: actor.id,
            action: "staff.create",
            idempotencyKeyHash: keyHash,
          },
        },
      });
      if (replay) {
        if (replay.payloadHash !== payloadHash)
          throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED" });
        return replay.responseJson;
      }
      await this.mfa.consumeStepUp(
        tx,
        input.stepUpToken,
        actor.id,
        actor.sessionId,
        payloadHash,
      );
      if (await tx.admin.findUnique({ where: { emailNormalized } }))
        throw new ConflictException({ code: "STAFF_IDENTITY_EXISTS" });
      const staff = await tx.admin.create({
        data: {
          email: input.email.trim(),
          emailNormalized,
          displayName: input.displayName?.trim() || null,
          passwordHash: null,
          status: "invited",
          enabled: false,
          role: "staff",
          mfaRequired,
          createdById: actor.id,
          roleAssignments: { create: assignments },
        },
      });
      const invitation = await this.invitations.issueWithClient(
        tx,
        staff.id,
        actor.id,
        staff.email,
        "invite",
      );
      await this.audit.recordWithClient(tx, {
        actorId: actor.id,
        actorEmail: actor.email,
        correlationId: randomUUID(),
        action: "staff.created",
        entityType: "Admin",
        entityId: staff.id,
        after: {
          id: staff.id,
          emailNormalized,
          status: staff.status,
          mfaRequired: staff.mfaRequired,
          assignments,
        },
      });
      const replaySafeResponse = {
        staff: {
          id: staff.id,
          email: staff.email,
          status: staff.status,
          version: staff.version,
        },
        invitation: {
          invitationId: invitation.invitationId,
          expiresAt: invitation.expiresAt,
        },
      };
      await tx.staffMutationRequest.create({
        data: {
          actorId: actor.id,
          action: "staff.create",
          idempotencyKeyHash: keyHash,
          payloadHash,
          resourceId: staff.id,
          responseJson: replaySafeResponse,
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        },
      });
      return { ...replaySafeResponse, invitation };
    });
  }

  async previewResend(
    actor: StaffActor,
    targetId: string,
    expectedVersion: number,
    reasonCode: string,
    reasonComment?: string,
  ) {
    await this.assertTargetById(actor, "staff.manage", targetId);
    const command = {
      action: "staff.invitation.resend",
      targetId,
      expectedVersion,
      reasonCode,
      reasonComment: reasonComment ?? null,
    };
    return { requestedActionHash: commandHash(command) };
  }

  async resendInvitation(
    actor: StaffActor,
    targetId: string,
    input: {
      expectedVersion: number;
      reasonCode: string;
      reasonComment?: string;
      stepUpToken: string;
    },
    idempotencyKey: string,
  ) {
    const command = {
      action: "staff.invitation.resend",
      targetId,
      expectedVersion: input.expectedVersion,
      reasonCode: input.reasonCode,
      reasonComment: input.reasonComment ?? null,
    };
    const payloadHash = commandHash(command);
    const keyHash = this.idempotencyKeyHash(actor.id, idempotencyKey);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext(${keyHash}))`,
      );
      const replay = await tx.staffMutationRequest.findUnique({
        where: {
          actorId_action_idempotencyKeyHash: {
            actorId: actor.id,
            action: "staff.invitation.resend",
            idempotencyKeyHash: keyHash,
          },
        },
      });
      if (replay) {
        if (replay.payloadHash !== payloadHash)
          throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED" });
        return replay.responseJson;
      }
      await this.mfa.consumeStepUp(
        tx,
        input.stepUpToken,
        actor.id,
        actor.sessionId,
        payloadHash,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Admin" WHERE "id" = ${targetId} FOR UPDATE`,
      );
      const before = await tx.admin.findUnique({
        where: { id: targetId },
        include: { roleAssignments: true },
      });
      if (!before) throw new NotFoundException({ code: "STAFF_NOT_FOUND" });
      assertTargetScope(actor, "staff.manage", before.roleAssignments);
      if (before.version !== input.expectedVersion)
        throw new ConflictException({
          code: "STAFF_VERSION_CONFLICT",
          currentVersion: before.version,
        });
      if (
        before.status !== "invited" &&
        before.status !== "pending_activation"
      ) {
        throw new ConflictException({
          code: "INVITATION_RESEND_NOT_ALLOWED",
          status: before.status,
        });
      }
      const invitation = await this.invitations.issueWithClient(
        tx,
        before.id,
        actor.id,
        before.email,
        "invite",
      );
      const after = await tx.admin.update({
        where: { id: targetId },
        data: { version: { increment: 1 } },
      });
      await this.audit.recordWithClient(tx, {
        actorId: actor.id,
        actorEmail: actor.email,
        correlationId: randomUUID(),
        action: "staff.invite.resent",
        entityType: "Admin",
        entityId: targetId,
        before: { version: before.version, status: before.status },
        after: {
          version: after.version,
          invitationId: invitation.invitationId,
          reasonCode: input.reasonCode,
        },
      });
      const replaySafeResponse = {
        targetId,
        version: after.version,
        invitation: {
          invitationId: invitation.invitationId,
          expiresAt: invitation.expiresAt,
        },
      };
      await tx.staffMutationRequest.create({
        data: {
          actorId: actor.id,
          action: "staff.invitation.resend",
          idempotencyKeyHash: keyHash,
          payloadHash,
          resourceId: invitation.invitationId,
          responseJson: replaySafeResponse,
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        },
      });
      return { ...replaySafeResponse, invitation };
    });
  }

  async previewTargetSessionRevoke(
    actor: StaffActor,
    targetId: string,
    sessionId: string,
    expectedVersion: number,
  ) {
    await this.assertTargetById(actor, "sessions.manage", targetId);
    return {
      requestedActionHash: commandHash({
        action: "staff.session.revoke",
        targetId,
        sessionId,
        expectedVersion,
      }),
    };
  }

  async revokeTargetSession(
    actor: StaffActor,
    targetId: string,
    sessionId: string,
    expectedVersion: number,
    stepUpToken: string,
  ) {
    const actionHash = commandHash({
      action: "staff.session.revoke",
      targetId,
      sessionId,
      expectedVersion,
    });
    return this.prisma.$transaction(async (tx) => {
      await this.mfa.consumeStepUp(
        tx,
        stepUpToken,
        actor.id,
        actor.sessionId,
        actionHash,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Admin" WHERE "id" = ${targetId} FOR UPDATE`,
      );
      const target = await tx.admin.findUnique({
        where: { id: targetId },
        include: { roleAssignments: true },
      });
      if (!target) throw new NotFoundException({ code: "STAFF_NOT_FOUND" });
      assertTargetScope(actor, "sessions.manage", target.roleAssignments);
      if (target.version !== expectedVersion)
        throw new ConflictException({
          code: "STAFF_VERSION_CONFLICT",
          currentVersion: target.version,
        });
      const revoked = await tx.staffSession.updateMany({
        where: { id: sessionId, staffUserId: targetId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokeReason: "administrative_session_revoke",
        },
      });
      if (revoked.count !== 1)
        throw new NotFoundException({ code: "SESSION_NOT_FOUND" });
      await tx.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const after = await tx.admin.update({
        where: { id: targetId },
        data: { version: { increment: 1 } },
      });
      await this.audit.recordWithClient(tx, {
        actorId: actor.id,
        actorEmail: actor.email,
        correlationId: randomUUID(),
        action: "staff.session.revoked",
        entityType: "StaffSession",
        entityId: sessionId,
        before: { targetStaffId: targetId, targetVersion: target.version },
        after: {
          targetStaffId: targetId,
          targetVersion: after.version,
          revoked: true,
        },
      });
      return { revoked: true, targetVersion: after.version };
    });
  }

  activate(
    actor: StaffActor,
    targetId: string,
    expectedVersion: number,
    stepUpToken: string,
  ) {
    return this.transition(
      actor,
      targetId,
      "active",
      "staff.activate",
      expectedVersion,
      stepUpToken,
    );
  }

  disable(
    actor: StaffActor,
    targetId: string,
    expectedVersion: number,
    reasonCode: string,
    reasonComment: string | undefined,
    stepUpToken: string,
  ) {
    if (actor.id === targetId)
      throw new ForbiddenException({ code: "SELF_DISABLE_FORBIDDEN" });
    return this.transition(
      actor,
      targetId,
      "disabled",
      "staff.disable",
      expectedVersion,
      stepUpToken,
      reasonCode,
      reasonComment,
    );
  }

  reenable(
    actor: StaffActor,
    targetId: string,
    expectedVersion: number,
    reasonCode: string,
    reasonComment: string | undefined,
    stepUpToken: string,
  ) {
    return this.transition(
      actor,
      targetId,
      "pending_activation",
      "staff.reenable",
      expectedVersion,
      stepUpToken,
      reasonCode,
      reasonComment,
    );
  }

  async replaceAssignments(
    actor: StaffActor,
    targetId: string,
    input: {
      assignments: StaffAssignmentInput[];
      expectedVersion: number;
      stepUpToken: string;
    },
  ) {
    if (actor.id === targetId)
      throw new ForbiddenException({ code: "SELF_ESCALATION_FORBIDDEN" });
    const assignments = this.canonicalAssignments(input.assignments);
    const action = this.assignmentCommand(
      targetId,
      input.expectedVersion,
      assignments,
    );
    return this.prisma.$transaction(async (tx) => {
      await this.mfa.consumeStepUp(
        tx,
        input.stepUpToken,
        actor.id,
        actor.sessionId,
        commandHash(action),
      );
      const { requiresMfa } = await this.validateRoles(tx, assignments);
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Admin" WHERE "id" = ${targetId} FOR UPDATE`,
      );
      const before = await tx.admin.findUnique({
        where: { id: targetId },
        include: { roleAssignments: true },
      });
      if (!before) throw new NotFoundException({ code: "STAFF_NOT_FOUND" });
      assertTargetScope(actor, "roles.assign", before.roleAssignments);
      assertTargetScope(actor, "roles.assign", assignments);
      if (before.version !== input.expectedVersion)
        throw new ConflictException({
          code: "STAFF_VERSION_CONFLICT",
          currentVersion: before.version,
        });
      await tx.adminRoleAssignment.deleteMany({ where: { adminId: targetId } });
      for (const assignment of assignments)
        await tx.adminRoleAssignment.create({
          data: { adminId: targetId, ...assignment },
        });
      const sessions = await tx.staffSession.findMany({
        where: { staffUserId: targetId, revokedAt: null },
        select: { id: true },
      });
      await tx.staffSession.updateMany({
        where: { staffUserId: targetId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokeReason: "role_assignment_changed",
        },
      });
      await tx.refreshToken.updateMany({
        where: {
          sessionId: { in: sessions.map(({ id }) => id) },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      const after = await tx.admin.update({
        where: { id: targetId },
        data: {
          version: { increment: 1 },
          tokenVersion: { increment: 1 },
          ...(requiresMfa ? { mfaRequired: true } : {}),
        },
        include: { roleAssignments: true },
      });
      await this.audit.recordWithClient(tx, {
        actorId: actor.id,
        actorEmail: actor.email,
        correlationId: randomUUID(),
        action: "staff.assignment.changed",
        entityType: "Admin",
        entityId: targetId,
        before: {
          version: before.version,
          tokenVersion: before.tokenVersion,
          mfaRequired: before.mfaRequired,
          assignments: before.roleAssignments,
        },
        after: {
          version: after.version,
          tokenVersion: after.tokenVersion,
          mfaRequired: after.mfaRequired,
          assignments: after.roleAssignments,
        },
      });
      return {
        id: after.id,
        version: after.version,
        tokenVersion: after.tokenVersion,
        mfaRequired: after.mfaRequired,
        assignments: after.roleAssignments,
      };
    });
  }

  private async transition(
    actor: StaffActor,
    targetId: string,
    targetStatus: "active" | "disabled" | "pending_activation",
    actionName: string,
    expectedVersion: number,
    stepUpToken: string,
    reasonCode?: string,
    reasonComment?: string,
  ) {
    const action = this.transitionCommand(
      actionName,
      targetId,
      expectedVersion,
      reasonCode,
      reasonComment,
    );
    return this.prisma.$transaction(async (tx) => {
      await this.mfa.consumeStepUp(
        tx,
        stepUpToken,
        actor.id,
        actor.sessionId,
        commandHash(action),
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Admin" WHERE "id" = ${targetId} FOR UPDATE`,
      );
      const before = await tx.admin.findUnique({
        where: { id: targetId },
        include: {
          roleAssignments: true,
          mfaCredentials: {
            where: { status: "confirmed" },
            select: { id: true },
          },
        },
      });
      if (!before) throw new NotFoundException({ code: "STAFF_NOT_FOUND" });
      assertTargetScope(actor, "staff.manage", before.roleAssignments);
      if (before.version !== expectedVersion)
        throw new ConflictException({
          code: "STAFF_VERSION_CONFLICT",
          currentVersion: before.version,
        });
      const legalSourceStates: Record<
        typeof targetStatus,
        StaffAccountStatus[]
      > = {
        active: ["pending_activation"],
        disabled: ["invited", "pending_activation", "active"],
        pending_activation: ["disabled"],
      };
      if (!legalSourceStates[targetStatus].includes(before.status)) {
        throw new ConflictException({
          code: "ILLEGAL_STAFF_STATE_TRANSITION",
          from: before.status,
          to: targetStatus,
        });
      }
      if (
        targetStatus === "active" &&
        (!before.passwordHash ||
          before.roleAssignments.length === 0 ||
          (before.mfaRequired && before.mfaCredentials.length === 0))
      ) {
        throw new ConflictException({ code: "ACTIVATION_GUARDS_FAILED" });
      }
      if (targetStatus === "disabled" && before.mfaRequired) {
        if (!this.config.privilegedRolePolicyReviewed) {
          throw new ConflictException({
            code: "EMERGENCY_OWNERSHIP_POLICY_REQUIRED",
          });
        }
        await tx.$queryRaw(Prisma.sql`
          SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtext('identity:emergency-owner-policy'))
        `);
        const otherEmergencyOwners = await tx.admin.count({
          where: {
            id: { not: targetId },
            status: "active",
            enabled: true,
            mfaRequired: true,
            mfaCredentials: { some: { status: "confirmed" } },
            roleAssignments: {
              some: {
                role: { key: { in: [...this.config.privilegedRoleKeys] } },
              },
            },
          },
        });
        if (otherEmergencyOwners < 1) {
          throw new ConflictException({
            code: "LAST_EMERGENCY_ACCOUNT_DISABLE_FORBIDDEN",
          });
        }
      }
      const after = await tx.admin.update({
        where: { id: targetId },
        data: {
          status: targetStatus,
          enabled: targetStatus === "active",
          activatedAt:
            targetStatus === "active" ? new Date() : before.activatedAt,
          disabledAt: targetStatus === "disabled" ? new Date() : null,
          disabledReason:
            targetStatus === "disabled"
              ? [reasonCode, reasonComment].filter(Boolean).join(": ")
              : null,
          tokenVersion: { increment: 1 },
          version: { increment: 1 },
        },
      });
      const sessions = await tx.staffSession.findMany({
        where: { staffUserId: targetId, revokedAt: null },
        select: { id: true },
      });
      await tx.staffSession.updateMany({
        where: { staffUserId: targetId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: actionName },
      });
      await tx.refreshToken.updateMany({
        where: {
          sessionId: { in: sessions.map(({ id }) => id) },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      if (targetStatus === "disabled") {
        await tx.staffInvitation.updateMany({
          where: { staffUserId: targetId, consumedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.authChallenge.updateMany({
          where: { staffUserId: targetId, consumedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.recordWithClient(tx, {
        actorId: actor.id,
        actorEmail: actor.email,
        correlationId: randomUUID(),
        action: (
          {
            "staff.activate": "staff.activated",
            "staff.disable": "staff.disabled",
            "staff.reenable": "staff.reenabled",
          } as const
        )[actionName as "staff.activate" | "staff.disable" | "staff.reenable"],
        entityType: "Admin",
        entityId: targetId,
        before: {
          status: before.status,
          enabled: before.enabled,
          version: before.version,
        },
        after: {
          status: after.status,
          enabled: after.enabled,
          version: after.version,
          reasonCode,
        },
      });
      return {
        id: after.id,
        status: after.status,
        enabled: after.enabled,
        version: after.version,
      };
    });
  }

  private canonicalAssignments(
    assignments: StaffAssignmentInput[],
  ): StaffAssignmentInput[] {
    const unique = new Map<string, StaffAssignmentInput>();
    for (const assignment of assignments) {
      const scopeId = assignment.scopeId.trim();
      if (
        (assignment.scopeType === "global" && scopeId !== "") ||
        (assignment.scopeType !== "global" && scopeId === "")
      ) {
        throw new ConflictException({ code: "INVALID_SCOPE" });
      }
      unique.set(`${assignment.roleId}:${assignment.scopeType}:${scopeId}`, {
        ...assignment,
        scopeId,
      });
    }
    return [...unique.values()].sort((a, b) =>
      `${a.roleId}:${a.scopeType}:${a.scopeId}`.localeCompare(
        `${b.roleId}:${b.scopeType}:${b.scopeId}`,
      ),
    );
  }

  private normalizeSearchQuery(q?: string): string | undefined {
    if (q === undefined) return undefined;
    const normalized = q.trim().normalize("NFKC").toLowerCase();
    if (
      normalized.length === 0 ||
      normalized.length > 254 ||
      /[\s\u0000-\u001f\u007f]/u.test(normalized)
    ) {
      throw new BadRequestException({ code: "INVALID_STAFF_QUERY" });
    }
    if (!normalized.includes("@")) return normalized;
    try {
      return normalizeStaffEmail(normalized);
    } catch {
      throw new BadRequestException({ code: "INVALID_STAFF_QUERY" });
    }
  }

  private assertCursor(cursor: string): void {
    if (cursor.length > 128 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
      throw new BadRequestException({ code: "INVALID_CURSOR" });
    }
  }

  private async validateRoles(
    tx: Pick<Prisma.TransactionClient, "role">,
    assignments: StaffAssignmentInput[],
  ): Promise<{ requiresMfa: boolean }> {
    const roles = await tx.role.findMany({
      where: { id: { in: assignments.map(({ roleId }) => roleId) } },
      select: { id: true, key: true },
    });
    if (roles.length !== new Set(assignments.map(({ roleId }) => roleId)).size)
      throw new ConflictException({ code: "INVALID_ROLE" });
    if (this.config.privilegedRoleKeys.length === 0) {
      throw new ConflictException({ code: "PRIVILEGED_ROLE_POLICY_MISSING" });
    }
    const privileged = new Set(this.config.privilegedRoleKeys);
    const requiresMfa = roles.some(({ key }) => privileged.has(key));
    if (requiresMfa && !this.config.privilegedRolePolicyReviewed) {
      throw new ConflictException({
        code: "PRIVILEGED_ASSIGNMENT_POLICY_DISABLED",
      });
    }
    return { requiresMfa };
  }

  private createCommand(
    emailNormalized: string,
    displayName: string | undefined,
    mfaRequired: boolean,
    assignments: StaffAssignmentInput[],
  ) {
    return {
      action: "staff.create",
      emailNormalized,
      displayName: displayName?.trim() || null,
      mfaRequired,
      assignments,
    };
  }

  private transitionCommand(
    action: string,
    targetId: string,
    expectedVersion: number,
    reasonCode?: string,
    reasonComment?: string,
  ) {
    return {
      action,
      targetId,
      expectedVersion,
      reasonCode: reasonCode ?? null,
      reasonComment: reasonComment ?? null,
    };
  }

  private assignmentCommand(
    targetId: string,
    expectedVersion: number,
    assignments: StaffAssignmentInput[],
  ) {
    return {
      action: "staff.assignments.replace",
      targetId,
      expectedVersion,
      assignments,
    };
  }

  private idempotencyKeyHash(actorId: string, rawKey: string): string {
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(rawKey)) {
      throw new ConflictException({ code: "INVALID_IDEMPOTENCY_KEY" });
    }
    if (!this.config.digestKeys)
      throw new ConflictException({ code: "IDENTITY_V2_DISABLED" });
    return keyedDigest(
      this.config.digestKeys,
      this.config.digestKeys.currentKeyId,
      "staff-idempotency",
      [actorId, rawKey],
    );
  }

  private async assertTargetById(
    actor: StaffActor,
    permission: string,
    targetId: string,
  ): Promise<void> {
    const target = await this.prisma.admin.findUnique({
      where: { id: targetId },
      include: { roleAssignments: true },
    });
    if (!target) throw new NotFoundException({ code: "STAFF_NOT_FOUND" });
    assertTargetScope(actor, permission, target.roleAssignments);
  }
}
