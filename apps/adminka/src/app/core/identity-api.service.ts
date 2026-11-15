import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Inject, Injectable, InjectionToken, Injector, inject } from '@angular/core';
import { Observable, catchError, defer, map, switchMap, throwError } from 'rxjs';

import { RequestByOperation, ResponseByOperation, Secret } from '@tyre/admin-api-client';
import {
  AcceptInvitationResponse,
  AdminInfo,
  InvitationInspectResponse,
  LoginResponse,
} from '@tyre/shared';

import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { ADMIN_REQUEST_ORIGIN, GeneratedIdentityTransport } from './generated-identity-transport';
import {
  AuthenticatedLoginResult,
  CreateStaffPreviewResponse,
  CreateStaffRequest,
  IdentityFeatureConfig,
  IdentityLoginResult,
  InvitationResendResponse,
  MfaEnrollmentConfirmed,
  MfaEnrollmentStart,
  RefreshResult,
  RoleAssignmentsMutationResponse,
  RoleAssignmentsPreviewResponse,
  RoleCatalogResponse,
  StaffDetailResponse,
  StaffListResponse,
  StaffMutationResponse,
  StaffSessionList,
  TargetStaffSessionList,
} from './identity-contract';

export const IDENTITY_FEATURE_CONFIG = new InjectionToken<IdentityFeatureConfig>(
  'IDENTITY_FEATURE_CONFIG',
  {
    providedIn: 'root',
    factory: () => ({
      apiBaseUrl: environment.identityApiBaseUrl,
      enabled: environment.identityV2Enabled,
      passwordResetDelivery: environment.identityPasswordResetDelivery ?? 'manual',
    }),
  },
);

/** Identity adapter. Generated Secret values are consumed once and never persisted here. */
@Injectable({ providedIn: 'root' })
export class IdentityApiService {
  private readonly http = inject(HttpClient);
  private readonly injector = inject(Injector);
  private readonly generated = inject(GeneratedIdentityTransport);

  constructor(
    @Inject(IDENTITY_FEATURE_CONFIG) readonly config: IdentityFeatureConfig,
    @Inject(ADMIN_REQUEST_ORIGIN) private readonly origin: string,
  ) {}

  login(email: string, password: string): Observable<IdentityLoginResult> {
    if (!this.config.enabled) {
      return this.http
        .post<LoginResponse>(`${environment.apiBaseUrl}/admin/auth/login`, { email, password })
        .pipe(
          map(
            (result): AuthenticatedLoginResult => ({
              status: 'authenticated',
              accessToken: result.accessToken,
              accessExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
              staff: result.admin,
            }),
          ),
        );
    }
    return this.generated
      .request(null, (client, signal) =>
        client.request('identity-auth.login', {
          headers: this.originHeader(),
          body: { email, password },
          signal,
        }),
      )
      .pipe(map(consumeLoginResponse));
  }

  completeMfa(challengeToken: string, code: string): Observable<AuthenticatedLoginResult> {
    return this.generated
      .request(null, (client, signal) =>
        client.request('identity-auth.complete-mfa', {
          headers: this.originHeader(),
          body: { challengeToken, code },
          signal,
        }),
      )
      .pipe(
        map((response) => ({
          status: response.status,
          accessToken: consumeSecret(response.accessToken),
          accessExpiresAt: response.accessExpiresAt,
          staff: toStaffInfo(response.staff),
        })),
      );
  }

  csrf(): Observable<{ csrfToken: string }> {
    return this.generated
      .request(null, (client, signal) =>
        client.request('identity-auth.csrf', { headers: this.originHeader(), signal }),
      )
      .pipe(map(({ csrfToken }) => ({ csrfToken: consumeSecret(csrfToken) })));
  }

  refresh(csrfToken: string): Observable<RefreshResult> {
    return this.generated
      .request(null, (client, signal) =>
        client.request('identity-auth.refresh', {
          headers: { ...this.originHeader(), 'X-CSRF-Token': csrfToken },
          signal,
        }),
      )
      .pipe(
        map((response) => ({
          accessToken: consumeSecret(response.accessToken),
          accessExpiresAt: response.accessExpiresAt,
          rotationResult: response.rotationResult,
          staff: toStaffInfo(response.staff),
        })),
      );
  }

  logout(csrfToken: string): Observable<void> {
    return this.generated
      .request(null, (client, signal) =>
        client.request('identity-auth.logout', {
          headers: { ...this.originHeader(), 'X-CSRF-Token': csrfToken },
          signal,
        }),
      )
      .pipe(map(() => undefined));
  }

