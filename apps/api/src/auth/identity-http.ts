import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { CookieOptions, Request } from 'express';

import { IdentityConfig } from './identity-config';

export function assertExactIdentityOrigin(request: Pick<Request, 'headers'>, config: IdentityConfig): void {
  if (!config.enabled) throw new ServiceUnavailableException({ code: 'IDENTITY_V2_DISABLED' });
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === 'null' || origin !== config.adminPublicOrigin) {
    throw new ForbiddenException({ code: 'ORIGIN_REJECTED' });
  }
}

export function refreshCookieName(config: IdentityConfig): string {
  return config.environment === 'production' ? '__Secure-tyre_admin_refresh' : 'tyre_admin_refresh';
}

export function refreshCookieOptions(config: IdentityConfig): CookieOptions {
  const secure = config.environment === 'production' || config.adminPublicOrigin?.startsWith('https://') === true;
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/admin/v1/auth',
  };
}

export function readCookie(request: Pick<Request, 'headers'>, name: string): string | undefined {
  const raw = request.headers.cookie;
  if (!raw) return undefined;
  for (const pair of raw.split(';')) {
    const index = pair.indexOf('=');
    if (index < 1) continue;
    if (pair.slice(0, index).trim() === name) return decodeURIComponent(pair.slice(index + 1).trim());
  }
  return undefined;
}
