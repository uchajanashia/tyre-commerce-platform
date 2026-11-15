import { randomUUID } from 'node:crypto';

import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { derivePermissionGrants, RoleAssignmentProjection } from './permission-evaluator';
import {
  decryptAead,
  constantTimeTextEqual,
  generateOpaqueToken,
  keyedDigest,
  matchTotpStep,
  normalizeStaffEmail,
  parseOpaqueToken,
  tokenDigest,
  verifyTokenDigest,
} from './identity-crypto';
import { IDENTITY_CONFIG, IdentityConfig } from './identity-config';
import { PasswordKdfService } from './password-kdf.service';
import { StaffSessionService } from './staff-session.service';
import { AuthThrottleService } from './auth-throttle.service';
import { MfaService } from './mfa.service';
import { commandHash } from './identity-command';

export interface StaffProjection {
  id: string;
  email: string;
  displayName?: string;
  role: string;
  enabled: boolean;
  status: 'invited' | 'pending_activation' | 'active' | 'disabled';
  mfaRequired: boolean;
  mfaEnrolled: boolean;
  version: number;
  permissions: string[];
  permissionGrants: ReturnType<typeof derivePermissionGrants>;
}

export type V1LoginResult =
  | { status: 'mfa_required'; challengeToken: string; expiresAt: string }
  | { status: 'authenticated'; accessToken: string; accessExpiresAt: string; refreshToken: string; staff: StaffProjection };

