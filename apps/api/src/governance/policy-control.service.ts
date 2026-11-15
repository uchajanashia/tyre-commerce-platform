import { randomUUID } from 'node:crypto';

import { ConflictException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ApprovalPolicyMode, ApprovalReviewValue, Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActionIntentService } from './action-intent.service';
import {
  GovernanceActor, assertGovernanceEnabled, requireCurrentExactGlobalPermission, requireExactGlobalPermission,
} from './governance-access';
import { GOVERNANCE_CONFIG, GovernanceConfig } from './governance-config';
import { GovernanceIdempotencyService } from './governance-idempotency.service';
import { evidenceSetHash, payloadHash, policyHash } from './governance-hash';

export interface PolicySemanticInput {
  policyKey: string;
  proposedPolicyVersion: number;
  actionType: string;
  actionSchemaVersionMin: number;
  actionSchemaVersionMax: number;
  mode: ApprovalPolicyMode;
  requiredApproverCount: number;
}

@Injectable()
export class PolicyControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intents: ActionIntentService,
    private readonly idempotency: GovernanceIdempotencyService,
    private readonly audit: AuditService,
    @Inject(GOVERNANCE_CONFIG) private readonly config: GovernanceConfig,
  ) {}

  async prepareProposal(actor: GovernanceActor, input: PolicySemanticInput, correlationId: string) {
    assertGovernanceEnabled(this.config);
    requireExactGlobalPermission(actor, 'approval_policies.propose');
    const requiredReviewCount = this.config.controlPlaneReviewQuorum;
    const evidenceDescriptors = this.config.bootstrapEvidenceDescriptors;
    if (!requiredReviewCount || requiredReviewCount < 2 || !evidenceDescriptors) {
      throw new ServiceUnavailableException({ code: 'BOOTSTRAP_CONTROL_POLICY_UNAVAILABLE' });
    }
    this.validatePolicyInput(input);
    if (!this.config.bootstrapEvidenceVerified && input.mode !== 'disabled') {
      throw new ConflictException({ code: 'BOOTSTRAP_EVIDENCE_REQUIRED_FOR_NON_DISABLED_POLICY' });
    }
    const proposalId = randomUUID();
    const semanticPolicy = this.semanticPolicy(input);
    const computedPolicyHash = policyHash(semanticPolicy);
    const computedEvidenceHash = evidenceSetHash({ descriptors: evidenceDescriptors });
    const intent = await this.intents.issue(actor, {
      action: 'approval.policy.propose', resourceType: 'ApprovalPolicyProposal', resourceId: proposalId,
      resourceVersion: 0, policyHash: computedPolicyHash, policyVersion: input.proposedPolicyVersion,
      approvalEvidenceSetHash: computedEvidenceHash, correlationId,
    });
    return {
      intent, proposalId, semanticPolicy, policyHash: computedPolicyHash,
      evidenceDescriptors, approvalEvidenceSetHash: computedEvidenceHash, requiredReviewCount,
    };
  }

  async propose(
    actor: GovernanceActor,
    input: PolicySemanticInput,
    rawIntentToken: string,
    stepUpToken: string,
    idempotencyKey: string,
  ) {
    assertGovernanceEnabled(this.config);
    this.validatePolicyInput(input);
    const requiredReviewCount = this.config.controlPlaneReviewQuorum;
    const evidenceDescriptors = this.config.bootstrapEvidenceDescriptors;
    if (!requiredReviewCount || requiredReviewCount < 2 || !evidenceDescriptors) throw new ServiceUnavailableException({ code: 'BOOTSTRAP_CONTROL_POLICY_UNAVAILABLE' });
    if (!this.config.bootstrapEvidenceVerified && input.mode !== 'disabled') throw new ConflictException({ code: 'BOOTSTRAP_EVIDENCE_REQUIRED_FOR_NON_DISABLED_POLICY' });
    const semanticPolicy = this.semanticPolicy(input);
    const computedPolicyHash = policyHash(semanticPolicy);
    const computedEvidenceHash = evidenceSetHash({ descriptors: evidenceDescriptors });
    const requestHash = payloadHash({
      action: 'approval.policy.propose', semanticPolicy,
      policyHash: computedPolicyHash, evidenceHash: computedEvidenceHash,
    });
    return this.prisma.$transaction(async (tx) => {
      await requireCurrentExactGlobalPermission(tx, actor.id, 'approval_policies.propose');
      const replay = await this.idempotency.lockAndReplay<{ proposalId: string; state: string; version: number }>(
        tx, actor, 'approval.policy.propose', idempotencyKey, requestHash,
      );
      if (replay.replay) return replay.replay;
      await tx.$queryRaw(Prisma.sql`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${input.policyKey}, 0))`);
      const latest = await tx.approvalPolicyProposal.findFirst({
        where: { policyKey: input.policyKey },
        orderBy: { proposedPolicyVersion: 'desc' }, select: { proposedPolicyVersion: true },
      });
      const expectedVersion = (latest?.proposedPolicyVersion ?? 0) + 1;
      if (input.proposedPolicyVersion !== expectedVersion) throw new ConflictException({ code: 'POLICY_VERSION_CONFLICT' });
      const consumedIntent = await this.intents.consumeWithClient(tx, rawIntentToken, stepUpToken, actor, {
        action: 'approval.policy.propose', resourceType: 'ApprovalPolicyProposal', resourceVersion: 0,
        policyHash: computedPolicyHash, policyVersion: input.proposedPolicyVersion,
        approvalEvidenceSetHash: computedEvidenceHash,
      });
      const proposal = await tx.approvalPolicyProposal.create({
        data: {
          id: consumedIntent.resourceId,
          policyKey: input.policyKey,
          proposedPolicyVersion: input.proposedPolicyVersion,
          actionType: input.actionType,
          actionSchemaVersionMin: input.actionSchemaVersionMin,
          actionSchemaVersionMax: input.actionSchemaVersionMax,
          mode: input.mode,
          requiredReviewCount,
          requiredApproverCount: input.requiredApproverCount,
          semanticPolicy: semanticPolicy as Prisma.InputJsonValue,
          policyHash: computedPolicyHash,
          d05EvidenceDescriptors: evidenceDescriptors as Prisma.InputJsonValue,
          approvalEvidenceSetHash: computedEvidenceHash,
          proposerId: actor.id,
          proposerTokenVersion: (await tx.admin.findUniqueOrThrow({ where: { id: actor.id } })).tokenVersion,
          proposerMfaVersion: (await tx.admin.findUniqueOrThrow({ where: { id: actor.id } })).mfaVersion,
          proposerSessionId: actor.sessionId,
          serverCorrelationId: consumedIntent.serverCorrelationId,
        },
      });
      const response = { proposalId: proposal.id, state: proposal.state, version: proposal.version };
      await this.idempotency.recordWithClient(tx, actor, 'approval.policy.propose', replay.identity, requestHash, response, proposal.id);
      await this.audit.recordWithClient(tx, {
        actorId: actor.id, action: 'approval.policy.proposed', entityType: 'ApprovalPolicyProposal', entityId: proposal.id,
        correlationId: proposal.serverCorrelationId,
        after: { state: proposal.state, version: proposal.version, policyHash: proposal.policyHash },
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async prepareReview(actor: GovernanceActor, proposalId: string, value: ApprovalReviewValue, correlationId: string) {
    assertGovernanceEnabled(this.config);
    requireExactGlobalPermission(actor, 'approval_policies.review');
    const proposal = await this.prisma.approvalPolicyProposal.findUnique({ where: { id: proposalId } });
    if (!proposal || !['proposed', 'under_review', 'approved'].includes(proposal.state) || (proposal.state === 'approved' && value !== 'reject')) throw new ConflictException({ code: 'POLICY_PROPOSAL_NOT_REVIEWABLE' });
    if (proposal.proposerId === actor.id) throw new ForbiddenException({ code: 'POLICY_SEPARATION_VIOLATION' });
    const intent = await this.intents.issue(actor, {
      action: 'approval.policy.review', resourceType: 'ApprovalPolicyProposal', resourceId: proposal.id,
      resourceVersion: proposal.version, policyHash: proposal.policyHash, policyVersion: proposal.proposedPolicyVersion,
      approvalEvidenceSetHash: proposal.approvalEvidenceSetHash, decisionValue: value, correlationId,
    });
    return { intent, proposalId, value, policyHash: proposal.policyHash, evidenceHash: proposal.approvalEvidenceSetHash };
  }

  async review(
    actor: GovernanceActor,
    proposalId: string,
    value: ApprovalReviewValue,
    rawIntentToken: string,
    stepUpToken: string,
    idempotencyKey: string,
  ) {
    const requestHash = payloadHash({ action: 'approval.policy.review', proposalId, value });
    return this.prisma.$transaction(async (tx) => {
      await requireCurrentExactGlobalPermission(tx, actor.id, 'approval_policies.review');
      const replay = await this.idempotency.lockAndReplay<{ proposalId: string; state: string; version: number }>(tx, actor, 'approval.policy.review', idempotencyKey, requestHash);
      if (replay.replay) return replay.replay;
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalPolicyProposal" WHERE "id" = ${proposalId} FOR UPDATE`);
      const proposal = await tx.approvalPolicyProposal.findUniqueOrThrow({ where: { id: proposalId } });
      if (!['proposed', 'under_review', 'approved'].includes(proposal.state) || (proposal.state === 'approved' && value !== 'reject') ||
        proposal.proposerId === actor.id) {
        throw new ConflictException({ code: 'POLICY_PROPOSAL_STALE' });
      }
      const consumedIntent = await this.intents.consumeWithClient(tx, rawIntentToken, stepUpToken, actor, {
        action: 'approval.policy.review', resourceType: 'ApprovalPolicyProposal', resourceId: proposal.id,
        resourceVersion: proposal.version, policyHash: proposal.policyHash, policyVersion: proposal.proposedPolicyVersion,
        approvalEvidenceSetHash: proposal.approvalEvidenceSetHash, decisionValue: value,
      });
      const currentActor = await tx.admin.findUniqueOrThrow({ where: { id: actor.id } });
      await tx.approvalPolicyReviewDecision.create({
        data: {
          proposalId: proposal.id, reviewerId: actor.id, reviewerTokenVersion: currentActor.tokenVersion,
          reviewerMfaVersion: currentActor.mfaVersion, reviewerAccountVersion: currentActor.version,
          reviewerSessionId: actor.sessionId, value, policyHash: proposal.policyHash,
          evidenceHash: proposal.approvalEvidenceSetHash,
          authorizationSnapshot: { permission: 'approval_policies.review', scopeType: 'global', scopeId: '' },
          actionHash: consumedIntent.actionHash, actionIntentId: consumedIntent.id,
          serverCorrelationId: consumedIntent.serverCorrelationId,
        },
      });
      const reviews = await this.effectiveReviews(tx, proposal.id);
      const anyReject = reviews.some((decision) => decision.value === 'reject');
      const approveCount = new Set(reviews.filter((decision) => decision.value === 'approve').map((decision) => decision.reviewerId)).size;
      let nextState: 'under_review' | 'approved' | 'rejected' = 'under_review';
      if (anyReject) nextState = 'rejected';
      else if (approveCount >= proposal.requiredReviewCount) nextState = 'approved';
      const reviewEvidenceHash = nextState === 'approved' ? this.reviewEvidenceHash(reviews) : null;
      await tx.approvalPolicyProposal.update({
        where: { id: proposal.id },
        data: { state: nextState, version: { increment: 1 }, decidedAt: nextState === 'under_review' ? null : new Date(), reviewEvidenceSetHash: reviewEvidenceHash },
      });
      if (nextState === 'approved') {
        await tx.approvalPolicy.create({
          data: {
            proposalId: proposal.id, policyKey: proposal.policyKey, policyVersion: proposal.proposedPolicyVersion,
            actionType: proposal.actionType, actionSchemaVersionMin: proposal.actionSchemaVersionMin,
            actionSchemaVersionMax: proposal.actionSchemaVersionMax, mode: proposal.mode,
            requiredApproverCount: proposal.requiredApproverCount, semanticPolicy: proposal.semanticPolicy as Prisma.InputJsonValue,
            policyHash: proposal.policyHash, approvalEvidenceSetHash: reviewEvidenceHash!,
          },
        });
      }
      const updated = await tx.approvalPolicyProposal.findUniqueOrThrow({ where: { id: proposal.id } });
      const response = { proposalId: updated.id, state: updated.state, version: updated.version };
      await this.idempotency.recordWithClient(tx, actor, 'approval.policy.review', replay.identity, requestHash, response, updated.id);
      await this.audit.recordWithClient(tx, {
        actorId: actor.id, action: nextState === 'rejected' ? 'approval.policy.rejected' : nextState === 'approved' ? 'approval.policy.approved' : 'approval.policy.reviewed',
        entityType: 'ApprovalPolicyProposal', entityId: updated.id, correlationId: consumedIntent.serverCorrelationId,
        after: { state: updated.state, version: updated.version, policyHash: updated.policyHash, decision: value },
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async prepareActivation(actor: GovernanceActor, proposalId: string, correlationId: string) {
    assertGovernanceEnabled(this.config);
    requireExactGlobalPermission(actor, 'approval_policies.activate');
    const proposal = await this.prisma.approvalPolicyProposal.findUnique({ where: { id: proposalId }, include: { policy: true, reviews: true } });
    if (!proposal?.policy || proposal.state !== 'approved') throw new ConflictException({ code: 'POLICY_NOT_APPROVED' });
    if (proposal.proposerId === actor.id || proposal.reviews.some((review) => review.reviewerId === actor.id)) throw new ForbiddenException({ code: 'POLICY_SEPARATION_VIOLATION' });
    const intent = await this.intents.issue(actor, {
      action: 'approval.policy.activate', resourceType: 'ApprovalPolicyProposal', resourceId: proposal.id,
      resourceVersion: proposal.version, policyHash: proposal.policyHash, policyVersion: proposal.proposedPolicyVersion,
      approvalEvidenceSetHash: proposal.policy.approvalEvidenceSetHash, correlationId,
    });
    return { intent, proposalId, policyId: proposal.policy.id };
  }

  async activate(actor: GovernanceActor, proposalId: string, rawIntentToken: string, stepUpToken: string, idempotencyKey: string) {
    if (!this.config.bootstrapEvidenceVerified) throw new ServiceUnavailableException({ code: 'BOOTSTRAP_EVIDENCE_NOT_VERIFIED' });
    const requestHash = payloadHash({ action: 'approval.policy.activate', proposalId });
    return this.prisma.$transaction(async (tx) => {
      await requireCurrentExactGlobalPermission(tx, actor.id, 'approval_policies.activate');
      const replay = await this.idempotency.lockAndReplay<{ policyId: string; state: string }>(tx, actor, 'approval.policy.activate', idempotencyKey, requestHash);
      if (replay.replay) return replay.replay;
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ApprovalPolicyProposal" WHERE "id" = ${proposalId} FOR UPDATE`);
      const proposal = await tx.approvalPolicyProposal.findUniqueOrThrow({ where: { id: proposalId }, include: { policy: true, reviews: true } });
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`);
      const effectiveReviews = await this.effectiveReviews(tx, proposal.id);
      const effectiveEvidenceHash = this.reviewEvidenceHash(effectiveReviews);
      const effectiveApprovals = new Set(effectiveReviews.filter((review) => review.value === 'approve').map((review) => review.reviewerId)).size;
      const exactD05EvidenceHash = evidenceSetHash({ descriptors: this.config.bootstrapEvidenceDescriptors ?? [] });
      const bootstrapAdmission = await tx.approvalBootstrapEvidenceAdmission.findUnique({ where: { approvalEvidenceSetHash: exactD05EvidenceHash } });
      if (!proposal.policy || proposal.state !== 'approved' || proposal.proposerId === actor.id ||
        proposal.reviews.some((review) => review.reviewerId === actor.id)) throw new ConflictException({ code: 'POLICY_ACTIVATION_DENIED' });
      if (policyHash(proposal.semanticPolicy) !== proposal.policyHash || proposal.policy.policyHash !== proposal.policyHash ||
        proposal.approvalEvidenceSetHash !== exactD05EvidenceHash || !bootstrapAdmission || bootstrapAdmission.revokedAt ||
        bootstrapAdmission.verifiedAt > clock.now || (bootstrapAdmission.expiresAt && bootstrapAdmission.expiresAt <= clock.now) ||
        effectiveReviews.some((review) => review.value === 'reject') ||
        effectiveApprovals < proposal.requiredReviewCount || !proposal.reviewEvidenceSetHash ||
        proposal.reviewEvidenceSetHash !== effectiveEvidenceHash || proposal.policy.approvalEvidenceSetHash !== effectiveEvidenceHash) {
        throw new ConflictException({ code: 'POLICY_EVIDENCE_INVALIDATED' });
      }
      const consumedIntent = await this.intents.consumeWithClient(tx, rawIntentToken, stepUpToken, actor, {
        action: 'approval.policy.activate', resourceType: 'ApprovalPolicyProposal', resourceId: proposal.id,
        resourceVersion: proposal.version, policyHash: proposal.policyHash, policyVersion: proposal.proposedPolicyVersion,
        approvalEvidenceSetHash: effectiveEvidenceHash,
      });
      const current = await tx.admin.findUniqueOrThrow({ where: { id: actor.id } });
      await tx.approvalPolicyActivation.create({ data: {
        proposalId: proposal.id, policyId: proposal.policy.id, kind: 'activate', actorId: actor.id,
        actorTokenVersion: current.tokenVersion, actorMfaVersion: current.mfaVersion, actorSessionId: actor.sessionId,
        policyHash: proposal.policyHash, approvalEvidenceSetHash: effectiveEvidenceHash,
        actionHash: consumedIntent.actionHash, actionIntentId: consumedIntent.id,
        serverCorrelationId: consumedIntent.serverCorrelationId,
      } });
      await tx.approvalPolicyActiveSlot.create({ data: {
        policyKey: proposal.policyKey, actionType: proposal.actionType, actionSchemaVersionMin: proposal.actionSchemaVersionMin,
        actionSchemaVersionMax: proposal.actionSchemaVersionMax, policyId: proposal.policy.id,
      } });
      await tx.approvalPolicyProposal.update({ where: { id: proposal.id }, data: { state: 'active', version: { increment: 1 } } });
      const response = { policyId: proposal.policy.id, state: 'active' };
      await this.idempotency.recordWithClient(tx, actor, 'approval.policy.activate', replay.identity, requestHash, response, proposal.policy.id);
      await this.audit.recordWithClient(tx, { actorId: actor.id, action: 'approval.policy.activated', entityType: 'ApprovalPolicy', entityId: proposal.policy.id, correlationId: consumedIntent.serverCorrelationId, after: { state: 'active', policyHash: proposal.policyHash } });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async prepareRetirement(actor: GovernanceActor, policyId: string, reasonCode: 'SUPERSEDED' | 'CONTROL_REVIEW' | 'SAFETY_DISABLE', correlationId: string) {
    assertGovernanceEnabled(this.config);
    requireExactGlobalPermission(actor, 'approval_policies.retire');
    const policy = await this.prisma.approvalPolicy.findUnique({ where: { id: policyId }, include: { proposal: true, activeSlot: true } });
    if (!policy?.activeSlot || policy.proposal.state !== 'active') throw new ConflictException({ code: 'POLICY_NOT_ACTIVE' });
    const intent = await this.intents.issue(actor, {
      action: 'approval.policy.retire', resourceType: 'ApprovalPolicy', resourceId: policy.id,
      resourceVersion: policy.activeSlot.version, policyHash: policy.policyHash, policyVersion: policy.policyVersion,
      approvalEvidenceSetHash: policy.approvalEvidenceSetHash, reasonCode, correlationId,
    });
    return { intent, policyId, proposalId: policy.proposalId, reasonCode };
  }

  async retire(actor: GovernanceActor, policyId: string, reasonCode: 'SUPERSEDED' | 'CONTROL_REVIEW' | 'SAFETY_DISABLE', rawIntentToken: string, stepUpToken: string, idempotencyKey: string) {
    const requestHash = payloadHash({ action: 'approval.policy.retire', policyId, reasonCode });
    return this.prisma.$transaction(async (tx) => {
      await requireCurrentExactGlobalPermission(tx, actor.id, 'approval_policies.retire');
      const replay = await this.idempotency.lockAndReplay<{ policyId: string; state: string }>(tx, actor, 'approval.policy.retire', idempotencyKey, requestHash);
      if (replay.replay) return replay.replay;
      await tx.$queryRaw(Prisma.sql`SELECT "policyId" FROM "ApprovalPolicyActiveSlot" WHERE "policyId" = ${policyId} FOR UPDATE`);
      const policy = await tx.approvalPolicy.findUniqueOrThrow({ where: { id: policyId }, include: { proposal: true, activeSlot: true } });
      if (!policy.activeSlot || policy.proposal.state !== 'active') throw new ConflictException({ code: 'POLICY_NOT_ACTIVE' });
      const consumedIntent = await this.intents.consumeWithClient(tx, rawIntentToken, stepUpToken, actor, {
        action: 'approval.policy.retire', resourceType: 'ApprovalPolicy', resourceId: policy.id,
        resourceVersion: policy.activeSlot.version, policyHash: policy.policyHash, policyVersion: policy.policyVersion,
        approvalEvidenceSetHash: policy.approvalEvidenceSetHash, reasonCode,
      });
      const current = await tx.admin.findUniqueOrThrow({ where: { id: actor.id } });
      await tx.approvalPolicyActivation.create({ data: {
        proposalId: policy.proposalId, policyId: policy.id, kind: 'retire', actorId: actor.id,
        actorTokenVersion: current.tokenVersion, actorMfaVersion: current.mfaVersion,
        actorSessionId: actor.sessionId, policyHash: policy.policyHash,
        approvalEvidenceSetHash: policy.approvalEvidenceSetHash, actionHash: consumedIntent.actionHash,
        actionIntentId: consumedIntent.id, reasonCode,
        serverCorrelationId: consumedIntent.serverCorrelationId,
      } });
      const deleted = await tx.approvalPolicyActiveSlot.deleteMany({ where: { policyId: policy.id, version: policy.activeSlot.version } });
      if (deleted.count !== 1) throw new ConflictException({ code: 'POLICY_CAS_CONFLICT' });
      await tx.approvalPolicyProposal.update({ where: { id: policy.proposalId }, data: { state: 'retired', version: { increment: 1 } } });
      const response = { policyId: policy.id, state: 'retired' };
      await this.idempotency.recordWithClient(tx, actor, 'approval.policy.retire', replay.identity, requestHash, response, policy.id);
      await this.audit.recordWithClient(tx, { actorId: actor.id, action: 'approval.policy.retired', entityType: 'ApprovalPolicy', entityId: policy.id, correlationId: consumedIntent.serverCorrelationId, after: { state: 'retired', policyHash: policy.policyHash, reasonCode } });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async effectiveReviews(tx: Prisma.TransactionClient, proposalId: string) {
    const decisions = await tx.approvalPolicyReviewDecision.findMany({ where: { proposalId }, orderBy: [{ reviewerId: 'asc' }, { id: 'asc' }] });
    const proposal = await tx.approvalPolicyProposal.findUniqueOrThrow({ where: { id: proposalId } });
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`);
    const control = await tx.securityControl.findUnique({ where: { id: 1 } });
    const effective = [];
    for (const decision of decisions) {
      const admin = await tx.admin.findUnique({
        where: { id: decision.reviewerId },
        include: { roleAssignments: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
      });
      const permitted = admin?.roleAssignments.some((assignment) => assignment.scopeType === 'global' && assignment.scopeId === '' &&
        assignment.role.permissions.some(({ permission }) => permission.key === 'approval_policies.review'));
      const session = await tx.staffSession.findUnique({ where: { id: decision.reviewerSessionId } });
      const sessionEffective = session?.staffUserId === decision.reviewerId && !session.revokedAt &&
        session.idleExpiresAt > clock.now && session.absoluteExpiresAt > clock.now &&
        session.tokenVersionSnapshot === decision.reviewerTokenVersion &&
        session.authContractVersion >= (control?.minimumAuthContractVersion ?? Number.MAX_SAFE_INTEGER);
      if (admin?.enabled && admin.status === 'active' && permitted && admin.tokenVersion === decision.reviewerTokenVersion &&
        admin.mfaVersion === decision.reviewerMfaVersion && admin.version === decision.reviewerAccountVersion && sessionEffective &&
        decision.policyHash === proposal.policyHash && decision.evidenceHash === proposal.approvalEvidenceSetHash) effective.push(decision);
    }
    return effective;
  }

  private reviewEvidenceHash(reviews: Awaited<ReturnType<PolicyControlService['effectiveReviews']>>): string {
    return evidenceSetHash({ decisions: reviews.map((decision) => ({
      actorId: decision.reviewerId, evidenceHash: decision.evidenceHash, policyHash: decision.policyHash,
      value: decision.value,
    })).sort((left, right) => left.actorId.localeCompare(right.actorId, 'en')) });
  }

  private semanticPolicy(input: PolicySemanticInput): Record<string, unknown> {
    return {
      actionSchemaVersionMax: input.actionSchemaVersionMax,
      actionSchemaVersionMin: input.actionSchemaVersionMin,
      actionType: input.actionType,
      mode: input.mode,
      policyKey: input.policyKey,
      proposedPolicyVersion: input.proposedPolicyVersion,
      requiredApproverCount: input.requiredApproverCount,
    };
  }

  private validatePolicyInput(input: PolicySemanticInput): void {
    if (!/^[a-z][a-z0-9_.-]{2,127}$/.test(input.policyKey) || !/^[a-z][a-z0-9_.-]{2,127}$/.test(input.actionType) ||
      !Number.isSafeInteger(input.proposedPolicyVersion) || input.proposedPolicyVersion < 1 ||
      !Number.isSafeInteger(input.actionSchemaVersionMin) || input.actionSchemaVersionMin < 1 ||
      !Number.isSafeInteger(input.actionSchemaVersionMax) || input.actionSchemaVersionMax < input.actionSchemaVersionMin ||
      !Number.isSafeInteger(input.requiredApproverCount) || input.requiredApproverCount < 0 ||
      (input.mode === 'disabled' ? input.requiredApproverCount !== 0 : input.requiredApproverCount < 1)) {
      throw new ConflictException({ code: 'INVALID_POLICY_SEMANTICS' });
    }
  }
}
