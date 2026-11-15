import { TestBed } from '@angular/core/testing';
import { Subject, firstValueFrom, of } from 'rxjs';

import { AdminInfo } from '@tyre/shared';

import { AuthService } from './auth.service';
import { IdentityApiService } from './identity-api.service';

const STAFF: AdminInfo = {
  id: 'admin-1',
  email: 'owner@tyre.ge',
  role: 'admin',
  enabled: true,
  permissions: ['*'],
  permissionGrants: [{ permission: '*', scopeType: 'global', scopeId: '' }],
};

describe('AuthService identity-v2', () => {
  let service: AuthService;
  let api: {
    config: { enabled: boolean };
    login: ReturnType<typeof vi.fn>;
    completeMfa: ReturnType<typeof vi.fn>;
    csrf: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    sessionStorage.clear();
    api = {
      config: { enabled: true },
      login: vi.fn(),
      completeMfa: vi.fn(),
      csrf: vi.fn(),
      refresh: vi.fn(),
      logout: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: IdentityApiService, useValue: api }],
    });
    service = TestBed.inject(AuthService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });

  it('keeps authenticated access material in memory only', async () => {
    api.login.mockReturnValue(
      of({
        status: 'authenticated',
        accessToken: 'memory-token',
        accessExpiresAt: '2026-07-30T10:10:00.000Z',
        staff: STAFF,
      }),
    );

    await expect(
      firstValueFrom(service.login(STAFF.email, 'private-password')),
    ).resolves.toMatchObject({ status: 'authenticated' });
    expect(api.login).toHaveBeenCalledWith(STAFF.email, 'private-password');
    expect(service.accessToken).toBe('memory-token');
    expect(service.admin()).toMatchObject(STAFF);
    expect(sessionStorage.length).toBe(0);
  });

  it('does not let wildcard permission semantics substitute for an exact audit.read grant', async () => {
    api.login.mockReturnValueOnce(
      of({
        status: 'authenticated',
        accessToken: 'wildcard-token',
        accessExpiresAt: '2026-07-30T10:10:00.000Z',
        staff: STAFF,
      }),
    );
    await firstValueFrom(service.login(STAFF.email, 'private-password'));
    expect(service.hasPermission('audit.read')).toBe(true);
    expect(service.hasExactPermission('audit.read')).toBe(false);

    const exactStaff: AdminInfo = {
      ...STAFF,
      permissions: ['audit.read'],
      permissionGrants: [{ permission: 'audit.read', scopeType: 'global', scopeId: '' }],
    };
    api.login.mockReturnValueOnce(
      of({
        status: 'authenticated',
        accessToken: 'exact-token',
        accessExpiresAt: '2026-07-30T10:10:00.000Z',
        staff: exactStaff,
      }),
    );
    await firstValueFrom(service.login(exactStaff.email, 'private-password'));
    expect(service.hasExactPermission('audit.read')).toBe(true);
    expect(service.hasExactPermission('audit.export')).toBe(false);
  });

  it('holds an MFA challenge in memory and exchanges it for a session', async () => {
    api.login.mockReturnValue(
      of({
        status: 'mfa_required',
        challengeToken: 'challenge-secret',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    );
    await firstValueFrom(service.login(STAFF.email, 'private-password'));

    expect(service.isAuthenticated()).toBe(false);
    expect(service.pendingMfa()?.challengeToken).toBe('challenge-secret');
    expect(sessionStorage.length).toBe(0);

    api.completeMfa.mockReturnValue(
      of({
        status: 'authenticated',
        accessToken: 'mfa-token',
        accessExpiresAt: '2026-07-30T10:10:00.000Z',
        staff: STAFF,
      }),
    );
    await firstValueFrom(service.completeMfa('123456'));

    expect(api.completeMfa).toHaveBeenCalledWith('challenge-secret', '123456');
    expect(service.pendingMfa()).toBeNull();
    expect(service.accessToken).toBe('mfa-token');
  });

  it('deduplicates cold refresh and accepts the server-authoritative staff projection', async () => {
    const csrf = new Subject<{ csrfToken: string }>();
    api.csrf.mockReturnValue(csrf.asObservable());
    api.refresh.mockReturnValue(
      of({
        accessToken: 'rotated-token',
        accessExpiresAt: '2026-07-30T10:10:00.000Z',
        rotationResult: 'idempotent_replay',
        staff: {
          ...STAFF,
          status: 'active',
          mfaRequired: true,
          mfaEnrolled: true,
          version: 3,
        },
      }),
    );
    const first = firstValueFrom(service.refreshAccessToken());
    const second = firstValueFrom(service.refreshAccessToken());
    csrf.next({ csrfToken: 'csrf-proof' });
    csrf.complete();

    await expect(first).resolves.toBe('rotated-token');
    await expect(second).resolves.toBe('rotated-token');
    expect(api.csrf).toHaveBeenCalledOnce();
    expect(api.refresh).toHaveBeenCalledOnce();
    expect(api.refresh).toHaveBeenCalledWith('csrf-proof');
    expect(service.admin()).toMatchObject(STAFF);
  });

  it('clears pre-v2 persisted secrets during local logout', async () => {
    sessionStorage.setItem('tyre-adminka-auth', 'old-secret');
    api.csrf.mockReturnValue(of({ csrfToken: 'csrf-proof' }));
    api.logout.mockReturnValue(of(undefined));

    await firstValueFrom(service.logout());

    expect(api.logout).toHaveBeenCalledWith('csrf-proof');
    expect(sessionStorage.getItem('tyre-adminka-auth')).toBeNull();
  });
});
