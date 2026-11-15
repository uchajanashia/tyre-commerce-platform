export type PermissionScopeType = 'global' | 'warehouse' | 'channel' | 'company';

export interface PermissionGrant {
  permission: string;
  scopeType: PermissionScopeType;
  scopeId: string;
}

export interface RoleAssignmentProjection {
  scopeType: PermissionScopeType;
  scopeId: string;
  role: { permissions: { permission: { key: string } }[] };
}

export function derivePermissionGrants(assignments: RoleAssignmentProjection[]): PermissionGrant[] {
  const unique = new Map<string, PermissionGrant>();
  for (const assignment of assignments) {
    for (const { permission } of assignment.role.permissions) {
      const grant = { permission: permission.key, scopeType: assignment.scopeType, scopeId: assignment.scopeId };
      unique.set(`${grant.permission}\u0000${grant.scopeType}\u0000${grant.scopeId}`, grant);
    }
  }
  return [...unique.values()];
}

/**
 * No requested scope means a global admin route and therefore accepts only a
 * global grant. A global grant may satisfy a scoped request. Wildcard is honored
 * only globally; scoped roles must enumerate their allowed operations.
 */
export function hasPermissionGrant(
  grants: PermissionGrant[],
  permission: string,
  requestedScope?: { scopeType: Exclude<PermissionScopeType, 'global'>; scopeId: string },
): boolean {
  return grants.some((grant) => {
    const permissionMatches = grant.permission === permission || (grant.permission === '*' && grant.scopeType === 'global');
    if (!permissionMatches) return false;
    if (!requestedScope) return grant.scopeType === 'global' && grant.scopeId === '';
    return grant.scopeType === 'global' ||
      (grant.scopeType === requestedScope.scopeType && grant.scopeId === requestedScope.scopeId);
  });
}
