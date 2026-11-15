import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PublicAdmin } from './auth.service';
import { ROLES_KEY } from './roles.decorator';
import {
  AUTHENTICATED_ONLY_KEY,
  PERMISSIONS_KEY,
  SCOPED_PERMISSION_KEY,
  ScopedPermissionRequirement,
} from './permissions.decorator';
import { hasPermissionGrant } from './permission-evaluator';

export function hasRequiredPermissions(granted: string[], required: string[]): boolean {
  return granted.includes('*') || required.every((permission) => granted.includes(permission));
}

export function isAuthorizedByMetadata(input: {
  user?: PublicAdmin;
  roles?: string[];
  permissions?: string[];
  authenticatedOnly?: boolean;
  scopedPermission?: ScopedPermissionRequirement;
  scopeId?: string;
}): boolean {
  const { user, roles, permissions, authenticatedOnly, scopedPermission, scopeId } = input;
  if (!user) return false;
  const hasPolicy = authenticatedOnly === true || (roles?.length ?? 0) > 0 ||
    (permissions?.length ?? 0) > 0 || scopedPermission !== undefined;
  if (!hasPolicy) return false;
  if (roles && roles.length > 0 && !roles.includes(user.role)) return false;
  if (permissions && permissions.length > 0 && !hasRequiredPermissions(user.permissions, permissions)) return false;
  if (scopedPermission) {
    if (!scopeId) return false;
    if (!hasPermissionGrant(user.permissionGrants, scopedPermission.permission, {
      scopeType: scopedPermission.scopeType,
      scopeId,
    })) return false;
  }
  return true;
}

/**
 * Checks request.user.role against @Roles() metadata. Must run AFTER JwtAuthGuard
 * (which populates request.user). Routes without @Roles() pass through.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const permissions = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const authenticatedOnly = this.reflector.getAllAndOverride<boolean | undefined>(AUTHENTICATED_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const scopedPermission = this.reflector.getAllAndOverride<ScopedPermissionRequirement | undefined>(SCOPED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const { user, params } = context.switchToHttp().getRequest<{
      user?: PublicAdmin;
      params?: Record<string, string>;
    }>();
    return isAuthorizedByMetadata({
      user, roles: required, permissions, authenticatedOnly, scopedPermission,
      scopeId: scopedPermission ? params?.[scopedPermission.scopeParam] : undefined,
    });
  }
}
