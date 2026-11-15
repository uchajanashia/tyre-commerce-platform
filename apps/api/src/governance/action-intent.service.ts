import { randomBytes } from 'node:crypto';

import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ApprovalDecisionValue, Prisma } from '@prisma/client';

import { MfaService } from '../auth/mfa.service';
import { generateOpaqueToken, parseOpaqueToken } from '../auth/identity-crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GovernanceActor, assertGovernanceEnabled } from './governance-access';
import { GOVERNANCE_CONFIG, GovernanceConfig } from './governance-config';
import { actionHash, actionIntentTokenDigest, constantTimeDigestEqual } from './governance-hash';
import { canonicalJsonText } from './canonical-json';

export const GOVERNANCE_INTENT_ACTIONS = new Set([
  'approval.policy.propose', 'approval.policy.review', 'approval.policy.activate', 'approval.policy.retire',
  'approval.request', 'approval.decide', 'approval.cancel', 'approval.execute',
]);

export interface ActionIntentBindings {
  action: string;
  resourceType: string;
  resourceId: string;
  resourceVersion: number;
  payloadHash?: string;
  targetSetHash?: string;
  policyHash?: string;
  policyVersion?: number;
  approvalEvidenceSetHash?: string;
  decisionValue?: ApprovalDecisionValue;
  executionId?: string;
  reasonCode?: string;
  correlationId: string;
}

export interface ActionIntentExpectation {
  action: string;
  resourceType: string;
  /** Omitted only for a new server-issued resource id, such as a proposal. */
  resourceId?: string;
  resourceVersion: number;
  payloadHash?: string;
  targetSetHash?: string;
  policyHash?: string;
  policyVersion?: number;
  approvalEvidenceSetHash?: string;
  decisionValue?: ApprovalDecisionValue;
  /** Execution ids are generated and persisted by the server-issued intent. */
  requireServerIssuedExecutionId?: boolean;
  reasonCode?: string;
}

export interface IssuedActionIntent {
  intentToken: string;
  actionHash: string;
  expiresAt: string;
  bindings: ActionIntentBindings;
}

