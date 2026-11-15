import { randomUUID } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { decode, sign, verify } from 'jsonwebtoken';

import { IDENTITY_CONFIG, IdentityConfig } from './identity-config';
import { IdentityKeyLifecycleService } from './identity-key-lifecycle.service';

export interface IdentityAccessClaims {
  sub: string;
  sid: string;
  ver: number;
  iat: number;
  exp: number;
  nbf?: number;
  iss: string;
  aud: string;
  jti: string;
}

@Injectable()
export class IdentityJwtService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(IDENTITY_CONFIG) private readonly config: IdentityConfig,
    private readonly keyLifecycle: IdentityKeyLifecycleService,
  ) {}

  async issue(staffUserId: string, sessionId: string, tokenVersion: number): Promise<{ token: string; expiresAt: string }> {
    const ring = this.requireRing();
    if (await this.keyLifecycle.isCompromised('jwt', ring.currentKeyId)) throw new Error('JWT_SIGNING_KEY_COMPROMISED');
    const key = ring.keys.get(ring.currentKeyId);
    if (!key?.privateKey || key.state !== 'sign+verify') throw new Error('JWT_SIGNING_KEY_UNAVAILABLE');
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.config.accessTokenTtlSeconds;
    const claims: IdentityAccessClaims = {
      sub: staffUserId,
      sid: sessionId,
      ver: tokenVersion,
      iat: now,
      exp,
      iss: this.config.jwtIssuer as string,
      aud: this.config.jwtAudience as string,
      jti: randomUUID(),
    };
    const token = sign(claims, key.privateKey, {
      algorithm: 'RS256',
      keyid: key.id,
    });
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }

  async verify(token: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<IdentityAccessClaims> {
    const decoded = decode(token, { complete: true }) as { header?: { alg?: string; kid?: string } } | null;
    if (!decoded?.header || decoded.header.alg !== 'RS256' || !decoded.header.kid) throw new UnauthorizedException('Session is no longer valid');
    const key = this.requireRing().keys.get(decoded.header.kid);
    if (!key || key.state === 'revoked' || await this.keyLifecycle.isCompromised('jwt', decoded.header.kid)) {
      throw new UnauthorizedException('Session is no longer valid');
    }
    let claims: IdentityAccessClaims;
    try {
      claims = verify(token, key.publicKey, {
        algorithms: ['RS256'],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
        clockTolerance: this.config.clockToleranceSeconds,
      }) as IdentityAccessClaims;
    } catch {
      throw new UnauthorizedException('Session is no longer valid');
    }
    this.validateNumericDates(claims, nowSeconds);
    return claims;
  }

  private validateNumericDates(claims: IdentityAccessClaims, now: number): void {
    const tol = this.config.clockToleranceSeconds;
    if (
      !claims || typeof claims.sub !== 'string' || typeof claims.sid !== 'string' ||
      !Number.isSafeInteger(claims.ver) || !Number.isSafeInteger(claims.iat) ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= claims.iat ||
      claims.exp - claims.iat > 900 || claims.iat > now + tol || claims.exp <= now - tol ||
      claims.iss !== this.config.jwtIssuer || claims.aud !== this.config.jwtAudience ||
      typeof claims.jti !== 'string' || claims.jti.length < 16
    ) {
      throw new UnauthorizedException('Session is no longer valid');
    }
    if (claims.nbf !== undefined && (
      !Number.isSafeInteger(claims.nbf) || claims.nbf < claims.iat - tol ||
      claims.nbf > Math.min(claims.exp, now + tol)
    )) {
      throw new UnauthorizedException('Session is no longer valid');
    }
  }

  private requireRing() {
    if (!this.config.enabled || !this.config.jwtKeys) throw new Error('IDENTITY_V2_DISABLED');
    return this.config.jwtKeys;
  }
}
