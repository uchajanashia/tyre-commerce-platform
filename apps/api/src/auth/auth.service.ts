import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import { derivePermissionGrants, PermissionGrant, RoleAssignmentProjection } from './permission-evaluator';

/** Safe admin projection — passwordHash must never leave this service. */
export interface PublicAdmin {
  id: string;
  email: string;
  role: string;
  enabled: boolean;
  permissions: string[];
  permissionGrants: PermissionGrant[];
}

/** JWT payload shape shared with JwtStrategy. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  /** Required session epoch. Tokens issued before the security cutover lack it and are rejected. */
  ver: number;
}

interface VerifiedCredentialSnapshot {
  id: string;
  passwordHash: string;
  tokenVersion: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /** Verify a specific credential snapshot; do not use it to issue a token yet. */
  private async verifyCredentialSnapshot(
    email: string,
    password: string,
  ): Promise<VerifiedCredentialSnapshot | null> {
    const admin = await this.prisma.admin.findUnique({
      where: { email },
    });
    if (!admin) return null;
    if (!admin.passwordHash) return null;
    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok || !admin.enabled) return null;
    return {
      id: admin.id,
      passwordHash: admin.passwordHash,
      tokenVersion: admin.tokenVersion,
    };
  }

  async login(email: string, password: string): Promise<{ accessToken: string; admin: PublicAdmin }> {
    if (!process.env.JWT_SECRET?.trim()) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const control = this.prisma.securityControl
      ? await this.prisma.securityControl.findUnique({ where: { id: 1 } })
      : null;
    if (control && (control.minimumAuthContractVersion >= 2 || control.legacyJwtRevokedAt)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const verified = await this.verifyCredentialSnapshot(email, password);
    if (!verified) {
      // Same message for unknown email and wrong password — no account enumeration.
      throw new UnauthorizedException('Invalid credentials');
    }

    // bcrypt verification is intentionally outside a database transaction. Bind
    // issuance back to the exact hash/version snapshot afterwards: a concurrent
    // password, role, status, or explicit session-revocation change makes this
    // lookup fail. A change after this lookup still invalidates the issued epoch
    // before the token can authorize a request.
    const persisted = await this.prisma.admin.findFirst({
      where: {
        id: verified.id,
        enabled: true,
        passwordHash: verified.passwordHash,
        tokenVersion: verified.tokenVersion,
      },
      include: {
        roleAssignments: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    if (!persisted) throw new UnauthorizedException('Invalid credentials');

    const admin = this.toPublicAdmin(persisted);
    const payload: JwtPayload = {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      ver: persisted.tokenVersion,
    };
    return { accessToken: await this.jwt.signAsync(payload), admin };
  }

  /** Invalidates all tokens for the account without retaining raw JWTs. */
  async revokeAllSessions(adminId: string, context: AuditContext): Promise<{ revoked: true }> {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.admin.findUniqueOrThrow({
        where: { id: adminId },
        select: { id: true, tokenVersion: true, enabled: true, role: true },
      });
      const after = await tx.admin.update({
        where: { id: adminId },
        data: { tokenVersion: { increment: 1 } },
        select: { id: true, tokenVersion: true, enabled: true, role: true },
      });
      await this.audit.recordWithClient(tx, {
        ...context,
        action: 'security.sessions.revoke_all',
        entityType: 'Admin',
        entityId: adminId,
        before,
        after,
      });
    });
    return { revoked: true };
  }

  private toPublicAdmin(admin: {
    id: string;
    email: string;
    role: string;
    enabled: boolean;
    roleAssignments: RoleAssignmentProjection[];
  }): PublicAdmin {
    const permissionGrants = derivePermissionGrants(admin.roleAssignments);
    const permissions = permissionGrants
      .filter(({ scopeType, scopeId }) => scopeType === 'global' && scopeId === '')
      .map(({ permission }) => permission);
    return { id: admin.id, email: admin.email, role: admin.role, enabled: admin.enabled, permissions, permissionGrants };
  }
}