@Injectable()
export class ActionIntentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
    @Inject(GOVERNANCE_CONFIG) private readonly config: GovernanceConfig,
  ) {}

  async issue(actor: GovernanceActor, bindings: ActionIntentBindings, ttlSeconds = this.config.actionIntentTtlSeconds): Promise<IssuedActionIntent> {
    assertGovernanceEnabled(this.config);
    if (!GOVERNANCE_INTENT_ACTIONS.has(bindings.action)) throw new ConflictException({ code: 'ACTION_INTENT_UNSUPPORTED' });
    if (!Number.isSafeInteger(bindings.resourceVersion) || bindings.resourceVersion < 0) throw new ConflictException({ code: 'INVALID_RESOURCE_VERSION' });
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > Math.min(300, this.config.actionIntentTtlSeconds)) {
      throw new ConflictException({ code: 'INVALID_ACTION_INTENT_TTL' });
    }
    const ring = this.requireKeys();
    const token = generateOpaqueToken();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
    const nonce = randomBytes(16).toString('base64url');
    const current = await this.prisma.admin.findUnique({ where: { id: actor.id } });
    const session = await this.prisma.staffSession.findUnique({ where: { id: actor.sessionId } });
    if (!current || !current.enabled || current.status !== 'active' || !session || session.staffUserId !== actor.id || session.revokedAt ||
      session.idleExpiresAt <= issuedAt || session.absoluteExpiresAt <= issuedAt || session.tokenVersionSnapshot !== current.tokenVersion) {
      throw new UnauthorizedException({ code: 'SESSION_INVALID' });
    }
    const envelope = {
      action: bindings.action,
      approvalEvidenceSetHash: bindings.approvalEvidenceSetHash ?? null,
      correlationId: bindings.correlationId,
      decisionValue: bindings.decisionValue ?? null,
      executionId: bindings.executionId ?? null,
      expiresAt: expiresAt.toISOString(),
      intentVersion: 1,
      intentId: token.selector,
      issuedAt: issuedAt.toISOString(),
      nonce,
      payloadHash: bindings.payloadHash ?? null,
      policyHash: bindings.policyHash ?? null,
      policyVersion: bindings.policyVersion ?? null,
      resource: { id: bindings.resourceId, type: bindings.resourceType, version: bindings.resourceVersion },
      sessionId: actor.sessionId,
      subjectId: actor.id,
      subjectMfaVersion: current.mfaVersion,
      subjectTokenVersion: current.tokenVersion,
      targetSetHash: bindings.targetSetHash ?? null,
      reasonCode: bindings.reasonCode ?? null,
    };
    const computedActionHash = actionHash(envelope);
    const digestKeyId = ring.currentKeyId;
    await this.prisma.actionIntent.create({
      data: {
        id: token.selector,
        tokenDigest: actionIntentTokenDigest(ring.keys.get(digestKeyId)!.key, token.selector, token.secret),
        digestKeyId,
        semanticEnvelope: envelope,
        actionHash: computedActionHash,
        subjectId: actor.id,
        subjectTokenVersion: current.tokenVersion,
        subjectMfaVersion: current.mfaVersion,
        sessionId: actor.sessionId,
        action: bindings.action,
        resourceType: bindings.resourceType,
        resourceId: bindings.resourceId,
        resourceVersion: bindings.resourceVersion,
        payloadHash: bindings.payloadHash,
        targetSetHash: bindings.targetSetHash,
        policyHash: bindings.policyHash,
        policyVersion: bindings.policyVersion,
        approvalEvidenceSetHash: bindings.approvalEvidenceSetHash,
        decisionValue: bindings.decisionValue,
        executionId: bindings.executionId,
        reasonCode: bindings.reasonCode,
        serverCorrelationId: bindings.correlationId,
        nonce,
        issuedAt,
        expiresAt,
      },
    });
    return { intentToken: token.value, actionHash: computedActionHash, expiresAt: expiresAt.toISOString(), bindings };
  }

  async consumeWithClient(
    tx: Prisma.TransactionClient,
    rawToken: string,
    stepUpToken: string,
    actor: GovernanceActor,
    expected: ActionIntentExpectation,
  ) {
    assertGovernanceEnabled(this.config);
    const parsed = parseOpaqueToken(rawToken);
    if (!parsed) throw this.invalid();
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ActionIntent" WHERE "id" = ${parsed.selector} FOR UPDATE`);
    const intent = await tx.actionIntent.findUnique({ where: { id: parsed.selector } });
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`);
    const staff = await tx.admin.findUnique({ where: { id: actor.id } });
    const session = await tx.staffSession.findUnique({ where: { id: actor.sessionId } });
    const key = intent ? this.requireKeys().keys.get(intent.digestKeyId) : undefined;
    const expectedDigest = key && key.state !== 'revoked'
      ? actionIntentTokenDigest(key.key, parsed.selector, parsed.secret)
      : '';
    const reconstructedEnvelope = intent ? {
      action: intent.action,
      approvalEvidenceSetHash: intent.approvalEvidenceSetHash,
      correlationId: intent.serverCorrelationId,
      decisionValue: intent.decisionValue,
      executionId: intent.executionId,
      expiresAt: intent.expiresAt.toISOString(),
      intentVersion: intent.intentVersion,
      intentId: intent.id,
      issuedAt: intent.issuedAt.toISOString(),
      nonce: intent.nonce,
      payloadHash: intent.payloadHash,
      policyHash: intent.policyHash,
      policyVersion: intent.policyVersion,
      resource: { id: intent.resourceId, type: intent.resourceType, version: intent.resourceVersion },
      sessionId: intent.sessionId,
      subjectId: intent.subjectId,
      subjectMfaVersion: intent.subjectMfaVersion,
      subjectTokenVersion: intent.subjectTokenVersion,
      targetSetHash: intent.targetSetHash,
      reasonCode: intent.reasonCode,
    } : null;
    if (!intent || !key || key.state === 'revoked' || !constantTimeDigestEqual(expectedDigest, intent.tokenDigest) ||
      intent.consumedAt || intent.revokedAt || intent.expiresAt <= clock.now ||
      intent.subjectId !== actor.id || intent.sessionId !== actor.sessionId ||
      intent.action !== expected.action || intent.resourceType !== expected.resourceType ||
      (expected.resourceId !== undefined && intent.resourceId !== expected.resourceId) || intent.resourceVersion !== expected.resourceVersion ||
      intent.payloadHash !== (expected.payloadHash ?? null) || intent.targetSetHash !== (expected.targetSetHash ?? null) ||
      intent.policyHash !== (expected.policyHash ?? null) || intent.policyVersion !== (expected.policyVersion ?? null) ||
      intent.approvalEvidenceSetHash !== (expected.approvalEvidenceSetHash ?? null) ||
      intent.decisionValue !== (expected.decisionValue ?? null) ||
      intent.reasonCode !== (expected.reasonCode ?? null) ||
      (expected.requireServerIssuedExecutionId ? !intent.executionId : intent.executionId !== null) ||
      !reconstructedEnvelope || actionHash(reconstructedEnvelope) !== intent.actionHash ||
      canonicalJsonText(reconstructedEnvelope) !== canonicalJsonText(intent.semanticEnvelope) ||
      !staff || !staff.enabled || staff.status !== 'active' || staff.tokenVersion !== intent.subjectTokenVersion ||
      staff.mfaVersion !== intent.subjectMfaVersion || !session || session.staffUserId !== actor.id || session.revokedAt ||
      session.idleExpiresAt <= clock.now || session.absoluteExpiresAt <= clock.now || session.tokenVersionSnapshot !== staff.tokenVersion) {
      throw this.invalid();
    }
    // Both consumptions are in the caller's transaction; either mutation commits
    // with both, or a failure rolls them all back.
    await this.mfa.consumeStepUp(tx, stepUpToken, actor.id, actor.sessionId, intent.actionHash);
    const updated = await tx.actionIntent.updateMany({
      where: { id: intent.id, consumedAt: null, revokedAt: null }, data: { consumedAt: clock.now },
    });
    if (updated.count !== 1) throw this.invalid();
    return intent;
  }

  private requireKeys() {
    if (!this.config.enabled || !this.config.actionIntentKeys) throw new Error('APPROVAL_PLATFORM_DISABLED');
    return this.config.actionIntentKeys;
  }

  private invalid() { return new UnauthorizedException({ code: 'INVALID_ACTION_INTENT' }); }
}
