import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Observable,
  catchError,
  finalize,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
  throwError,
} from 'rxjs';

import { AdminInfo } from '@tyre/shared';

import {
  AuthenticatedLoginResult,
  IdentityLoginResult,
  MfaRequiredLoginResult,
} from './identity-contract';
import { IdentityApiService } from './identity-api.service';

interface MemoryAuthState {
  accessToken: string;
  accessExpiresAt: string;
  staff: AdminInfo;
}

/** Identity-v2 browser state: access/challenge/CSRF secrets remain memory-only. */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(IdentityApiService);
  private readonly state = signal<MemoryAuthState | null>(null);
  private readonly pendingMfaState = signal<MfaRequiredLoginResult | null>(null);
  private refreshInFlight$: Observable<string> | null = null;

  readonly admin = computed(() => this.state()?.staff ?? null);
  readonly isAuthenticated = computed(() => this.state() !== null);
  readonly pendingMfa = this.pendingMfaState.asReadonly();
  readonly identityV2Enabled = this.api.config.enabled;

  get accessToken(): string | null {
    return this.state()?.accessToken ?? null;
  }

  login(email: string, password: string): Observable<IdentityLoginResult> {
    this.clearLocalSession();
    return this.api.login(email, password).pipe(tap((result) => this.acceptLoginResult(result)));
  }

  completeMfa(code: string): Observable<AuthenticatedLoginResult> {
    const challenge = this.pendingMfaState();
    if (!challenge || Date.parse(challenge.expiresAt) <= Date.now()) {
      this.pendingMfaState.set(null);
      return throwError(() => new Error('MFA_CHALLENGE_EXPIRED'));
    }
    return this.api.completeMfa(challenge.challengeToken, code).pipe(
      tap((result) => {
        this.pendingMfaState.set(null);
        this.setAuthenticated(result);
      }),
    );
  }

  cancelMfa(): void {
    this.pendingMfaState.set(null);
  }

  ensureAuthenticated(): Observable<boolean> {
    if (this.isAuthenticated()) return of(true);
    if (!this.identityV2Enabled) return of(false);
    return this.refreshAccessToken().pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /** One in-flight refresh per tab; interceptor queues safe requests behind it. */
  refreshAccessToken(): Observable<string> {
    if (!this.identityV2Enabled) return throwError(() => new Error('IDENTITY_V2_DISABLED'));
    if (this.refreshInFlight$) return this.refreshInFlight$;

    const request$ = this.api.csrf().pipe(
      switchMap(({ csrfToken }) =>
        this.api.refresh(csrfToken).pipe(map((result) => ({ result, csrfToken }))),
      ),
      tap(({ result }) =>
        this.state.set({
          accessToken: result.accessToken,
          accessExpiresAt: result.accessExpiresAt,
          staff: result.staff,
        }),
      ),
      map(({ result }) => result.accessToken),
      catchError((error: unknown) => {
        this.clearLocalSession();
        return throwError(() => error);
      }),
      finalize(() => (this.refreshInFlight$ = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.refreshInFlight$ = request$;
    return request$;
  }

  csrfToken(): Observable<string> {
    return this.api.csrf().pipe(map((result) => result.csrfToken));
  }

  logout(): Observable<void> {
    if (!this.identityV2Enabled) {
      this.clearLocalSession();
      return of(undefined);
    }
    return this.csrfToken().pipe(
      switchMap((csrfToken) => this.api.logout(csrfToken)),
      finalize(() => this.clearLocalSession()),
    );
  }

  clearLocalSession(): void {
    this.state.set(null);
    this.pendingMfaState.set(null);
    // Security migration: remove pre-v2 secret storage if an older build left it behind.
    this.removeLegacySecret(globalThis.sessionStorage);
    this.removeLegacySecret(globalThis.localStorage);
  }

  hasPermission(permission: string): boolean {
    const granted = this.admin()?.permissions ?? [];
    return granted.includes('*') || granted.includes(permission);
  }

  /** Literal permission+grant check for surfaces whose contract forbids legacy wildcard substitution. */
  hasExactPermission(permission: string): boolean {
    const admin = this.admin();
    return Boolean(
      admin?.permissions.includes(permission) &&
      admin.permissionGrants.some((grant) => grant.permission === permission),
    );
  }

  private acceptLoginResult(result: IdentityLoginResult): void {
    if (result.status === 'mfa_required') {
      this.pendingMfaState.set(result);
      return;
    }
    this.setAuthenticated(result);
  }

  private setAuthenticated(result: AuthenticatedLoginResult): void {
    this.state.set({
      accessToken: result.accessToken,
      accessExpiresAt: result.accessExpiresAt,
      staff: result.staff,
    });
  }

  private removeLegacySecret(storage: Storage | undefined): void {
    try {
      storage?.removeItem('tyre-adminka-auth');
    } catch {
      // Storage may be unavailable under strict privacy policies; secrets still live in memory only.
    }
  }
}
