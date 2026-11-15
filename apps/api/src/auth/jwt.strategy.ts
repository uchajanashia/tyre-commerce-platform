import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload, PublicAdmin } from './auth.service';
import { derivePermissionGrants } from './permission-evaluator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Presence is enforced at bootstrap (main.ts fails fast without it).
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  /** Return value becomes request.user for guarded routes. */
  async validate(payload: JwtPayload): Promise<PublicAdmin> {
    const control = this.prisma.securityControl
      ? await this.prisma.securityControl.findUnique({ where: { id: 1 } })
      : null;
    if (control && (control.minimumAuthContractVersion >= 2 || control.legacyJwtRevokedAt)) {
      throw new UnauthorizedException('Session is no longer valid');
    }
    const admin = await this.prisma.admin.findUnique({
      where: { id: payload.sub },
      include: {
        roleAssignments: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    if (
      !Number.isSafeInteger(payload.ver) ||
      !admin ||
      !admin.enabled ||
      admin.tokenVersion !== payload.ver
    ) {
      throw new UnauthorizedException('Session is no longer valid');
    }
    const permissionGrants = derivePermissionGrants(admin.roleAssignments);
    const permissions = permissionGrants
      .filter(({ scopeType, scopeId }) => scopeType === 'global' && scopeId === '')
      .map(({ permission }) => permission);
    return {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      enabled: admin.enabled,
      permissions,
      permissionGrants,
    };
  }
}
