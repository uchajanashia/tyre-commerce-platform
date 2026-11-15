import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  constantTimeTextEqual,
  decryptAead,
  encryptAead,
  generateOpaqueToken,
  keyedDigest,
  parseOpaqueToken,
  tokenDigest,
  verifyTokenDigest,
} from "./identity-crypto";
import { IDENTITY_CONFIG, IdentityConfig } from "./identity-config";
import { IdentityJwtService } from "./identity-jwt.service";

export interface SessionIssueResult {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  sessionId: string;
}

export interface SessionRotationResult extends SessionIssueResult {
  rotationResult: "rotated" | "idempotent_replay";
}

type RotationOutcome =
  | {
      ok: true;
      refreshToken: string;
      sessionId: string;
      staffUserId: string;
      tokenVersion: number;
      rotationResult: "rotated" | "idempotent_replay";
    }
  | { ok: false };

@Injectable()
export class StaffSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: IdentityJwtService,
    private readonly audit: AuditService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  async createSession(
    staffUser: { id: string; email: string; tokenVersion: number },
    authMethod: "password" | "password_totp" | "password_recovery_code",
    mfaSatisfiedAt: Date | null,
  ): Promise<SessionIssueResult> {
    return this.prisma.$transaction((tx) =>
      this.createSessionWithClient(tx, staffUser, authMethod, mfaSatisfiedAt),
    );
  }

  async createSessionWithClient(
    tx: Prisma.TransactionClient,
    staffUser: { id: string; email: string; tokenVersion: number },
    authMethod: "password" | "password_totp" | "password_recovery_code",
    mfaSatisfiedAt: Date | null,
  ): Promise<SessionIssueResult> {
    const digestRing = this.requireDigestRing();
    const token = generateOpaqueToken();
    const now = new Date();
    const absoluteExpiresAt = new Date(
      now.getTime() + this.config.refreshAbsoluteSeconds * 1000,
    );
    const idleExpiresAt = new Date(
      Math.min(
        absoluteExpiresAt.getTime(),
        now.getTime() + this.config.refreshIdleSeconds * 1000,
      ),
    );
    const sessionId = randomUUID();
    await tx.staffSession.create({
      data: {
        id: sessionId,
        staffUserId: staffUser.id,
        tokenVersionSnapshot: staffUser.tokenVersion,
        idleExpiresAt,
        absoluteExpiresAt,
        mfaSatisfiedAt,
        authMethod,
        refreshTokens: {
          create: {
            id: token.selector,
            tokenDigest: tokenDigest(
              digestRing,
              digestRing.currentKeyId,
              "refresh",
              token,
              sessionId,
            ),
            digestKeyId: digestRing.currentKeyId,
            expiresAt: absoluteExpiresAt,
          },
        },
      },
    });
    await this.audit.recordWithClient(tx, {
      actorId: staffUser.id,
      actorEmail: staffUser.email,
      correlationId: randomUUID(),
      action: "auth.session.created",
      entityType: "StaffSession",
      entityId: sessionId,
      after: {
        staffUserId: staffUser.id,
        authMethod,
        absoluteExpiresAt,
        mfaSatisfied: mfaSatisfiedAt !== null,
      },
    });
    const access = await this.jwt.issue(
      staffUser.id,
      sessionId,
      staffUser.tokenVersion,
    );
    return {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken: token.value,
      sessionId,
    };
  }

  async csrfProof(refreshCookie: string): Promise<string> {
    const parsed = parseOpaqueToken(refreshCookie);
    if (!parsed) throw new UnauthorizedException({ code: "INVALID_SESSION" });
    const token = await this.prisma.refreshToken.findUnique({
      where: { id: parsed.selector },
      include: { session: { include: { staffUser: true } } },
    });
    if (
      !token ||
      token.revokedAt ||
      token.expiresAt.getTime() <= Date.now() ||
      !verifyTokenDigest(
        this.requireDigestRing(),
        token.digestKeyId,
        "refresh",
        parsed,
        token.sessionId,
        token.tokenDigest,
      )
    ) {
      throw new UnauthorizedException({ code: "INVALID_SESSION" });
    }
    this.assertActive(token.session, token.session.staffUser);
    return this.deriveCsrf(
      token.session.id,
      token.session.familyId,
      token.session.staffUser.tokenVersion,
    );
  }

  async assertRefreshProofForSession(
    refreshCookie: string,
    csrfProof: string,
    staffUserId: string,
    sessionId: string,
  ): Promise<void> {
    const parsed = parseOpaqueToken(refreshCookie);
    if (!parsed) throw new UnauthorizedException({ code: "INVALID_SESSION" });
    const token = await this.prisma.refreshToken.findUnique({
      where: { id: parsed.selector },
      include: { session: { include: { staffUser: true } } },
    });
    if (
      !token ||
      token.sessionId !== sessionId ||
      token.session.staffUserId !== staffUserId ||
      token.revokedAt ||
      token.expiresAt.getTime() <= Date.now() ||
      !verifyTokenDigest(
        this.requireDigestRing(),
        token.digestKeyId,
        "refresh",
        parsed,
        token.sessionId,
        token.tokenDigest,
      ) ||
      !this.validCsrf(
        csrfProof,
        token.session.id,
        token.session.familyId,
        token.session.staffUser.tokenVersion,
      )
    )
      throw new UnauthorizedException({ code: "INVALID_SESSION" });
    this.assertActive(token.session, token.session.staffUser);
  }

  async rotate(
    refreshCookie: string,
    csrfProof: string,
  ): Promise<SessionRotationResult> {
    const parsed = parseOpaqueToken(refreshCookie);
    if (!parsed) throw new UnauthorizedException({ code: "INVALID_SESSION" });
    const outcome = await this.prisma.$transaction<RotationOutcome>(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT "id" FROM "RefreshToken" WHERE "id" = ${parsed.selector} FOR UPDATE`,
        );
        if (locked.length !== 1) return { ok: false };
        const predecessor = await tx.refreshToken.findUnique({
          where: { id: parsed.selector },
          include: {
            session: { include: { staffUser: true } },
            predecessorReceipt: true,
          },
        });
        if (
          !predecessor ||
          !verifyTokenDigest(
            this.requireDigestRing(),
            predecessor.digestKeyId,
            "refresh",
            parsed,
            predecessor.sessionId,
            predecessor.tokenDigest,
          )
        ) {
          return { ok: false };
        }
        const { session } = predecessor;
        if (
          !this.validCsrf(
            csrfProof,
            session.id,
            session.familyId,
            session.staffUser.tokenVersion,
          )
        )
          return { ok: false };
        if (predecessor.revokedAt) {
          await this.revokeFamilyWithClient(
            tx,
            session.id,
            "refresh_revoked_token_reuse",
          );
          await this.audit.recordWithClient(tx, {
            actorId: session.staffUserId,
            actorEmail: session.staffUser.email,
            correlationId: randomUUID(),
            action: "auth.refresh.reuse_detected",
            entityType: "StaffSession",
            entityId: session.id,
            metadata: {
              predecessorId: predecessor.id,
              reason: "revoked_token",
              familyOnly: true,
            },
          });
          return { ok: false };
        }
        if (predecessor.expiresAt.getTime() <= Date.now()) {
          await this.revokeFamilyWithClient(
            tx,
            session.id,
            "refresh_token_expired",
          );
          await this.audit.recordWithClient(tx, {
            actorId: session.staffUserId,
            actorEmail: session.staffUser.email,
            correlationId: randomUUID(),
            action: "auth.refresh.expired",
            entityType: "StaffSession",
            entityId: session.id,
            metadata: { predecessorId: predecessor.id, familyOnly: true },
          });
          return { ok: false };
        }
        try {
          this.assertActive(session, session.staffUser);
        } catch {
          await this.revokeFamilyWithClient(tx, session.id, "session_invalid");
          return { ok: false };
        }

        if (predecessor.usedAt || predecessor.replacedByTokenId) {
          const receipt = predecessor.predecessorReceipt;
          if (
            receipt &&
            receipt.expiresAt.getTime() > Date.now() &&
            receipt.nonce &&
            receipt.ciphertext &&
            receipt.authTag
          ) {
            try {
              const raw = decryptAead(
                this.requireEnvelopeRing(),
                {
                  keyId: receipt.encryptionKeyId,
                  nonce: Buffer.from(receipt.nonce),
                  ciphertext: Buffer.from(receipt.ciphertext),
                  authTag: Buffer.from(receipt.authTag),
                },
                this.receiptAad(
                  receipt.predecessorId,
                  receipt.successorId,
                  receipt.sessionId,
                  receipt.familyId,
                  receipt.expiresAt,
                ),
              ).toString("utf8");
              await this.audit.recordWithClient(tx, {
                actorId: session.staffUserId,
                actorEmail: session.staffUser.email,
                correlationId: randomUUID(),
                action: "auth.refresh.idempotent_replay",
                entityType: "StaffSession",
                entityId: session.id,
                metadata: {
                  predecessorId: predecessor.id,
                  successorId: receipt.successorId,
                },
              });
              return {
                ok: true,
                refreshToken: raw,
                sessionId: session.id,
                staffUserId: session.staffUserId,
                tokenVersion: session.staffUser.tokenVersion,
                rotationResult: "idempotent_replay",
              };
            } catch {
              await this.revokeFamilyWithClient(
                tx,
                session.id,
                "refresh_receipt_failed",
              );
              await this.audit.recordWithClient(tx, {
                actorId: session.staffUserId,
                actorEmail: session.staffUser.email,
                correlationId: randomUUID(),
                action: "auth.refresh.receipt_failed",
                entityType: "StaffSession",
                entityId: session.id,
                metadata: {
                  predecessorId: predecessor.id,
                  encryptionKeyId: receipt.encryptionKeyId,
                },
              });
              return { ok: false };
            }
          }
          await this.revokeFamilyWithClient(
            tx,
            session.id,
            "refresh_reuse_detected",
          );
          await this.audit.recordWithClient(tx, {
            actorId: session.staffUserId,
            actorEmail: session.staffUser.email,
            correlationId: randomUUID(),
            action: "auth.refresh.reuse_detected",
            entityType: "StaffSession",
            entityId: session.id,
            metadata: { predecessorId: predecessor.id, familyOnly: true },
          });
          return { ok: false };
        }

        const successor = generateOpaqueToken();
        const receiptExpiresAt = new Date(
          Date.now() + this.config.refreshReceiptSeconds * 1000,
        );
        const encrypted = encryptAead(
          this.requireEnvelopeRing(),
          successor.value,
          this.receiptAad(
            predecessor.id,
            successor.selector,
            session.id,
            session.familyId,
            receiptExpiresAt,
          ),
        );
        await tx.refreshToken.create({
          data: {
            id: successor.selector,
            sessionId: session.id,
            tokenDigest: tokenDigest(
              this.requireDigestRing(),
              this.requireDigestRing().currentKeyId,
              "refresh",
              successor,
              session.id,
            ),
            digestKeyId: this.requireDigestRing().currentKeyId,
            expiresAt: session.absoluteExpiresAt,
          },
        });
        await tx.refreshToken.update({
          where: { id: predecessor.id },
          data: { usedAt: new Date(), replacedByTokenId: successor.selector },
        });
        await tx.refreshRotationReceipt.create({
          data: {
            predecessorId: predecessor.id,
            successorId: successor.selector,
            sessionId: session.id,
            familyId: session.familyId,
            encryptionKeyId: encrypted.keyId,
            nonce: Uint8Array.from(encrypted.nonce),
            ciphertext: Uint8Array.from(encrypted.ciphertext),
            authTag: Uint8Array.from(encrypted.authTag),
            expiresAt: receiptExpiresAt,
          },
        });
        await tx.staffSession.update({
          where: { id: session.id },
          data: {
            lastSeenAt: new Date(),
            idleExpiresAt: new Date(
              Math.min(
                session.absoluteExpiresAt.getTime(),
                Date.now() + this.config.refreshIdleSeconds * 1000,
              ),
            ),
          },
        });
        await this.audit.recordWithClient(tx, {
          actorId: session.staffUserId,
          actorEmail: session.staffUser.email,
          correlationId: randomUUID(),
          action: "auth.session.rotated",
          entityType: "StaffSession",
          entityId: session.id,
          metadata: {
            predecessorId: predecessor.id,
            successorId: successor.selector,
          },
        });
        return {
          ok: true,
          refreshToken: successor.value,
          sessionId: session.id,
          staffUserId: session.staffUserId,
          tokenVersion: session.staffUser.tokenVersion,
          rotationResult: "rotated",
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    if (!outcome.ok)
      throw new UnauthorizedException({ code: "INVALID_SESSION" });
    const access = await this.jwt.issue(
      outcome.staffUserId,
      outcome.sessionId,
      outcome.tokenVersion,
    );
    return {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken: outcome.refreshToken,
      sessionId: outcome.sessionId,
      rotationResult: outcome.rotationResult,
    };
  }

  async revokeSession(
    staffUserId: string,
    sessionId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.staffSession.findFirst({
        where: { id: sessionId, staffUserId },
        include: { staffUser: { select: { email: true } } },
      });
      if (!session) return false;
      const result = await tx.staffSession.updateMany({
        where: { id: sessionId, staffUserId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "user_revoked" },
      });
      if (!result.count) return false;
      await tx.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.recordWithClient(tx, {
        actorId: staffUserId,
        actorEmail: session.staffUser.email,
        correlationId: randomUUID(),
        action: "auth.session.revoked",
        entityType: "StaffSession",
        entityId: sessionId,
        after: { selfService: true, revoked: true },
      });
      return true;
    });
  }

  async revokeByRefresh(
    refreshCookie: string,
    csrfProof: string,
  ): Promise<void> {
    const parsed = parseOpaqueToken(refreshCookie);
    if (!parsed) throw new UnauthorizedException({ code: "INVALID_SESSION" });
    const token = await this.prisma.refreshToken.findUnique({
      where: { id: parsed.selector },
      include: { session: { include: { staffUser: true } } },
    });
    if (
      !token ||
      !verifyTokenDigest(
        this.requireDigestRing(),
        token.digestKeyId,
        "refresh",
        parsed,
        token.sessionId,
        token.tokenDigest,
      ) ||
      !this.validCsrf(
        csrfProof,
        token.session.id,
        token.session.familyId,
        token.session.staffUser.tokenVersion,
      )
    )
      throw new UnauthorizedException({ code: "INVALID_SESSION" });
    await this.revokeSession(token.session.staffUserId, token.session.id);
  }

  async revokeAll(staffUserId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.admin.update({
        where: { id: staffUserId },
        data: { tokenVersion: { increment: 1 }, version: { increment: 1 } },
      });
      const sessions = await tx.staffSession.findMany({
        where: { staffUserId, revokedAt: null },
        select: { id: true },
      });
      await tx.staffSession.updateMany({
        where: { staffUserId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "account_revoke_all" },
      });
      await tx.refreshToken.updateMany({
        where: {
          sessionId: { in: sessions.map(({ id }) => id) },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    });
  }

  async list(staffUserId: string, cursor?: string, take = 25) {
    const boundedTake = Math.max(1, Math.min(take, 50));
    if (cursor) {
      this.assertCursor(cursor);
      const cursorRow = await this.prisma.staffSession.findFirst({
        where: { id: cursor, staffUserId },
        select: { id: true },
      });
      if (!cursorRow) throw new BadRequestException({ code: "INVALID_CURSOR" });
    }
    return this.prisma.staffSession.findMany({
      where: { staffUserId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: boundedTake + 1,
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

  private assertCursor(cursor: string): void {
    if (cursor.length > 128 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
      throw new BadRequestException({ code: "INVALID_CURSOR" });
    }
  }

  cleanupExpiredReceipts(now = new Date()) {
    return this.prisma.refreshRotationReceipt.updateMany({
      where: { expiresAt: { lte: now }, ciphertextClearedAt: null },
      data: {
        nonce: null,
        ciphertext: null,
        authTag: null,
        ciphertextClearedAt: now,
      },
    });
  }

  private deriveCsrf(
    sessionId: string,
    familyId: string,
    tokenVersion: number,
  ): string {
    const ring = this.requireCsrfRing();
    return `${ring.currentKeyId}.${keyedDigest(ring, ring.currentKeyId, "csrf", [sessionId, familyId, String(tokenVersion)])}`;
  }

  private validCsrf(
    proof: string,
    sessionId: string,
    familyId: string,
    tokenVersion: number,
  ): boolean {
    const [keyId, supplied, extra] = proof.split(".");
    if (!keyId || !supplied || extra) return false;
    try {
      const expected = keyedDigest(this.requireCsrfRing(), keyId, "csrf", [
        sessionId,
        familyId,
        String(tokenVersion),
      ]);
      return constantTimeTextEqual(supplied, expected);
    } catch {
      return false;
    }
  }

  private assertActive(
    session: {
      revokedAt: Date | null;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
      tokenVersionSnapshot: number;
    },
    staff: { enabled: boolean; status: string; tokenVersion: number },
  ): void {
    const now = Date.now();
    if (
      !staff.enabled ||
      staff.status !== "active" ||
      session.revokedAt ||
      session.idleExpiresAt.getTime() <= now ||
      session.absoluteExpiresAt.getTime() <= now ||
      session.tokenVersionSnapshot !== staff.tokenVersion
    ) {
      throw new UnauthorizedException({ code: "INVALID_SESSION" });
    }
  }

  private revokeFamilyWithClient(
    tx: Prisma.TransactionClient,
    sessionId: string,
    reason: string,
  ): Promise<unknown> {
    const now = new Date();
    return Promise.all([
      tx.staffSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: now, revokeReason: reason },
      }),
      tx.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }

  private receiptAad(
    predecessorId: string,
    successorId: string,
    sessionId: string,
    familyId: string,
    expiresAt: Date,
  ): string[] {
    return [
      "refresh-rotation",
      predecessorId,
      successorId,
      sessionId,
      familyId,
      expiresAt.toISOString(),
    ];
  }

  private requireDigestRing() {
    if (!this.config.enabled || !this.config.digestKeys)
      throw new Error("IDENTITY_V2_DISABLED");
    return this.config.digestKeys;
  }
  private requireCsrfRing() {
    if (!this.config.enabled || !this.config.csrfKeys)
      throw new Error("IDENTITY_V2_DISABLED");
    return this.config.csrfKeys;
  }
  private requireEnvelopeRing() {
    if (!this.config.enabled || !this.config.envelopeKeys)
      throw new Error("IDENTITY_V2_DISABLED");
    return this.config.envelopeKeys;
  }
}
