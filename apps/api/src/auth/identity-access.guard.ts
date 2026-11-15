import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { IdentityAuthService, StaffProjection } from './identity-auth.service';
import { IdentityJwtService } from './identity-jwt.service';

export interface IdentityRequest {
  headers: Record<string, string | string[] | undefined>;
  user: StaffProjection & { sessionId: string };
}

@Injectable()
export class IdentityAccessGuard implements CanActivate {
  constructor(
    private readonly jwt: IdentityJwtService,
    private readonly prisma: PrismaService,
    private readonly identity: IdentityAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    this.identity.assertEnabled();
    const request = context.switchToHttp().getRequest<IdentityRequest>();
    const authorization = request.headers.authorization;
    const raw = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!raw?.startsWith('Bearer ')) throw new UnauthorizedException('Session is no longer valid');
    const claims = await this.jwt.verify(raw.slice(7));
    const session = await this.prisma.staffSession.findUnique({
      where: { id: claims.sid },
      include: { staffUser: true },
    });
    const now = Date.now();
    if (
      !session || session.staffUserId !== claims.sub || session.revokedAt ||
      session.idleExpiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now ||
      session.authContractVersion !== 2 || session.tokenVersionSnapshot !== claims.ver ||
      session.staffUser.tokenVersion !== claims.ver || !session.staffUser.enabled || session.staffUser.status !== 'active'
    ) throw new UnauthorizedException('Session is no longer valid');

    const control = await this.prisma.securityControl.findUnique({ where: { id: 1 } });
    if (!control || control.minimumAuthContractVersion > 2) throw new UnauthorizedException('Session is no longer valid');
    if (session.lastSeenAt.getTime() <= now - 5 * 60_000) {
      await this.prisma.staffSession.updateMany({
        where: { id: session.id, lastSeenAt: { lte: new Date(now - 5 * 60_000) }, revokedAt: null },
        data: { lastSeenAt: new Date() },
      });
    }
    request.user = { ...(await this.identity.staffInfo(claims.sub)), sessionId: claims.sid };
    return true;
  }
}
