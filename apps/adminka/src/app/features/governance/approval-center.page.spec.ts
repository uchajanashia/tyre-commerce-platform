import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';

import {
  ApprovalActionIntent,
  ApprovalActionResult,
  ApprovalDetail,
  ApprovalListQuery,
  ApprovalListResponse,
  ApprovalSummary,
} from '../../core/governance-contract';
import { GovernanceApiService } from '../../core/governance-api.service';
import { ApprovalCenterPage, readApprovalQuery } from './approval-center.page';

describe('ApprovalCenterPage', () => {
  let fixture: ComponentFixture<ApprovalCenterPage>;
  const params = new BehaviorSubject(convertToParamMap({ id: 'approval-1' }));
  const queryParams = new BehaviorSubject(convertToParamMap({}));
  const detail = approvalFixture();
  const intent: ApprovalActionIntent = {
    intentToken: 'opaque-intent',
    requestedActionHash: 'server-action-hash',
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const api = {
    config: { approvalsEnabled: true },
    getApproval: vi.fn((_id: string): Observable<ApprovalDetail> => of(detail)),
    listApprovals: vi.fn(
      (_query: ApprovalListQuery): Observable<ApprovalListResponse> => of(emptyApprovalPage()),
    ),
    prepareApprovalAction: vi.fn(
      (_request: ApprovalDetail, _action: string): Observable<ApprovalActionIntent> => of(intent),
    ),
    executeApprovalAction: vi.fn(
      (): Observable<ApprovalActionResult> => of({ request: { ...detail, status: 'approved' } }),
    ),
  };

  async function setup(
    enabled = true,
    routeValues: Record<string, string> = { id: 'approval-1' },
    queryValues: Record<string, string> = {},
  ): Promise<void> {
    api.config.approvalsEnabled = enabled;
    for (const mock of [
      api.getApproval,
      api.listApprovals,
      api.prepareApprovalAction,
      api.executeApprovalAction,
    ]) {
      mock.mockClear();
    }
    params.next(convertToParamMap(routeValues));
    queryParams.next(convertToParamMap(queryValues));
    await TestBed.configureTestingModule({
      imports: [ApprovalCenterPage],
      providers: [
        provideRouter([]),
        { provide: GovernanceApiService, useValue: api },
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
    fixture = TestBed.createComponent(ApprovalCenterPage);
    fixture.detectChanges();
  }

  afterEach(() => {
    if (fixture && !fixture.componentRef.hostView.destroyed) fixture.destroy();
    TestBed.resetTestingModule();
    api.getApproval.mockImplementation((_id: string) => of(detail));
    api.listApprovals.mockImplementation((_query: ApprovalListQuery) => of(emptyApprovalPage()));
    api.prepareApprovalAction.mockImplementation(() => of(intent));
    api.executeApprovalAction.mockImplementation(() =>
      of({ request: { ...detail, status: 'approved' } }),
    );
  });

  it('renders an honest safe-disabled state without requesting data', async () => {
    await setup(false);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[role="status"]')).not.toBeNull();
    expect(api.getApproval).not.toHaveBeenCalled();
    expect(element.querySelector('.approval-actions')).toBeNull();
  });

  it('renders safe bidi-isolated server projections and a semantic diff table', async () => {
    await setup();
    const element = fixture.nativeElement as HTMLElement;
    const actionButtons = [
      ...element.querySelectorAll<HTMLButtonElement>('.approval-actions button'),
    ];

    expect(actionButtons).toHaveLength(1);
    expect(element.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(element.textContent).toContain('Stock \u202E correction אבג');
    expect(element.querySelector('.governance-projection img')).toBeNull();
    expect(element.querySelector('[innerhtml]')).toBeNull();
    expect(element.textContent).toContain('payload-hash');
    expect(element.textContent).toContain('1 / 2');
    expect(
      [...element.querySelectorAll('bdi')].every((node) => node.getAttribute('dir') === 'auto'),
    ).toBe(true);

    const headers = [
      element.querySelector<HTMLTableCellElement>('#approval-diff-field'),
      element.querySelector<HTMLTableCellElement>('#approval-diff-before'),
      element.querySelector<HTMLTableCellElement>('#approval-diff-after'),
    ];
    expect(headers.every((header) => header?.getAttribute('scope') === 'col')).toBe(true);
    expect(
      element.querySelector<HTMLTableCellElement>('.governance-diff td')?.getAttribute('headers'),
    ).toBe('approval-diff-field approval-diff-before');
    expect(
      fixture.componentInstance.availableActions({
        ...detail,
        status: 'external_outcome_unknown',
        allowedActions: ['approve'],
      }),
    ).toEqual([]);
  });

  it('keeps reason, server intent, exact MFA step-up and focus in the confirmation flow', async () => {
    await setup();
    const element = fixture.nativeElement as HTMLElement;
    const sidebar = document.createElement('aside');
    const topbar = document.createElement('header');
    sidebar.className = 'admin-sidebar';
    topbar.className = 'admin-topbar';
    sidebar.inert = false;
    topbar.inert = false;
    sidebar.setAttribute('aria-hidden', 'false');
    document.body.append(sidebar, topbar);
    const trigger = element.querySelector<HTMLButtonElement>('.approval-actions button')!;
    trigger.click();
    fixture.detectChanges();
    await Promise.resolve();

    const dialog = element.querySelector<HTMLDialogElement>('[role="dialog"]')!;
    const page = element.querySelector<HTMLElement>('.governance-page')!;
    expect(document.activeElement).toBe(dialog.querySelector('h2'));
    expect(page.inert).toBe(true);
    expect(page.getAttribute('aria-hidden')).toBe('true');
    expect(sidebar.inert).toBe(true);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(topbar.inert).toBe(true);
    expect(dialog.getAttribute('aria-hidden')).toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
    const focusables = dialog.querySelectorAll<HTMLElement>(
      '[tabindex="-1"], button:not(:disabled), input:not(:disabled), textarea:not(:disabled)',
    );
    expect(document.activeElement).toBe(focusables.item(focusables.length - 1));

    const reason = dialog.querySelector<HTMLTextAreaElement>('textarea')!;
    reason.value = 'Source record verified';
    reason.dispatchEvent(new Event('input'));
    dialog.querySelectorAll<HTMLButtonElement>('button')[1].click();
    fixture.detectChanges();
    await Promise.resolve();

    const code = element.querySelector<HTMLInputElement>('#approval-step-up')!;
    expect(api.prepareApprovalAction).toHaveBeenCalledWith(detail, 'approve');
    expect(document.activeElement).toBe(code);
    code.value = '123456';
    code.dispatchEvent(new Event('input'));
    element.querySelectorAll<HTMLButtonElement>('.governance-modal__actions button')[1].click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(api.executeApprovalAction).toHaveBeenCalledWith(
      detail,
      'approve',
      'Source record verified',
      '123456',
      expect.objectContaining({ intentToken: 'opaque-intent' }),
    );
    expect(element.querySelector('[role="dialog"]')).toBeNull();
    expect(page.inert).not.toBe(true);
    expect(page.getAttribute('aria-hidden')).toBeNull();
    expect(sidebar.inert).toBe(false);
    expect(sidebar.getAttribute('aria-hidden')).toBe('false');
    expect(topbar.inert).toBe(false);
    expect(topbar.getAttribute('aria-hidden')).toBeNull();
    expect(document.activeElement).toBe(element.querySelector('#approval-detail-title'));
    sidebar.remove();
    topbar.remove();
  });

  it('blocks every close path, duplicate submission and navigation while an action is busy', async () => {
    const pendingAction = new Subject<ApprovalActionResult>();
    api.executeApprovalAction.mockReturnValueOnce(pendingAction);
    await setup();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.approval-actions button')!.click();
    fixture.detectChanges();
    await Promise.resolve();

    const dialog = element.querySelector<HTMLDialogElement>('[role="dialog"]')!;
    const reason = dialog.querySelector<HTMLTextAreaElement>('textarea')!;
    reason.value = 'Verified';
    reason.dispatchEvent(new Event('input'));
    dialog.querySelectorAll<HTMLButtonElement>('button')[1].click();
    fixture.detectChanges();
    await Promise.resolve();

    const code = dialog.querySelector<HTMLInputElement>('#approval-step-up')!;
    code.value = '123456';
    code.dispatchEvent(new Event('input'));
    const execute = dialog.querySelectorAll<HTMLButtonElement>('button')[1];
    execute.click();
    fixture.detectChanges();
    execute.click();

    expect(api.executeApprovalAction).toHaveBeenCalledTimes(1);
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(fixture.componentInstance.canLeaveGovernance()).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    dialog.dispatchEvent(new MouseEvent('click', { clientX: -1, clientY: -1 }));
    fixture.detectChanges();
    expect(element.querySelector('[role="dialog"]')).toBe(dialog);
    expect(element.querySelector<HTMLElement>('.governance-page')?.inert).toBe(true);

    pendingAction.next({ request: { ...detail, status: 'approved' } });
    pendingAction.complete();
    fixture.detectChanges();
    expect(fixture.componentInstance.canLeaveGovernance()).toBe(true);
    await Promise.resolve();
    expect(element.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(element.querySelector('#approval-detail-title'));
  });

  it('restores focus to the action trigger when a non-busy dialog is cancelled', async () => {
    await setup();
    const element = fixture.nativeElement as HTMLElement;
    const trigger = element.querySelector<HTMLButtonElement>('.approval-actions button')!;
    trigger.click();
    fixture.detectChanges();
    await Promise.resolve();
    element
      .querySelector<HTMLDialogElement>('[role="dialog"]')!
      .dispatchEvent(new Event('cancel', { cancelable: true }));
    fixture.detectChanges();
    await Promise.resolve();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores the isolated background and cancels in-flight work when destroyed', async () => {
    const pendingIntent = new Subject<ApprovalActionIntent>();
    api.prepareApprovalAction.mockReturnValueOnce(pendingIntent);
    await setup();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('.approval-actions button')!.click();
    fixture.detectChanges();
    await Promise.resolve();
    const page = element.querySelector<HTMLElement>('.governance-page')!;
    const reason = element.querySelector<HTMLTextAreaElement>('textarea')!;
    reason.value = 'Verified';
    reason.dispatchEvent(new Event('input'));
    element.querySelectorAll<HTMLButtonElement>('.governance-modal__actions button')[1].click();
    fixture.detectChanges();

    expect(page.inert).toBe(true);
    expect(pendingIntent.observed).toBe(true);
    fixture.destroy();
    expect(page.inert).not.toBe(true);
    expect(page.getAttribute('aria-hidden')).toBeNull();
    expect(pendingIntent.observed).toBe(false);
  });

  it('keeps programmatic list headers when the table is visually stacked', async () => {
    const page: ApprovalListResponse = {
      items: [approvalSummary('approval-mobile', 'Mobile row')],
      nextCursor: null,
      previousCursor: null,
    };
    api.listApprovals.mockReturnValueOnce(of(page));
    await setup(true, {});
    const element = fixture.nativeElement as HTMLElement;
    const headerIds = new Set(
      [...element.querySelectorAll<HTMLTableCellElement>('.governance-table__head th')].map(
        (header) => header.id,
      ),
    );

    expect(headerIds.size).toBe(6);
    expect(
      [...element.querySelectorAll<HTMLTableCellElement>('.governance-table tbody td')].every(
        (cell) =>
          cell.headers.length > 0 && cell.headers.split(' ').every((id) => headerIds.has(id)),
      ),
    ).toBe(true);
  });

  it('renders only the latest list and detail route responses', async () => {
    const oldList = new Subject<ApprovalListResponse>();
    const newList = new Subject<ApprovalListResponse>();
    api.listApprovals.mockImplementation((query) =>
      query.status === 'approved' ? newList : oldList,
    );
    await setup(true, {}, { status: 'pending' });
    queryParams.next(convertToParamMap({ status: 'approved' }));
    newList.next({
      items: [approvalSummary('new-list', 'Newest list')],
      nextCursor: null,
      previousCursor: null,
    });
    oldList.next({
      items: [approvalSummary('old-list', 'Stale list')],
      nextCursor: null,
      previousCursor: null,
    });
    fixture.detectChanges();
    expect(fixture.componentInstance.list()?.items.map((item) => item.id)).toEqual(['new-list']);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Newest list');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Stale list');

    const oldDetail = new Subject<ApprovalDetail>();
    const newDetail = new Subject<ApprovalDetail>();
    api.getApproval.mockImplementation((id) => (id === 'new-detail' ? newDetail : oldDetail));
    params.next(convertToParamMap({ id: 'old-detail' }));
    params.next(convertToParamMap({ id: 'new-detail' }));
    newDetail.next(approvalFixture('new-detail', 'Newest detail'));
    oldDetail.next(approvalFixture('old-detail', 'Stale detail'));
    fixture.detectChanges();
    expect(fixture.componentInstance.detail()?.id).toBe('new-detail');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Newest detail');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Stale detail');
  });

  it('whitelists shareable URL status/sort values and keeps the cursor opaque', () => {
    expect(
      readApprovalQuery(
        convertToParamMap({
          status: 'pending',
          sort: 'DROP TABLE',
          direction: 'asc',
          cursor: 'opaque/server+cursor',
        }),
      ),
    ).toEqual({
      status: 'pending',
      sort: 'createdAt',
      direction: 'asc',
      cursor: 'opaque/server+cursor',
    });
  });
});

function emptyApprovalPage(): ApprovalListResponse {
  return { items: [], nextCursor: null, previousCursor: null };
}

function approvalSummary(id: string, actionLabel: string): ApprovalSummary {
  return {
    id,
    version: 4,
    actionType: 'inventory.adjust.post',
    actionLabel,
    targetSummary: 'Warehouse item',
    requester: { id: 'staff-1', displayName: 'Requester' },
    status: 'pending',
    createdAt: '2026-07-30T00:00:00Z',
    expiresAt: '2099-01-01T00:00:00Z',
    quorum: { satisfied: 1, required: 2 },
    allowedActions: ['approve'],
  };
}

function approvalFixture(
  id = 'approval-1',
  actionLabel = 'Stock \u202E correction אבג',
): ApprovalDetail {
  return {
    ...approvalSummary(id, actionLabel),
    immutable: {
      schemaVersion: 1,
      adapterVersion: 'inventory-v1',
      policyVersion: 'policy-v3',
      payloadHash: 'payload-hash',
      targetSetHash: 'target-hash',
      policyHash: 'policy-hash',
      targets: [{ type: 'InventoryItem', id: 'item-1', version: 7, label: 'Item 1' }],
    },
    preview: {
      fields: [
        {
          key: 'note',
          label: 'Note',
          value: '<img src=x onerror=alert(1)>',
          classification: 'operational',
        },
      ],
      changes: [
        {
          key: 'quantity',
          label: 'Quantity \u2066 כמות',
          before: '10',
          after: '12',
          classification: 'operational',
        },
      ],
    },
    timeline: [
      {
        id: 'timeline-1',
        occurredAt: '2026-07-30T00:00:00Z',
        kind: 'requested',
        label: 'Requested',
        actor: { id: 'staff-1', displayName: 'Requester' },
        outcome: null,
        reason: 'Verified request',
      },
    ],
  };
}
