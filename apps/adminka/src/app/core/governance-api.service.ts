import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Inject, Injectable, inject } from '@angular/core';
import { Observable, catchError, defer, map, switchMap, throwError } from 'rxjs';

import { ApiProblemError, RequestByOperation } from '@tyre/admin-api-client';
import {
  AuditEventDetail,
  AuditEventListResult,
  JOB_SORT_DIRECTIONS,
  JOB_SORT_FIELDS,
  JOB_STATES,
  JobDetail,
  JobListResult,
} from '@tyre/shared';

import {
  ApprovalActionIntent,
  ApprovalActionResult,
  ApprovalAllowedAction,
  ApprovalDetail,
  ApprovalListQuery,
  ApprovalListResponse,
  GovernanceApiError,
  GovernanceErrorKind,
} from './governance-contract';
import {
  AUDIT_EVENT_SOURCES,
  AUDIT_SORT_DIRECTIONS,
  AUDIT_SORT_FIELDS,
  AuditReaderRequest,
  decodeAuditEventDetail,
  decodeAuditEventList,
} from './audit-transport';
import { AuthService } from './auth.service';
import { GeneratedAdminReadTransport } from './generated-admin-read-transport';
import { GOVERNANCE_FEATURE_CONFIG, GovernanceFeatureConfig } from './governance-flags';
import { IdentityApiService } from './identity-api.service';
import { JobReaderRequest, decodeJobDetail, decodeJobList } from './jobs-transport';

@Injectable({ providedIn: 'root' })
export class GovernanceApiService {
  private readonly http = inject(HttpClient);
  private readonly identity = inject(IdentityApiService);
  private readonly auth = inject(AuthService);
  private readonly generatedReads = inject(GeneratedAdminReadTransport);

  constructor(@Inject(GOVERNANCE_FEATURE_CONFIG) readonly config: GovernanceFeatureConfig) {}

  listApprovals(query: ApprovalListQuery): Observable<ApprovalListResponse> {
    if (!this.config.approvalsEnabled) return this.disabled('APPROVAL_PLATFORM_DISABLED');
    return this.http
      .get<ApprovalListResponse>(`${this.config.apiBaseUrl}/approvals`, {
        params: appendQuery(new HttpParams(), query),
      })
      .pipe(
        catchError((error: unknown) =>
          throwError(() => collectionError(error, 'APPROVAL_API_UNAVAILABLE')),
        ),
      );
  }

  getApproval(id: string): Observable<ApprovalDetail> {
    if (!this.config.approvalsEnabled) return this.disabled('APPROVAL_PLATFORM_DISABLED');
    return this.http
      .get<ApprovalDetail>(`${this.config.apiBaseUrl}/approvals/${encodeURIComponent(id)}`)
      .pipe(catchError((error: unknown) => throwError(() => normalizeGovernanceError(error))));
  }

  prepareApprovalAction(
    request: Pick<ApprovalDetail, 'id' | 'version'>,
    action: ApprovalAllowedAction,
  ): Observable<ApprovalActionIntent> {
    if (!this.config.approvalsEnabled) return this.disabled('APPROVAL_PLATFORM_DISABLED');
    return this.http
      .post<ApprovalActionIntent>(`${this.config.apiBaseUrl}/action-intents`, {
        action: action === 'cancel' ? 'approval.cancel' : 'approval.decide',
        resourceType: 'ApprovalRequest',
        resourceId: request.id,
        resourceVersion: request.version,
        ...(action === 'cancel' ? {} : { decisionValue: action }),
      })
      .pipe(
        catchError((error: unknown) =>
          throwError(() => collectionError(error, 'ACTION_INTENT_API_UNAVAILABLE')),
        ),
      );
  }

