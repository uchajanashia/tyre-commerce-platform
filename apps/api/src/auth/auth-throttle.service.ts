import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuthThrottleKind, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { keyedDigest } from './identity-crypto';
import { IDENTITY_CONFIG, IdentityConfig } from './identity-config';

@Injectable()
export class AuthThrottleService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  async consumeWindow(kind: AuthThrottleKind, rawKey: string, bucket: string, limit: number, windowMs: number): Promise<void> {
    const keyHash = this.key(kind, `${bucket}:${rawKey}`);
    const rows = await this.prisma.$queryRaw<Array<{ windowCount: number; cooldownUntil: Date | null }>>(Prisma.sql`
      INSERT INTO "AuthThrottleBucket" ("keyHash", "kind", "windowStartedAt", "windowCount", "consecutiveFailures", "updatedAt")
      VALUES (${keyHash}, ${kind}::"AuthThrottleKind", CURRENT_TIMESTAMP, 1, 0, CURRENT_TIMESTAMP)
      ON CONFLICT ("keyHash") DO UPDATE SET
        "windowCount" = CASE
          WHEN "AuthThrottleBucket"."windowStartedAt" + (${windowMs} * interval '1 millisecond') <= CURRENT_TIMESTAMP THEN 1
          ELSE "AuthThrottleBucket"."windowCount" + 1 END,
        "windowStartedAt" = CASE
          WHEN "AuthThrottleBucket"."windowStartedAt" + (${windowMs} * interval '1 millisecond') <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP
          ELSE "AuthThrottleBucket"."windowStartedAt" END,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "windowCount", "cooldownUntil"
    `);
    const row = rows[0];
    if (!row || row.windowCount > limit || (row.cooldownUntil && row.cooldownUntil.getTime() > Date.now())) throw this.limited();
  }

  async assertAccountAvailable(rawKey: string): Promise<void> {
    const row = await this.prisma.authThrottleBucket.findUnique({ where: { keyHash: this.key('login_account', rawKey) } });
    if (row?.cooldownUntil && row.cooldownUntil.getTime() > Date.now()) throw this.limited();
  }

  async recordLoginFailure(rawKey: string): Promise<void> {
    const keyHash = this.key('login_account', rawKey);
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "AuthThrottleBucket" ("keyHash", "kind", "windowStartedAt", "windowCount", "consecutiveFailures", "updatedAt")
      VALUES (${keyHash}, 'login_account', CURRENT_TIMESTAMP, 0, 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("keyHash") DO UPDATE SET
        "consecutiveFailures" = "AuthThrottleBucket"."consecutiveFailures" + 1,
        "cooldownUntil" = CASE
          WHEN "AuthThrottleBucket"."consecutiveFailures" + 1 >= 10 THEN CURRENT_TIMESTAMP + interval '30 minutes'
          WHEN "AuthThrottleBucket"."consecutiveFailures" + 1 >= 5 THEN CURRENT_TIMESTAMP + interval '5 minutes'
          ELSE "AuthThrottleBucket"."cooldownUntil" END,
        "updatedAt" = CURRENT_TIMESTAMP
    `);
  }

  async resetLoginFailures(rawKey: string): Promise<void> {
    await this.prisma.authThrottleBucket.updateMany({
      where: { keyHash: this.key('login_account', rawKey) },
      data: { consecutiveFailures: 0, cooldownUntil: null },
    });
  }

  async assertMfaAvailable(staffUserId: string): Promise<void> {
    const row = await this.prisma.authThrottleBucket.findUnique({ where: { keyHash: this.key('mfa_account', staffUserId) } });
    if (row?.cooldownUntil && row.cooldownUntil.getTime() > Date.now()) throw this.limited();
  }

  async recordMfaFailureWithClient(tx: Prisma.TransactionClient, staffUserId: string): Promise<void> {
    const keyHash = this.key('mfa_account', staffUserId);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "AuthThrottleBucket" ("keyHash", "kind", "windowStartedAt", "windowCount", "consecutiveFailures", "updatedAt")
      VALUES (${keyHash}, 'mfa_account', CURRENT_TIMESTAMP, 1, 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("keyHash") DO UPDATE SET
        "windowCount" = CASE
          WHEN "AuthThrottleBucket"."windowStartedAt" + interval '10 minutes' <= CURRENT_TIMESTAMP THEN 1
          ELSE "AuthThrottleBucket"."windowCount" + 1 END,
        "consecutiveFailures" = CASE
          WHEN "AuthThrottleBucket"."windowStartedAt" + interval '10 minutes' <= CURRENT_TIMESTAMP THEN 1
          ELSE "AuthThrottleBucket"."consecutiveFailures" + 1 END,
        "windowStartedAt" = CASE
          WHEN "AuthThrottleBucket"."windowStartedAt" + interval '10 minutes' <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP
          ELSE "AuthThrottleBucket"."windowStartedAt" END,
        "cooldownUntil" = CASE
          WHEN "AuthThrottleBucket"."windowStartedAt" + interval '10 minutes' > CURRENT_TIMESTAMP
            AND "AuthThrottleBucket"."windowCount" + 1 >= 10
          THEN CURRENT_TIMESTAMP + interval '30 minutes'
          ELSE "AuthThrottleBucket"."cooldownUntil" END,
        "updatedAt" = CURRENT_TIMESTAMP
    `);
  }

  async resetMfaFailures(staffUserId: string): Promise<void> {
    await this.prisma.authThrottleBucket.updateMany({
      where: { keyHash: this.key('mfa_account', staffUserId) },
      data: { windowCount: 0, consecutiveFailures: 0, cooldownUntil: null, windowStartedAt: new Date() },
    });
  }

  async assertStepUpAvailable(staffUserId: string): Promise<void> {
    const row = await this.prisma.authThrottleBucket.findUnique({
      where: { keyHash: this.key('step_up_account', staffUserId) },
    });
    if (row && row.windowStartedAt.getTime() + 5 * 60_000 > Date.now() && row.windowCount >= 5) {
      throw this.limited();
    }
    if (row?.cooldownUntil && row.cooldownUntil.getTime() > Date.now()) throw this.limited();
  }

  async recordStepUpFailureWithClient(tx: Prisma.TransactionClient, staffUserId: string): Promise<void> {
    const keyHash = this.key('step_up_account', staffUserId);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "AuthThrottleBucket" ("keyHash", "kind", "windowStartedAt", "windowCount", "consecutiveFailures", "updatedAt")
      VALUES (${keyHash}, 'step_up_account', CURRENT_TIMESTAMP, 1, 1, CURRENT_TIMESTAMP)
      ON CONFLICT ("keyHash") DO UPDATE SET
        "windowCount" = CASE
          WHEN "AuthThrottleBucket"."windowStartedAt" + interval '5 minutes' <= CURRENT_TIMESTAMP THEN 1
          ELSE "AuthThrottleBucket"."windowCount" + 1 END,
        "consecutiveFailures" = CASE
          WHEN "AuthThrottleBucket"."windowStartedAt" + interval '5 minutes' <= CURRENT_TIMESTAMP THEN 1
          ELSE "AuthThrottleBucket"."consecutiveFailures" + 1 END,
        "windowStartedAt" = CASE
          WHEN "AuthThrottleBucket"."windowStartedAt" + interval '5 minutes' <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP
          ELSE "AuthThrottleBucket"."windowStartedAt" END,
        "cooldownUntil" = CASE
          WHEN "AuthThrottleBucket"."windowStartedAt" + interval '5 minutes' > CURRENT_TIMESTAMP
            AND "AuthThrottleBucket"."windowCount" + 1 >= 5
          THEN "AuthThrottleBucket"."windowStartedAt" + interval '5 minutes'
          ELSE NULL END,
        "updatedAt" = CURRENT_TIMESTAMP
    `);
  }

  async resetStepUpFailures(staffUserId: string): Promise<void> {
    await this.prisma.authThrottleBucket.updateMany({
      where: { keyHash: this.key('step_up_account', staffUserId) },
      data: { windowCount: 0, consecutiveFailures: 0, cooldownUntil: null, windowStartedAt: new Date() },
    });
  }

  private key(kind: AuthThrottleKind, rawKey: string): string {
    const ring = this.config.digestKeys;
    if (!ring) throw new Error('IDENTITY_V2_DISABLED');
    return keyedDigest(ring, ring.currentKeyId, 'auth-throttle', [kind, rawKey]);
  }
  private limited() {
    return new HttpException({ code: 'RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
