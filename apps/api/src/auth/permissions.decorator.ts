import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const AUTHENTICATED_ONLY_KEY = 'authenticated-only';
export const SCOPED_PERMISSION_KEY = 'scoped-permission';

export interface ScopedPermissionRequirement {
  permission: string;
  scopeType: 'warehouse' | 'channel' | 'company';
  scopeParam: string;
}

/** Require every listed permission. A role carrying `*` satisfies any check. */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Explicitly allow any authenticated staff account, regardless of permissions. */
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY_KEY, true);

/** Resolve a resource scope id from a route param, e.g. warehouseId. */
export const ScopedPermission = (
  permission: string,
  scopeType: ScopedPermissionRequirement['scopeType'],
  scopeParam: string,
) => SetMetadata(SCOPED_PERMISSION_KEY, { permission, scopeType, scopeParam } satisfies ScopedPermissionRequirement);