  executeApprovalAction(
    request: Pick<ApprovalDetail, 'id' | 'version'>,
    action: ApprovalAllowedAction,
    reason: string,
    stepUpCode: string,
    intent: ApprovalActionIntent,
  ): Observable<ApprovalActionResult> {
    if (!this.config.approvalsEnabled) return this.disabled('APPROVAL_PLATFORM_DISABLED');
    return this.identity.stepUp(stepUpCode, intent.requestedActionHash).pipe(
      switchMap(({ stepUpToken }) => {
        const headers = new HttpHeaders({ 'Idempotency-Key': createIdempotencyKey() });
        const body = {
          expectedVersion: request.version,
          reason: { comment: reason },
          intentToken: intent.intentToken,
          stepUpToken,
          ...(action === 'cancel' ? {} : { decisionValue: action }),
        };
        const suffix = action === 'cancel' ? 'cancel' : 'decisions';
        return this.http.post<ApprovalActionResult>(
          `${this.config.apiBaseUrl}/approval-requests/${encodeURIComponent(request.id)}/${suffix}`,
          body,
          { headers },
        );
      }),
      catchError((error: unknown) => throwError(() => normalizeGovernanceError(error))),
    );
  }

  listAuditEvents(query: AuditReaderRequest): Observable<AuditEventListResult> {
    if (!this.config.auditReaderEnabled) return this.disabled('AUDIT_READER_DISABLED');
    const generatedQuery = toAuditReaderQuery(query);
    return this.readWithRefresh((accessToken) =>
      this.generatedReads.listAuditEvents(generatedQuery, accessToken),
    ).pipe(
      map((response) => decodeAuditEventList(response)),
      catchError((error: unknown) =>
        throwError(() => collectionError(error, 'AUDIT_READER_UNAVAILABLE')),
      ),
    );
  }

  getAuditEvent(id: string): Observable<AuditEventDetail> {
    if (!this.config.auditReaderEnabled) return this.disabled('AUDIT_READER_DISABLED');
    return this.readWithRefresh((accessToken) =>
      this.generatedReads.getAuditEvent(id, accessToken),
    ).pipe(
      map((response) => decodeAuditEventDetail(response)),
      catchError((error: unknown) => throwError(() => normalizeGovernanceError(error))),
    );
  }

  listJobs(query: JobReaderRequest): Observable<JobListResult> {
    if (!this.config.jobsReaderEnabled) return this.disabled('JOBS_READER_DISABLED');
    const generatedQuery = toJobsReaderQuery(query);
    return this.readWithRefresh((accessToken) =>
      this.generatedReads.listJobs(generatedQuery, accessToken),
    ).pipe(
      map(decodeJobList),
      catchError((error: unknown) =>
        throwError(() => collectionError(error, 'JOBS_READER_UNAVAILABLE')),
      ),
    );
  }

  getJob(id: string): Observable<JobDetail> {
    if (!this.config.jobsReaderEnabled) return this.disabled('JOBS_READER_DISABLED');
    return this.readWithRefresh((accessToken) => this.generatedReads.getJob(id, accessToken)).pipe(
      map(decodeJobDetail),
      catchError((error: unknown) => throwError(() => normalizeGovernanceError(error))),
    );
  }

  private readWithRefresh<T>(
    request: (accessToken: string | null) => Observable<T>,
  ): Observable<T> {
    return defer(() => request(this.auth.accessToken)).pipe(
      catchError((error: unknown) => {
        if (!(error instanceof ApiProblemError) || error.httpStatus !== 401)
          return throwError(() => error);
        return this.auth
          .refreshAccessToken()
          .pipe(switchMap((accessToken) => request(accessToken)));
      }),
    );
  }

  private disabled<T>(code: string): Observable<T> {
    return throwError(() => new GovernanceApiError('disabled', 423, code));
  }
}

function appendQuery(params: HttpParams, query: object): HttpParams {
  let result = params;
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '')
      result = result.set(key, String(value));
  }
  return result;
}

