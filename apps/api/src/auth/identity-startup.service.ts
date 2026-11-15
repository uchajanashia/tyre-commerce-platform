import { randomUUID } from 'node:crypto';

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { IDENTITY_AUTH_CONTRACT_VERSION, IDENTITY_CONFIG, IdentityConfig } from './identity-config';
import { IdentityKeyLifecycleService } from './identity-key-lifecycle.service';

@Injectable()
export class IdentityStartupService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
    private readonly keyLifecycle: IdentityKeyLifecycleService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.operatorMode) throw new Error('ADMIN_IDENTITY_OPERATOR_MODE cannot boot the HTTP API.');
    let control;
    try {
      control = await this.prisma.securityControl.findUnique({ where: { id: 1 } });
    } catch (error) {
      // Identity v2 is an optional admin subsystem while disabled. A catalog-only
      // database may legitimately predate its additive tables; public reads must
      // still boot, while every v2 endpoint remains fail-closed via assertEnabled().
      if (
        !this.config.enabled &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2021'
      ) {
        return;
      }
      throw error;
    }
    if (!control) {
      if (this.config.enabled) throw new Error('SecurityControl singleton is required for identity v2.');
      return;
    }
    if (control.minimumAuthContractVersion > IDENTITY_AUTH_CONTRACT_VERSION) {
      throw new Error('Database auth contract is newer than this API binary.');
    }
    if (this.config.enabled && (
      control.identityCanonicalizationVersion !== 1 ||
      !control.identityCanonicalizedAt || !control.identityCanonicalizationDigest
    )) {
      throw new Error('Exact runtime staff-email canonicalization backfill marker is required for identity v2.');
    }
    if (control.sessionsEnforcedAt || control.minimumAuthContractVersion >= 2) {
      if (
        control.minimumAuthContractVersion !== IDENTITY_AUTH_CONTRACT_VERSION ||
        !control.sessionsEnforcedAt || !control.legacyJwtRevokedAt
      ) throw new Error('Identity cutover marker is incomplete or incompatible.');
      if (!this.config.enabled) throw new Error('ADMIN_IDENTITY_ENABLED must remain true after identity contract-v2 cutover.');
      if (process.env.JWT_SECRET) throw new Error('JWT_SECRET must be removed after identity contract-v2 cutover.');
      const recorded = await this.prisma.auditEvent.findFirst({ where: { action: 'auth.cutover.enforced' }, select: { id: true } });
      if (!recorded) {
        await this.prisma.$transaction((tx) => this.audit.recordWithClient(tx, {
          correlationId: randomUUID(), action: 'auth.cutover.enforced',
          entityType: 'SecurityControl', entityId: '1',
          after: { minimumAuthContractVersion: control.minimumAuthContractVersion, sessionsEnforced: true, legacyJwtRevoked: true },
        }));
      }
    }
    if (this.config.enabled) {
      await this.keyLifecycle.assertTotpKeyCoverage();
      await this.keyLifecycle.assertCompromiseReadiness();
    }
  }
}
