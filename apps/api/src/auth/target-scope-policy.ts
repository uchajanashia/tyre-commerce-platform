import { ForbiddenException } from '@nestjs/common';

import { hasPermissionGrant, PermissionGrant, PermissionScopeType } from './permission-evaluator';

export interface TargetScopeProjection {
  scopeType: PermissionScopeType;
  scopeId: string;
}

export function assertTargetScope(
  actor: { permissionGrants: PermissionGrant[] },
  permission: string,
  targetAssignments: readonly TargetScopeProjection[],
): void {
  if (!canTargetScope(actor, permission, targetAssignments)) {
    throw new ForbiddenException({ code: 'TARGET_SCOPE_FORBIDDEN' });
  }
}

export function canTargetScope(
  actor: { permissionGrants: PermissionGrant[] },
  permission: string,
  targetAssignments: readonly TargetScopeProjection[],
): boolean {
  if (hasPermissionGrant(actor.permissionGrants, permission)) return true;
  return targetAssignments.length > 0 && targetAssignments.every((assignment) => {
    if (assignment.scopeType === 'global') return false;
    return hasPermissionGrant(actor.permissionGrants, permission, {
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
    });
  });
}
