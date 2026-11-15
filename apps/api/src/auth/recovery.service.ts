import { randomUUID } from 'node:crypto';

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalCommand, commandHash } from './identity-command';
import { InvitationService } from './invitation.service';
import { MfaService } from './mfa.service';
import { PermissionGrant } from './permission-evaluator';
import { assertTargetScope } from './target-scope-policy';

interface RecoveryActor {
  id: string;
  email: string;
  sessionId: string;
  permissionGrants: PermissionGrant[];
}

@Injectable()
export class RecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
    private readonly invitations: InvitationService,
    private readonly audit: AuditService,
  ) {}

  async previewRequest(actor: RecoveryActor, targetStaffId: string, reasonCode: string, reasonComment?: string) {
    const prepared = await this.prepareRequest(actor, targetStaffId, reasonCode, reasonComment);
    return {
      requestedActionHash: prepared.actionHash,
      payloadHash: prepared.payloadHash,
      targetVersion: prepared.target.version,
      targetTokenVersion: prepared.target.tokenVersion,
      targetMfaVersion: prepared.target.mfaVersion,
      roleScopeSnapshotHash: prepared.roleScopeSnapshotHash,
      validForSeconds: 300,
    };
  }

  async previewApproval(actor: RecoveryActor, requestId: string) {
    const request = await this.prisma.staffRecoveryRequest.findUnique({
      where: { id: requestId },
      include: { targetStaff: { include: { roleAssignments: true } } },
    });
    if (!request) throw new NotFoundException({ code: 'RECOVERY_REQUEST_NOT_FOUND' });
    assertTargetScope(actor, 'staff.recovery.approve', request.targetStaff.roleAssignments);
    return {
      requestedActionHash: commandHash({ action: 'staff.recovery.approve', requestId, payloadHash: request.payloadHash }),
      payloadHash: request.payloadHash,
      state: request.state,
      expiresAt: request.expiresAt.toISOString(),
    };
  }

  async request(
    actor: RecoveryActor,
    targetStaffId: string,
    reasonCode: string,
    reasonComment: string | undefined,
    stepUpToken: string,
  ) {
    if (actor.id === targetStaffId) throw new ForbiddenException({ code: 'RECOVERY_ACTOR_SEPARATION_REQUIRED' });
    const prepared = await this.prepareRequest(actor, targetStaffId, reasonCode, reasonComment);
    const { target, roleScopeSnapshotHash, command, payloadHash, actionHash } = prepared;
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    return this.prisma.$transaction(async (tx) => {
      await this.mfa.consumeStepUp(tx, stepUpToken, actor.id, actor.sessionId, actionHash);
      const request = await tx.staffRecoveryRequest.create({
        data: {
          targetStaffId,
          requesterId: actor.id,
          reasonCode,
          reasonComment,
          commandPayload: JSON.parse(canonicalCommand(command)) as Prisma.InputJsonValue,
          payloadHash,
          targetVersionSnapshot: target.version,
          targetTokenVersionSnapshot: target.tokenVersion,
          targetMfaVersionSnapshot: target.mfaVersion,
          roleScopeSnapshotHash,
          expiresAt,
          executionIdempotencyKey: randomUUID(),
        },
      });
      await this.audit.recordWithClient(tx, {
        actorId: actor.id, actorEmail: actor.email, correlationId: randomUUID(),
        action: 'staff.recovery.requested', entityType: 'StaffRecoveryRequest', entityId: request.id,
        after: { targetStaffId, payloadHash, expiresAt, reasonCode },
      });
      return { id: request.id, state: request.state, payloadHash, expiresAt: expiresAt.toISOString() };
    });
  }

  async approve(actor: RecoveryActor, requestId: string, stepUpToken: string) {
    try {
      return await this.executeApproval(actor, requestId, stepUpToken);
    } catch (error) {
      await this.prisma.$transaction((tx) => this.audit.recordWithClient(tx, {
        actorId: actor.id, actorEmail: actor.email, correlationId: randomUUID(),
        action: 'staff.recovery.rejected', entityType: 'StaffRecoveryRequest', entityId: requestId,
        metadata: { reason: this.rejectionReason(error) },
      }));
      throw error;
    }
  }

  private async executeApproval(actor: RecoveryActor, requestId: string, stepUpToken: string) {
    const preview = await this.prisma.staffRecoveryRequest.findUnique({ where: { id: requestId } });
    if (!preview) throw new NotFoundException({ code: 'RECOVERY_REQUEST_NOT_FOUND' });
    const actionHash = commandHash({ action: 'staff.recovery.approve', requestId, payloadHash: preview.payloadHash });
    return this.prisma.$transaction(async (tx) => {
      await this.mfa.consumeStepUp(tx, stepUpToken, actor.id, actor.sessionId, actionHash);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "StaffRecoveryRequest" WHERE "id" = ${requestId} FOR UPDATE`);
      const request = await tx.staffRecoveryRequest.findUnique({ where: { id: requestId }, include: { targetStaff: { include: { roleAssignments: true } } } });
      if (!request) throw new NotFoundException({ code: 'RECOVERY_REQUEST_NOT_FOUND' });
      if (
        request.state !== 'pending' || request.expiresAt.getTime() <= Date.now() || actor.id === request.requesterId ||
        actor.id === request.targetStaffId || request.requesterId === request.targetStaffId
      ) throw new ForbiddenException({ code: 'RECOVERY_APPROVAL_REJECTED' });
      const target = request.targetStaff;
      assertTargetScope(actor, 'staff.recovery.approve', target.roleAssignments);
      const currentScopeHash = commandHash(target.roleAssignments.map(({ roleId, scopeType, scopeId }) => ({ roleId, scopeType, scopeId })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
      if (
        target.version !== request.targetVersionSnapshot || target.tokenVersion !== request.targetTokenVersionSnapshot ||
        target.mfaVersion !== request.targetMfaVersionSnapshot || currentScopeHash !== request.roleScopeSnapshotHash ||
        commandHash(request.commandPayload) !== request.payloadHash
      ) throw new ConflictException({ code: 'RECOVERY_REQUEST_STALE' });
      await tx.mfaCredential.updateMany({ where: { staffUserId: target.id, status: { not: 'revoked' } }, data: { status: 'revoked', revokedAt: new Date() } });
      await tx.mfaRecoveryCode.updateMany({ where: { staffUserId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.authChallenge.updateMany({ where: { staffUserId: target.id, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const sessionIds = await tx.staffSession.findMany({ where: { staffUserId: target.id, revokedAt: null }, select: { id: true } });
      await tx.staffSession.updateMany({ where: { staffUserId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'administrative_mfa_recovery' } });
      await tx.refreshToken.updateMany({ where: { sessionId: { in: sessionIds.map(({ id }) => id) }, revokedAt: null }, data: { revokedAt: new Date() } });
      const updated = await tx.admin.update({
        where: { id: target.id },
        data: {
          status: 'pending_activation', enabled: false,
          mfaVersion: { increment: 1 }, tokenVersion: { increment: 1 }, version: { increment: 1 },
        },
      });
      const invitation = await this.invitations.issueWithClient(tx, target.id, actor.id, target.email, 'recovery', 60 * 60_000);
      const executed = await tx.staffRecoveryRequest.updateMany({
        where: { id: request.id, state: 'pending', approverId: null, executedAt: null },
        data: { approverId: actor.id, approvedAt: new Date(), executedAt: new Date(), state: 'executed' },
      });
      if (executed.count !== 1) throw new ConflictException({ code: 'RECOVERY_ALREADY_EXECUTED' });
      await this.audit.recordWithClient(tx, {
        actorId: actor.id, actorEmail: actor.email, correlationId: randomUUID(),
        action: 'staff.recovery.executed', entityType: 'StaffRecoveryRequest', entityId: request.id,
        before: { state: request.state, targetVersion: target.version, targetMfaVersion: target.mfaVersion },
        after: { state: 'executed', targetVersion: updated.version, targetMfaVersion: updated.mfaVersion, invitationId: invitation.invitationId },
      });
      await this.audit.recordWithClient(tx, {
        actorId: actor.id, actorEmail: actor.email, correlationId: randomUUID(),
        action: 'staff.recovery.approved', entityType: 'StaffRecoveryRequest', entityId: request.id,
        after: { state: 'executed', targetStaffId: target.id },
      });
      return { id: request.id, state: 'executed' as const, targetStatus: updated.status, invitation };
    });
  }

  private rejectionReason(error: unknown): string {
    if (error instanceof NotFoundException) return 'not_found';
    if (error instanceof ConflictException) return 'stale_or_executed';
    if (error instanceof ForbiddenException) return 'actor_or_state_rejected';
    return 'invalid_proof_or_internal';
  }

  private async prepareRequest(actor: RecoveryActor, targetStaffId: string, reasonCode: string, reasonComment?: string) {
    const target = await this.prisma.admin.findUnique({
      where: { id: targetStaffId },
      include: { roleAssignments: true },
    });
    if (!target) throw new NotFoundException({ code: 'STAFF_NOT_FOUND' });
    assertTargetScope(actor, 'staff.recovery.request', target.roleAssignments);
    const roleScopeSnapshotHash = commandHash(target.roleAssignments
      .map(({ roleId, scopeType, scopeId }) => ({ roleId, scopeType, scopeId }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const command = {
      action: 'reset_mfa', targetStaffId, targetVersion: target.version,
      targetTokenVersion: target.tokenVersion, targetMfaVersion: target.mfaVersion,
      requestedRoleScopeSnapshotHash: roleScopeSnapshotHash,
      reasonCode, reasonComment: reasonComment ?? null,
    };
    const payloadHash = commandHash(command);
    const actionHash = commandHash({ action: 'staff.recovery.request', targetStaffId, payloadHash });
    return { target, roleScopeSnapshotHash, command, payloadHash, actionHash };
  }
}