@Injectable()
export class IdentityAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordKdfService,
    private readonly sessions: StaffSessionService,
    private readonly audit: AuditService,
    private readonly throttle: AuthThrottleService,
    private readonly mfa: MfaService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  assertEnabled(): void {
    if (!this.config.enabled) throw new ServiceUnavailableException({ code: 'IDENTITY_V2_DISABLED' });
  }

  async login(email: string, password: string, sourceIp = 'unknown'): Promise<V1LoginResult> {
    this.assertEnabled();
    try {
      await this.throttle.consumeWindow('login_ip', sourceIp, 'minute', 5, 60_000);
      await this.throttle.consumeWindow('login_ip', sourceIp, 'hour', 30, 60 * 60_000);
    } catch (error) {
      await this.recordLoginAudit('auth.login.rate_limited', undefined, sourceIp);
      throw error;
    }
    let emailNormalized: string;
    try {
      emailNormalized = normalizeStaffEmail(email);
    } catch {
      await this.passwords.verify(null, password);
      await this.throttle.recordLoginFailure(email.trim().normalize('NFKC').toLowerCase());
      await this.recordLoginAudit('auth.login.failed', undefined, sourceIp);
      throw this.invalidCredentials();
    }
    try {
      await this.throttle.assertAccountAvailable(emailNormalized);
    } catch (error) {
      await this.recordLoginAudit('auth.login.rate_limited', undefined, sourceIp);
      throw error;
    }
    let staff = await this.prisma.admin.findUnique({
      where: { emailNormalized },
      include: this.staffInclude(),
    });
    const verification = await this.passwords.verify(staff?.passwordHash, password);
    if (!staff || !verification.valid || staff.status !== 'active' || !staff.enabled) {
      await this.throttle.recordLoginFailure(emailNormalized);
      await this.recordLoginAudit('auth.login.failed', staff?.id, sourceIp);
      throw this.invalidCredentials();
    }

    if (verification.needsRehash) {
      const newHash = await this.passwords.hash(password);
      const updated = await this.prisma.admin.updateMany({
        where: { id: staff.id, passwordHash: staff.passwordHash, tokenVersion: staff.tokenVersion, status: 'active', enabled: true },
        data: {
          passwordHash: newHash,
          passwordChangedAt: new Date(),
          credentialVersion: { increment: 1 },
          tokenVersion: { increment: 1 },
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        await this.throttle.recordLoginFailure(emailNormalized);
        await this.recordLoginAudit('auth.login.failed', staff.id, sourceIp);
        throw this.invalidCredentials();
      }
      staff = await this.prisma.admin.findUniqueOrThrow({ where: { id: staff.id }, include: this.staffInclude() });
    }

    const confirmed = staff.mfaCredentials.find((credential) => credential.status === 'confirmed');
    if (staff.mfaRequired || confirmed) {
      if (!confirmed) throw this.invalidCredentials();
      const challenge = generateOpaqueToken();
      const expiresAt = new Date(Date.now() + 5 * 60_000);
      await this.prisma.$transaction(async (tx) => {
        await tx.authChallenge.updateMany({
          where: { staffUserId: staff.id, purpose: 'login_mfa', consumedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.authChallenge.create({
          data: {
            id: challenge.selector,
            staffUserId: staff.id,
            purpose: 'login_mfa',
            tokenDigest: tokenDigest(this.requireDigestRing(), this.requireDigestRing().currentKeyId, 'challenge:login_mfa', challenge, staff.id),
            digestKeyId: this.requireDigestRing().currentKeyId,
            tokenVersionSnapshot: staff.tokenVersion,
            credentialVersionSnapshot: staff.credentialVersion,
            mfaVersionSnapshot: staff.mfaVersion,
            credentialId: confirmed.id,
            credentialRecordVersion: confirmed.version,
            expiresAt,
          },
        });
      });
      return { status: 'mfa_required', challengeToken: challenge.value, expiresAt: expiresAt.toISOString() };
    }

    const session = await this.sessions.createSession(staff, 'password', null);
    await this.throttle.resetLoginFailures(emailNormalized);
    await this.recordLoginAudit('auth.login.succeeded', staff.id, sourceIp, { mfaChallengeIssued: false });
    return {
      status: 'authenticated', accessToken: session.accessToken, accessExpiresAt: session.accessExpiresAt,
      refreshToken: session.refreshToken, staff: this.project(staff),
    };
  }

  async completeLoginMfa(challengeValue: string, code: string, sourceIp = 'unknown'): Promise<Extract<V1LoginResult, { status: 'authenticated' }>> {
    this.assertEnabled();
    const token = parseOpaqueToken(challengeValue);
    if (!token) throw this.invalidChallenge();
    const challengeOwner = await this.prisma.authChallenge.findUnique({ where: { id: token.selector }, select: { staffUserId: true } });
    if (challengeOwner) await this.throttle.assertMfaAvailable(challengeOwner.staffUserId);
    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "AuthChallenge" WHERE "id" = ${token.selector} FOR UPDATE`,
      );
      if (locked.length !== 1) return null;
      const challenge = await tx.authChallenge.findUnique({
        where: { id: token.selector },
        include: { staffUser: { include: this.staffInclude() }, credential: true },
      });
      if (!challenge || !verifyTokenDigest(this.requireDigestRing(), challenge.digestKeyId, 'challenge:login_mfa', token, challenge.staffUserId, challenge.tokenDigest)) return null;
      const staff = challenge.staffUser;
      const credential = challenge.credential;
      if (
        challenge.purpose !== 'login_mfa' || challenge.consumedAt || challenge.revokedAt ||
        challenge.expiresAt.getTime() <= Date.now() || challenge.remainingAttempts <= 0 ||
        staff.status !== 'active' || !staff.enabled || staff.tokenVersion !== challenge.tokenVersionSnapshot ||
        staff.credentialVersion !== challenge.credentialVersionSnapshot || staff.mfaVersion !== challenge.mfaVersionSnapshot ||
        !credential || credential.status !== 'confirmed' || credential.version !== challenge.credentialRecordVersion
      ) return null;

      let authMethod: 'password_totp' | 'password_recovery_code' | null = null;
      let auditCredentialId = credential.id;
      if (/^\d{6}$/.test(code)) {
        let matchedStep: number | null = null;
        try {
          const secret = decryptAead(this.requireTotpRing(), {
            keyId: credential.encryptionKeyId,
            nonce: Buffer.from(credential.nonce),
            ciphertext: Buffer.from(credential.secretCiphertext),
            authTag: Buffer.from(credential.authTag),
          }, ['mfa-credential', credential.id, staff.id, 'totp', String(credential.version)]).toString('utf8');
          matchedStep = matchTotpStep(secret, code);
        } catch {
          matchedStep = null;
        }
        if (matchedStep !== null) {
          const replayFence = await tx.mfaCredential.updateMany({
            where: { id: credential.id, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: matchedStep } }] },
            data: { lastUsedStep: matchedStep },
          });
          if (replayFence.count === 1) authMethod = 'password_totp';
        }
      } else if (/^[A-Za-z0-9_-]{22}$/.test(code)) {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "MfaRecoveryCode"
          WHERE "staffUserId" = ${staff.id} AND "usedAt" IS NULL AND "revokedAt" IS NULL
          ORDER BY "id" FOR UPDATE
        `);
        const candidates = await tx.mfaRecoveryCode.findMany({
          where: { staffUserId: staff.id, usedAt: null, revokedAt: null },
        });
        const matched = candidates.find((candidate) => {
          try {
            const expected = keyedDigest(
              this.requireDigestRing(), candidate.digestKeyId, 'mfa-recovery-code',
              [staff.id, candidate.id, code],
            );
            return constantTimeTextEqual(expected, candidate.codeDigest);
          } catch {
            return false;
          }
        });
        if (matched) {
          const consumed = await tx.mfaRecoveryCode.updateMany({
            where: { id: matched.id, staffUserId: staff.id, usedAt: null, revokedAt: null },
            data: { usedAt: new Date() },
          });
          if (consumed.count === 1) {
            authMethod = 'password_recovery_code';
            auditCredentialId = matched.id;
            await this.audit.recordWithClient(tx, {
              actorId: staff.id, correlationId: randomUUID(),
              action: 'auth.mfa.recovery_code.used', entityType: 'MfaRecoveryCode', entityId: matched.id,
              metadata: { challengeId: challenge.id, purpose: 'login_mfa' },
            });
          }
        }
      }
      if (!authMethod) {
        await this.throttle.recordMfaFailureWithClient(tx, staff.id);
        await tx.authChallenge.update({
          where: { id: challenge.id },
          data: { remainingAttempts: { decrement: 1 }, ...(challenge.remainingAttempts === 1 ? { revokedAt: new Date() } : {}) },
        });
        await this.audit.recordWithClient(tx, {
          actorId: staff.id, correlationId: randomUUID(),
          action: 'auth.mfa.challenge.failed', entityType: 'AuthChallenge', entityId: challenge.id,
          metadata: { purpose: 'login_mfa', remainingAttempts: challenge.remainingAttempts - 1 },
        });
        return null;
      }
      await tx.authChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
      await this.audit.recordWithClient(tx, {
        actorId: staff.id,
        actorEmail: staff.email,
        correlationId: randomUUID(),
        action: 'auth.mfa.challenge.succeeded',
        entityType: 'AuthChallenge',
        entityId: challenge.id,
        metadata: { purpose: challenge.purpose, credentialId: auditCredentialId, authMethod },
      });
      const session = await this.sessions.createSessionWithClient(tx, staff, authMethod, new Date());
      return { staff, session };
    });
    if (!result) throw this.invalidChallenge();
    if (!result.staff.emailNormalized) throw new Error('CANONICAL_IDENTITY_MARKER_INCONSISTENT');
    await this.throttle.resetLoginFailures(result.staff.emailNormalized);
    await this.throttle.resetMfaFailures(result.staff.id);
    await this.recordLoginAudit('auth.login.succeeded', result.staff.id, sourceIp, { mfaChallengeIssued: true });
    return {
      status: 'authenticated', accessToken: result.session.accessToken, accessExpiresAt: result.session.accessExpiresAt,
      refreshToken: result.session.refreshToken, staff: this.project(result.staff),
    };
  }

  async staffInfo(staffUserId: string): Promise<StaffProjection> {
    const staff = await this.prisma.admin.findUniqueOrThrow({ where: { id: staffUserId }, include: this.staffInclude() });
    return this.project(staff);
  }

  async staffInfoFromSession(sessionId: string): Promise<StaffProjection> {
    const session = await this.prisma.staffSession.findUniqueOrThrow({ where: { id: sessionId }, select: { staffUserId: true } });
    return this.staffInfo(session.staffUserId);
  }

  async revokeAllWithStepUp(staff: { id: string; email: string; sessionId: string }, stepUpToken: string): Promise<{ revoked: true }> {
    await this.prisma.$transaction(async (tx) => {
      await this.mfa.consumeStepUp(tx, stepUpToken, staff.id, staff.sessionId, commandHash({ action: 'auth.revoke_all', staffUserId: staff.id }));
      const before = await tx.admin.findUniqueOrThrow({ where: { id: staff.id }, select: { tokenVersion: true, version: true } });
      const sessionIds = await tx.staffSession.findMany({ where: { staffUserId: staff.id, revokedAt: null }, select: { id: true } });
      await tx.staffSession.updateMany({ where: { staffUserId: staff.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'account_revoke_all' } });
      await tx.refreshToken.updateMany({ where: { sessionId: { in: sessionIds.map(({ id }) => id) }, revokedAt: null }, data: { revokedAt: new Date() } });
      const after = await tx.admin.update({ where: { id: staff.id }, data: { tokenVersion: { increment: 1 }, version: { increment: 1 } }, select: { tokenVersion: true, version: true } });
      await this.audit.recordWithClient(tx, {
        actorId: staff.id, actorEmail: staff.email, correlationId: randomUUID(),
        action: 'auth.session.revoke_all', entityType: 'Admin', entityId: staff.id, before, after,
      });
    });
    return { revoked: true };
  }

  private staffInclude() {
    return {
      roleAssignments: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      mfaCredentials: { where: { status: 'confirmed' as const }, select: { id: true, status: true, version: true, encryptionKeyId: true, nonce: true, secretCiphertext: true, authTag: true } },
    };
  }

  private project(staff: {
    id: string; email: string; displayName: string | null; role: string; enabled: boolean;
    status: StaffProjection['status']; mfaRequired: boolean; version: number;
    roleAssignments: RoleAssignmentProjection[]; mfaCredentials: Array<{ status: string }>;
  }): StaffProjection {
    const permissionGrants = derivePermissionGrants(staff.roleAssignments);
    return {
      id: staff.id, email: staff.email, ...(staff.displayName ? { displayName: staff.displayName } : {}),
      role: staff.role, enabled: staff.enabled, status: staff.status, mfaRequired: staff.mfaRequired,
      mfaEnrolled: staff.mfaCredentials.some(({ status }) => status === 'confirmed'), version: staff.version,
      permissions: permissionGrants.filter(({ scopeType, scopeId }) => scopeType === 'global' && scopeId === '').map(({ permission }) => permission),
      permissionGrants,
    };
  }

  private requireDigestRing() {
    if (!this.config.digestKeys) throw new Error('IDENTITY_V2_DISABLED');
    return this.config.digestKeys;
  }
  private requireTotpRing() {
    if (!this.config.totpKeys) throw new Error('IDENTITY_V2_DISABLED');
    return this.config.totpKeys;
  }
  private invalidCredentials() {
    return new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
  }
  private invalidChallenge() {
    return new UnauthorizedException({ code: 'INVALID_CHALLENGE' });
  }

  private async recordLoginAudit(
    action: 'auth.login.succeeded' | 'auth.login.failed' | 'auth.login.rate_limited',
    staffUserId: string | undefined,
    sourceIp: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const sourceIpHash = keyedDigest(
      this.requireDigestRing(), this.requireDigestRing().currentKeyId, 'audit-source-ip', [sourceIp],
    );
    await this.prisma.$transaction((tx) => this.audit.recordWithClient(tx, {
      ...(staffUserId ? { actorId: staffUserId, entityId: staffUserId } : {}),
      correlationId: randomUUID(), action, entityType: 'Authentication',
      metadata: { ...metadata, sourceIpHash },
    }));
  }
}