export function normalizeGovernanceError(error: unknown): GovernanceApiError {
  if (error instanceof GovernanceApiError) return error;
  if (!(error instanceof HttpErrorResponse) && !(error instanceof ApiProblemError))
    return new GovernanceApiError('unknown', 0, 'UNKNOWN');
  const status = error instanceof ApiProblemError ? error.httpStatus : error.status;
  const code = error instanceof ApiProblemError ? error.problem.code : readErrorCode(error);
  let kind: GovernanceErrorKind;
  if (status === 401) kind = 'stale_auth';
  else if (isAuditCursorError(code) || code === 'INVALID_JOB_CURSOR') kind = 'invalid_cursor';
  else if (status === 403) kind = 'forbidden';
  else if (status === 404) kind = 'not_found';
  else if (status === 409 && code.includes('STALE')) kind = 'stale';
  else if (status === 409 && code.includes('EXPIRED')) kind = 'expired';
  else if (status === 409) kind = 'conflict';
  else if (status === 410) kind = 'expired';
  else if (status === 423) kind = 'disabled';
  else if (status === 501) kind = 'unavailable';
  else if (status === 503) kind = 'dependency';
  else kind = 'unknown';
  return new GovernanceApiError(kind, status, code);
}

function readErrorCode(error: HttpErrorResponse): string {
  const value = error.error;
  return isRecord(value) && 'code' in value ? String(value['code']) : `HTTP_${error.status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectionError(error: unknown, code: string): GovernanceApiError {
  const status =
    error instanceof ApiProblemError
      ? error.httpStatus
      : error instanceof HttpErrorResponse
        ? error.status
        : undefined;
  return status === 404
    ? new GovernanceApiError('unavailable', 404, code)
    : normalizeGovernanceError(error);
}

const AUDIT_QUERY_KEYS = [
  'occurredFrom',
  'occurredTo',
  'eventFamily',
  'outcome',
  'actorId',
  'entityType',
  'entityId',
  'approvalRequestId',
  'approvalExecutionId',
  'serverCorrelationId',
  'causationId',
  'bulkOperationId',
  'bulkItemId',
  'retentionClass',
] as const satisfies readonly (keyof AuditReaderRequest)[];

function toAuditReaderQuery(
  query: AuditReaderRequest,
): RequestByOperation['audit-reader.list']['query'] {
  const result: Record<string, string> = {};
  for (const key of AUDIT_QUERY_KEYS) {
    const value = query[key];
    if (typeof value === 'string' && value !== '') result[key] = value;
  }
  if (query.sortField && AUDIT_SORT_FIELDS.includes(query.sortField))
    result['sortField'] = query.sortField;
  if (query.sortDirection && AUDIT_SORT_DIRECTIONS.includes(query.sortDirection))
    result['sortDirection'] = query.sortDirection;
  if (query.source && AUDIT_EVENT_SOURCES.includes(query.source)) result['source'] = query.source;
  if (typeof query.cursor === 'string' && query.cursor !== '') result['cursor'] = query.cursor;
  return result as RequestByOperation['audit-reader.list']['query'];
}

function isAuditCursorError(code: string): boolean {
  return code.startsWith('AUDIT_CURSOR_') || code === 'INVALID_AUDIT_CURSOR';
}

const JOB_QUERY_KEYS = [
  'jobType',
  'ownerDomain',
  'correlationId',
  'createdFrom',
  'createdTo',
] as const satisfies readonly (keyof JobReaderRequest)[];

function toJobsReaderQuery(
  query: JobReaderRequest,
): RequestByOperation['jobs-reader.list']['query'] {
  const result: Record<string, string | number> = {};
  for (const key of JOB_QUERY_KEYS) {
    const value = query[key];
    if (typeof value === 'string' && value !== '') result[key] = value;
  }
  if (query.state && JOB_STATES.includes(query.state)) result['state'] = query.state;
  if (query.sortField && JOB_SORT_FIELDS.includes(query.sortField))
    result['sortField'] = query.sortField;
  if (query.sortDirection && JOB_SORT_DIRECTIONS.includes(query.sortDirection))
    result['sortDirection'] = query.sortDirection;
  if (typeof query.pageSize === 'number' && Number.isInteger(query.pageSize) && query.pageSize > 0)
    result['pageSize'] = query.pageSize;
  if (typeof query.cursor === 'string' && query.cursor !== '') result['cursor'] = query.cursor;
  return result as RequestByOperation['jobs-reader.list']['query'];
}

export function createIdempotencyKey(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