  currentStaff(accessToken: string): Observable<AdminInfo> {
    return this.readWithRefresh(
      () => accessToken,
      (token) =>
        this.generated.request(token, (client, signal) =>
          client.request('identity-auth.me', { signal }),
        ),
    ).pipe(map(toAdminInfo));
  }

  sessions(cursor?: string): Observable<StaffSessionList> {
    return this.authenticatedRead((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('identity-auth.list-sessions', {
          ...(cursor ? { query: { cursor } } : {}),
          signal,
        }),
      ),
    ).pipe(
      map((response) => ({
        items: response.items.map((item) => ({ ...item })),
        ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
        currentSessionId: response.currentSessionId,
      })),
    );
  }

  revokeSession(sessionId: string, csrfToken: string): Observable<void> {
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('identity-auth.revoke-session', {
          path: { id: sessionId },
          headers: { ...this.originHeader(), 'X-CSRF-Token': csrfToken },
          signal,
        }),
      ),
    ).pipe(map(() => undefined));
  }

  revokeAll(csrfToken: string, stepUpToken: string): Observable<void> {
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('identity-auth.revoke-all', {
          headers: { ...this.originHeader(), 'X-CSRF-Token': csrfToken },
          body: { stepUpToken },
          signal,
        }),
      ),
    ).pipe(map(() => undefined));
  }

  stepUp(
    code: string,
    requestedActionHash: string,
  ): Observable<{ stepUpToken: string; expiresAt: string }> {
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('step-up.step-up', {
          headers: this.originHeader(),
          body: { code, requestedActionHash },
          signal,
        }),
      ),
    ).pipe(
      map(({ stepUpToken, expiresAt }) => ({
        stepUpToken: consumeSecret(stepUpToken),
        expiresAt,
      })),
    );
  }

  startMfaEnrollment(activationProof: string): Observable<MfaEnrollmentStart> {
    return this.generated
      .request(null, (client, signal) =>
        client.request('mfa.start', {
          headers: this.originHeader(),
          body: { activationProof },
          signal,
        }),
      )
      .pipe(map(consumeEnrollmentStart));
  }

  confirmMfaEnrollment(enrollmentToken: string, code: string): Observable<MfaEnrollmentConfirmed> {
    return this.generated
      .request(null, (client, signal) =>
        client.request('mfa.confirm', {
          headers: this.originHeader(),
          body: { enrollmentToken, code },
          signal,
        }),
      )
      .pipe(
        map((response) => ({
          confirmed: response.confirmed,
          recoveryCodes: consumeSecretList(response.recoveryCodes),
        })),
      );
  }

  inspectInvitation(token: string): Observable<InvitationInspectResponse> {
    return this.generated.request(null, (client, signal) =>
      client.request('invitation.inspect', {
        headers: this.originHeader(),
        body: { token },
        signal,
      }),
    );
  }

  acceptInvitation(token: string, password: string): Observable<AcceptInvitationResponse> {
    return this.generated
      .request(null, (client, signal) =>
        client.request('invitation.accept', {
          headers: this.originHeader(),
          body: { token, password },
          signal,
        }),
      )
      .pipe(
        map((response) => ({
          status: response.status,
          mfaRequired: response.mfaRequired,
          ...(response.activationProof
            ? { activationProof: consumeSecret(response.activationProof) }
            : {}),
        })),
      );
  }

  requestPasswordReset(email: string): Observable<{ accepted: true }> {
    return this.generated.request(null, (client, signal) =>
      client.request('password-reset.request', {
        headers: this.originHeader(),
        body: { email },
        signal,
      }),
    );
  }

  completePasswordReset(token: string, newPassword: string): Observable<{ completed: true }> {
    return this.generated.request(null, (client, signal) =>
      client.request('password-reset.complete', {
        headers: this.originHeader(),
        body: { token, newPassword },
        signal,
      }),
    );
  }

  listStaff(query: {
    q?: string;
    status?: string;
    cursor?: string;
  }): Observable<StaffListResponse> {
    const generatedQuery = toStaffListQuery(query);
    return this.authenticatedRead((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('staff-admin.list', { query: generatedQuery, signal }),
      ),
    ).pipe(map(toStaffList));
  }

  listRoles(): Observable<RoleCatalogResponse> {
    return this.authenticatedRead((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('role-catalog.roles', { signal }),
      ),
    ).pipe(
      map((response) => ({
        items: response.items.map((item) => ({ ...item, permissions: [...item.permissions] })),
        scopeTypes: [...response.scopeTypes],
      })),
    );
  }

  staffDetail(staffId: string): Observable<StaffDetailResponse> {
    return this.authenticatedRead((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('staff-admin.detail', { path: { id: staffId }, signal }),
      ),
    ).pipe(map(toStaffDetail));
  }

  previewCreateStaff(
    request: Omit<CreateStaffRequest, 'idempotencyKey'>,
  ): Observable<CreateStaffPreviewResponse> {
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('staff-admin.preview-create', {
          headers: this.originHeader(),
          body: request,
          signal,
        }),
      ),
    ).pipe(
      map((response) => ({
        ...response,
        assignments: response.assignments.map((assignment) => ({ ...assignment })),
      })),
    );
  }

  createStaff(request: CreateStaffRequest, stepUpToken: string): Observable<unknown> {
    void request;
    void stepUpToken;
    return this.unapprovedSensitiveDelivery();
  }

  previewStaffAction(
    staffId: string,
    action: 'activate' | 'disable' | 'reenable',
    expectedVersion: number,
    reasonCode?: string,
    reasonComment?: string,
  ): Observable<{ requestedActionHash: string }> {
    const operation = previewStaffOperation(action);
    const body =
      action === 'activate'
        ? { expectedVersion }
        : { expectedVersion, reasonCode, reasonComment: reasonComment || undefined };
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) => {
        if (operation === 'staff-admin.preview-activate')
          return client.request(operation, {
            path: { id: staffId },
            headers: this.originHeader(),
            body,
            signal,
          });
        if (operation === 'staff-admin.preview-disable')
          return client.request(operation, {
            path: { id: staffId },
            headers: this.originHeader(),
            body,
            signal,
          });
        return client.request(operation, {
          path: { id: staffId },
          headers: this.originHeader(),
          body,
          signal,
        });
      }),
    );
  }

  staffAction(
    staffId: string,
    action: 'activate' | 'disable' | 'reenable',
    expectedVersion: number,
    reasonCode: string,
    reasonComment: string,
    stepUpToken: string,
  ): Observable<StaffMutationResponse> {
    const operation = staffOperation(action);
    const body = {
      expectedVersion,
      reasonCode,
      reasonComment: reasonComment || undefined,
      stepUpToken,
    };
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) => {
        if (operation === 'staff-admin.activate')
          return client.request(operation, {
            path: { id: staffId },
            headers: this.originHeader(),
            body,
            signal,
          });
        if (operation === 'staff-admin.disable')
          return client.request(operation, {
            path: { id: staffId },
            headers: this.originHeader(),
            body,
            signal,
          });
        return client.request(operation, {
          path: { id: staffId },
          headers: this.originHeader(),
          body,
          signal,
        });
      }),
    );
  }

  previewRoleAssignments(
    staffId: string,
    expectedVersion: number,
    assignments: CreateStaffRequest['assignments'],
  ): Observable<RoleAssignmentsPreviewResponse> {
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('staff-admin.preview-assignments', {
          path: { id: staffId },
          headers: this.originHeader(),
          body: { expectedVersion, assignments },
          signal,
        }),
      ),
    ).pipe(
      map((response) => ({
        ...response,
        assignments: response.assignments.map((assignment) => ({ ...assignment })),
      })),
    );
  }

  updateRoleAssignments(
    staffId: string,
    expectedVersion: number,
    assignments: CreateStaffRequest['assignments'],
    stepUpToken: string,
  ): Observable<RoleAssignmentsMutationResponse> {
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('staff-admin.assignments', {
          path: { id: staffId },
          headers: this.originHeader(),
          body: { expectedVersion, assignments, stepUpToken },
          signal,
        }),
      ),
    ).pipe(
      map((response) => ({
        ...response,
        assignments: response.assignments.map(({ roleId, scopeType, scopeId }) => ({
          roleId,
          scopeType,
          scopeId,
        })),
      })),
    );
  }

  previewInvitationResend(
    staffId: string,
    expectedVersion: number,
    reasonCode: string,
    reasonComment: string,
  ): Observable<{ requestedActionHash: string }> {
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('staff-admin.preview-resend', {
          path: { id: staffId },
          headers: this.originHeader(),
          body: { expectedVersion, reasonCode, reasonComment: reasonComment || undefined },
          signal,
        }),
      ),
    );
  }

  resendInvitation(
    staffId: string,
    expectedVersion: number,
    reasonCode: string,
    reasonComment: string,
    stepUpToken: string,
    idempotencyKey: string,
  ): Observable<InvitationResendResponse> {
    void staffId;
    void expectedVersion;
    void reasonCode;
    void reasonComment;
    void stepUpToken;
    void idempotencyKey;
    return this.unapprovedSensitiveDelivery();
  }

  targetSessions(staffId: string, cursor?: string): Observable<TargetStaffSessionList> {
    return this.authenticatedRead((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('staff-admin.target-sessions', {
          path: { id: staffId },
          ...(cursor ? { query: { cursor } } : {}),
          signal,
        }),
      ),
    ).pipe(map(toTargetSessions));
  }

  previewTargetSessionRevoke(
    staffId: string,
    sessionId: string,
    expectedVersion: number,
  ): Observable<{ requestedActionHash: string }> {
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('staff-admin.preview-target-session-revoke', {
          path: { id: staffId, sid: sessionId },
          headers: this.originHeader(),
          body: { expectedVersion },
          signal,
        }),
      ),
    );
  }

  revokeTargetSession(
    staffId: string,
    sessionId: string,
    expectedVersion: number,
    stepUpToken: string,
  ): Observable<{ revoked: true; targetVersion: number }> {
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('staff-admin.revoke-target-session', {
          path: { id: staffId, sid: sessionId },
          headers: this.originHeader(),
          body: { expectedVersion, stepUpToken },
          signal,
        }),
      ),
    );
  }

  previewRecoveryRequest(
    staffId: string,
    reasonCode: string,
    reasonComment: string,
  ): Observable<{ requestedActionHash: string; payloadHash: string; validForSeconds: number }> {
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('recovery.preview-request', {
          path: { id: staffId },
          headers: this.originHeader(),
          body: { reasonCode, reasonComment: reasonComment || undefined },
          signal,
        }),
      ),
    );
  }

  createRecoveryRequest(
    staffId: string,
    reasonCode: string,
    reasonComment: string,
    stepUpToken: string,
  ): Observable<{ id: string; state: string; payloadHash: string; expiresAt: string }> {
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('recovery.request', {
          path: { id: staffId },
          headers: this.originHeader(),
          body: { reasonCode, reasonComment: reasonComment || undefined, stepUpToken },
          signal,
        }),
      ),
    );
  }

  previewRecoveryApproval(requestId: string): Observable<{
    requestedActionHash: string;
    payloadHash: string;
    state: string;
    expiresAt: string;
  }> {
    return this.authenticatedRead((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('recovery.preview-approval', { path: { id: requestId }, signal }),
      ),
    );
  }

  approveRecoveryRequest(
    requestId: string,
    stepUpToken: string,
  ): Observable<{ id: string; state: 'executed'; targetStatus: 'pending_activation' }> {
    return this.authenticatedMutation((accessToken) =>
      this.generated.request(accessToken, (client, signal) =>
        client.request('recovery.approve', {
          path: { id: requestId },
          headers: this.originHeader(),
          body: { stepUpToken },
          signal,
        }),
      ),
    );
  }

  private originHeader(): { readonly Origin: string } {
    return { Origin: this.origin };
  }

  private authenticatedMutation<T>(
    request: (accessToken: string | null) => Observable<T>,
  ): Observable<T> {
    return defer(() => request(this.injector.get(AuthService).accessToken));
  }

  private unapprovedSensitiveDelivery<T>(): Observable<T> {
    return throwError(
      () =>
        new HttpErrorResponse({
          status: 503,
          statusText: 'Sensitive delivery client is not approved',
          error: {
            status: 503,
            code: 'PRODUCTION_HARD_DENY',
            serverCorrelationId: 'client-safe-disabled',
            type: 'urn:tyre:problem:production-hard-deny',
            title: 'Sensitive delivery is disabled',
            detail: 'No approved isolated client exists for this one-time credential flow.',
            violations: [],
          },
        }),
    );
  }

  private authenticatedRead<T>(
    request: (accessToken: string | null) => Observable<T>,
  ): Observable<T> {
    return this.readWithRefresh(() => this.injector.get(AuthService).accessToken, request);
  }

  private readWithRefresh<T>(
    initialAccessToken: () => string | null,
    request: (accessToken: string | null) => Observable<T>,
  ): Observable<T> {
    return defer(() => request(initialAccessToken())).pipe(
      catchError((error: unknown) => {
        if (!(error instanceof HttpErrorResponse) || error.status !== 401)
          return throwError(() => error);
        return this.injector
          .get(AuthService)
          .refreshAccessToken()
          .pipe(switchMap((accessToken) => request(accessToken)));
      }),
    );
  }
}

