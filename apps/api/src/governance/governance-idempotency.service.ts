import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { GovernanceActor, assertGovernanceEnabled } from './governance-access';
import { GOVERNANCE_CONFIG, GovernanceConfig } from './governance-config';
import { assertStrongIdempotencyKey, idempotencyKeyHash } from './governance-hash';

export interface GovernanceIdempotencyIdentity {
  keyId: string;
  keyHash: string;
}

@Injectable()
export class GovernanceIdempotencyService {
  constructor(@Inject(GOVERNANCE_CONFIG) private readonly config: GovernanceConfig) {}

  identify(actor: GovernanceActor, actionType: string, rawKey: string): GovernanceIdempotencyIdentity {
    assertGovernanceEnabled(this.config);
    assertStrongIdempotencyKey(rawKey);
    const ring = this.requireKeys();
    const keyId = ring.currentKeyId;
    return { keyId, keyHash: idempotencyKeyHash(ring.keys.get(keyId)!.key, actor.id, actionType, rawKey) };
  }

  async lockAndReplay<T>(
    tx: Prisma.TransactionClient,
    actor: GovernanceActor,
    actionType: string,
    rawKey: string,
    requestHash: string,
  ): Promise<{ identity: GovernanceIdempotencyIdentity; replay?: T }> {
    const identity = this.identify(actor, actionType, rawKey);
    // keyHash already purpose-binds actor and action; PostgreSQL text cannot
    // carry NUL separators, so lock directly on the canonical keyed digest.
    await tx.$queryRaw(Prisma.sql`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${identity.keyHash}, 0))`);
    const existing = await tx.governanceIdempotencyRecord.findUnique({
      where: { actorId_actionType_idempotencyKeyHash: { actorId: actor.id, actionType, idempotencyKeyHash: identity.keyHash } },
    });
    if (!existing) return { identity };
    if (existing.requestHash !== requestHash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' });
    return { identity, replay: existing.responseJson as T };
  }

  async recordWithClient(
    tx: Prisma.TransactionClient,
    actor: GovernanceActor,
    actionType: string,
    identity: GovernanceIdempotencyIdentity,
    requestHash: string,
    response: object,
    resourceId?: string,
  ): Promise<void> {
    await tx.governanceIdempotencyRecord.create({
      data: {
        actorId: actor.id, actionType, idempotencyKeyHash: identity.keyHash, keyId: identity.keyId,
        requestHash, responseJson: response, resourceId, retainUntil: null,
      },
    });
  }

  private requireKeys() {
    if (!this.config.enabled || !this.config.idempotencyKeys) throw new Error('APPROVAL_PLATFORM_DISABLED');
    return this.config.idempotencyKeys;
  }
}
