import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { IDENTITY_CONFIG, IdentityConfig } from './identity-config';
import { StaffSessionService } from './staff-session.service';
import { IdentityKeyLifecycleService } from './identity-key-lifecycle.service';

@Injectable()
export class IdentityMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdentityMaintenanceService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: StaffSessionService,
    private readonly keyLifecycle: IdentityKeyLifecycleService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) return;
    this.timer = setInterval(() => void this.cleanup(), 5_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async cleanup(now = new Date()): Promise<void> {
    try {
      await this.prisma.$transaction([
        this.prisma.refreshRotationReceipt.updateMany({
          where: { expiresAt: { lte: now }, ciphertextClearedAt: null },
          data: { nonce: null, ciphertext: null, authTag: null, ciphertextClearedAt: now },
        }),
        this.prisma.secretDeliveryEnvelope.updateMany({
          where: { expiresAt: { lte: now }, ciphertextClearedAt: null },
          data: { nonce: null, ciphertext: null, authTag: null, ciphertextClearedAt: now, state: 'expired' },
        }),
      ]);
      await this.keyLifecycle.reencryptTotpBatch(50);
    } catch (error) {
      // Key material and envelope/token identifiers are deliberately excluded.
      this.logger.error(`Identity expiry cleanup failed: ${(error as Error).name}`);
    }
  }
}
