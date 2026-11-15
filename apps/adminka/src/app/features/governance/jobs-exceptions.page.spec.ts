import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  ParamMap,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';

import { AdminInfo, JOB_CONTRACT_FIXTURE_V1, JobDetail, JobListResult } from '@tyre/shared';

import { AuthService } from '../../core/auth.service';
import { GovernanceApiService } from '../../core/governance-api.service';
import { GovernanceApiError } from '../../core/governance-contract';
import { JobsExceptionsPage, readJobQuery } from './jobs-exceptions.page';

describe('JobsExceptionsPage', () => {
  const params = new BehaviorSubject<ParamMap>(convertToParamMap({}));
  const queryParams = new BehaviorSubject<ParamMap>(convertToParamMap({}));
  const admin = signal(exactAdmin());
  const hasExactPermission = vi.fn(() => true);
  const listJobs = vi.fn(
    (_query: object): Observable<JobListResult> => of(JOB_CONTRACT_FIXTURE_V1.listPage),
  );
  const getJob = vi.fn((_id: string): Observable<JobDetail> => of(JOB_CONTRACT_FIXTURE_V1.detail));
  const api = {
    config: { jobsReaderEnabled: true },
    listJobs,
    getJob,
  };

  beforeEach(() => {
    params.next(convertToParamMap({}));
    queryParams.next(convertToParamMap({}));
    admin.set(exactAdmin());
    hasExactPermission.mockReset();
    hasExactPermission.mockReturnValue(true);
    api.config.jobsReaderEnabled = true;
    listJobs.mockReset();
    listJobs.mockImplementation(() => of(JOB_CONTRACT_FIXTURE_V1.listPage));
    getJob.mockReset();
    getJob.mockImplementation(() => of(JOB_CONTRACT_FIXTURE_V1.detail));
  });

  afterEach(() => TestBed.resetTestingModule());

  async function setup(): Promise<ComponentFixture<JobsExceptionsPage>> {
    await TestBed.configureTestingModule({
      imports: [JobsExceptionsPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params, queryParamMap: queryParams } },
        { provide: AuthService, useValue: { admin, hasExactPermission } },
        { provide: GovernanceApiService, useValue: api },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(JobsExceptionsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('stays honestly disabled and makes no reader call while its distinct flag is false', async () => {
    api.config.jobsReaderEnabled = false;
    const fixture = await setup();
    expect(fixture.nativeElement.textContent).toContain('Jobs reader გამორთულია');
    expect(listJobs).not.toHaveBeenCalled();
    expect(getJob).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('denies missing literal jobs.read with no data call even if broader auth could allow it', async () => {
    hasExactPermission.mockReturnValue(false);
    const fixture = await setup();
    expect(fixture.nativeElement.textContent).toContain('Jobs-ზე წვდომა აკრძალულია');
    expect(listJobs).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('renders only shared fixture evidence with semantic tables, bidi isolation and no mutation or payload controls', async () => {
    params.next(convertToParamMap({ id: JOB_CONTRACT_FIXTURE_V1.detail.jobId }));
    const fixture = await setup();
    await flushFocus();
    const element = fixture.nativeElement as HTMLElement;
    const text = element.textContent ?? '';
    expect(getJob).toHaveBeenCalledWith(JOB_CONTRACT_FIXTURE_V1.detail.jobId);
    expect(text).toContain(JOB_CONTRACT_FIXTURE_V1.detail.originatingAuditEventId);
    expect(text).toContain('dead_lettered');
    expect(text).toContain('FIXTURE_SCHEMA_REJECTED');
    expect(text).toContain('60s');
    expect(element.querySelectorAll('table thead th').length).toBeGreaterThan(0);
    expect(element.querySelectorAll('bdi[dir="auto"]').length).toBeGreaterThan(5);
    expect(text.toLocaleLowerCase()).not.toContain('raw payload');
    expect(text.toLocaleLowerCase()).not.toContain('resume');
    expect(text.toLocaleLowerCase()).not.toContain('provider');
    expect(
      [...element.querySelectorAll('button')].some((button) =>
        /retry/iu.test(button.textContent ?? ''),
      ),
    ).toBe(false);
    expect(document.activeElement?.id).toBe('job-detail-title');
    fixture.destroy();
  });

  it('renders completed, failed, and quarantined source outcomeAt values while pending stays unrecorded', async () => {
    const detail = {
      ...JOB_CONTRACT_FIXTURE_V1.detail,
      attempts: [
        {
          attemptStartedId: 'attempt-completed',
          leaseGeneration: 1,
          startedAt: '2026-07-30T08:01:00.000Z',
          outcome: 'succeeded',
          outcomeAt: '2026-07-30T08:01:30.125Z',
          safeReasonCode: 'COMPLETED',
        },
        {
          attemptStartedId: 'attempt-failed',
          leaseGeneration: 2,
          startedAt: '2026-07-30T08:02:00.000Z',
          outcome: 'known_safe_failure',
          outcomeAt: '2026-07-30T08:02:45.500Z',
          safeReasonCode: 'KNOWN_SAFE_FAILURE',
        },
        {
          attemptStartedId: 'attempt-quarantined',
          leaseGeneration: 3,
          startedAt: '2026-07-30T08:03:00.000Z',
          outcome: 'external_outcome_unknown',
          outcomeAt: '2026-07-30T08:03:12.999Z',
          safeReasonCode: 'QUARANTINED_UNKNOWN_OUTCOME',
        },
        {
          attemptStartedId: 'attempt-pending',
          leaseGeneration: 4,
          startedAt: '2026-07-30T08:04:00.000Z',
        },
      ],
    } satisfies JobDetail;
    getJob.mockReturnValue(of(detail));
    params.next(convertToParamMap({ id: detail.jobId }));

    const fixture = await setup();
    const element = fixture.nativeElement as HTMLElement;
    const outcomeCells = [
      ...element.querySelectorAll<HTMLTableCellElement>('td[headers="attempt-col-outcome-at"]'),
    ];
    const sourceTimes = outcomeCells
      .map((cell) => cell.querySelector<HTMLTimeElement>('time'))
      .filter((time): time is HTMLTimeElement => time !== null);
    const expectedInstants = detail.attempts
      .map((attempt) => attempt.outcomeAt)
      .filter((value): value is string => value !== undefined);

    expect(sourceTimes.map((time) => time.dateTime)).toEqual(expectedInstants);
    expect(sourceTimes.map((time) => time.textContent?.trim())).toEqual(expectedInstants);
    for (const [index, time] of sourceTimes.entries()) {
      expect(time.getAttribute('aria-label')).toContain(expectedInstants[index]);
      expect(time.textContent).not.toMatch(/\//u);
    }
    const pendingCell = outcomeCells.at(-1);
    expect(pendingCell?.textContent?.trim()).toBe('—');
    expect(
      pendingCell?.querySelector('[aria-label="Outcome timestamp not recorded"]'),
    ).not.toBeNull();
    fixture.destroy();
  });

  it('keeps attempt table headers associated on desktop and stacked mobile rows', async () => {
    params.next(convertToParamMap({ id: JOB_CONTRACT_FIXTURE_V1.detail.jobId }));
    const fixture = await setup();
    const table = (fixture.nativeElement as HTMLElement).querySelector<HTMLTableElement>(
      'table[aria-labelledby="attempts-title"]',
    );

    expect(table?.getAttribute('aria-describedby')).toBe('attempts-timestamp-note');
    expect(table?.textContent).toContain('Outcome at');
    for (const cell of table?.querySelectorAll<HTMLTableCellElement>('tbody td') ?? []) {
      const headerId = cell.getAttribute('headers');
      expect(headerId).toBeTruthy();
      expect(cell.dataset['label']).toBeTruthy();
      expect(table?.querySelector(`th#${headerId}[scope="col"]`)).not.toBeNull();
    }
    expect(table?.querySelector('#attempt-col-fence-age .sr-only')?.textContent).toContain(
      'derived from server source timestamps',
    );
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Client clock არ გამოიყენება',
    );
    fixture.destroy();
  });

  it('renders a truthful empty state from an empty server page', async () => {
    listJobs.mockReturnValue(
      of({
        items: [],
        asOfCreatedAt: JOB_CONTRACT_FIXTURE_V1.listPage.asOfCreatedAt,
        allowedActions: [],
      }),
    );
    const fixture = await setup();
    expect(fixture.nativeElement.textContent).toContain('შესაბამისი Jobs არ არის');
    expect(fixture.nativeElement.querySelector('.jobs-table')).toBeNull();
    fixture.destroy();
  });

  it('keeps an unresolved request in an announced loading state', async () => {
    listJobs.mockReturnValue(new Subject<JobListResult>());
    const fixture = await setup();
    expect(fixture.nativeElement.textContent).toContain('Jobs მტკიცებულება იტვირთება');
    expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).not.toBeNull();
    fixture.destroy();
  });

  it('keeps opaque jc1 continuation memory-only while filters remain shareable', async () => {
    const fixture = await setup();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentInstance.nextPage();
    expect(listJobs).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: JOB_CONTRACT_FIXTURE_V1.listPage.nextCursor }),
    );
    expect(location.search).not.toContain('jc1.');

    const form = (fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>('form');
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(navigate).toHaveBeenCalledWith(
      ['/jobs'],
      expect.objectContaining({
        queryParams: expect.not.objectContaining({ cursor: expect.anything() }),
      }),
    );
    fixture.destroy();
  });

  it('uses latest-only cancellation so an older refresh cannot replace newer evidence', async () => {
    const first = new Subject<JobListResult>();
    const second = new Subject<JobListResult>();
    listJobs.mockReset();
    listJobs.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const fixture = await setup();
    fixture.componentInstance.reload();
    const newest = {
      ...JOB_CONTRACT_FIXTURE_V1.listPage,
      items: [{ ...JOB_CONTRACT_FIXTURE_V1.listPage.items[0], jobId: 'newest-job' }],
    };
    second.next(newest);
    second.complete();
    fixture.detectChanges();
    first.next(JOB_CONTRACT_FIXTURE_V1.listPage);
    first.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('newest-job');
    expect(fixture.nativeElement.textContent).not.toContain(
      JOB_CONTRACT_FIXTURE_V1.listPage.items[0].jobId,
    );
    fixture.destroy();
  });

  it('restores pagination focus to the stable next-page trigger', async () => {
    const fixture = await setup();
    fixture.componentInstance.nextPage();
    fixture.detectChanges();
    await flushFocus();
    expect((document.activeElement as HTMLElement | null)?.dataset['focusKey']).toBe('page-next');
    fixture.destroy();
  });

  it('uses a fixed non-disclosing detail 404 state without echoing the requested identifier', async () => {
    params.next(convertToParamMap({ id: 'secret-job-identifier' }));
    getJob.mockReturnValue(
      throwError(() => new GovernanceApiError('not_found', 404, 'JOB_NOT_FOUND')),
    );
    const fixture = await setup();
    expect(fixture.nativeElement.textContent).toContain('Job ვერ მოიძებნა');
    expect(fixture.nativeElement.textContent).not.toContain('secret-job-identifier');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    fixture.destroy();
  });

  it.each([
    ['forbidden', 'Jobs-ზე წვდომა აკრძალულია'],
    ['not_found', 'Job ვერ მოიძებნა'],
    ['invalid_cursor', 'continuation აღარ მოქმედებს'],
    ['stale_auth', 'სესია ან წვდომა შეიცვალა'],
    ['dependency', 'Jobs dependency მიუწვდომელია'],
  ] as const)('renders the explicit %s state without stale evidence', async (kind, copy) => {
    listJobs.mockImplementation(() =>
      throwError(() => new GovernanceApiError(kind, kind === 'not_found' ? 404 : 503, 'SAFE_CODE')),
    );
    const fixture = await setup();
    expect(fixture.nativeElement.textContent).toContain(copy);
    expect(fixture.nativeElement.textContent).not.toContain(
      JOB_CONTRACT_FIXTURE_V1.listPage.items[0].jobId,
    );
    fixture.destroy();
  });

  it('clears visible evidence when the exact authorization graph fingerprint changes', async () => {
    const fixture = await setup();
    expect(fixture.nativeElement.textContent).toContain(
      JOB_CONTRACT_FIXTURE_V1.listPage.items[0].jobId,
    );
    hasExactPermission.mockReturnValue(false);
    admin.set({
      ...exactAdmin(),
      permissions: ['*'],
      permissionGrants: [{ permission: '*', scopeType: 'global', scopeId: '' }],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('სესია ან წვდომა შეიცვალა');
    expect(fixture.nativeElement.textContent).not.toContain(
      JOB_CONTRACT_FIXTURE_V1.listPage.items[0].jobId,
    );
    fixture.destroy();
  });
});

describe('readJobQuery', () => {
  it('whitelists shareable non-secret filters and never accepts a URL cursor', () => {
    const query = readJobQuery(
      convertToParamMap({
        state: 'dead_lettered',
        sortField: 'priority',
        sortDirection: 'asc',
        ownerDomain: 'inventory',
        cursor: JOB_CONTRACT_FIXTURE_V1.listPage.nextCursor,
      }),
    );
    expect(query).toEqual({
      state: 'dead_lettered',
      ownerDomain: 'inventory',
      sortField: 'priority',
      sortDirection: 'asc',
    });
    expect(query.cursor).toBeUndefined();
  });

  it('normalizes invalid enum and page-size input to closed defaults', () => {
    expect(
      readJobQuery(
        convertToParamMap({ state: 'retrying', sortField: 'rawPayload', pageSize: '999' }),
      ),
    ).toEqual({ sortField: 'createdAt', sortDirection: 'desc' });
  });
});

function exactAdmin(): AdminInfo {
  return {
    id: 'staff-jobs-reader',
    email: 'reader@tyre.ge',
    role: 'ops',
    enabled: true,
    permissions: ['jobs.read'],
    permissionGrants: [
      { permission: 'jobs.read', scopeType: 'warehouse', scopeId: 'fixture-warehouse-001' },
    ],
  };
}

function flushFocus(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 5));
}
