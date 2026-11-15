import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ApiProblemError } from '@tyre/admin-api-client';
import {
  AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1,
  AuditEventDetail,
  AuditEventListResult,
  JOB_CONTRACT_FIXTURE_V1,
  JobDetail,
  JobListResult,
} from '@tyre/shared';

import { GovernanceApiService, normalizeGovernanceError } from './governance-api.service';
import { GOVERNANCE_FEATURE_CONFIG } from './governance-flags';
import { AuthService } from './auth.service';
import { GeneratedAdminReadTransport } from './generated-admin-read-transport';
import { IdentityApiService } from './identity-api.service';

describe('GovernanceApiService', () => {
  const stepUp = vi.fn(() =>
    of({ stepUpToken: 'step-up-proof', expiresAt: '2099-01-01T00:00:00Z' }),
  );

  function setup(
    approvalsEnabled = true,
    auditReaderEnabled = true,
    jobsReaderEnabled = false,
  ): {
    service: GovernanceApiService;
    http: HttpTestingController;
    generatedReads: {
      listAuditEvents: ReturnType<typeof vi.fn>;
      getAuditEvent: ReturnType<typeof vi.fn>;
      listJobs: ReturnType<typeof vi.fn>;
      getJob: ReturnType<typeof vi.fn>;
    };
    auth: {
      accessToken: string | null;
      refreshAccessToken: ReturnType<typeof vi.fn>;
    };
  } {
    const generatedReads = {
      listAuditEvents: vi.fn(() => of(AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.listPage)),
      getAuditEvent: vi.fn(() => of(AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.detail)),
      listJobs: vi.fn(() => of(JOB_CONTRACT_FIXTURE_V1.listPage)),
      getJob: vi.fn(() => of(JOB_CONTRACT_FIXTURE_V1.detail)),
    };
    const auth = {
      accessToken: 'memory-token' as string | null,
      refreshAccessToken: vi.fn(() => of('rotated-token')),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: GOVERNANCE_FEATURE_CONFIG,
          useValue: {
            apiBaseUrl: '/admin/v1',
            approvalsEnabled,
            auditReaderEnabled,
            jobsReaderEnabled,
          },
        },
        { provide: IdentityApiService, useValue: { stepUp } },
        { provide: AuthService, useValue: auth },
        { provide: GeneratedAdminReadTransport, useValue: generatedReads },
      ],
    });
    return {
      service: TestBed.inject(GovernanceApiService),
      http: TestBed.inject(HttpTestingController),
      generatedReads,
      auth,
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('fails closed without sending HTTP when the approval flag is disabled', () => {
    const { service, http } = setup(false, false);
    let received: unknown;
    service.listApprovals({}).subscribe({ error: (error: unknown) => (received = error) });
    expect(received).toEqual(expect.objectContaining({ kind: 'disabled', status: 423 }));
    http.expectNone(() => true);
  });

  it('fails closed without sending HTTP when only the audit reader flag is disabled', () => {
    const { service, http, generatedReads } = setup(true, false);
    let received: unknown;
    service.listAuditEvents({}).subscribe({ error: (error: unknown) => (received = error) });
    service.getAuditEvent('event-1').subscribe({ error: (error: unknown) => (received = error) });
    expect(received).toEqual(
      expect.objectContaining({ kind: 'disabled', status: 423, code: 'AUDIT_READER_DISABLED' }),
    );
    expect(generatedReads.listAuditEvents).not.toHaveBeenCalled();
    expect(generatedReads.getAuditEvent).not.toHaveBeenCalled();
    http.expectNone(() => true);
  });

  it('fails closed without HTTP when the independent Jobs reader flag is disabled', () => {
    const { service, http, generatedReads } = setup(true, true, false);
    let received: unknown;
    service.listJobs({}).subscribe({ error: (error: unknown) => (received = error) });
    service.getJob('job-1').subscribe({ error: (error: unknown) => (received = error) });
    expect(received).toEqual(
      expect.objectContaining({ kind: 'disabled', status: 423, code: 'JOBS_READER_DISABLED' }),
    );
    expect(generatedReads.listJobs).not.toHaveBeenCalled();
    expect(generatedReads.getJob).not.toHaveBeenCalled();
    http.expectNone(() => true);
  });

  it('serializes only explicit server-side approval filters, sort, and cursor', () => {
    const { service, http } = setup();
    service
      .listApprovals({
        status: 'pending',
        actionType: 'inventory.adjust.post',
        requesterId: 'staff-1',
        sort: 'expiresAt',
        direction: 'asc',
        cursor: 'opaque-cursor',
      })
      .subscribe();
    const request = http.expectOne(
      '/admin/v1/approvals?status=pending&actionType=inventory.adjust.post&requesterId=staff-1&sort=expiresAt&direction=asc&cursor=opaque-cursor',
    );
    expect(request.request.method).toBe('GET');
    request.flush({ items: [], nextCursor: null, previousCursor: null });
    http.verify();
  });

  it('binds a server action intent to MFA before sending a reasoned idempotent decision', () => {
    const { service, http } = setup();
    stepUp.mockClear();
    service
      .executeApprovalAction(
        { id: 'approval/1', version: 7 },
        'approve',
        'Verified against source record',
        '123456',
        {
          intentToken: 'opaque-intent',
          requestedActionHash: 'server-action-hash',
          expiresAt: '2099-01-01T00:00:00Z',
        },
      )
      .subscribe();
    expect(stepUp).toHaveBeenCalledWith('123456', 'server-action-hash');
    const request = http.expectOne('/admin/v1/approval-requests/approval%2F1/decisions');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Idempotency-Key')).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    expect(request.request.body).toEqual({
      expectedVersion: 7,
      reason: { comment: 'Verified against source record' },
      intentToken: 'opaque-intent',
      stepUpToken: 'step-up-proof',
      decisionValue: 'approve',
    });
    request.flush({ request: {} });
    http.verify();
  });

  it('sends the API-accepted default audit query with no invented keys', () => {
    const { service, http, generatedReads } = setup();
    let received: AuditEventListResult | undefined;
    service.listAuditEvents({}).subscribe((page) => (received = page));
    const response = AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.listPage;
    expect(generatedReads.listAuditEvents).toHaveBeenCalledWith({}, 'memory-token');
    expect(received).toEqual(response);
    http.verify();
  });

  it('serializes the exact shared controller query fixture and keeps the cursor server-bound', () => {
    const { service, http, generatedReads } = setup();
    const { pageSize, ...adminQuery } = AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.listQuery;
    service.listAuditEvents(adminQuery).subscribe();
    expect(pageSize).toBe(25);
    expect(generatedReads.listAuditEvents).toHaveBeenCalledWith(adminQuery, 'memory-token');
    http.verify();
  });

  it('decodes a real shared audit detail and preserves encoded non-disclosing reads', () => {
    const { service, http, generatedReads } = setup();
    let received: AuditEventDetail | undefined;
    service.getAuditEvent('event/wrong scope').subscribe((event) => (received = event));
    const response = AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.detail;
    expect(generatedReads.getAuditEvent).toHaveBeenCalledWith('event/wrong scope', 'memory-token');
    expect(received).toEqual(response);
    http.verify();
  });

  it('fails closed when an audit response drifts from the shared wire contract', () => {
    const { service, http, generatedReads } = setup();
    generatedReads.listAuditEvents.mockReturnValue(of({ items: [], nextCursor: null }));
    let received: unknown;
    service.listAuditEvents({}).subscribe({ error: (error: unknown) => (received = error) });
    expect(received).toEqual(
      expect.objectContaining({ kind: 'unavailable', code: 'AUDIT_CONTRACT_DRIFT' }),
    );
    http.verify();
  });

  it('preserves non-disclosing 404 semantics for audit detail', () => {
    const { service, http, generatedReads } = setup();
    generatedReads.getAuditEvent.mockReturnValue(
      throwError(() => apiProblem(404, 'AUDIT_EVENT_NOT_FOUND')),
    );
    let received: unknown;
    service.getAuditEvent('missing').subscribe({ error: (error: unknown) => (received = error) });
    expect(received).toEqual(expect.objectContaining({ kind: 'not_found', status: 404 }));
    http.verify();
  });

  it('serializes the closed Jobs query and decodes the shared list fixture', () => {
    const { service, http, generatedReads } = setup(true, true, true);
    let received: JobListResult | undefined;
    service
      .listJobs({
        state: 'dead_lettered',
        jobType: 'inventory.snapshot',
        ownerDomain: 'inventory',
        correlationId: 'correlation-1',
        createdFrom: '2026-07-30T08:00:00.000Z',
        createdTo: '2026-07-30T09:00:00.000Z',
        sortField: 'priority',
        sortDirection: 'asc',
        pageSize: 25,
        cursor: JOB_CONTRACT_FIXTURE_V1.listPage.nextCursor,
      })
      .subscribe((page) => (received = page));
    expect(generatedReads.listJobs).toHaveBeenCalledWith(
      {
        state: 'dead_lettered',
        jobType: 'inventory.snapshot',
        ownerDomain: 'inventory',
        correlationId: 'correlation-1',
        createdFrom: '2026-07-30T08:00:00.000Z',
        createdTo: '2026-07-30T09:00:00.000Z',
        sortField: 'priority',
        sortDirection: 'asc',
        pageSize: 25,
        cursor: JOB_CONTRACT_FIXTURE_V1.listPage.nextCursor,
      },
      'memory-token',
    );
    expect(received).toEqual(JOB_CONTRACT_FIXTURE_V1.listPage);
    http.verify();
  });

  it('decodes shared Jobs detail and preserves encoded non-disclosing reads', () => {
    const { service, http, generatedReads } = setup(true, true, true);
    let received: JobDetail | undefined;
    service.getJob('job/wrong scope').subscribe((job) => (received = job));
    expect(generatedReads.getJob).toHaveBeenCalledWith('job/wrong scope', 'memory-token');
    expect(received).toEqual(JOB_CONTRACT_FIXTURE_V1.detail);
    http.verify();
  });

  it('maps Jobs cursor errors and non-disclosing detail 404', () => {
    expect(normalizeGovernanceError(httpError(400, 'INVALID_JOB_CURSOR')).kind).toBe(
      'invalid_cursor',
    );
    const { service, http, generatedReads } = setup(true, true, true);
    generatedReads.getJob.mockReturnValue(
      throwError(() => apiProblem(404, JOB_CONTRACT_FIXTURE_V1.errors.notFound.code)),
    );
    let received: unknown;
    service.getJob('missing').subscribe({ error: (error: unknown) => (received = error) });
    expect(received).toEqual(expect.objectContaining({ kind: 'not_found', status: 404 }));
    http.verify();
  });

  it('treats an absent audit collection endpoint as unavailable and never invents rows', () => {
    const { service, http, generatedReads } = setup();
    generatedReads.listAuditEvents.mockReturnValue(throwError(() => apiProblem(404, 'NOT_FOUND')));
    let received: unknown;
    service.listAuditEvents({ sortField: 'occurredAt', sortDirection: 'desc' }).subscribe({
      error: (error: unknown) => (received = error),
    });
    expect(generatedReads.listAuditEvents).toHaveBeenCalledWith(
      { sortField: 'occurredAt', sortDirection: 'desc' },
      'memory-token',
    );
    expect(received).toEqual(
      expect.objectContaining({
        kind: 'unavailable',
        status: 404,
        code: 'AUDIT_READER_UNAVAILABLE',
      }),
    );
    http.verify();
  });

  it('refreshes and replays a generated replay-safe read exactly once after 401', () => {
    const { service, generatedReads, auth } = setup();
    generatedReads.getAuditEvent
      .mockReturnValueOnce(throwError(() => apiProblem(401, 'SESSION_VERSION_STALE')))
      .mockReturnValueOnce(of(AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.detail));

    let received: AuditEventDetail | undefined;
    service.getAuditEvent('event-1').subscribe((event) => (received = event));

    expect(auth.refreshAccessToken).toHaveBeenCalledOnce();
    expect(generatedReads.getAuditEvent).toHaveBeenNthCalledWith(1, 'event-1', 'memory-token');
    expect(generatedReads.getAuditEvent).toHaveBeenNthCalledWith(2, 'event-1', 'rotated-token');
    expect(received).toEqual(AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.detail);
  });

  it('does not recursively replay a generated read when the single retry is also unauthorized', () => {
    const { service, generatedReads, auth } = setup(true, true, true);
    generatedReads.getJob.mockReturnValue(
      throwError(() => apiProblem(401, 'SESSION_VERSION_STALE')),
    );

    let received: unknown;
    service.getJob('job-1').subscribe({ error: (error: unknown) => (received = error) });

    expect(auth.refreshAccessToken).toHaveBeenCalledOnce();
    expect(generatedReads.getJob).toHaveBeenCalledTimes(2);
    expect(received).toEqual(
      expect.objectContaining({ kind: 'stale_auth', status: 401, code: 'SESSION_VERSION_STALE' }),
    );
  });

  it('maps audit cursor/auth/key lifecycle and dependency failures without disclosing cursor cause', () => {
    expect(normalizeGovernanceError(httpError(400, 'AUDIT_CURSOR_TAMPERED')).kind).toBe(
      'invalid_cursor',
    );
    expect(normalizeGovernanceError(httpError(409, 'AUDIT_CURSOR_KEY_RETIRED')).kind).toBe(
      'invalid_cursor',
    );
    expect(normalizeGovernanceError(httpError(401, 'SESSION_VERSION_STALE')).kind).toBe(
      'stale_auth',
    );
    expect(normalizeGovernanceError(httpError(503, 'AUDIT_READER_DEPENDENCY')).kind).toBe(
      'dependency',
    );
  });

  it('maps non-disclosing and concurrency HTTP states to stable UI categories', () => {
    expect(normalizeGovernanceError(httpError(403, 'SCOPE_DENIED')).kind).toBe('forbidden');
    expect(normalizeGovernanceError(httpError(404, 'NOT_FOUND')).kind).toBe('not_found');
    expect(normalizeGovernanceError(httpError(409, 'APPROVAL_STALE')).kind).toBe('stale');
    expect(normalizeGovernanceError(httpError(409, 'VERSION_CONFLICT')).kind).toBe('conflict');
    expect(normalizeGovernanceError(httpError(410, 'INTENT_EXPIRED')).kind).toBe('expired');
    expect(normalizeGovernanceError(httpError(423, 'APPROVAL_POLICY_UNAVAILABLE')).kind).toBe(
      'disabled',
    );
  });
});

function httpError(status: number, code: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { code } });
}

function apiProblem(status: number, code: string): ApiProblemError {
  return new ApiProblemError(
    { status, code, serverCorrelationId: 'correlation-1' },
    status,
    'correlation-1',
  );
}
