import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/** Bearer attachment plus one deduplicated, replay-safe refresh attempt on access expiry. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const trusted = isTrustedApiUrl(req.url);
  const authEndpoint = isIdentityAuthEndpoint(req.url);
  const outgoing = attachBearer(req, trusted ? auth.accessToken : null);

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      if (
        !trusted ||
        authEndpoint ||
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401 ||
        !isReplaySafe(req)
      ) {
        if (
          trusted &&
          !authEndpoint &&
          error instanceof HttpErrorResponse &&
          error.status === 401
        ) {
          auth.clearLocalSession();
          void router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
        }
        return throwError(() => error);
      }

      return auth.refreshAccessToken().pipe(
        switchMap((token) => next(attachBearer(req, token))),
        catchError((refreshError: unknown) => {
          auth.clearLocalSession();
          void router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};

function attachBearer(request: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  return token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;
}

export function isReplaySafe(request: HttpRequest<unknown>): boolean {
  return (
    ['GET', 'HEAD', 'OPTIONS'].includes(request.method) || request.headers.has('Idempotency-Key')
  );
}

function isIdentityAuthEndpoint(requestUrl: string): boolean {
  try {
    const pathname = new URL(requestUrl, browserOrigin()).pathname;
    return new Set([
      '/admin/auth/login',
      '/admin/v1/auth/login',
      '/admin/v1/auth/mfa/challenge',
      '/admin/v1/auth/csrf',
      '/admin/v1/auth/refresh',
      '/admin/v1/auth/logout',
      '/admin/v1/auth/password-reset/request',
      '/admin/v1/auth/password-reset/complete',
      '/admin/v1/invitations/inspect',
      '/admin/v1/invitations/accept',
      '/admin/v1/mfa/enrollment/start',
      '/admin/v1/mfa/enrollment/confirm',
    ]).has(pathname);
  } catch {
    return false;
  }
}

/** Exact origin comparison prevents Bearer leakage; relative URLs are same-origin only. */
export function isTrustedApiUrl(requestUrl: string): boolean {
  try {
    const origin = browserOrigin();
    const request = new URL(requestUrl, origin);
    const legacyApi = new URL(environment.apiBaseUrl, origin);
    const identityApi = new URL(environment.identityApiBaseUrl, origin);
    return request.origin === legacyApi.origin || request.origin === identityApi.origin;
  } catch {
    return false;
  }
}

function browserOrigin(): string {
  const origin = globalThis.location?.origin;
  // Browser requests always have a concrete origin. Keep non-browser evaluation
  // fail-closed without shipping a development host in production artifacts.
  return origin && origin !== 'null' ? origin : 'https://invalid.invalid';
}