function consumeSecret(secret: Secret<string>): string {
  return secret.consume((value) => value);
}

function consumeSecretList(secrets: readonly Secret<string>[]): string[] {
  const values: string[] = [];
  try {
    for (const secret of secrets) values.push(consumeSecret(secret));
    return values;
  } finally {
    for (const secret of secrets) secret.clear();
  }
}

function consumeLoginResponse(
  response: ResponseByOperation['identity-auth.login'],
): IdentityLoginResult {
  if (response.status === 'mfa_required') {
    return {
      status: response.status,
      challengeToken: consumeSecret(response.challengeToken),
      expiresAt: response.expiresAt,
    };
  }
  return {
    status: response.status,
    accessToken: consumeSecret(response.accessToken),
    accessExpiresAt: response.accessExpiresAt,
    staff: toStaffInfo(response.staff),
  };
}

function consumeEnrollmentStart(response: ResponseByOperation['mfa.start']): MfaEnrollmentStart {
  try {
    return {
      enrollmentToken: consumeSecret(response.enrollmentToken),
      otpauthUri: consumeSecret(response.otpauthUri),
      expiresAt: response.expiresAt,
    };
  } finally {
    response.enrollmentToken.clear();
    response.otpauthUri.clear();
  }
}

function toAdminInfo(staff: ResponseByOperation['identity-auth.me']): AdminInfo {
  return {
    id: staff.id,
    email: staff.email,
    role: staff.role,
    enabled: staff.enabled,
    permissions: [...staff.permissions],
    permissionGrants: staff.permissionGrants.map((grant) => ({ ...grant })),
  };
}

