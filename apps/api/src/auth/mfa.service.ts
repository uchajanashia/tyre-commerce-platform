import { randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  decryptAead,
  encryptAead,
  generateOpaqueToken,
  generateTotpSecret,
  keyedDigest,
  matchTotpStep,
  parseOpaqueToken,
  tokenDigest,
  verifyTokenDigest,
} from './identity-crypto';
import { IDENTITY_CONFIG, IdentityConfig } from './identity-config';
import { AuthThrottleService } from './auth-throttle.service';

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly throttle: AuthThrottleService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  async startEnrollment(activationProof: string): Promise<{ enrollmentToken: string; otpauthUri: string; expiresAt: string }> {
    const proof = parseOpaqueToken(activationProof);
    if (!proof) throw this.invalid();
    const credentialId = randomUUID();
    const secret = generateTotpSecret();
    const enrollment = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "AuthChallenge" WHERE "id" = ${proof.selector} FOR UPDATE`);
      const challenge = await tx.authChallenge.findUnique({ where: { id: proof.selector }, include: { staffUser: true } });
      if (
        !challenge || challenge.purpose !== 'enroll_mfa' || challenge.credentialId || challenge.consumedAt || challenge.revokedAt ||
        challenge.expiresAt.getTime() <= Date.now() || challenge.staffUser.status !== 'pending_activation' ||
        challenge.staffUser.tokenVersion !== challenge.tokenVersionSnapshot ||
        challenge.staffUser.credentialVersion !== challenge.credentialVersionSnapshot ||
        challenge.staffUser.mfaVersion !== challenge.mfaVersionSnapshot || challenge.staffUser.version !== challenge.proofVersion ||
        !verifyTokenDigest(this.requireDigestRing(), challenge.digestKeyId, 'challenge:enroll_mfa', proof, challenge.staffUserId, challenge.tokenDigest)
      ) return null;
      await tx.mfaCredential.updateMany({
        where: { staffUserId: challenge.staffUserId, status: 'pending' },
        data: { status: 'revoked', revokedAt: new Date() },
      });
      await tx.authChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
      const encrypted = encryptAead(this.requireTotpRing(), secret, ['mfa-credential', credentialId, challenge.staffUserId, 'totp', '1']);
      await tx.mfaCredential.create({
        data: {
          id: credentialId,
          staffUserId: challenge.staffUserId,
          secretCiphertext: Uint8Array.from(encrypted.ciphertext),
          encryptionKeyId: encrypted.keyId,
          nonce: Uint8Array.from(encrypted.nonce),
          authTag: Uint8Array.from(encrypted.authTag),
          expiresAt,
        },
      });
      await tx.authChallenge.create({
        data: {
          id: enrollment.selector,
          staffUserId: challenge.staffUserId,
          purpose: 'enroll_mfa',
          tokenDigest: tokenDigest(this.requireDigestRing(), this.requireDigestRing().currentKeyId, 'challenge:enroll_mfa', enrollment, challenge.staffUserId),
          digestKeyId: this.requireDigestRing().currentKeyId,
          tokenVersionSnapshot: challenge.staffUser.tokenVersion,
          credentialVersionSnapshot: challenge.staffUser.credentialVersion,
          mfaVersionSnapshot: challenge.staffUser.mfaVersion,
          credentialId,
          credentialRecordVersion: 1,
          proofVersion: challenge.staffUser.version,
          expiresAt,
        },
      });
      return challenge.staffUser;
    });
    if (!result) throw this.invalid();
    const label = encodeURIComponent(`tyre.ge Admin:${result.email}`);
    return {
      enrollmentToken: enrollment.value,
      otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('tyre.ge Admin')}&algorithm=SHA1&digits=6&period=30`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async confirmEnrollment(enrollmentToken: string, code: string): Promise<{ confirmed: true; recoveryCodes: string[] }> {
    const proof = parseOpaqueToken(enrollmentToken);
    if (!proof) throw this.invalid();
    const owner = await this.prisma.authChallenge.findUnique({ where: { id: proof.selector }, select: { staffUserId: true } });
    if (owner) await this.throttle.assertMfaAvailable(owner.staffUserId);
    const rawCodes = Array.from({ length: 10 }, () => randomBytes(16).toString('base64url'));
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "AuthChallenge" WHERE "id" = ${proof.selector} FOR UPDATE`);
      const challenge = await tx.authChallenge.findUnique({
        where: { id: proof.selector },
        include: { staffUser: true, credential: true },
      });
      if (
        !challenge || challenge.purpose !== 'enroll_mfa' || challenge.consumedAt || challenge.revokedAt ||
        challenge.expiresAt.getTime() <= Date.now() || challenge.remainingAttempts <= 0 ||
        challenge.staffUser.tokenVersion !== challenge.tokenVersionSnapshot ||
        challenge.staffUser.credentialVersion !== challenge.credentialVersionSnapshot ||
        challenge.staffUser.mfaVersion !== challenge.mfaVersionSnapshot || challenge.staffUser.version !== challenge.proofVersion ||
        !challenge.credential || challenge.credential.status !== 'pending' ||
        challenge.credential.version !== challenge.credentialRecordVersion ||
        !verifyTokenDigest(this.requireDigestRing(), challenge.digestKeyId, 'challenge:enroll_mfa', proof, challenge.staffUserId, challenge.tokenDigest)
      ) return null;
      let step: number | null = null;
      try {
        const secret = decryptAead(this.requireTotpRing(), {
          keyId: challenge.credential.encryptionKeyId,
          nonce: Buffer.from(challenge.credential.nonce),
          ciphertext: Buffer.from(challenge.credential.secretCiphertext),
          authTag: Buffer.from(challenge.credential.authTag),
        }, ['mfa-credential', challenge.credential.id, challenge.staffUserId, 'totp', String(challenge.credential.version)]).toString('utf8');
        step = matchTotpStep(secret, code);
      } catch {
        step = null;
      }
      if (step === null) {
        await this.throttle.recordMfaFailureWithClient(tx, challenge.staffUserId);
        await tx.authChallenge.update({
          where: { id: challenge.id },
          data: { remainingAttempts: { decrement: 1 }, ...(challenge.remainingAttempts === 1 ? { revokedAt: new Date() } : {}) },
        });
        await this.audit.recordWithClient(tx, {
          actorId: challenge.staffUserId, correlationId: randomUUID(),
          action: 'auth.mfa.challenge.failed', entityType: 'AuthChallenge', entityId: challenge.id,
          metadata: { purpose: 'enroll_mfa', remainingAttempts: challenge.remainingAttempts - 1 },
        });
        return null;
      }
      const credential = await tx.mfaCredential.updateMany({
        where: { id: challenge.credential.id, status: 'pending', version: challenge.credential.version, lastUsedStep: null },
        data: { status: 'confirmed', confirmedAt: new Date(), lastUsedStep: step },
      });
      if (credential.count !== 1) return null;
      const staff = await tx.admin.update({
        where: { id: challenge.staffUserId },
        data: { mfaVersion: { increment: 1 }, tokenVersion: { increment: 1 }, version: { increment: 1 } },
      });
      await tx.mfaRecoveryCode.updateMany({ where: { staffUserId: staff.id, revokedAt: null }, data: { revokedAt: new Date() } });
      for (const rawCode of rawCodes) {
        const id = randomUUID();
        await tx.mfaRecoveryCode.create({
          data: {
            id,
            staffUserId: staff.id,
            digestKeyId: this.requireDigestRing().currentKeyId,
            codeDigest: keyedDigest(this.requireDigestRing(), this.requireDigestRing().currentKeyId, 'mfa-recovery-code', [staff.id, id, rawCode]),
          },
        });
      }
      await tx.authChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
      await this.audit.recordWithClient(tx, {
        actorId: staff.id,
        actorEmail: staff.email,
        correlationId: randomUUID(),
        action: 'auth.mfa.enrolled',
        entityType: 'MfaCredential',
        entityId: challenge.credential.id,
        after: { status: 'confirmed', recoveryCodeCount: rawCodes.length, mfaVersion: staff.mfaVersion },
      });
      return staff;
    });
    if (!result) throw this.invalid();
    return { confirmed: true, recoveryCodes: rawCodes };
  }

  async issueStepUp(staffUserId: string, sessionId: string, requestedActionHash: string, code: string): Promise<{ stepUpToken: string; expiresAt: string }> {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(requestedActionHash)) throw this.invalid();
    const credential = await this.prisma.mfaCredential.findFirst({ where: { staffUserId, status: 'confirmed' } });
    const staff = await this.prisma.admin.findUnique({ where: { id: staffUserId } });
    if (!credential || !staff || staff.status !== 'active') throw this.invalid();
    await this.throttle.assertStepUpAvailable(staffUserId);
    let step: number | null = null;
    try {
      const secret = decryptAead(this.requireTotpRing(), {
        keyId: credential.encryptionKeyId,
        nonce: Buffer.from(credential.nonce),
        ciphertext: Buffer.from(credential.secretCiphertext),
        authTag: Buffer.from(credential.authTag),
      }, ['mfa-credential', credential.id, staff.id, 'totp', String(credential.version)]).toString('utf8');
      step = matchTotpStep(secret, code);
    } catch {
      step = null;
    }
    if (step === null) {
      await this.prisma.$transaction(async (tx) => {
        await this.throttle.recordStepUpFailureWithClient(tx, staffUserId);
        await this.audit.recordWithClient(tx, {
          actorId: staffUserId, correlationId: randomUUID(),
          action: 'auth.mfa.challenge.failed', entityType: 'Admin', entityId: staffUserId,
          metadata: { purpose: 'step_up' },
        });
      });
      throw this.invalid();
    }
    const proof = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const committed = await this.prisma.$transaction(async (tx) => {
      const fence = await tx.mfaCredential.updateMany({
        where: { id: credential.id, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step as number } }] },
        data: { lastUsedStep: step },
      });
      if (fence.count !== 1) return false;
      await tx.authChallenge.create({
        data: {
          id: proof.selector,
          staffUserId,
          purpose: 'step_up',
          tokenDigest: tokenDigest(this.requireDigestRing(), this.requireDigestRing().currentKeyId, 'challenge:step_up', proof, staffUserId),
          digestKeyId: this.requireDigestRing().currentKeyId,
          tokenVersionSnapshot: staff.tokenVersion,
          credentialVersionSnapshot: staff.credentialVersion,
          mfaVersionSnapshot: staff.mfaVersion,
          sessionId,
          credentialId: credential.id,
          credentialRecordVersion: credential.version,
          requestedActionHash,
          expiresAt,
        },
      });
      return true;
    });
    if (!committed) throw this.invalid();
    await this.throttle.resetStepUpFailures(staffUserId);
    return { stepUpToken: proof.value, expiresAt: expiresAt.toISOString() };
  }

  async consumeStepUp(
    tx: Prisma.TransactionClient,
    rawProof: string,
    staffUserId: string,
    sessionId: string,
    requestedActionHash: string,
  ): Promise<void> {
    const proof = parseOpaqueToken(rawProof);
    if (!proof) throw this.invalid();
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "AuthChallenge" WHERE "id" = ${proof.selector} FOR UPDATE`);
    const challenge = await tx.authChallenge.findUnique({ where: { id: proof.selector }, include: { staffUser: true, credential: true, session: true } });
    if (
      !challenge || challenge.purpose !== 'step_up' || challenge.staffUserId !== staffUserId || challenge.sessionId !== sessionId ||
      challenge.requestedActionHash !== requestedActionHash || challenge.consumedAt || challenge.revokedAt || challenge.expiresAt.getTime() <= Date.now() ||
      !challenge.session || challenge.session.revokedAt || !challenge.credential || challenge.credential.status !== 'confirmed' ||
      challenge.tokenVersionSnapshot !== challenge.staffUser.tokenVersion ||
      challenge.credentialVersionSnapshot !== challenge.staffUser.credentialVersion ||
      challenge.mfaVersionSnapshot !== challenge.staffUser.mfaVersion ||
      challenge.credentialRecordVersion !== challenge.credential.version ||
      !verifyTokenDigest(this.requireDigestRing(), challenge.digestKeyId, 'challenge:step_up', proof, staffUserId, challenge.tokenDigest)
    ) throw this.invalid();
    await tx.authChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
  }

  private requireDigestRing() {
    if (!this.config.enabled || !this.config.digestKeys) throw new Error('IDENTITY_V2_DISABLED');
    return this.config.digestKeys;
  }
  private requireTotpRing() {
    if (!this.config.enabled || !this.config.totpKeys) throw new Error('IDENTITY_V2_DISABLED');
    return this.config.totpKeys;
  }
  private invalid() {
    return new UnauthorizedException({ code: 'INVALID_MFA_PROOF' });
  }
}
