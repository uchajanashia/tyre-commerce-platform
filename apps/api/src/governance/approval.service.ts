import { randomUUID } from 'node:crypto';

import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ApprovalDecisionValue, Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActionIntentService } from './action-intent.service';
import {
  GovernanceActor, assertGovernanceEnabled, requireCurrentExactGlobalPermission, requireExactGlobalPermission,
} from './governance-access';
import { GOVERNANCE_CONFIG, GovernanceConfig } from './governance-config';
import { GovernanceIdempotencyService } from './governance-idempotency.service';
import { evidenceSetHash, payloadHash, targetSetHash } from './governance-hash';

export interface TrustedApprovalCommand {
  requestId: string;
  actionType: string;
  schemaVersion: number;
  normalizationVersion: number;
  adapterVersion: number;
  semanticCommand: object;
  targets: readonly { id: string; type: string; version: number }[];
  expiresAt: Date;
  supersedesRequestId?: string;
}

@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intents: ActionIntentService,
    private readonly idempotency: GovernanceIdempotencyService,
    private readonly audit: AuditService,
    @Inject(GOVERNANCE_CONFIG) private readonly config: GovernanceConfig,
  ) {}

  /** Internal adapter boundary only; no HTTP route exposes arbitrary semantic JSON. */
  async prepareTrustedRequest(actor: GovernanceActor, command: Omit<TrustedApprovalCommand, 'requestId'>, correlationId: string) {
    assertGovernanceEnabled(this.config);
    requireExactGlobalPermission(actor, 'approvals.request');
    this.validateCommand(command);
    const normalizedTargets = [...command.targets].sort((left, right) =>
      `${left.type}\0${left.id}`.localeCompare(`${right.type}\0${right.id}`, 'en'),
    );
    const computedPayloadHash = payloadHash(command.semanticCommand);
    const computedTargetSetHash = targetSetHash({ targets: normalizedTargets });
    const slots = await this.prisma.approvalPolicyActiveSlot.findMany({
      where: {
        actionType: command.actionType,
        actionSchemaVersionMin: { lte: command.schemaVersion },
        actionSchemaVersionMax: { gte: command.schemaVersion },
      },
      include: { policy: true },
      take: 2,
    });
    if (slots.length !== 1 || slots[0].policy.mode !== 'approval_required') throw new ConflictException({ code: 'APPROVAL_POLICY_UNAVAILABLE' });
    const slot = slots[0];
    const requestId = randomUUID();
    const intent = await this.intents.issue(actor, {
      action: 'approval.request', resourceType: 'ApprovalRequest', resourceId: requestId, resourceVersion: 0,
      payloadHash: computedPayloadHash, targetSetHash: computedTargetSetHash,
      policyHash: slot.policy.policyHash, policyVersion: slot.policy.policyVersion, correlationId,
    });
    return {
      intent, command: { ...command, requestId, targets: normalizedTargets },
      payloadHash: computedPayloadHash, targetSetHash: computedTargetSetHash,
      policyId: slot.policy.id, policyHash: slot.policy.policyHash, policyVersion: slot.policy.policyVersion,
      requiredApproverCount: slot.policy.requiredApproverCount,
    };
  }

  async createRequest(
    actor: GovernanceActor,
    command: Omit<TrustedApprovalCommand, 'requestId'>,
    rawIntentToken: string,
    stepUpToken: string,
    idempotencyKey: string,
  ) {
    this.validateCommand(command);
    const normalizedTargets = [...command.targets].sort((left, right) =>
      `${left.type}\0${left.id}`.localeCompare(`${right.type}\0${right.id}`, 'en'),
    );
    const computedPayloadHash = payloadHash(command.semanticCommand);
    const computedTargetSetHash = targetSetHash({ targets: normalizedTargets });
    const requestHash = payloadHash({
      action: 'approval.request', actionType: command.actionType,
      payloadHash: computedPayloadHash, targetSetHash: computedTargetSetHash,
      expiresAt: command.expiresAt.toISOString(),
    });
    return this.prisma.$transaction(async (tx) => {
      await requireCurrentExactGlobalPermission(tx, actor.id, 'approvals.request');
      const replay = await this.idempotency.lockAndReplay<{ requestId: string; state: string; version: number }>(tx, actor, 'approval.request', idempotencyKey, requestHash);
      if (replay.replay) return replay.replay;
      const slots = await tx.approvalPolicyActiveSlot.findMany({ where: {
        actionType: command.actionType, actionSchemaVersionMin: { lte: command.schemaVersion }, actionSchemaVersionMax: { gte: command.schemaVersion },
      }, include: { policy: true }, take: 2 });
      if (slots.length !== 1 || slots[0].policy.mode !== 'approval_required') throw new ConflictException({ code: 'APPROVAL_POLICY_STALE' });
      const slot = slots[0];
      const consumedIntent = await this.intents.consumeWithClient(tx, rawIntentToken, stepUpToken, actor, {
        action: 'approval.request', resourceType: 'ApprovalRequest', resourceVersion: 0,
        payloadHash: computedPayloadHash, targetSetHash: computedTargetSetHash,
        policyHash: slot.policy.policyHash, policyVersion: slot.policy.policyVersion,
      });
      const current = await tx.admin.findUniqueOrThrow({ where: { id: actor.id } });
      const identity = replay.identity;
      const request = await tx.approvalRequest.create({ data: {
        id: consumedIntent.resourceId, actionType: command.actionType,
        schemaVersion: command.schemaVersion, normalizationVersion: command.normalizationVersion,
        adapterVersion: command.adapterVersion, semanticCommand: command.semanticCommand as Prisma.InputJsonValue,
        payloadHash: computedPayloadHash, targetSetHash: computedTargetSetHash,
        policyId: slot.policy.id, policyHash: slot.policy.policyHash, policyVersion: slot.policy.policyVersion,
        requiredApproverCount: slot.policy.requiredApproverCount,
        requesterId: actor.id, requesterTokenVersion: current.tokenVersion,
        requesterMfaVersion: current.mfaVersion, requesterAccountVersion: current.version,
        requesterSessionId: actor.sessionId, idempotencyKeyHash: identity.keyHash, idempotencyKeyId: identity.keyId,
        serverCorrelationId: consumedIntent.serverCorrelationId, expiresAt: command.expiresAt,
        supersedesRequestId: command.supersedesRequestId,
      } });
      const response = { requestId: request.id, state: request.state, version: request.version };
      await this.idempotency.recordWithClient(tx, actor, 'approval.request', identity, requestHash, response, request.id);
      await this.audit.recordWithClient(tx, {
        actorId: actor.id, action: 'approval.request.created', entityType: 'ApprovalRequest', entityId: request.id,
        correlationId: request.serverCorrelationId,
        after: { state: request.state, version: request.version, payloadHash: request.payloadHash, targetSetHash: request.targetSetHash, policyHash: request.policyHash },
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async prepareDecision(actor: GovernanceActor, requestId: string, value: ApprovalDecisionValue, correlationId: string) {
    assertGovernanceEnabled(this.config);
    requireExactGlobalPermission(actor, 'approvals.decide');
    const request = await this.prisma.approvalRequest.findUnique({ where: { id: requestId }, include: { execution: true } });
    if (!request || !['pending', 'approved'].includes(request.state) || request.execution) throw new ConflictException({ code: 'APPROVAL_NOT_DECIDABLE' });
    if (request.requesterId === actor.id) throw new ForbiddenException({ code: 'APPROVAL_SEPARATION_VIOLATION' });
    const intent = await this.intents.issue(actor, {
      action: 'approval.decide', resourceType: 'ApprovalRequest', resourceId: request.id, resourceVersion: request.version,
      payloadHash: request.payloadHash, targetSetHash: request.targetSetHash,
      policyHash: request.policyHash, policyVersion: request.policyVersion, decisionValue: value, correlationId,
    });
    return { intent, requestId, value };
  }

  async decide(actor: GovernanceActor, requestId: string, value: ApprovalDecisionValue, rawIntentToken: string, stepUpToken: string, idempotencyKey: string) {
    const requestHash = payloadHash({ action: 'approval.decide', requestId, value });
    return this.prisma.$transaction(async (tx) => {
      await requireCurrentExactGlobalPermission(tx, actor.id, 'approvals.decide');
      const replay = await this.idempotency.lockAndReplay<{ requestId: string; state: string; version: number }>(tx, actor, 'approval.decide', idempotencyKey, requestHash);
      if (replay.replay) return replay.replay;
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`);
      const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include: { execution: true } });
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`);
      if (request.expiresAt <= clock.now) {
        if (request.state === 'pending' || request.state === 'approved') {
          const expired = await tx.approvalRequest.update({ where: { id: request.id }, data: { state: 'expired', terminalAt: clock.now, version: { increment: 1 } } });
          await this.audit.recordWithClient(tx, { actorId: actor.id, action: 'approval.request.expired', entityType: 'ApprovalRequest', entityId: request.id, correlationId: request.serverCorrelationId, after: { state: expired.state, version: expired.version, reasonCode: 'REQUEST_EXPIRED' } });
          return { requestId: expired.id, state: expired.state, version: expired.version };
        }
        throw new ConflictException({ code: 'APPROVAL_NOT_DECIDABLE' });
      }
      if (!['pending', 'approved'].includes(request.state) || request.execution || request.requesterId === actor.id) throw new ConflictException({ code: 'APPROVAL_NOT_DECIDABLE' });
      const consumedIntent = await this.intents.consumeWithClient(tx, rawIntentToken, stepUpToken, actor, {
        action: 'approval.decide', resourceType: 'ApprovalRequest', resourceId: request.id, resourceVersion: request.version,
        payloadHash: request.payloadHash, targetSetHash: request.targetSetHash,
        policyHash: request.policyHash, policyVersion: request.policyVersion, decisionValue: value,
      });
      const current = await tx.admin.findUniqueOrThrow({ where: { id: actor.id } });
      await tx.approvalDecision.create({ data: {
        requestId: request.id, actorId: actor.id, actorTokenVersion: current.tokenVersion,
        actorMfaVersion: current.mfaVersion, actorAccountVersion: current.version, actorSessionId: actor.sessionId,
        value, authorizationSnapshot: { permission: 'approvals.decide', scopeType: 'global', scopeId: '' },
        policyHash: request.policyHash, payloadHash: request.payloadHash, targetSetHash: request.targetSetHash,
        actionHash: consumedIntent.actionHash, actionIntentId: consumedIntent.id,
        serverCorrelationId: consumedIntent.serverCorrelationId,
      } });
      const effective = await this.effectiveDecisions(tx, request.id);
      const anyReject = effective.some((decision) => decision.value === 'reject');
      const approvals = new Set(effective.filter((decision) => decision.value === 'approve').map((decision) => decision.actorId)).size;
      // Row-lock linearization + reject allowed from approved until execution:
      // a reject that commits before authorization always has precedence.
      const nextState = anyReject ? 'rejected' : approvals >= request.requiredApproverCount ? 'approved' : 'pending';
      const updated = await tx.approvalRequest.update({ where: { id: request.id }, data: {
        state: nextState, version: { increment: 1 }, terminalAt: nextState === 'rejected' ? clock.now : null,
      } });
      const response = { requestId: updated.id, state: updated.state, version: updated.version };
      await this.idempotency.recordWithClient(tx, actor, 'approval.decide', replay.identity, requestHash, response, updated.id);
      await this.audit.recordWithClient(tx, {
        actorId: actor.id, action: nextState === 'rejected' ? 'approval.request.rejected' : nextState === 'approved' ? 'approval.request.approved' : 'approval.decision.recorded',
        entityType: 'ApprovalRequest', entityId: updated.id, correlationId: consumedIntent.serverCorrelationId,
        after: { state: updated.state, version: updated.version, decision: value, payloadHash: request.payloadHash, targetSetHash: request.targetSetHash, policyHash: request.policyHash },
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async prepareExecution(actor: GovernanceActor, requestId: string, correlationId: string) {
    assertGovernanceEnabled(this.config);
    requireExactGlobalPermission(actor, 'approvals.execute');
    const request = await this.prisma.approvalRequest.findUnique({ where: { id: requestId }, include: { execution: true } });
    if (!request || request.state !== 'approved' || request.execution || request.requesterId === actor.id) throw new ConflictException({ code: 'APPROVAL_NOT_EXECUTABLE' });
    const effective = await this.prisma.$transaction((tx) => this.effectiveDecisions(tx, request.id));
    const approvals = new Set(effective.filter((decision) => decision.value === 'approve').map((decision) => decision.actorId)).size;
    if (effective.some((decision) => decision.value === 'reject') || approvals < request.requiredApproverCount) throw new ConflictException({ code: 'APPROVAL_REAPPROVAL_REQUIRED' });
    const evidenceHash = this.decisionEvidenceHash(effective);
    const executionId = randomUUID();
    const intent = await this.intents.issue(actor, {
      action: 'approval.execute', resourceType: 'ApprovalRequest', resourceId: request.id, resourceVersion: request.version,
      payloadHash: request.payloadHash, targetSetHash: request.targetSetHash,
      policyHash: request.policyHash, policyVersion: request.policyVersion,
      approvalEvidenceSetHash: evidenceHash, executionId, correlationId,
    });
    return { intent, requestId, executionId, approvalEvidenceSetHash: evidenceHash };
  }

  async authorizeExecution(actor: GovernanceActor, requestId: string, rawIntentToken: string, stepUpToken: string, idempotencyKey: string) {
    const requestHash = payloadHash({ action: 'approval.execute', requestId });
    return this.prisma.$transaction(async (tx) => {
      await requireCurrentExactGlobalPermission(tx, actor.id, 'approvals.execute');
      const replay = await this.idempotency.lockAndReplay<{ executionId: string; state: string }>(tx, actor, 'approval.execute', idempotencyKey, requestHash);
      if (replay.replay) return replay.replay;
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`);
      const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId }, include: { execution: true } });
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`);
      if (request.expiresAt <= clock.now) {
        const expired = await tx.approvalRequest.update({ where: { id: request.id }, data: { state: 'expired', terminalAt: clock.now, version: { increment: 1 } } });
        await this.audit.recordWithClient(tx, { actorId: actor.id, action: 'approval.request.expired', entityType: 'ApprovalRequest', entityId: request.id, correlationId: request.serverCorrelationId, after: { state: expired.state, version: expired.version, reasonCode: 'REQUEST_EXPIRED' } });
        return { executionId: '', state: 'expired' };
      }
      const active = await tx.approvalPolicyActiveSlot.findUnique({ where: { policyId: request.policyId }, include: { policy: true } });
      const effective = await this.effectiveDecisions(tx, request.id);
      const evidenceHash = this.decisionEvidenceHash(effective);
      const approvals = new Set(effective.filter((decision) => decision.value === 'approve').map((decision) => decision.actorId)).size;
      if (request.state !== 'approved' || request.execution || request.requesterId === actor.id) throw new ConflictException({ code: 'APPROVAL_NOT_EXECUTABLE' });
      if (!active || active.policy.policyHash !== request.policyHash || effective.some((decision) => decision.value === 'reject') ||
        approvals < request.requiredApproverCount) {
        const stale = await tx.approvalRequest.update({ where: { id: request.id }, data: {
          state: 'stale', terminalAt: clock.now, staleReasonCode: 'DECISION_AUTHORIZATION_REVOKED', version: { increment: 1 },
        } });
        await this.audit.recordWithClient(tx, { actorId: actor.id, action: 'approval.request.stale', entityType: 'ApprovalRequest', entityId: request.id, correlationId: request.serverCorrelationId, after: { state: stale.state, version: stale.version, reasonCode: stale.staleReasonCode } });
        return { executionId: '', state: 'stale' };
      }
      const consumedIntent = await this.intents.consumeWithClient(tx, rawIntentToken, stepUpToken, actor, {
        action: 'approval.execute', resourceType: 'ApprovalRequest', resourceId: request.id, resourceVersion: request.version,
        payloadHash: request.payloadHash, targetSetHash: request.targetSetHash,
        policyHash: request.policyHash, policyVersion: request.policyVersion,
        approvalEvidenceSetHash: evidenceHash, requireServerIssuedExecutionId: true,
      });
      const current = await tx.admin.findUniqueOrThrow({ where: { id: actor.id } });
      const execution = await tx.approvalExecution.create({ data: {
        id: consumedIntent.executionId!, requestId: request.id, actorId: actor.id,
        actorTokenVersion: current.tokenVersion, actorMfaVersion: current.mfaVersion,
        actorAccountVersion: current.version, actorSessionId: actor.sessionId,
        approvalEvidenceSetHash: evidenceHash, policyHash: request.policyHash,
        payloadHash: request.payloadHash, targetSetHash: request.targetSetHash,
        actionHash: consumedIntent.actionHash, actionIntentId: consumedIntent.id,
        serverCorrelationId: consumedIntent.serverCorrelationId,
      } });
      const response = { executionId: execution.id, state: execution.state };
      await this.idempotency.recordWithClient(tx, actor, 'approval.execute', replay.identity, requestHash, response, execution.id);
      await this.audit.recordWithClient(tx, {
        actorId: actor.id, action: 'approval.execution.authorized', entityType: 'ApprovalExecution', entityId: execution.id,
        correlationId: execution.serverCorrelationId,
        after: { state: execution.state, approvalEvidenceSetHash: evidenceHash, policyHash: request.policyHash, payloadHash: request.payloadHash, targetSetHash: request.targetSetHash },
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async prepareCancellation(actor: GovernanceActor, requestId: string, correlationId: string) {
    assertGovernanceEnabled(this.config);
    requireExactGlobalPermission(actor, 'approvals.cancel');
    const request = await this.prisma.approvalRequest.findUnique({ where: { id: requestId } });
    if (!request || request.state !== 'pending' || request.requesterId !== actor.id) throw new ConflictException({ code: 'APPROVAL_NOT_CANCELLABLE' });
    const intent = await this.intents.issue(actor, {
      action: 'approval.cancel', resourceType: 'ApprovalRequest', resourceId: request.id, resourceVersion: request.version,
      payloadHash: request.payloadHash, targetSetHash: request.targetSetHash,
      policyHash: request.policyHash, policyVersion: request.policyVersion, correlationId,
    });
    return { intent, requestId };
  }

  async cancel(actor: GovernanceActor, requestId: string, rawIntentToken: string, stepUpToken: string, idempotencyKey: string) {
    const requestHash = payloadHash({ action: 'approval.cancel', requestId });
    return this.prisma.$transaction(async (tx) => {
      await requireCurrentExactGlobalPermission(tx, actor.id, 'approvals.cancel');
      const replay = await this.idempotency.lockAndReplay<{ requestId: string; state: string; version: number }>(tx, actor, 'approval.cancel', idempotencyKey, requestHash);
      if (replay.replay) return replay.replay;
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`);
      const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (request.state !== 'pending' || request.requesterId !== actor.id) throw new ConflictException({ code: 'APPROVAL_NOT_CANCELLABLE' });
      const consumedIntent = await this.intents.consumeWithClient(tx, rawIntentToken, stepUpToken, actor, {
        action: 'approval.cancel', resourceType: 'ApprovalRequest', resourceId: request.id, resourceVersion: request.version,
        payloadHash: request.payloadHash, targetSetHash: request.targetSetHash,
        policyHash: request.policyHash, policyVersion: request.policyVersion,
      });
      const cancelled = await tx.approvalRequest.update({ where: { id: request.id }, data: { state: 'cancelled', terminalAt: new Date(), version: { increment: 1 } } });
      const response = { requestId: cancelled.id, state: cancelled.state, version: cancelled.version };
      await this.idempotency.recordWithClient(tx, actor, 'approval.cancel', replay.identity, requestHash, response, request.id);
      await this.audit.recordWithClient(tx, { actorId: actor.id, action: 'approval.request.cancelled', entityType: 'ApprovalRequest', entityId: request.id, correlationId: consumedIntent.serverCorrelationId, after: { state: cancelled.state, version: cancelled.version } });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async markStale(requestId: string, expectedVersion: number, reasonCode: 'TARGET_VERSION_CHANGED' | 'TARGET_MISSING' | 'POLICY_RETIRED' | 'ADAPTER_INCOMPATIBLE', correlationId: string) {
    assertGovernanceEnabled(this.config);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalRequest" WHERE "id" = ${requestId} FOR UPDATE`);
      const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (!['pending', 'approved'].includes(request.state) || request.version !== expectedVersion) throw new ConflictException({ code: 'APPROVAL_CAS_CONFLICT' });
      const updated = await tx.approvalRequest.update({ where: { id: request.id }, data: { state: 'stale', terminalAt: new Date(), staleReasonCode: reasonCode, version: { increment: 1 } } });
      await this.audit.recordWithClient(tx, { action: 'approval.request.stale', entityType: 'ApprovalRequest', entityId: request.id, correlationId, after: { state: updated.state, version: updated.version, reasonCode } });
      return { requestId: updated.id, state: updated.state, version: updated.version };
    });
  }

  private async effectiveDecisions(tx: Prisma.TransactionClient, requestId: string) {
    const decisions = await tx.approvalDecision.findMany({ where: { requestId }, orderBy: [{ actorId: 'asc' }, { id: 'asc' }] });
    const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`);
    const control = await tx.securityControl.findUnique({ where: { id: 1 } });
    const effective = [];
    for (const decision of decisions) {
      const admin = await tx.admin.findUnique({
        where: { id: decision.actorId },
        include: { roleAssignments: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
      });
      const permitted = admin?.roleAssignments.some((assignment) => assignment.scopeType === 'global' && assignment.scopeId === '' &&
        assignment.role.permissions.some(({ permission }) => permission.key === 'approvals.decide'));
      const session = await tx.staffSession.findUnique({ where: { id: decision.actorSessionId } });
      const sessionEffective = session?.staffUserId === decision.actorId && !session.revokedAt &&
        session.idleExpiresAt > clock.now && session.absoluteExpiresAt > clock.now &&
        session.tokenVersionSnapshot === decision.actorTokenVersion &&
        session.authContractVersion >= (control?.minimumAuthContractVersion ?? Number.MAX_SAFE_INTEGER);
      if (admin?.enabled && admin.status === 'active' && permitted && admin.tokenVersion === decision.actorTokenVersion &&
        admin.mfaVersion === decision.actorMfaVersion && admin.version === decision.actorAccountVersion && sessionEffective &&
        decision.policyHash === request.policyHash && decision.payloadHash === request.payloadHash &&
        decision.targetSetHash === request.targetSetHash) effective.push(decision);
    }
    return effective;
  }

  private decisionEvidenceHash(decisions: ReadonlyArray<{ actorId: string; value: ApprovalDecisionValue; policyHash: string; payloadHash: string; targetSetHash: string }>): string {
    return evidenceSetHash({ decisions: decisions.map((decision) => ({
      actorId: decision.actorId, payloadHash: decision.payloadHash, policyHash: decision.policyHash,
      targetSetHash: decision.targetSetHash, value: decision.value,
    })).sort((left, right) => left.actorId.localeCompare(right.actorId, 'en')) });
  }

  private validateCommand(command: Omit<TrustedApprovalCommand, 'requestId'>): void {
    if (!/^[a-z][a-z0-9_.-]{2,127}$/.test(command.actionType) ||
      !Number.isSafeInteger(command.schemaVersion) || command.schemaVersion < 1 ||
      !Number.isSafeInteger(command.normalizationVersion) || command.normalizationVersion < 1 ||
      !Number.isSafeInteger(command.adapterVersion) || command.adapterVersion < 1 ||
      !(command.expiresAt instanceof Date) || !Number.isFinite(command.expiresAt.getTime()) || command.expiresAt <= new Date() ||
      !Array.isArray(command.targets) || command.targets.length < 1 || command.targets.some((target) =>
        !target.id || !target.type || !Number.isSafeInteger(target.version) || target.version < 0)) {
      throw new ConflictException({ code: 'INVALID_APPROVAL_COMMAND' });
    }
  }
}
