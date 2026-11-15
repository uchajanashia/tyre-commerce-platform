import { randomUUID } from 'node:crypto';

import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma, StaffInvitationPurpose } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  encryptAead,
  generateOpaqueToken,
  keyedDigest,
  normalizeStaffEmail,
  parseOpaqueToken,
  tokenDigest,
  verifyTokenDigest,
} from './identity-crypto';
import { IDENTITY_CONFIG, IdentityConfig } from './identity-config';
import { PasswordKdfService } from './password-kdf.service';
import { AuthThrottleService } from './auth-throttle.service';

@Injectable()
export class InvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordKdfService,
    private readonly audit: AuditService,
    private readonly throttle: AuthThrottleService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  async inspect(rawToken: string): Promise<{ purpose: StaffInvitationPurpose; expiresAt: string }> {
    const invitation = await this.verifiedInvitation(rawToken);
    if (!invitation || invitation.consumedAt || invitation.revokedAt || invitation.expiresAt.getTime() <= Date.now()) {
      throw this.invalidToken();
    }
    return { purpose: invitation.purpose, expiresAt: invitation.expiresAt.toISOString() };
  }

  async acceptInvite(rawToken: string, password: string): Promise<{ status: 'pending_activation'; mfaRequired: boolean; activationProof?: string }> {
    const initial = await this.verifiedInvitation(rawToken);
    if (!initial || (initial.purpose !== 'invite' && initial.purpose !== 'recovery') || initial.consumedAt || initial.revokedAt || initial.expiresAt.getTime() <= Date.now()) throw this.invalidToken();
    const passwordHash = await this.passwords.hash(password);
    const parsed = parseOpaqueToken(rawToken) as NonNullable<ReturnType<typeof parseOpaqueToken>>;
    const enrollmentProof = initial.staffUser.mfaRequired || initial.purpose === 'recovery' ? generateOpaqueToken() : null;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "StaffInvitation" WHERE "id" = ${initial.id} FOR UPDATE`);
      const invitation = await tx.staffInvitation.findUnique({ where: { id: initial.id }, include: { staffUser: true } });
      if (
        !invitation || (invitation.purpose !== 'invite' && invitation.purpose !== 'recovery') || invitation.consumedAt || invitation.revokedAt ||
        invitation.expiresAt.getTime() <= Date.now() ||
        (invitation.purpose === 'invite' ? invitation.staffUser.status !== 'invited' : invitation.staffUser.status !== 'pending_activation') ||
        !verifyTokenDigest(this.requireDigestRing(), invitation.digestKeyId, `invitation:${invitation.purpose}`, parsed, invitation.staffUserId, invitation.tokenDigest)
      ) return null;
      const staff = await tx.admin.update({
        where: { id: invitation.staffUserId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          status: 'pending_activation',
          enabled: false,
          tokenVersion: { increment: 1 },
          credentialVersion: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await tx.staffInvitation.update({ where: { id: invitation.id }, data: { consumedAt: new Date(), deliveryStatus: 'accepted' } });
      if (enrollmentProof) {
        await tx.authChallenge.create({
          data: {
            id: enrollmentProof.selector,
            staffUserId: staff.id,
            purpose: 'enroll_mfa',
            tokenDigest: tokenDigest(this.requireDigestRing(), this.requireDigestRing().currentKeyId, 'challenge:enroll_mfa', enrollmentProof, staff.id),
            digestKeyId: this.requireDigestRing().currentKeyId,
            tokenVersionSnapshot: staff.tokenVersion,
            credentialVersionSnapshot: staff.credentialVersion,
            mfaVersionSnapshot: staff.mfaVersion,
            proofVersion: staff.version,
            expiresAt: new Date(Date.now() + 5 * 60_000),
          },
        });
      }
      await this.audit.recordWithClient(tx, {
        actorId: staff.id,
        actorEmail: staff.email,
        correlationId: randomUUID(),
        action: invitation.purpose === 'invite' ? 'staff.invite.consumed' : 'staff.recovery.consumed',
        entityType: 'Admin',
        entityId: staff.id,
        after: { status: staff.status, mfaRequired: staff.mfaRequired, credentialVersion: staff.credentialVersion },
      });
      return staff;
    });
    if (!result) throw this.invalidToken();
    return {
      status: 'pending_activation',
      mfaRequired: result.mfaRequired,
      ...(enrollmentProof ? { activationProof: enrollmentProof.value } : {}),
    };
  }

  async requestPasswordReset(email: string, sourceIp = 'unknown'): Promise<{ accepted: true }> {
    await this.throttle.consumeWindow('public_ip', sourceIp, 'password-reset-hour', 3, 60 * 60_000);
    const derivedIdentity = email.trim().normalize('NFKC').toLowerCase();
    await this.throttle.consumeWindow('public_identity', derivedIdentity, 'password-reset-hour', 3, 60 * 60_000);
    let emailNormalized: string;
    try {
      emailNormalized = normalizeStaffEmail(email);
    } catch {
      await this.recordPasswordResetRequested();
      return { accepted: true };
    }
    const staff = await this.prisma.admin.findUnique({ where: { emailNormalized } });
    if (staff && staff.status !== 'invited' && this.config.deliveryAdapter !== 'disabled') {
      await this.issue(staff.id, staff.id, staff.email, 'password_reset', 60 * 60_000);
    }
    await this.recordPasswordResetRequested(staff?.id);
    return { accepted: true };
  }

  async completePasswordReset(rawToken: string, password: string): Promise<{ completed: true }> {
    const initial = await this.verifiedInvitation(rawToken);
    if (!initial || initial.purpose !== 'password_reset' || initial.consumedAt || initial.revokedAt || initial.expiresAt.getTime() <= Date.now()) throw this.invalidToken();
    const passwordHash = await this.passwords.hash(password);
    const parsed = parseOpaqueToken(rawToken) as NonNullable<ReturnType<typeof parseOpaqueToken>>;
    const completed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "StaffInvitation" WHERE "id" = ${initial.id} FOR UPDATE`);
      const invitation = await tx.staffInvitation.findUnique({ where: { id: initial.id }, include: { staffUser: true } });
      if (
        !invitation || invitation.consumedAt || invitation.revokedAt || invitation.expiresAt.getTime() <= Date.now() ||
        !verifyTokenDigest(this.requireDigestRing(), invitation.digestKeyId, 'invitation:password_reset', parsed, invitation.staffUserId, invitation.tokenDigest)
      ) return false;
      const staff = await tx.admin.update({
        where: { id: invitation.staffUserId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          credentialVersion: { increment: 1 },
          tokenVersion: { increment: 1 },
          version: { increment: 1 },
        },
      });
      const sessionIds = await tx.staffSession.findMany({ where: { staffUserId: staff.id }, select: { id: true } });
      await tx.staffSession.updateMany({ where: { staffUserId: staff.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'password_reset' } });
      await tx.refreshToken.updateMany({ where: { sessionId: { in: sessionIds.map(({ id }) => id) }, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.authChallenge.updateMany({ where: { staffUserId: staff.id, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.staffInvitation.update({ where: { id: invitation.id }, data: { consumedAt: new Date(), deliveryStatus: 'accepted' } });
      await this.audit.recordWithClient(tx, {
        actorId: staff.id,
        actorEmail: staff.email,
        correlationId: randomUUID(),
        action: 'auth.password_reset.completed',
        entityType: 'Admin',
        entityId: staff.id,
        after: { credentialVersion: staff.credentialVersion, tokenVersion: staff.tokenVersion, mfaPreserved: true },
      });
      return true;
    });
    if (!completed) throw this.invalidToken();
    return { completed: true };
  }

  async issue(
    staffUserId: string,
    createdById: string,
    recipient: string,
    purpose: StaffInvitationPurpose,
    ttlMs = 24 * 60 * 60_000,
  ): Promise<{ invitationId: string; expiresAt: string; developmentOneTimeUrl?: string }> {
    if (this.config.deliveryAdapter === 'disabled') {
      throw new ServiceUnavailableException({ code: 'IDENTITY_DELIVERY_DISABLED' });
    }
    return this.prisma.$transaction((tx) => this.issueWithClient(tx, staffUserId, createdById, recipient, purpose, ttlMs));
  }

  async issueWithClient(
    tx: Prisma.TransactionClient,
    staffUserId: string,
    createdById: string,
    recipient: string,
    purpose: StaffInvitationPurpose,
    ttlMs = 24 * 60 * 60_000,
  ): Promise<{ invitationId: string; expiresAt: string; developmentOneTimeUrl?: string }> {
    if (this.config.deliveryAdapter === 'disabled') {
      throw new ServiceUnavailableException({ code: 'IDENTITY_DELIVERY_DISABLED' });
    }
    if (!this.config.adminPublicOrigin) throw new Error('ADMIN_PUBLIC_ORIGIN_REQUIRED');
    const token = generateOpaqueToken();
    const invitationId = randomUUID();
    const envelopeId = randomUUID();
    const correlationId = randomUUID();
    const expiresAt = new Date(Date.now() + ttlMs);
    const recipientHash = keyedDigest(this.requireDigestRing(), this.requireDigestRing().currentKeyId, 'delivery-recipient', [normalizeStaffEmail(recipient)]);
    const route = purpose === 'invite' ? '/admin/invitations/accept' : purpose === 'password_reset' ? '/admin/password-reset' : '/admin/recovery';
    const oneTimeUrl = `${this.config.adminPublicOrigin}${route}#${token.value}`;
    const encrypted = encryptAead(this.requireEnvelopeRing(), oneTimeUrl, [
      'delivery-envelope', envelopeId, staffUserId, purpose, '1', recipientHash, correlationId,
    ]);
    const previous = await tx.staffInvitation.findMany({
        where: { staffUserId, purpose, consumedAt: null, revokedAt: null },
        include: { envelope: true },
    });
    await tx.staffInvitation.updateMany({ where: { id: { in: previous.map(({ id }) => id) } }, data: { revokedAt: new Date() } });
    for (const old of previous) {
      if (old.envelope && !old.envelope.ciphertextClearedAt) {
        await tx.secretDeliveryEnvelope.update({
          where: { id: old.envelope.id },
          data: { nonce: null, ciphertext: null, authTag: null, ciphertextClearedAt: new Date(), state: 'expired' },
        });
      }
    }
    await tx.staffInvitation.create({
        data: {
          id: invitationId,
          staffUserId,
          purpose,
          selector: token.selector,
          tokenDigest: tokenDigest(this.requireDigestRing(), this.requireDigestRing().currentKeyId, `invitation:${purpose}`, token, staffUserId),
          digestKeyId: this.requireDigestRing().currentKeyId,
          expiresAt,
          createdById,
          envelope: {
            create: {
              id: envelopeId,
              purpose,
              recipientHash,
              correlationId,
              encryptionKeyId: encrypted.keyId,
              nonce: this.config.deliveryAdapter === 'manual' ? null : Uint8Array.from(encrypted.nonce),
              ciphertext: this.config.deliveryAdapter === 'manual' ? null : Uint8Array.from(encrypted.ciphertext),
              authTag: this.config.deliveryAdapter === 'manual' ? null : Uint8Array.from(encrypted.authTag),
              expiresAt,
              state: this.config.deliveryAdapter === 'manual' ? 'delivered' : 'pending',
              deliveredAt: this.config.deliveryAdapter === 'manual' ? new Date() : null,
              ciphertextClearedAt: this.config.deliveryAdapter === 'manual' ? new Date() : null,
              outbox: { create: this.config.deliveryAdapter === 'manual' ? { completedAt: new Date() } : {} },
            },
          },
        },
    });
    await this.audit.recordWithClient(tx, {
        actorId: createdById,
        action: `staff.${purpose}.issued`,
        entityType: 'StaffInvitation',
        entityId: invitationId,
        correlationId,
        after: { staffUserId, purpose, expiresAt, digestKeyId: this.requireDigestRing().currentKeyId, envelopeId },
    });
    return {
      invitationId,
      expiresAt: expiresAt.toISOString(),
      ...(this.config.environment !== 'production' && this.config.deliveryAdapter === 'manual'
        ? { developmentOneTimeUrl: oneTimeUrl }
        : {}),
    };
  }

  async markDeliveryFailure(envelopeId: string, rawErrorCode: string): Promise<void> {
    const errorCode = /^[A-Z0-9_]{2,64}$/.test(rawErrorCode) ? rawErrorCode : 'DELIVERY_FAILED';
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SecretDeliveryEnvelope" WHERE "id" = ${envelopeId} FOR UPDATE`);
      const envelope = await tx.secretDeliveryEnvelope.findUnique({ where: { id: envelopeId } });
      if (!envelope || envelope.state === 'delivered' || envelope.state === 'expired') return;
      await tx.secretDeliveryEnvelope.update({
        where: { id: envelopeId },
        data: { state: 'failed', attemptCount: { increment: 1 }, lastErrorCode: errorCode },
      });
      await tx.secretDeliveryOutbox.updateMany({
        where: { envelopeId }, data: { attemptCount: { increment: 1 }, lastErrorCode: errorCode },
      });
      await this.audit.recordWithClient(tx, {
        correlationId: randomUUID(), action: 'staff.invite.failed',
        entityType: 'SecretDeliveryEnvelope', entityId: envelopeId,
        metadata: { purpose: envelope.purpose, errorCode },
      });
    });
  }

  private async verifiedInvitation(rawToken: string) {
    const parsed = parseOpaqueToken(rawToken);
    if (!parsed) return null;
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { selector: parsed.selector },
      include: { staffUser: true },
    });
    if (!invitation || !verifyTokenDigest(
      this.requireDigestRing(), invitation.digestKeyId, `invitation:${invitation.purpose}`,
      parsed, invitation.staffUserId, invitation.tokenDigest,
    )) return null;
    return invitation;
  }

  private async recordPasswordResetRequested(staffUserId?: string): Promise<void> {
    await this.prisma.$transaction((tx) => this.audit.recordWithClient(tx, {
      ...(staffUserId ? { actorId: staffUserId, entityId: staffUserId } : {}),
      correlationId: randomUUID(), action: 'auth.password_reset.requested', entityType: 'Authentication',
      metadata: { genericResponse: true },
    }));
  }

  private requireDigestRing() {
    if (!this.config.enabled || !this.config.digestKeys) throw new Error('IDENTITY_V2_DISABLED');
    return this.config.digestKeys;
  }
  private requireEnvelopeRing() {
    if (!this.config.enabled || !this.config.envelopeKeys) throw new Error('IDENTITY_V2_DISABLED');
    return this.config.envelopeKeys;
  }
  private invalidToken() {
    return new UnauthorizedException({ code: 'INVALID_OR_EXPIRED_TOKEN' });
  }
}
