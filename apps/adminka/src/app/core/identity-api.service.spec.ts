import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';

import { AuthService } from './auth.service';
import { ADMIN_API_FETCH } from './generated-admin-read-transport';
import { ADMIN_REQUEST_ORIGIN } from './generated-identity-transport';
import { IDENTITY_FEATURE_CONFIG, IdentityApiService } from './identity-api.service';

describe('IdentityApiService generated compatibility', () => {
  let api: IdentityApiService;
  let fetchMock: ReturnType<typeof vi.fn>;
  let auth: { accessToken: string | null; refreshAccessToken: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fetchMock = vi.fn();
    auth = {
      accessToken: 'memory-token',
      refreshAccessToken: vi.fn(() => of('rotated-token')),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ADMIN_API_FETCH, useValue: fetchMock as unknown as typeof fetch },
        { provide: ADMIN_REQUEST_ORIGIN, useValue: 'https://admin.tyre.test' },
        { provide: AuthService, useValue: auth },
        {
          provide: IDENTITY_FEATURE_CONFIG,
          useValue: { apiBaseUrl: '/admin/v1', enabled: true },
        },
      ],
    });
    api = TestBed.inject(IdentityApiService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('maps login, MFA, CSRF, refresh and logout with one-use secrets and exact browser proofs', async () => {
    enqueue({
      status: 'authenticated',
      accessToken: 'access-secret',
      accessExpiresAt: DATE,
      staff: STAFF,
    });
    expect(await firstValueFrom(api.login('ops@tyre.ge', 'private-password'))).toEqual({
      status: 'authenticated',
      accessToken: 'access-secret',
      accessExpiresAt: DATE,
      staff: STAFF,
    });
    expectRequest(0, '/admin/v1/auth/login', 'POST', {
      email: 'ops@tyre.ge',
      password: 'private-password',
    });
    expectHeaders(0, { Origin: ORIGIN, Authorization: null });

    enqueue({
      status: 'mfa_required',
      challengeToken: 'challenge-secret',
      expiresAt: DATE,
    });
    expect(await firstValueFrom(api.login('ops@tyre.ge', 'private-password'))).toEqual({
      status: 'mfa_required',
      challengeToken: 'challenge-secret',
      expiresAt: DATE,
    });

    enqueue({
      status: 'authenticated',
      accessToken: 'mfa-access-secret',
      accessExpiresAt: DATE,
      staff: STAFF,
    });
    expect(await firstValueFrom(api.completeMfa('challenge-secret', '123456'))).toEqual(
      expect.objectContaining({ status: 'authenticated', accessToken: 'mfa-access-secret' }),
    );
    expectRequest(2, '/admin/v1/auth/mfa/challenge', 'POST', {
      challengeToken: 'challenge-secret',
      code: '123456',
    });

    enqueue({ csrfToken: 'csrf-secret' });
    expect(await firstValueFrom(api.csrf())).toEqual({ csrfToken: 'csrf-secret' });
    expectHeaders(3, { Origin: ORIGIN, Authorization: null });

    enqueue({
      accessToken: 'rotated-secret',
      accessExpiresAt: DATE,
      rotationResult: 'rotated',
      staff: STAFF,
    });
    expect(await firstValueFrom(api.refresh('csrf-secret'))).toEqual(
      expect.objectContaining({ accessToken: 'rotated-secret', rotationResult: 'rotated' }),
    );
    expectHeaders(4, {
      Origin: ORIGIN,
      Authorization: null,
      'X-CSRF-Token': 'csrf-secret',
    });

    enqueue({ revoked: true });
    expect(await firstValueFrom(api.logout('csrf-secret'))).toBeUndefined();
    expectHeaders(5, {
      Origin: ORIGIN,
      Authorization: null,
      'X-CSRF-Token': 'csrf-secret',
    });
    expect(credentials(5)).toBe('same-origin');
  });

  it('maps invitation, password reset and MFA enrollment operations without leaking responses', async () => {
    enqueue({ purpose: 'invite', expiresAt: DATE });
    expect(await firstValueFrom(api.inspectInvitation('invite-token'))).toEqual({
      purpose: 'invite',
      expiresAt: DATE,
    });
    expectRequest(0, '/admin/v1/invitations/inspect', 'POST', { token: 'invite-token' });

    enqueue({ status: 'pending_activation', mfaRequired: true, activationProof: 'proof-secret' });
    expect(await firstValueFrom(api.acceptInvitation('invite-token', 'private-password'))).toEqual({
      status: 'pending_activation',
      mfaRequired: true,
      activationProof: 'proof-secret',
    });
    expectRequest(1, '/admin/v1/invitations/accept', 'POST', {
      token: 'invite-token',
      password: 'private-password',
    });

    enqueue({ accepted: true }, 202);
    expect(await firstValueFrom(api.requestPasswordReset('ops@tyre.ge'))).toEqual({
      accepted: true,
    });
    expectRequest(2, '/admin/v1/auth/password-reset/request', 'POST', { email: 'ops@tyre.ge' });

    enqueue({ completed: true });
    expect(await firstValueFrom(api.completePasswordReset('reset-token', 'new-password'))).toEqual({
      completed: true,
    });
    expectRequest(3, '/admin/v1/auth/password-reset/complete', 'POST', {
      token: 'reset-token',
      newPassword: 'new-password',
    });

    enqueue(
      { enrollmentToken: 'enrollment-secret', otpauthUri: 'otpauth://secret', expiresAt: DATE },
      201,
    );
    expect(await firstValueFrom(api.startMfaEnrollment('activation-proof'))).toEqual({
      enrollmentToken: 'enrollment-secret',
      otpauthUri: 'otpauth://secret',
      expiresAt: DATE,
    });

    enqueue({ confirmed: true, recoveryCodes: ['recovery-one', 'recovery-two'] }, 201);
    expect(await firstValueFrom(api.confirmMfaEnrollment('enrollment-secret', '123456'))).toEqual({
      confirmed: true,
      recoveryCodes: ['recovery-one', 'recovery-two'],
    });
    expectHeaders(5, { Origin: ORIGIN, Authorization: null });
  });

  it('maps all authenticated Identity reads and explicitly refreshes/replays only GETs once', async () => {
    enqueue(STAFF);
    expect(await firstValueFrom(api.currentStaff('explicit-token'))).toEqual(publicStaff());
    expectRequest(0, '/admin/v1/auth/me', 'GET');
    expectHeaders(0, { Authorization: 'Bearer explicit-token' });

    enqueue({ currentSessionId: 'session-1', items: [SESSION], nextCursor: 'next-session' });
    expect(await firstValueFrom(api.sessions('session-cursor'))).toEqual({
      currentSessionId: 'session-1',
      items: [SESSION],
      nextCursor: 'next-session',
    });
    expectRequest(1, '/admin/v1/auth/sessions?cursor=session-cursor', 'GET');

    enqueue({ items: [STAFF_LIST_ITEM], nextCursor: 'next-staff' });
    expect(
      await firstValueFrom(api.listStaff({ q: 'ops', status: 'active', cursor: 'staff-cursor' })),
    ).toEqual(expect.objectContaining({ nextCursor: 'next-staff' }));
    expectRequest(2, '/admin/v1/staff?q=ops&status=active&cursor=staff-cursor', 'GET');

    enqueue({ items: [ROLE], scopeTypes: ['global', 'warehouse'] });
    expect(await firstValueFrom(api.listRoles())).toEqual({
      items: [ROLE],
      scopeTypes: ['global', 'warehouse'],
    });

    enqueue(STAFF_DETAIL);
    expect(await firstValueFrom(api.staffDetail('staff/1'))).toEqual(
      expect.objectContaining({ id: 'staff/1', tokenVersion: 3 }),
    );
    expectRequest(4, '/admin/v1/staff/staff%2F1', 'GET');

    enqueue({ items: [TARGET_SESSION], nextCursor: 'target-next' });
    expect(await firstValueFrom(api.targetSessions('staff/1', 'target-cursor'))).toEqual({
      items: [TARGET_SESSION],
      nextCursor: 'target-next',
    });
    expectRequest(5, '/admin/v1/staff/staff%2F1/sessions?cursor=target-cursor', 'GET');

    enqueueProblem(401, 'INVALID_SESSION');
    enqueue({ currentSessionId: 'session-1', items: [] });
    expect(await firstValueFrom(api.sessions())).toEqual({
      currentSessionId: 'session-1',
      items: [],
    });
    expect(auth.refreshAccessToken).toHaveBeenCalledOnce();
    expectHeaders(6, { Authorization: 'Bearer memory-token' });
    expectHeaders(7, { Authorization: 'Bearer rotated-token' });
  });

  it('maps session and step-up mutations with exact CSRF, Origin, bearer and no automatic retry', async () => {
    enqueue({ revoked: true });
    expect(await firstValueFrom(api.revokeSession('session/1', 'csrf-proof'))).toBeUndefined();
    expectRequest(0, '/admin/v1/auth/sessions/session%2F1', 'DELETE');
    expectHeaders(0, {
      Origin: ORIGIN,
      Authorization: 'Bearer memory-token',
      'X-CSRF-Token': 'csrf-proof',
    });

    enqueue({ revoked: true }, 201);
    expect(await firstValueFrom(api.revokeAll('csrf-proof', 'step-up-secret'))).toBeUndefined();
    expectRequest(1, '/admin/v1/auth/revoke-all', 'POST', { stepUpToken: 'step-up-secret' });
    expectHeaders(1, {
      Origin: ORIGIN,
      Authorization: 'Bearer memory-token',
      'X-CSRF-Token': 'csrf-proof',
    });

    enqueue({ stepUpToken: 'new-step-up-secret', expiresAt: DATE }, 201);
    expect(await firstValueFrom(api.stepUp('123456', 'action-hash'))).toEqual({
      stepUpToken: 'new-step-up-secret',
      expiresAt: DATE,
    });

    enqueueProblem(401, 'INVALID_SESSION');
    await expect(firstValueFrom(api.revokeAll('csrf-proof', 'step-up-secret'))).rejects.toEqual(
      expect.objectContaining({ status: 401 }),
    );
    expect(auth.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('safe-disables unapproved staff delivery while mapping state and assignment operations', async () => {
    const assignment = { roleId: 'role-1', scopeType: 'global' as const, scopeId: '' };
    const preview = {
      email: 'new@tyre.ge',
      displayName: 'New Staff',
      mfaRequired: true,
      assignments: [assignment],
    };
    enqueue(
      {
        requestedActionHash: 'create-hash',
        emailNormalized: 'new@tyre.ge',
        assignments: [assignment],
        mfaRequired: true,
      },
      201,
    );
    expect(await firstValueFrom(api.previewCreateStaff(preview))).toEqual(
      expect.objectContaining({ requestedActionHash: 'create-hash' }),
    );

    await expect(
      firstValueFrom(
        api.createStaff({ ...preview, idempotencyKey: 'idempotency-key-0001' }, 'step-up-secret'),
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 503,
        error: expect.objectContaining({ code: 'PRODUCTION_HARD_DENY' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (const action of ['activate', 'disable', 'reenable'] as const) {
      enqueue({ requestedActionHash: `${action}-hash` }, 201);
      await firstValueFrom(
        api.previewStaffAction('staff/1', action, 2, 'security_incident', 'Lost device'),
      );
      enqueue({ id: 'staff/1', status: 'active', enabled: true, version: 3 }, 201);
      await firstValueFrom(
        api.staffAction('staff/1', action, 2, 'security_incident', 'Lost device', 'step-up-secret'),
      );
    }
    expectRequest(1, '/admin/v1/staff/staff%2F1/activate/preview', 'POST', {
      expectedVersion: 2,
    });
    expectRequest(3, '/admin/v1/staff/staff%2F1/disable/preview', 'POST', {
      expectedVersion: 2,
      reasonCode: 'security_incident',
      reasonComment: 'Lost device',
    });

    enqueue(
      { requestedActionHash: 'assign-hash', assignments: [assignment], mfaRequired: true },
      201,
    );
    await firstValueFrom(api.previewRoleAssignments('staff/1', 3, [assignment]));
    enqueue({
      id: 'staff/1',
      version: 4,
      tokenVersion: 5,
      mfaRequired: true,
      assignments: [
        {
          id: 'row-1',
          adminId: 'staff/1',
          roleId: 'role-1',
          scopeType: 'global',
          scopeId: '',
          createdAt: DATE,
        },
      ],
    });
    expect(
      await firstValueFrom(api.updateRoleAssignments('staff/1', 3, [assignment], 'step-up-secret')),
    ).toEqual(
      expect.objectContaining({
        assignments: [{ roleId: 'role-1', scopeType: 'global', scopeId: '' }],
      }),
    );
  });

  it('safe-disables unapproved invitation resend and maps target-session operations', async () => {
    enqueue({ requestedActionHash: 'resend-hash' }, 201);
    await firstValueFrom(
      api.previewInvitationResend('staff/1', 4, 'resend_requested', 'Requested'),
    );

    await expect(
      firstValueFrom(
        api.resendInvitation(
          'staff/1',
          4,
          'resend_requested',
          'Requested',
          'step-up-secret',
          'idempotency-key-0002',
        ),
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 503,
        error: expect.objectContaining({ code: 'PRODUCTION_HARD_DENY' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    enqueue({ requestedActionHash: 'revoke-hash' }, 201);
    await firstValueFrom(api.previewTargetSessionRevoke('staff/1', 'session/1', 5));
    expectRequest(1, '/admin/v1/staff/staff%2F1/sessions/session%2F1/revoke/preview', 'POST', {
      expectedVersion: 5,
    });

    enqueue({ revoked: true, targetVersion: 6 });
    expect(
      await firstValueFrom(api.revokeTargetSession('staff/1', 'session/1', 5, 'step-up-secret')),
    ).toEqual({ revoked: true, targetVersion: 6 });
  });

  it('maps all recovery preview and execution operations without widening their state', async () => {
    enqueue(
      {
        requestedActionHash: 'request-hash',
        payloadHash: 'payload-hash',
        targetVersion: 2,
        targetTokenVersion: 3,
        targetMfaVersion: 4,
        roleScopeSnapshotHash: 'scope-hash',
        validForSeconds: 300,
      },
      201,
    );
    expect(
      await firstValueFrom(
        api.previewRecoveryRequest('staff/1', 'security_incident', 'Lost device'),
      ),
    ).toEqual(expect.objectContaining({ requestedActionHash: 'request-hash' }));

    enqueue(
      { id: 'recovery-1', state: 'pending', payloadHash: 'payload-hash', expiresAt: DATE },
      201,
    );
    await firstValueFrom(
      api.createRecoveryRequest('staff/1', 'security_incident', 'Lost device', 'step-up-secret'),
    );

    enqueue({
      requestedActionHash: 'approval-hash',
      payloadHash: 'payload-hash',
      state: 'pending',
      expiresAt: DATE,
    });
    await firstValueFrom(api.previewRecoveryApproval('recovery/1'));
    expectRequest(2, '/admin/v1/recovery-requests/recovery%2F1/approval-preview', 'GET');

    enqueue(
      {
        id: 'recovery/1',
        state: 'executed',
        targetStatus: 'pending_activation',
        invitation: { invitationId: 'invitation-3', expiresAt: DATE },
      },
      201,
    );
    expect(
      await firstValueFrom(api.approveRecoveryRequest('recovery/1', 'step-up-secret')),
    ).toEqual(expect.objectContaining({ state: 'executed', targetStatus: 'pending_activation' }));
  });

  function enqueue(body: unknown, status = 200): void {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'X-Server-Correlation-Id': 'corr-1' },
      }),
    );
  }

  function enqueueProblem(status: number, code: string): void {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status,
          code,
          serverCorrelationId: 'corr-1',
          type: 'about:blank',
          title: code,
        }),
        {
          status,
          headers: {
            'Content-Type': 'application/problem+json',
            'X-Server-Correlation-Id': 'corr-1',
          },
        },
      ),
    );
  }

  function expectRequest(index: number, url: string, method: string, body?: unknown): void {
    const [actualUrl, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    expect(actualUrl).toBe(url);
    expect(init.method).toBe(method);
    expect(init.credentials).toBe('same-origin');
    if (body === undefined) expect(init.body).toBeUndefined();
    else expect(JSON.parse(String(init.body))).toEqual(body);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  }

  function expectHeaders(index: number, expected: Record<string, string | null>): void {
    const [, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(expected)) expect(headers.get(name)).toBe(value);
  }

  function credentials(index: number): RequestCredentials | undefined {
    const [, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    return init.credentials;
  }
});

const ORIGIN = 'https://admin.tyre.test';
const DATE = '2026-07-31T00:00:00.000Z';
const STAFF = {
  id: 'staff-1',
  email: 'ops@tyre.ge',
  role: 'operator',
  enabled: true,
  permissions: ['staff.read'],
  permissionGrants: [{ permission: 'staff.read', scopeType: 'global', scopeId: '' }],
  displayName: 'Ops',
  status: 'active',
  mfaRequired: true,
  mfaEnrolled: true,
  version: 2,
};
const SESSION = {
  id: 'session-1',
  current: true,
  createdAt: DATE,
  lastSeenAt: DATE,
  idleExpiresAt: DATE,
  absoluteExpiresAt: DATE,
  authMethod: 'password_mfa',
};
const TARGET_SESSION = {
  id: 'session-2',
  createdAt: DATE,
  lastSeenAt: DATE,
  idleExpiresAt: DATE,
  absoluteExpiresAt: DATE,
  revokedAt: null,
  deviceLabel: null,
  browserFamily: null,
  osFamily: null,
  mfaSatisfiedAt: null,
  authMethod: 'password_mfa',
};
const STAFF_LIST_ITEM = {
  id: 'staff-1',
  email: 'ops@tyre.ge',
  displayName: 'Ops',
  status: 'active',
  enabled: true,
  mfaRequired: true,
  mfaEnrolled: true,
  version: 2,
  createdAt: DATE,
  updatedAt: DATE,
  assignments: [],
};
const ROLE = {
  id: 'role-1',
  key: 'operator',
  name: 'Operator',
  isSystem: true,
  permissions: ['staff.read'],
  mfaRequired: true,
  assignmentAllowed: true,
};
const STAFF_DETAIL = {
  id: 'staff/1',
  email: 'ops@tyre.ge',
  displayName: null,
  status: 'active',
  enabled: true,
  version: 2,
  tokenVersion: 3,
  mfaRequired: true,
  createdAt: DATE,
  updatedAt: DATE,
  mfaCredentials: [],
  roleAssignments: [],
};

function publicStaff() {
  return {
    id: STAFF.id,
    email: STAFF.email,
    role: STAFF.role,
    enabled: STAFF.enabled,
    permissions: STAFF.permissions,
    permissionGrants: STAFF.permissionGrants,
  };
}