function toStaffInfo(staff: ResponseByOperation['identity-auth.me']): RefreshResult['staff'] {
  return {
    ...toAdminInfo(staff),
    ...(staff.displayName === undefined ? {} : { displayName: staff.displayName }),
    status: staff.status,
    mfaRequired: staff.mfaRequired,
    mfaEnrolled: staff.mfaEnrolled,
    version: staff.version,
  };
}

function toStaffListQuery(query: {
  q?: string;
  status?: string;
  cursor?: string;
}): NonNullable<RequestByOperation['staff-admin.list']['query']> {
  const statuses = ['active', 'disabled', 'invited', 'pending_activation'] as const;
  const status = statuses.find((candidate) => candidate === query.status);
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(status ? { status } : {}),
    ...(query.cursor ? { cursor: query.cursor } : {}),
  };
}

function toStaffList(response: ResponseByOperation['staff-admin.list']): StaffListResponse {
  return {
    items: response.items.map((staff) => ({
      id: staff.id,
      email: staff.email,
      ...(staff.displayName === undefined ? {} : { displayName: staff.displayName }),
      status: staff.status,
      mfaRequired: staff.mfaRequired,
      mfaEnrolled: staff.mfaEnrolled,
      ...(staff.lastActivityAt === undefined ? {} : { lastActivityAt: staff.lastActivityAt }),
      version: staff.version,
      assignments: staff.assignments.map((assignment) => ({
        role: { ...assignment.role },
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
      })),
    })),
    ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
  };
}

function toStaffDetail(response: ResponseByOperation['staff-admin.detail']): StaffDetailResponse {
  return {
    id: response.id,
    email: response.email,
    displayName: response.displayName,
    status: response.status,
    enabled: response.enabled,
    version: response.version,
    tokenVersion: response.tokenVersion,
    mfaRequired: response.mfaRequired,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    mfaCredentials: response.mfaCredentials.map((credential) => ({ ...credential })),
    roleAssignments: response.roleAssignments.map((assignment) => ({
      role: { ...assignment.role },
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
    })),
  };
}

function toTargetSessions(
  response: ResponseByOperation['staff-admin.target-sessions'],
): TargetStaffSessionList {
  return {
    items: response.items.map((item) => ({ ...item })),
    ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
  };
}

function previewStaffOperation(action: 'activate' | 'disable' | 'reenable') {
  return `staff-admin.preview-${action}` as const;
}

function staffOperation(action: 'activate' | 'disable' | 'reenable') {
  return `staff-admin.${action}` as const;
}
