import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';

import {
  AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1,
  AdminInfo,
  AuditEventDetail,
  AuditEventListResult,
  AuditEventSummary,
} from '@tyre/shared';

import { AuditReaderRequest } from '../../core/audit-transport';
import { AuthService } from '../../core/auth.service';
import { GovernanceApiService } from '../../core/governance-api.service';
import { GovernanceApiError } from '../../core/governance-contract';
import { AuditOperationsPage, readAuditQuery } from './audit-operations.page';

describe('AuditOperationsPage', () => {
  let fixture: ComponentFixture<AuditOperationsPage> | undefined;
  const params = new BehaviorSubject(convertToParamMap({ id: 'event-1' }));
  const queryParams = new BehaviorSubject(convertToParamMap({}));
  const admin = signal<AdminInfo | null>(exactAdmin());
  let exactAllowed = true;
  const hasExactPermission = vi.fn((permission: string) => {
    const current = admin();
    return (
      exactAllowed &&
      permission === 'audit.read' &&
      Boolean(
        current?.permissions.includes('audit.read') &&
        current.permissionGrants.some((grant) => grant.permission === 'audit.read'),
      )
    );
  });
  const api = {
    config: { auditReaderEnabled: true },
    getAuditEvent: vi.fn((_id: string): Observable<AuditEventDetail> => of(detailFixture())),
    listAuditEvents: vi.fn(
      (_query: AuditReaderRequest): Observable<AuditEventListResult> => of(emptyPage()),
    ),
  };

  beforeEach(() => {
    fixture = undefined;
    exactAllowed = true;
    admin.set(exactAdmin());
    hasExactPermission.mockClear();
    api.config.auditReaderEnabled = true;
    api.getAuditEvent.mockReset();
    api.getAuditEvent.mockImplementation((_id: string) => of(detailFixture()));
    api.listAuditEvents.mockReset();
    api.listAuditEvents.mockImplementation((_query: AuditReaderRequest) => of(emptyPage()));
  });

  afterEach(() => {
    if (fixture && !fixture.componentRef.hostView.destroyed) fixture.destroy();
    TestBed.resetTestingModule();
  });

  async function setup(
    routeValues: Record<string, string> = { id: 'event-1' },
    queryValues: Record<string, string> = {},
  ): Promise<ComponentFixture<AuditOperationsPage>> {
    params.next(convertToParamMap(routeValues));
    queryParams.next(convertToParamMap(queryValues));
    await TestBed.configureTestingModule({
      imports: [AuditOperationsPage],
      providers: [
        provideRouter([]),
        { provide: GovernanceApiService, useValue: api },
        { provide: AuthService, useValue: { admin, hasExactPermission } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params,
            queryParamMap: queryParams,
            snapshot: { paramMap: params.value, queryParamMap: queryParams.value },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AuditOperationsPage);
    fixture.detectChanges();
    return fixture;
  }

  it('fails closed with no reader call when the rollout flag is disabled', async () => {
    api.config.auditReaderEnabled = false;
    const current = await setup();
    expect(current.nativeElement.querySelector('[role="status"]')).not.toBeNull();
    expect(api.getAuditEvent).not.toHaveBeenCalled();
    expect(api.listAuditEvents).not.toHaveBeenCalled();
  });

  it('denies wildcard-only access without a reader call and allows the exact grant', async () => {
    admin.set(wildcardAdmin());
    exactAllowed = false;
    const denied = await setup();
    expect(denied.componentInstance.errorKind()).toBe('forbidden');
    expect(api.getAuditEvent).not.toHaveBeenCalled();
    expect(api.listAuditEvents).not.toHaveBeenCalled();
    denied.destroy();
    TestBed.resetTestingModule();
    fixture = undefined;

    admin.set(exactAdmin());
    exactAllowed = true;
    const allowed = await setup();
    expect(api.getAuditEvent).toHaveBeenCalledWith('event-1');
    expect(allowed.componentInstance.state()).toBe('ready');
  });

  it('renders real shared detail fields as bidi-isolated text with no actions or export', async () => {
    api.getAuditEvent.mockReturnValue(of(AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.detail));
    const current = await setup();
    const element: HTMLElement = current.nativeElement;
    expect(element.textContent).toContain('Stock quantity');
    expect(element.textContent).toContain('12');
    expect(element.textContent).toContain('15');
    expect(element.textContent).toContain('public_operational');
    expect(element.textContent).toContain('fixture-server-correlation-001');
    expect(element.textContent).toContain('fixture-audit-event-001');
    expect(element.querySelector('script')).toBeNull();
    expect([...element.querySelectorAll('bdi')].every((node) => node.dir === 'auto')).toBe(true);
    expect(element.querySelectorAll('.audit-detail button, .audit-detail a')).toHaveLength(0);
    const controls = [...element.querySelectorAll<HTMLElement>('button, a')].map((control) =>
      control.textContent?.trim().toLocaleLowerCase(),
    );
    expect(controls.some((label) => label?.includes('export') || label?.includes('download'))).toBe(
      false,
    );
    expect(element.querySelector('#audit-diff-before')?.getAttribute('scope')).toBe('col');
    expect(element.querySelector('.governance-diff td')?.getAttribute('headers')).toContain(
      'audit-diff-before',
    );
  });

  it('renders the shared list response and keeps stacked table header associations', async () => {
    api.listAuditEvents.mockReturnValue(of(AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.listPage));
    const current = await setup({});
    const element: HTMLElement = current.nativeElement;
    expect(element.textContent).toContain('inventory.stock.update');
    expect(element.textContent).toContain('Staff · fixture-actor-001');
    expect(element.textContent).toContain('fixture-server-correlation-001');
    const headerIds = new Set(
      [...element.querySelectorAll<HTMLTableCellElement>('.governance-table__head th')].map(
        (header) => header.id,
      ),
    );
    expect(headerIds.size).toBe(7);
    expect(
      [...element.querySelectorAll<HTMLTableCellElement>('.governance-table tbody td')].every(
        (cell) => cell.headers.split(' ').every((id) => headerIds.has(id)),
      ),
    ).toBe(true);
    element.querySelectorAll<HTMLButtonElement>('.governance-pagination button')[1].click();
    current.detectChanges();
    expect(api.listAuditEvents).toHaveBeenLastCalledWith({
      cursor: AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.listPage.nextCursor,
    });
    expect(element.textContent).not.toContain(
      AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.listPage.nextCursor ?? '',
    );
  });

  it('uses a safe in-memory next/back cursor stack and never writes cursor into the URL', async () => {
    api.listAuditEvents.mockImplementation((query) => {
      const id = query.cursor ? 'page-2' : 'page-1';
      return of(pageFixture([summaryFixture(id)], query.cursor ? undefined : 'opaque-next'));
    });
    const current = await setup({}, { eventFamily: 'identity' });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');
    current.nativeElement.querySelectorAll('.governance-pagination button')[1].click();
    current.detectChanges();
    expect(api.listAuditEvents).toHaveBeenLastCalledWith({
      eventFamily: 'identity',
      cursor: 'opaque-next',
    });
    expect(current.componentInstance.cursorDepth()).toBe(1);
    expect(current.nativeElement.textContent).toContain('page-2');
    expect(current.nativeElement.textContent).not.toContain('opaque-next');
    expect(navigate).not.toHaveBeenCalled();

    current.nativeElement.querySelectorAll('.governance-pagination button')[0].click();
    current.detectChanges();
    expect(api.listAuditEvents).toHaveBeenLastCalledWith({ eventFamily: 'identity' });
    expect(current.componentInstance.cursorDepth()).toBe(0);
    expect(current.nativeElement.textContent).toContain('page-1');
  });

  it('restores pager focus after next and back loading transitions', async () => {
    api.listAuditEvents.mockImplementation((query) =>
      of(
        pageFixture(
          [summaryFixture(query.cursor ? 'page-2' : 'page-1')],
          query.cursor ? 'next-page-3' : 'next',
        ),
      ),
    );
    const current = await setup({});
    const next = current.nativeElement.querySelector('[data-focus-key="page-next"]');
    next.focus();
    next.click();
    current.detectChanges();
    await settleFocus(current);
    expect(document.activeElement?.getAttribute('data-focus-key')).toBe('page-next');

    const back = current.nativeElement.querySelector('[data-focus-key="page-back"]');
    back.focus();
    back.click();
    current.detectChanges();
    await settleFocus(current);
    expect(document.activeElement?.id).toBe('audit-workspace-focus');
  });

  it('restores filter and reset focus after their cursor-free route transitions', async () => {
    const current = await setup({}, { actorId: 'staff-old' });
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const actor = current.nativeElement.querySelector('input[name="actorId"]');
    actor.value = 'staff-new';
    const submit = current.nativeElement.querySelector('[data-focus-key="filter-submit"]');
    submit.focus();
    submit.click();
    queryParams.next(convertToParamMap({ actorId: 'staff-new' }));
    current.detectChanges();
    await settleFocus(current);
    expect(api.listAuditEvents).toHaveBeenLastCalledWith({ actorId: 'staff-new' });
    expect(document.activeElement?.getAttribute('data-focus-key')).toBe('filter-submit');

    const reset = current.nativeElement.querySelector('[data-focus-key="filter-reset"]');
    reset.focus();
    reset.click();
    queryParams.next(convertToParamMap({}));
    current.detectChanges();
    await settleFocus(current);
    expect(api.listAuditEvents).toHaveBeenLastCalledWith({});
    expect(document.activeElement?.getAttribute('data-focus-key')).toBe('filter-reset');
  });

  it('clears evidence and restarts from page one after an invalid cursor', async () => {
    api.listAuditEvents.mockImplementation((query) =>
      query.cursor
        ? throwError(() => new GovernanceApiError('invalid_cursor', 409, 'INVALID_AUDIT_CURSOR'))
        : of(pageFixture([summaryFixture('page-1')], 'opaque-next')),
    );
    const current = await setup({});
    current.componentInstance.nextPage();
    current.detectChanges();
    expect(current.componentInstance.errorKind()).toBe('invalid_cursor');
    expect(current.componentInstance.list()).toBeNull();
    expect(current.componentInstance.cursorDepth()).toBe(0);
    current.componentInstance.retry();
    current.detectChanges();
    expect(api.listAuditEvents).toHaveBeenLastCalledWith({});
    expect(current.componentInstance.list()?.items[0]?.eventId).toBe('page-1');
  });

  it('moves focus to detail heading and to the error alert for non-disclosing 404', async () => {
    const current = await setup();
    await settleFocus(current);
    expect(document.activeElement?.id).toBe('audit-detail-title');
    api.getAuditEvent.mockReturnValueOnce(
      throwError(() => new GovernanceApiError('not_found', 404, 'AUDIT_EVENT_NOT_FOUND')),
    );
    params.next(convertToParamMap({ id: 'missing' }));
    current.detectChanges();
    await settleFocus(current);
    expect(current.componentInstance.detail()).toBeNull();
    expect(document.activeElement?.getAttribute('role')).toBe('alert');
  });

  it('cancels and clears evidence when the exact live authorization scope changes', async () => {
    api.listAuditEvents.mockReturnValueOnce(of(pageFixture([summaryFixture('old-auth')])));
    const current = await setup({});
    const refreshed = new Subject<AuditEventListResult>();
    api.listAuditEvents.mockReturnValue(refreshed);
    admin.set(exactAdmin('warehouse', 'warehouse-2'));
    current.detectChanges();
    expect(current.componentInstance.state()).toBe('loading');
    expect(current.componentInstance.list()).toBeNull();
    expect(refreshed.observed).toBe(true);

    admin.set(null);
    current.detectChanges();
    expect(refreshed.observed).toBe(false);
    expect(current.componentInstance.errorKind()).toBe('stale_auth');
    expect(current.componentInstance.list()).toBeNull();
  });

  it('ignores an out-of-order page and does not let it steal completion focus', async () => {
    api.listAuditEvents.mockReturnValueOnce(
      of(pageFixture([summaryFixture('initial')], 'cursor-a')),
    );
    const current = await setup({});
    const oldPage = new Subject<AuditEventListResult>();
    const newPage = new Subject<AuditEventListResult>();
    api.listAuditEvents.mockImplementation((query) =>
      query.eventFamily === 'new-family' ? newPage : oldPage,
    );
    current.componentInstance.nextPage();
    queryParams.next(convertToParamMap({ eventFamily: 'new-family' }));
    newPage.next(pageFixture([summaryFixture('newest')]));
    oldPage.next(pageFixture([summaryFixture('stale')]));
    current.detectChanges();
    await settleFocus(current);
    expect(current.componentInstance.list()?.items.map((item) => item.eventId)).toEqual(['newest']);
    expect(current.nativeElement.textContent).not.toContain('stale');
    expect(document.activeElement?.id).toBe('audit-workspace-focus');
  });

  it('does not mutate or focus after a pending route is destroyed', async () => {
    const pending = new Subject<AuditEventDetail>();
    api.getAuditEvent.mockReturnValue(pending);
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const current = await setup();
    const callsBeforeDestroy = focus.mock.calls.length;
    current.destroy();
    pending.next(detailFixture('late-event'));
    await waitForTimer();
    expect(pending.observed).toBe(false);
    expect(current.componentInstance.state()).toBe('loading');
    expect(focus.mock.calls.length).toBe(callsBeforeDestroy);
    focus.mockRestore();
  });

  it('whitelists exact query keys and never restores a cursor from the URL', () => {
    expect(
      readAuditQuery(
        convertToParamMap({
          eventFamily: 'identity',
          outcome: 'succeeded',
          serverCorrelationId: 'server-1',
          sortField: 'metadata.secret',
          sortDirection: 'asc',
          cursor: 'opaque-cursor',
          payloadPath: '$.secret',
        }),
      ),
    ).toEqual({
      eventFamily: 'identity',
      outcome: 'succeeded',
      serverCorrelationId: 'server-1',
      sortDirection: 'asc',
    });
  });
});

async function settleFocus(fixture: ComponentFixture<AuditOperationsPage>): Promise<void> {
  fixture.detectChanges();
  await waitForTimer();
  fixture.detectChanges();
}

function waitForTimer(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 1));
}

function exactAdmin(scopeType: 'global' | 'warehouse' = 'global', scopeId = ''): AdminInfo {
  return {
    id: 'staff-1',
    email: 'auditor@tyre.ge',
    role: 'auditor',
    enabled: true,
    permissions: ['audit.read'],
    permissionGrants: [{ permission: 'audit.read', scopeType, scopeId }],
  };
}

function wildcardAdmin(): AdminInfo {
  return {
    id: 'staff-1',
    email: 'owner@tyre.ge',
    role: 'admin',
    enabled: true,
    permissions: ['*'],
    permissionGrants: [{ permission: '*', scopeType: 'global', scopeId: '' }],
  };
}

function emptyPage(): AuditEventListResult {
  return { items: [], asOfOccurredAt: '2026-07-30T00:01:00.000Z', allowedActions: [] };
}

function pageFixture(items: AuditEventSummary[], nextCursor?: string): AuditEventListResult {
  return {
    items,
    ...(nextCursor ? { nextCursor } : {}),
    asOfOccurredAt: '2026-07-30T00:01:00.000Z',
    allowedActions: [],
  };
}

function summaryFixture(eventId = 'event-1'): AuditEventSummary {
  return {
    eventId,
    eventType: 'identity.staff.updated',
    schemaVersion: 1,
    occurredAt: '2026-07-30T00:00:00.000Z',
    actorId: 'staff-1',
    actorType: 'Staff',
    subjectType: 'Staff',
    subjectId: 'staff-2',
    action: 'staff.update',
    entityType: 'Staff',
    entityId: eventId,
    entityVersion: '8',
    outcome: 'succeeded',
    source: 'admin_api',
    retentionClass: 'security',
    serverCorrelationId: 'server-correlation-1',
    allowedActions: [],
  };
}

function detailFixture(eventId = 'event-1'): AuditEventDetail {
  return {
    ...summaryFixture(eventId),
    eventType: 'identity.staff.\u202eupdated',
    action: 'Staff \u202e updated אבג',
    authorizationScopeKind: 'global_security',
    authorizationScopeRefs: [],
    scopeMatchMode: 'all',
    scopeResolverId: 'identity-scope',
    scopeResolverVersion: 2,
    authorizationPolicyVersion: 3,
    reasonCode: 'ADMIN_UPDATE',
    clientRequestId: 'client-request-1',
    before: [
      {
        key: 'displayName',
        label: 'Display name \u2066 שם',
        classification: 'masked',
        value: 'Before \u202D masked',
      },
    ],
    after: [
      {
        key: 'displayName',
        label: 'Display name \u2066 שם',
        classification: 'masked',
        value: 'After אבג masked',
      },
    ],
    metadata: [
      {
        key: 'summary',
        label: 'Summary',
        classification: 'public_operational',
        value: '<script>alert(1)</script>',
      },
    ],
  };
}
