import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { Prisma, StaffInvitationPurpose } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { decryptAead, encryptAead } from './identity-crypto';
import { IDENTITY_CONFIG, IdentityConfig } from './identity-config';
import { InvitationService } from './invitation.service';

@Injectable()
export class IdentityKeyLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
    private readonly invitations: InvitationService,
  ) {}

  async isCompromised(purpose: string, keyId: string): Promise<boolean> {
    return Boolean(await this.prisma.identityKeyCompromise.findUnique({
      where: { purpose_keyId: { purpose, keyId } }, select: { id: true },
    }));
  }

  async assertTotpKeyCoverage(): Promise<void> {
    if (!this.config.enabled) return;
    const ring = this.requireTotpRing();
    const rows = await this.prisma.mfaCredential.findMany({
      where: { status: { not: 'revoked' } }, distinct: ['encryptionKeyId'], select: { encryptionKeyId: true },
    });
    for (const { encryptionKeyId } of rows) {
      const key = ring.keys.get(encryptionKeyId);
      if (!key || (key.state !== 'encrypt+decrypt' && key.state !== 'decrypt-only')) {
        throw new Error(`Active MFA credentials reference unavailable TOTP key id: ${encryptionKeyId}`);
      }
    }
  }

  async assertCompromiseReadiness(): Promise<void> {
    if (!this.config.enabled) return;
    const incomplete = await this.prisma.identityKeyCompromise.count({ where: { state: { not: 'completed' } } });
    if (incomplete) throw new Error('Incomplete identity key-compromise workflow requires operator intervention.');
    const currentKeys = new Map<string, string>([
      ['jwt', this.config.jwtKeys?.currentKeyId ?? ''],
      ['digest', this.config.digestKeys?.currentKeyId ?? ''],
      ['envelope', this.config.envelopeKeys?.currentKeyId ?? ''],
      ['totp', this.config.totpKeys?.currentKeyId ?? ''],
    ]);
    const compromises = await this.prisma.identityKeyCompromise.findMany({ select: { purpose: true, keyId: true } });
    for (const compromise of compromises) {
      if (currentKeys.get(compromise.purpose) === compromise.keyId) {
        throw new Error(`Current ${compromise.purpose} key is durably marked compromised; rotate configuration before startup.`);
      }
    }
  }

  async reencryptTotpBatch(batchSize = 50) {
    const limit = Math.max(1, Math.min(batchSize, 200));
    const ring = this.requireTotpRing();
    const targetKeyId = ring.currentKeyId;
    const rotationId = `totp:${targetKeyId}`;
    try {
      return await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "MfaCredential"
        WHERE "status" <> 'revoked' AND "encryptionKeyId" <> ${targetKeyId}
        ORDER BY "id" LIMIT ${limit} FOR UPDATE SKIP LOCKED
      `);
      const existing = await tx.identityKeyRotation.findUnique({ where: { id: rotationId } });
      if (locked.length === 0 && existing?.state === 'completed') {
        return { targetKeyId, processed: 0, remaining: 0, version: existing.version, state: existing.state };
      }
      let processed = 0;
      let lastCredentialId: string | null = null;
      for (const { id } of locked) {
        const credential = await tx.mfaCredential.findUniqueOrThrow({ where: { id } });
        const plaintext = decryptAead(ring, {
          keyId: credential.encryptionKeyId,
          nonce: Buffer.from(credential.nonce), ciphertext: Buffer.from(credential.secretCiphertext),
          authTag: Buffer.from(credential.authTag),
        }, ['mfa-credential', credential.id, credential.staffUserId, 'totp', String(credential.version)]);
        const nextVersion = credential.version + 1;
        const encrypted = encryptAead(ring, plaintext, [
          'mfa-credential', credential.id, credential.staffUserId, 'totp', String(nextVersion),
        ]);
        const updated = await tx.mfaCredential.updateMany({
          where: { id: credential.id, version: credential.version, encryptionKeyId: credential.encryptionKeyId },
          data: {
            encryptionKeyId: encrypted.keyId, nonce: Uint8Array.from(encrypted.nonce),
            secretCiphertext: Uint8Array.from(encrypted.ciphertext), authTag: Uint8Array.from(encrypted.authTag),
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new Error('Concurrent MFA credential rotation conflict.');
        processed += 1;
        lastCredentialId = credential.id;
      }
      const remaining = await tx.mfaCredential.count({ where: { status: { not: 'revoked' }, encryptionKeyId: { not: targetKeyId } } });
      const progress = await tx.identityKeyRotation.upsert({
        where: { id: rotationId },
        create: {
          id: rotationId, purpose: 'totp', targetKeyId,
          state: remaining === 0 ? 'completed' : 'running', lastCredentialId,
          processedCount: processed, completedAt: remaining === 0 ? new Date() : null,
        },
        update: {
          state: remaining === 0 ? 'completed' : 'running', lastCredentialId,
          processedCount: { increment: processed }, version: { increment: 1 },
          completedAt: remaining === 0 ? new Date() : null,
        },
      });
      await this.audit.recordWithClient(tx, {
        correlationId: randomUUID(), action: remaining === 0 ? 'auth.key.rotated' : 'security.totp_key_rotation.progress',
        entityType: 'IdentityKeyRotation', entityId: progress.id,
        after: { targetKeyId, processed, remaining, version: progress.version, state: progress.state },
      });
      return { targetKeyId, processed, remaining, version: progress.version, state: progress.state };
      });
    } catch (error) {
      await this.prisma.identityKeyRotation.upsert({
        where: { id: rotationId },
        create: { id: rotationId, purpose: 'totp', targetKeyId, state: 'failed' },
        update: { state: 'failed', version: { increment: 1 }, completedAt: null },
      });
      throw error;
    }
  }

  async revokeCompromisedTotpKey(keyId: string): Promise<{ affectedAccounts: number }> {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(keyId)) throw new Error('Invalid key id.');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtext(${'identity-compromise:totp:' + keyId}))`);
      const compromiseId = `totp:${keyId}`;
      const existing = await tx.identityKeyCompromise.findUnique({ where: { purpose_keyId: { purpose: 'totp', keyId } } });
      if (existing?.state === 'completed') return { affectedAccounts: existing.affectedAccounts };
      await tx.identityKeyCompromise.upsert({
        where: { purpose_keyId: { purpose: 'totp', keyId } },
        create: { id: compromiseId, purpose: 'totp', keyId, state: 'handling' },
        update: { state: 'handling', version: { increment: 1 }, completedAt: null },
      });
      const credentials = await tx.mfaCredential.findMany({
        where: { encryptionKeyId: keyId, status: { not: 'revoked' } }, select: { id: true, staffUserId: true },
      });
      const staffIds = [...new Set(credentials.map(({ staffUserId }) => staffUserId))];
      await tx.mfaCredential.updateMany({
        where: { encryptionKeyId: keyId, status: { not: 'revoked' } }, data: { status: 'revoked', revokedAt: new Date() },
      });
      for (const staffUserId of staffIds) {
        await tx.mfaRecoveryCode.updateMany({ where: { staffUserId, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.authChallenge.updateMany({ where: { staffUserId, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
        const sessions = await tx.staffSession.findMany({ where: { staffUserId, revokedAt: null }, select: { id: true } });
        await tx.staffSession.updateMany({ where: { staffUserId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'compromised_totp_key' } });
        await tx.refreshToken.updateMany({ where: { sessionId: { in: sessions.map(({ id }) => id) }, revokedAt: null }, data: { revokedAt: new Date() } });
        const staff = await tx.admin.update({
          where: { id: staffUserId },
          data: { status: 'pending_activation', enabled: false, mfaVersion: { increment: 1 }, tokenVersion: { increment: 1 }, version: { increment: 1 } },
        });
        await this.audit.recordWithClient(tx, {
          actorId: staffUserId, correlationId: randomUUID(), action: 'auth.key.revoked',
          entityType: 'Admin', entityId: staffUserId,
          after: { keyId, status: staff.status, tokenVersion: staff.tokenVersion, mfaVersion: staff.mfaVersion },
        });
      }
      await tx.identityKeyCompromise.update({
        where: { id: compromiseId },
        data: { state: 'completed', affectedAccounts: staffIds.length, affectedArtifacts: credentials.length, completedAt: new Date() },
      });
      await this.audit.recordWithClient(tx, {
        correlationId: randomUUID(), action: 'security.totp_key.compromised',
        entityType: 'IdentityKeyCompromise', entityId: compromiseId,
        after: { keyId, affectedAccounts: staffIds.length, affectedArtifacts: credentials.length, state: 'completed' },
      });
      return { affectedAccounts: staffIds.length };
    });
  }

  async revokeCompromisedJwtKey(keyId: string): Promise<{ affectedAccounts: number; affectedSessions: number }> {
    this.assertKeyId(keyId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtext(${'identity-compromise:jwt:' + keyId}))`);
      const compromiseId = `jwt:${keyId}`;
      const existing = await tx.identityKeyCompromise.findUnique({ where: { purpose_keyId: { purpose: 'jwt', keyId } } });
      if (existing?.state === 'completed') return { affectedAccounts: existing.affectedAccounts, affectedSessions: existing.affectedArtifacts };
      const sessions = await tx.staffSession.findMany({ where: { revokedAt: null }, select: { id: true, staffUserId: true } });
      const staffIds = [...new Set(sessions.map(({ staffUserId }) => staffUserId))];
      await tx.identityKeyCompromise.upsert({
        where: { purpose_keyId: { purpose: 'jwt', keyId } },
        create: { id: compromiseId, purpose: 'jwt', keyId, state: 'handling' },
        update: { state: 'handling', version: { increment: 1 }, completedAt: null },
      });
      await this.revokeSessionsAndEpochs(tx, staffIds, 'compromised_jwt_signing_key');
      await tx.identityKeyCompromise.update({
        where: { id: compromiseId },
        data: { state: 'completed', affectedAccounts: staffIds.length, affectedArtifacts: sessions.length, completedAt: new Date() },
      });
      await this.audit.recordWithClient(tx, {
        correlationId: randomUUID(), action: 'security.jwt_key.compromised',
        entityType: 'IdentityKeyCompromise', entityId: compromiseId,
        after: { keyId, affectedAccounts: staffIds.length, affectedSessions: sessions.length, state: 'completed' },
      });
      return { affectedAccounts: staffIds.length, affectedSessions: sessions.length };
    });
  }

  async revokeCompromisedEnvelopeKey(keyId: string): Promise<{ affectedArtifacts: number; queuedReissues: number }> {
    this.assertKeyId(keyId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtext(${'identity-compromise:envelope:' + keyId}))`);
      const compromiseId = `envelope:${keyId}`;
      const existing = await tx.identityKeyCompromise.findUnique({ where: { purpose_keyId: { purpose: 'envelope', keyId } } });
      if (existing?.state === 'completed') {
        const queuedReissues = await tx.identityArtifactReissue.count({ where: { compromiseId } });
        return { affectedArtifacts: existing.affectedArtifacts, queuedReissues };
      }
      const envelopes = await tx.secretDeliveryEnvelope.findMany({
        where: { encryptionKeyId: keyId }, include: { invitation: true },
      });
      await tx.identityKeyCompromise.upsert({
        where: { purpose_keyId: { purpose: 'envelope', keyId } },
        create: { id: compromiseId, purpose: 'envelope', keyId, state: 'handling' },
        update: { state: 'handling', version: { increment: 1 }, completedAt: null },
      });
      const queueable = envelopes.filter(({ invitation }) =>
        !invitation.consumedAt && !invitation.revokedAt && invitation.expiresAt.getTime() > Date.now(),
      );
      await this.revokeDeliveryArtifacts(tx, compromiseId, envelopes);
      await tx.identityKeyCompromise.update({
        where: { id: compromiseId },
        data: { state: 'completed', affectedArtifacts: envelopes.length, completedAt: new Date() },
      });
      await this.audit.recordWithClient(tx, {
        correlationId: randomUUID(), action: 'security.envelope_key.compromised',
        entityType: 'IdentityKeyCompromise', entityId: compromiseId,
        after: { keyId, affectedArtifacts: envelopes.length, queuedReissues: queueable.length, state: 'completed' },
      });
      return { affectedArtifacts: envelopes.length, queuedReissues: queueable.length };
    });
  }

  async revokeCompromisedDigestKey(keyId: string): Promise<{ affectedAccounts: number; affectedArtifacts: number; queuedReissues: number }> {
    this.assertKeyId(keyId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtext(${'identity-compromise:digest:' + keyId}))`);
      const compromiseId = `digest:${keyId}`;
      const existing = await tx.identityKeyCompromise.findUnique({ where: { purpose_keyId: { purpose: 'digest', keyId } } });
      if (existing?.state === 'completed') {
        const queuedReissues = await tx.identityArtifactReissue.count({ where: { compromiseId } });
        return { affectedAccounts: existing.affectedAccounts, affectedArtifacts: existing.affectedArtifacts, queuedReissues };
      }
      const [refresh, invitations, recoveryCodes, challenges] = await Promise.all([
        tx.refreshToken.findMany({ where: { digestKeyId: keyId, revokedAt: null }, select: { sessionId: true } }),
        tx.staffInvitation.findMany({
          where: { digestKeyId: keyId, consumedAt: null, revokedAt: null }, include: { envelope: true },
        }),
        tx.mfaRecoveryCode.findMany({ where: { digestKeyId: keyId, usedAt: null, revokedAt: null }, select: { staffUserId: true } }),
        tx.authChallenge.findMany({ where: { digestKeyId: keyId, consumedAt: null, revokedAt: null }, select: { staffUserId: true } }),
      ]);
      const refreshSessions = await tx.staffSession.findMany({
        where: { id: { in: refresh.map(({ sessionId }) => sessionId) } }, select: { staffUserId: true },
      });
      const staffIds = [...new Set([
        ...refreshSessions.map(({ staffUserId }) => staffUserId),
        ...recoveryCodes.map(({ staffUserId }) => staffUserId),
        ...challenges.map(({ staffUserId }) => staffUserId),
      ])];
      await tx.identityKeyCompromise.upsert({
        where: { purpose_keyId: { purpose: 'digest', keyId } },
        create: { id: compromiseId, purpose: 'digest', keyId, state: 'handling' },
        update: { state: 'handling', version: { increment: 1 }, completedAt: null },
      });
      await tx.refreshToken.updateMany({ where: { digestKeyId: keyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.authChallenge.updateMany({ where: { digestKeyId: keyId, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.mfaRecoveryCode.updateMany({ where: { digestKeyId: keyId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.revokeSessionsAndEpochs(tx, staffIds, 'compromised_token_digest_key');
      if (recoveryCodes.length) {
        await tx.admin.updateMany({
          where: { id: { in: [...new Set(recoveryCodes.map(({ staffUserId }) => staffUserId))] } },
          data: { mfaVersion: { increment: 1 }, version: { increment: 1 } },
        });
      }
      const envelopeRows = invitations.flatMap((invitation) => invitation.envelope
        ? [{ ...invitation.envelope, invitation }]
        : []);
      await this.revokeDeliveryArtifacts(tx, compromiseId, envelopeRows);
      const invitationWithoutEnvelope = invitations.filter(({ envelope }) => !envelope);
      for (const invitation of invitationWithoutEnvelope) {
        await tx.staffInvitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
        await this.queueReissue(tx, compromiseId, invitation);
      }
      const affectedArtifacts = refresh.length + invitations.length + recoveryCodes.length + challenges.length;
      await tx.identityKeyCompromise.update({
        where: { id: compromiseId },
        data: { state: 'completed', affectedAccounts: staffIds.length, affectedArtifacts, completedAt: new Date() },
      });
      await this.audit.recordWithClient(tx, {
        correlationId: randomUUID(), action: 'security.digest_key.compromised',
        entityType: 'IdentityKeyCompromise', entityId: compromiseId,
        after: { keyId, affectedAccounts: staffIds.length, affectedArtifacts, queuedReissues: invitations.length, state: 'completed' },
      });
      return { affectedAccounts: staffIds.length, affectedArtifacts, queuedReissues: invitations.length };
    });
  }

  async resumeArtifactReissues(limit = 25): Promise<{ issued: number; failed: number; remaining: number }> {
    const jobs = await this.prisma.identityArtifactReissue.findMany({
      where: { state: { in: ['pending', 'failed'] } }, orderBy: { createdAt: 'asc' }, take: Math.max(1, Math.min(limit, 100)),
    });
    let issued = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        const staff = await this.prisma.admin.findUnique({ where: { id: job.staffUserId } });
        if (!staff) throw new Error('STAFF_NOT_FOUND');
        const replacement = await this.invitations.issue(
          staff.id, job.requestedById, staff.email, job.purpose as StaffInvitationPurpose,
        );
        await this.prisma.identityArtifactReissue.update({
          where: { id: job.id },
          data: { state: 'issued', replacementId: replacement.invitationId, attemptCount: { increment: 1 }, lastErrorCode: null, completedAt: new Date() },
        });
        issued += 1;
      } catch (error) {
        await this.prisma.identityArtifactReissue.update({
          where: { id: job.id },
          data: { state: 'failed', attemptCount: { increment: 1 }, lastErrorCode: this.safeErrorCode(error), completedAt: null },
        });
        failed += 1;
      }
    }
    const remaining = await this.prisma.identityArtifactReissue.count({ where: { state: { in: ['pending', 'failed'] } } });
    await this.prisma.$transaction((tx) => this.audit.recordWithClient(tx, {
      correlationId: randomUUID(), action: 'security.artifact_reissue.batch',
      entityType: 'IdentityArtifactReissue', after: { issued, failed, remaining },
    }));
    return { issued, failed, remaining };
  }

  private async revokeDeliveryArtifacts(
    tx: Prisma.TransactionClient,
    compromiseId: string,
    envelopes: Array<{ id: string; invitation: { id: string; staffUserId: string; purpose: StaffInvitationPurpose; createdById: string; consumedAt: Date | null; revokedAt: Date | null; expiresAt: Date } }>,
  ): Promise<void> {
    for (const envelope of envelopes) {
      const queueable = !envelope.invitation.consumedAt && !envelope.invitation.revokedAt && envelope.invitation.expiresAt.getTime() > Date.now();
      await tx.staffInvitation.updateMany({ where: { id: envelope.invitation.id, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.secretDeliveryEnvelope.update({
        where: { id: envelope.id },
        data: { nonce: null, ciphertext: null, authTag: null, ciphertextClearedAt: new Date(), state: 'expired', lastErrorCode: 'KEY_COMPROMISED' },
      });
      await tx.secretDeliveryOutbox.updateMany({
        where: { envelopeId: envelope.id },
        data: { completedAt: new Date(), claimedAt: null, lastErrorCode: 'KEY_COMPROMISED' },
      });
      if (queueable) await this.queueReissue(tx, compromiseId, envelope.invitation);
    }
  }

  private async queueReissue(
    tx: Prisma.TransactionClient,
    compromiseId: string,
    invitation: { id: string; staffUserId: string; purpose: StaffInvitationPurpose; createdById: string },
  ): Promise<void> {
    await tx.identityArtifactReissue.upsert({
      where: { sourceArtifactId: invitation.id },
      create: {
        compromiseId, sourceArtifactId: invitation.id, staffUserId: invitation.staffUserId,
        purpose: invitation.purpose, requestedById: invitation.createdById,
      },
      update: {},
    });
  }

  private async revokeSessionsAndEpochs(tx: Prisma.TransactionClient, staffIds: string[], reason: string): Promise<void> {
    if (!staffIds.length) return;
    const sessions = await tx.staffSession.findMany({ where: { staffUserId: { in: staffIds }, revokedAt: null }, select: { id: true } });
    await tx.staffSession.updateMany({ where: { id: { in: sessions.map(({ id }) => id) } }, data: { revokedAt: new Date(), revokeReason: reason } });
    await tx.refreshToken.updateMany({ where: { sessionId: { in: sessions.map(({ id }) => id) }, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.admin.updateMany({ where: { id: { in: staffIds } }, data: { tokenVersion: { increment: 1 }, version: { increment: 1 } } });
  }

  private assertKeyId(keyId: string): void {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(keyId)) throw new Error('Invalid key id.');
  }

  private safeErrorCode(error: unknown): string {
    const message = error instanceof Error ? error.message : '';
    return /^[A-Z0-9_]{2,64}$/.test(message) ? message : 'REISSUE_FAILED';
  }

  private requireTotpRing() {
    if (!this.config.enabled || !this.config.totpKeys) throw new Error('IDENTITY_V2_DISABLED');
    return this.config.totpKeys;
  }
}
