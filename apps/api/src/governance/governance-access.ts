import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { StaffProjection } from '../auth/identity-auth.service';
import { GovernanceConfig } from './governance-config';

export type GovernanceActor = StaffProjection & { sessionId: string };

export function assertGovernanceEnabled(config: GovernanceConfig): void {
  if (!config.enabled) throw new ServiceUnavailableException({ code: 'APPROVAL_PLATFORM_DISABLED' });
}

/** Governance permissions never accept the legacy global wildcard. */
export function requireExactGlobalPermission(actor: GovernanceActor, permission: string): void {
  const permitted = actor.permissionGrants.some((grant) =>
    grant.permission === permission && grant.scopeType === 'global' && grant.scopeId === '',
  );
  if (!permitted) throw new ForbiddenException({ code: 'GOVERNANCE_PERMISSION_DENIED' });
}

export async function requireCurrentExactGlobalPermission(
  tx: Prisma.TransactionClient,
  actorId: string,
  permission: string,
): Promise<void> {
  const count = await tx.rolePermission.count({
    where: {
      permission: { key: permission },
      role: { assignments: { some: { adminId: actorId, scopeType: 'global', scopeId: '' } } },
    },
  });
  if (count < 1) throw new ForbiddenException({ code: 'GOVERNANCE_PERMISSION_DENIED' });
}
