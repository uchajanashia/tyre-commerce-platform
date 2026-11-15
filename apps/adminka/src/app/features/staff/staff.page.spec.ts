import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth.service';
import { IdentityApiService } from '../../core/identity-api.service';
import {
  CreateStaffRequest,
  StaffListItem,
  StaffListResponse,
  TargetStaffSessionItem,
  TargetStaffSessionList,
} from '../../core/identity-contract';
import { StaffPage } from './staff.page';

describe('StaffPage', () => {
  const member: StaffListItem = {
    id: 'staff-target',
    email: 'target@tyre.ge',
    displayName: 'Target',
    status: 'active',
    mfaRequired: true,
    mfaEnrolled: true,
    lastActivityAt: null,
    version: 2,
    assignments: [
      {
        role: { id: 'role-ops', key: 'ops', name: 'Operations' },
        scopeType: 'global',
        scopeId: '',
      },
    ],
  };
  const nonMfaMember: StaffListItem = { ...member, mfaRequired: false };
  const detailFor = (item: StaffListItem) => ({
    id: item.id,
    email: item.email,
    displayName: item.displayName,
    status: item.status,
    enabled: item.status === 'active',
    version: item.version,
    tokenVersion: 1,
    mfaRequired: item.mfaRequired,
    createdAt: '2026-07-29T10:00:00Z',
    updatedAt: '2026-07-30T10:00:00Z',
    mfaCredentials: item.mfaEnrolled ? [{ id: 'mfa-1', confirmedAt: '2026-07-29T11:00:00Z' }] : [],
    roleAssignments: item.assignments,
  });
  const auth = {
    identityV2Enabled: true,
    hasPermission: vi.fn(
      (permission: string) => permission === 'staff.manage' || permission === 'roles.assign',
    ),
  };
  const api = {
    listStaff: vi.fn(
      (_query?: unknown): Observable<StaffListResponse> => of({ items: [] as StaffListItem[] }),
    ),
    listRoles: vi.fn(() =>
      of({
        items: [
          {
            id: 'role-ops',
            key: 'ops',
            name: 'Operations',
            description: 'Operations role',
            isSystem: true,
            permissions: ['staff.read'],
            mfaRequired: false,
            assignmentAllowed: true,
          },
        ],
        scopeTypes: ['global'],
      }),
    ),
    staffDetail: vi.fn(() => of(detailFor(member))),
    previewCreateStaff: vi.fn(() =>
      of({
        requestedActionHash: 'server-action-hash',
        emailNormalized: 'new.operator@tyre.ge',
        assignments: [{ roleId: 'role-ops', scopeType: 'global' as const, scopeId: '' }],
        mfaRequired: true,
      }),
    ),
    stepUp: vi.fn(() => of({ stepUpToken: 'step-up-token', expiresAt: '2026-07-30T10:00:00Z' })),
    createStaff: vi.fn((_request: CreateStaffRequest, _proof: string) => of({ id: 'staff-new' })),
    updateRoleAssignments: vi.fn(() =>
      of({ id: member.id, version: 3, tokenVersion: 2, mfaRequired: true, assignments: [] }),
    ),
    staffAction: vi.fn(() =>
      of({ id: member.id, status: 'disabled' as const, enabled: false, version: 3 }),
    ),
    previewRoleAssignments: vi.fn(() =>
      of({
        requestedActionHash: 'assignment-hash',
        assignments: [{ roleId: 'role-ops', scopeType: 'global' as const, scopeId: '' }],
        mfaRequired: true,
      }),
    ),
    previewStaffAction: vi.fn(() => of({ requestedActionHash: 'status-hash' })),
    previewRecoveryRequest: vi.fn(() => of({ requestedActionHash: 'recovery-hash' })),
    createRecoveryRequest: vi.fn(() =>
      of({
        id: 'recovery-1',
        state: 'pending',
        payloadHash: 'payload-hash',
        expiresAt: '2026-07-31T10:00:00Z',
      }),
    ),
    previewRecoveryApproval: vi.fn(() =>
      of({
        requestedActionHash: 'approval-hash',
        payloadHash: 'payload-hash',
        state: 'pending',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    ),
    approveRecoveryRequest: vi.fn(() =>
      of({ id: 'recovery-1', state: 'executed', targetStatus: 'pending_activation' }),
    ),
    previewInvitationResend: vi.fn(() => of({ requestedActionHash: 'resend-hash' })),
    resendInvitation: vi.fn(() =>
      of({
        targetId: member.id,
        version: 3,
        invitation: { invitationId: 'invite-2', expiresAt: '2026-08-01T10:00:00Z' },
      }),
    ),
    targetSessions: vi.fn(
      (_staffId?: string, _cursor?: string): Observable<TargetStaffSessionList> =>
        of({ items: [] as TargetStaffSessionItem[] }),
    ),
    previewTargetSessionRevoke: vi.fn(() => of({ requestedActionHash: 'session-hash' })),
    revokeTargetSession: vi.fn(() => of({ revoked: true as const, targetVersion: 3 })),
  };

  beforeEach(() => {
    auth.identityV2Enabled = true;
    auth.hasPermission.mockImplementation(
      (permission: string) => permission === 'staff.manage' || permission === 'roles.assign',
    );
    auth.hasPermission.mockClear();
    Object.values(api).forEach((mock) => mock.mockClear());
  });

  async function create(): Promise<ComponentFixture<StaffPage>> {
    await TestBed.configureTestingModule({
      imports: [StaffPage],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: IdentityApiService, useValue: api },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(StaffPage);
    fixture.detectChanges();
    return fixture;
  }

  it('does not request or invent staff data when identity-v2 is disabled', async () => {
    auth.identityV2Enabled = false;
    const fixture = await create();

    expect(fixture.componentInstance.state()).toBe('unavailable');
    expect(api.listStaff).not.toHaveBeenCalled();
    expect(api.listRoles).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('loads staff and role catalogs together and keeps management permission-aware', async () => {
    const fixture = await create();

    expect(fixture.componentInstance.state()).toBe('ready');
    expect(fixture.componentInstance.roles().map((role) => role.id)).toEqual(['role-ops']);
    expect(fixture.componentInstance.canManage()).toBe(true);
    expect(fixture.componentInstance.canAssignRoles()).toBe(true);
    auth.hasPermission.mockReturnValueOnce(false);
    expect(fixture.componentInstance.canManage()).toBe(false);
    fixture.destroy();
  });

  it('loads cursor pages, deduplicates staff, announces end, and resets search/filter data', async () => {
    const updated = { ...member, displayName: 'Updated Target' };
    const another = fixtureMember('invited', false);
    api.listStaff
      .mockReturnValueOnce(of({ items: [member], nextCursor: 'staff-cursor-2' }))
      .mockReturnValueOnce(of({ items: [updated, another], nextCursor: undefined }))
      .mockReturnValueOnce(of({ items: [another], nextCursor: undefined }));
    const fixture = await create();
    const host = fixture.nativeElement as HTMLElement;
    const loadMore = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('მეტი თანამშრომლის'),
    )!;
    loadMore.focus();
    loadMore.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(api.listStaff).toHaveBeenNthCalledWith(2, {
      q: undefined,
      status: undefined,
      cursor: 'staff-cursor-2',
    });
    expect(fixture.componentInstance.staff()?.items.map(({ id }) => id)).toEqual([
      member.id,
      another.id,
    ]);
    expect(fixture.componentInstance.staff()?.items[0].displayName).toBe('Updated Target');
    expect(fixture.componentInstance.staffNextCursor()).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('.identity-pagination'));

    fixture.componentInstance.query = 'invited';
    fixture.componentInstance.status = 'invited';
    fixture.componentInstance.load();
    expect(api.listStaff).toHaveBeenLastCalledWith({
      q: 'invited',
      status: 'invited',
    });
    expect(fixture.componentInstance.staff()?.items).toEqual([another]);
    expect(fixture.componentInstance.staffPageError()).toBe(false);
    fixture.destroy();
  });

  it('retains directory items/cursor on page error and blocks concurrent page fetches', async () => {
    const pending = new Subject<{ items: StaffListItem[]; nextCursor?: string }>();
    api.listStaff
      .mockReturnValueOnce(of({ items: [member], nextCursor: 'staff-cursor-2' }))
      .mockReturnValueOnce(pending);
    const fixture = await create();

    fixture.componentInstance.loadMoreStaff();
    fixture.componentInstance.loadMoreStaff();
    expect(api.listStaff).toHaveBeenCalledTimes(2);
    pending.error(new Error('PAGE_FAILED'));

    expect(fixture.componentInstance.staff()?.items).toEqual([member]);
    expect(fixture.componentInstance.staffNextCursor()).toBe('staff-cursor-2');
    expect(fixture.componentInstance.staffPageError()).toBe(true);
    expect(fixture.componentInstance.staffLoadingMore()).toBe(false);
    fixture.destroy();
  });

  it('creates a global role invitation only after step-up and supplies an idempotency key', async () => {
    const fixture = await create();
    fixture.componentInstance.newDisplayName = 'New Operator';
    fixture.componentInstance.newEmail = 'new.operator@tyre.ge';
    fixture.componentInstance.newRoleIds = ['role-ops'];
    fixture.componentInstance.newMfaRequired = false;
    fixture.componentInstance.createStepUpCode = '123456';

    fixture.componentInstance.createStaff();

    expect(api.previewCreateStaff).toHaveBeenCalledWith({
      email: 'new.operator@tyre.ge',
      displayName: 'New Operator',
      mfaRequired: false,
      assignments: [{ roleId: 'role-ops', scopeType: 'global', scopeId: '' }],
    });
    expect(api.stepUp).toHaveBeenCalledWith('123456', 'server-action-hash');
    expect(api.createStaff).toHaveBeenCalledOnce();
    const [request, proof] = api.createStaff.mock.calls[0];
    expect(proof).toBe('step-up-token');
    expect(request).toMatchObject({
      email: 'new.operator@tyre.ge',
      displayName: 'New Operator',
      mfaRequired: true,
      assignments: [{ roleId: 'role-ops', scopeType: 'global', scopeId: '' }],
    });
    expect(request.idempotencyKey).toEqual(expect.any(String));
    expect(request.idempotencyKey.length).toBeGreaterThan(10);
    expect(fixture.componentInstance.createStepUpCode).toBe('');
    fixture.destroy();
  });

  it('uses a server preview before action-bound MFA recovery step-up', async () => {
    auth.hasPermission.mockImplementation(
      (permission: string) =>
        permission === 'staff.read' || permission === 'staff.recovery.request',
    );
    const fixture = await create();
    fixture.componentInstance.detailState.set('ready');
    fixture.componentInstance.recoveryReasonCode = 'security_incident';
    fixture.componentInstance.recoveryReason = 'Lost authenticator';
    fixture.componentInstance.recoveryStepUpCode = '654321';

    fixture.componentInstance.requestRecovery(member);

    expect(api.previewRecoveryRequest).toHaveBeenCalledWith(
      member.id,
      'security_incident',
      'Lost authenticator',
    );
    expect(api.stepUp).toHaveBeenCalledWith('654321', 'recovery-hash');
    expect(api.createRecoveryRequest).toHaveBeenCalledWith(
      member.id,
      'security_incident',
      'Lost authenticator',
      'step-up-token',
    );
    expect(fixture.componentInstance.notice()).toContain('recovery-1');
    expect(fixture.componentInstance.recoveryStepUpCode).toBe('');
    fixture.destroy();
  });

  it('exposes recovery-only controls without staff.manage and keeps status controls inaccessible', async () => {
    auth.hasPermission.mockImplementation(
      (permission: string) =>
        permission === 'staff.read' || permission === 'staff.recovery.request',
    );
    api.listStaff.mockReturnValueOnce(of({ items: [member] }));
    const fixture = await create();
    const host = fixture.nativeElement as HTMLElement;
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('მართვა'))!
      .click();
    fixture.detectChanges();

    expect(host.querySelector('#staff-action-step-up')).toBeNull();
    expect(host.querySelector('#staff-action-reason')).toBeNull();
    expect(host.querySelector('#staff-recovery-step-up')).not.toBeNull();
    expect(host.querySelector('#staff-recovery-reason')).not.toBeNull();
    expect(host.textContent).toContain('დამოუკიდებელი recovery workflow');
    fixture.destroy();
  });

  it('does not expose or invoke recovery without staff.recovery.request', async () => {
    auth.hasPermission.mockImplementation(
      (permission: string) => permission === 'staff.read' || permission === 'staff.manage',
    );
    api.listStaff.mockReturnValueOnce(of({ items: [nonMfaMember] }));
    api.staffDetail.mockReturnValueOnce(of(detailFor(nonMfaMember)));
    const fixture = await create();
    const host = fixture.nativeElement as HTMLElement;
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('მართვა'))!
      .click();
    fixture.detectChanges();
    expect(host.querySelector('#staff-recovery-step-up')).toBeNull();

    fixture.componentInstance.detailState.set('ready');
    fixture.componentInstance.recoveryReason = 'Lost authenticator';
    fixture.componentInstance.recoveryStepUpCode = '654321';
    fixture.componentInstance.requestRecovery(nonMfaMember);
    expect(api.previewRecoveryRequest).not.toHaveBeenCalled();
    expect(api.createRecoveryRequest).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('previews a status mutation before step-up and sends the returned one-time token', async () => {
    const fixture = await create();
    fixture.componentInstance.detailState.set('ready');
    fixture.componentInstance.actionReasonCode = 'security_incident';
    fixture.componentInstance.actionReason = 'Compromised device';
    fixture.componentInstance.stepUpCode = '123456';

    fixture.componentInstance.runAction(nonMfaMember, 'disable');

    expect(api.previewStaffAction).toHaveBeenCalledWith(
      nonMfaMember.id,
      'disable',
      nonMfaMember.version,
      'security_incident',
      'Compromised device',
    );
    expect(api.stepUp).toHaveBeenCalledWith('123456', 'status-hash');
    expect(api.staffAction).toHaveBeenCalledWith(
      nonMfaMember.id,
      'disable',
      nonMfaMember.version,
      'security_incident',
      'Compromised device',
      'step-up-token',
    );
    expect(fixture.componentInstance.stepUpCode).toBe('');
    fixture.destroy();
  });

  it('keeps create dialog modal, traps focus, blocks nested dialogs, and restores its trigger', async () => {
    const fixture = await create();
    const host = fixture.nativeElement as HTMLElement;
    const trigger = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('თანამშრომლის დამატება'),
    )!;
    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    await Promise.resolve();

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const pageContent = host.querySelector<HTMLElement>('.staff-page__content')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(pageContent.hasAttribute('inert')).toBe(true);
    expect(pageContent.getAttribute('aria-hidden')).toBe('true');
    expect((document.activeElement as HTMLElement).id).toBe('new-staff-name');

    fixture.componentInstance.openDetail(member, {
      currentTarget: document.createElement('button'),
    } as unknown as Event);
    expect(fixture.componentInstance.createOpen()).toBe(true);
    expect(fixture.componentInstance.selected()).toBeNull();

    const first = dialog.querySelector<HTMLInputElement>('#new-staff-name')!;
    const last = [...dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')].at(-1)!;
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(first);
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(last);

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await Promise.resolve();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fixture.destroy();
  });

  it('focuses the detail dialog and restores the row trigger after a successful action', async () => {
    api.listStaff.mockReturnValueOnce(of({ items: [nonMfaMember] }));
    api.staffDetail.mockReturnValueOnce(of(detailFor(nonMfaMember)));
    const fixture = await create();
    const host = fixture.nativeElement as HTMLElement;
    const trigger = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('მართვა'),
    )!;
    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(document.activeElement).toBe(host.querySelector('[role="dialog"] .quiet-button'));
    fixture.componentInstance.actionReasonCode = 'security_incident';
    fixture.componentInstance.actionReason = 'Compromised device';
    fixture.componentInstance.stepUpCode = '123456';
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('[role="dialog"] .danger-button')!.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(api.previewStaffAction).toHaveBeenCalledOnce();
    fixture.destroy();
  });

  it('makes roles read-only for staff managers without roles.assign and never starts role step-up', async () => {
    auth.hasPermission.mockImplementation((permission: string) => permission === 'staff.manage');
    api.listStaff.mockReturnValueOnce(of({ items: [member] }));
    const fixture = await create();
    const host = fixture.nativeElement as HTMLElement;
    const createButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('თანამშრომლის დამატება'),
    )!;
    expect(createButton.disabled).toBe(true);

    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('მართვა'))!
      .click();
    fixture.detectChanges();
    expect(
      host.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.disabled,
    ).toBe(true);
    expect(host.querySelector('#staff-role-step-up')).toBeNull();
    expect(host.textContent).toContain('როლები მხოლოდ სანახავადაა');

    fixture.componentInstance.roleStepUpCode = '123456';
    fixture.componentInstance.editRoleIds = ['role-ops'];
    fixture.componentInstance.saveAssignments(member);
    expect(api.previewRoleAssignments).not.toHaveBeenCalled();
    expect(api.stepUp).not.toHaveBeenCalled();
    expect(api.updateRoleAssignments).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('allows roles.assign without staff.manage to use only the role assignment workflow', async () => {
    auth.hasPermission.mockImplementation((permission: string) => permission === 'roles.assign');
    api.listStaff.mockReturnValueOnce(of({ items: [member] }));
    const fixture = await create();
    const host = fixture.nativeElement as HTMLElement;
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('მართვა'))!
      .click();
    fixture.detectChanges();

    expect(
      host.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!.disabled,
    ).toBe(false);
    expect(host.querySelector('#staff-role-step-up')).not.toBeNull();
    expect(host.querySelector('#staff-action-step-up')).toBeNull();
    fixture.componentInstance.roleStepUpCode = '654321';
    fixture.componentInstance.editRoleIds = ['role-ops'];
    fixture.componentInstance.saveAssignments(member);

    expect(api.previewRoleAssignments).toHaveBeenCalledWith(member.id, member.version, [
      { roleId: 'role-ops', scopeType: 'global', scopeId: '' },
    ]);
    expect(api.stepUp).toHaveBeenCalledWith('654321', 'assignment-hash');
    expect(api.updateRoleAssignments).toHaveBeenCalledWith(
      member.id,
      member.version,
      [{ roleId: 'role-ops', scopeType: 'global', scopeId: '' }],
      'step-up-token',
    );
    expect(fixture.componentInstance.roleStepUpCode).toBe('');
    fixture.destroy();
  });

  it('uses server legal states and keeps D-05 MFA disable fail-closed', async () => {
    const fixture = await create();
    expect(fixture.componentInstance.canResendInvitation(fixtureMember('invited', false))).toBe(
      true,
    );
    expect(
      fixture.componentInstance.canResendInvitation(fixtureMember('pending_activation', false)),
    ).toBe(true);
    expect(fixture.componentInstance.canResendInvitation(fixtureMember('active', false))).toBe(
      false,
    );
    expect(fixture.componentInstance.canDisable(fixtureMember('invited', false))).toBe(true);
    expect(fixture.componentInstance.canDisable(fixtureMember('pending_activation', false))).toBe(
      true,
    );
    expect(fixture.componentInstance.canDisable(fixtureMember('active', false))).toBe(true);
    expect(fixture.componentInstance.canDisable(fixtureMember('disabled', false))).toBe(false);
    expect(fixture.componentInstance.disableBlockedByPolicy(member)).toBe(true);

    fixture.componentInstance.detailState.set('ready');
    fixture.componentInstance.runAction(member, 'disable');
    expect(api.previewStaffAction).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('renders both legal pending-activation actions and no blocked transition', async () => {
    const pending = fixtureMember('pending_activation', false);
    api.listStaff.mockReturnValueOnce(of({ items: [pending] }));
    api.staffDetail.mockReturnValueOnce(of(detailFor(pending)));
    const fixture = await create();
    const host = fixture.nativeElement as HTMLElement;
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('მართვა'))!
      .click();
    fixture.detectChanges();

    const text = host.querySelector('[role="dialog"]')!.textContent;
    expect(text).toContain('გააქტიურება');
    expect(text).toContain('გამორთვა');
    expect(text).toContain('მოწვევის ხელახლა გაგზავნა');
    expect(text).not.toContain('ხელახლა ჩართვა');
    fixture.destroy();
  });

  it('resends eligible invitations with CAS, action-bound step-up, and a valid idempotency key', async () => {
    const invited = fixtureMember('invited', false);
    const fixture = await create();
    fixture.componentInstance.selected.set(invited);
    fixture.componentInstance.detailState.set('ready');
    fixture.componentInstance.actionReason = 'Operator requested another invite';
    fixture.componentInstance.stepUpCode = '123456';

    fixture.componentInstance.resendInvitation(invited);

    expect(api.previewInvitationResend).toHaveBeenCalledWith(
      invited.id,
      invited.version,
      'resend_requested',
      'Operator requested another invite',
    );
    expect(api.stepUp).toHaveBeenCalledWith('123456', 'resend-hash');
    expect(api.resendInvitation).toHaveBeenCalledOnce();
    const [staffId, expectedVersion, reasonCode, reasonComment, proof, idempotencyKey] = api
      .resendInvitation.mock.calls[0] as unknown as [
      string,
      number,
      string,
      string,
      string,
      string,
    ];
    expect({ staffId, expectedVersion, reasonCode, reasonComment, proof }).toEqual({
      staffId: invited.id,
      expectedVersion: invited.version,
      reasonCode: 'resend_requested',
      reasonComment: 'Operator requested another invite',
      proof: 'step-up-token',
    });
    expect(idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{16,128}$/);
    expect(fixture.componentInstance.selected()?.version).toBe(3);
    expect(fixture.componentInstance.stepUpCode).toBe('');
    fixture.destroy();
  });

  it('loads and revokes a target session with sessions.manage and advances target CAS version', async () => {
    auth.hasPermission.mockImplementation(
      (permission: string) =>
        permission === 'staff.manage' ||
        permission === 'roles.assign' ||
        permission === 'sessions.manage',
    );
    const session = {
      id: 'session-target',
      createdAt: '2026-07-29T10:00:00Z',
      lastSeenAt: '2026-07-30T09:00:00Z',
      idleExpiresAt: '2026-07-30T10:00:00Z',
      absoluteExpiresAt: '2026-08-10T10:00:00Z',
      revokedAt: null,
      deviceLabel: 'Warehouse tablet',
      browserFamily: 'Chrome',
      osFamily: 'Windows',
      mfaSatisfiedAt: '2026-07-29T10:00:00Z',
      authMethod: 'password+mfa',
    };
    api.listStaff.mockReturnValueOnce(of({ items: [nonMfaMember] }));
    api.staffDetail.mockReturnValueOnce(of(detailFor(nonMfaMember)));
    const secondSession = {
      ...session,
      id: 'session-second',
      deviceLabel: 'Dispatch laptop',
    };
    api.targetSessions
      .mockReturnValueOnce(of({ items: [session], nextCursor: 'session-cursor-2' }))
      .mockReturnValueOnce(
        of({
          items: [{ ...session, deviceLabel: 'Updated tablet' }, secondSession],
          nextCursor: undefined,
        }),
      );
    const fixture = await create();
    const host = fixture.nativeElement as HTMLElement;
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('მართვა'))!
      .click();
    fixture.detectChanges();

    expect(api.staffDetail).toHaveBeenCalledWith(nonMfaMember.id);
    expect(api.targetSessions).toHaveBeenCalledWith(nonMfaMember.id);
    expect(host.textContent).toContain('Warehouse tablet');
    fixture.componentInstance.loadMoreTargetSessions(fixture.componentInstance.selected()!);
    expect(api.targetSessions).toHaveBeenLastCalledWith(nonMfaMember.id, 'session-cursor-2');
    expect(fixture.componentInstance.targetSessions().map(({ id }) => id)).toEqual([
      session.id,
      secondSession.id,
    ]);
    expect(fixture.componentInstance.targetSessions()[0].deviceLabel).toBe('Updated tablet');
    expect(fixture.componentInstance.targetSessionsNextCursor()).toBeNull();
    fixture.componentInstance.stepUpCode = '654321';
    fixture.componentInstance.revokeTargetSession(fixture.componentInstance.selected()!, session);

    expect(api.previewTargetSessionRevoke).toHaveBeenCalledWith(
      nonMfaMember.id,
      session.id,
      nonMfaMember.version,
    );
    expect(api.stepUp).toHaveBeenCalledWith('654321', 'session-hash');
    expect(api.revokeTargetSession).toHaveBeenCalledWith(
      nonMfaMember.id,
      session.id,
      nonMfaMember.version,
      'step-up-token',
    );
    expect(fixture.componentInstance.selected()?.version).toBe(3);
    expect(fixture.componentInstance.targetSessions()[0].revokedAt).not.toBeNull();
    expect(fixture.componentInstance.targetSessions()).toHaveLength(2);
    expect(fixture.componentInstance.stepUpCode).toBe('');
    fixture.destroy();
  });

  it('retains target sessions and cursor on page error while preventing concurrent calls', async () => {
    auth.hasPermission.mockImplementation(
      (permission: string) => permission === 'staff.read' || permission === 'sessions.manage',
    );
    const pending = new Subject<{
      items: TargetStaffSessionItem[];
      nextCursor?: string;
    }>();
    const session: TargetStaffSessionItem = {
      id: 'session-target',
      createdAt: '2026-07-29T10:00:00Z',
      lastSeenAt: '2026-07-30T09:00:00Z',
      idleExpiresAt: '2026-07-30T10:00:00Z',
      absoluteExpiresAt: '2026-08-10T10:00:00Z',
      revokedAt: null,
      deviceLabel: 'Warehouse tablet',
      browserFamily: 'Chrome',
      osFamily: 'Windows',
      mfaSatisfiedAt: null,
      authMethod: 'password',
    };
    api.listStaff.mockReturnValueOnce(of({ items: [member], nextCursor: undefined }));
    api.targetSessions
      .mockReturnValueOnce(of({ items: [session], nextCursor: 'session-cursor-2' }))
      .mockReturnValueOnce(pending);
    const fixture = await create();
    fixture.componentInstance.openDetail(member);
    fixture.componentInstance.loadMoreTargetSessions(fixture.componentInstance.selected()!);
    fixture.componentInstance.loadMoreTargetSessions(fixture.componentInstance.selected()!);
    expect(api.targetSessions).toHaveBeenCalledTimes(2);
    pending.error(new Error('PAGE_FAILED'));

    expect(fixture.componentInstance.targetSessions()).toEqual([session]);
    expect(fixture.componentInstance.targetSessionsNextCursor()).toBe('session-cursor-2');
    expect(fixture.componentInstance.targetSessionsPageError()).toBe(true);
    fixture.destroy();
  });

  it('prevents new D-05-blocked role assignment before preview or step-up', async () => {
    api.listRoles.mockReturnValueOnce(
      of({
        items: [
          {
            id: 'role-owner',
            key: 'owner',
            name: 'Owner',
            description: 'Privileged role',
            isSystem: true,
            permissions: ['staff.manage'],
            mfaRequired: true,
            assignmentAllowed: false,
            blockReasonCode: 'PRIVILEGED_ASSIGNMENT_POLICY_DISABLED' as const,
          },
        ],
        scopeTypes: ['global'],
      }),
    );
    const fixture = await create();
    fixture.componentInstance.newDisplayName = 'Blocked Owner';
    fixture.componentInstance.newEmail = 'blocked@tyre.ge';
    fixture.componentInstance.newRoleIds = ['role-owner'];
    fixture.componentInstance.createStepUpCode = '123456';

    expect(fixture.componentInstance.createReady()).toBe(false);
    fixture.componentInstance.createStaff();
    expect(api.previewCreateStaff).not.toHaveBeenCalled();
    expect(api.stepUp).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('checks recovery approval state and expiry before action-bound step-up', async () => {
    const fixture = await create();
    fixture.componentInstance.approvalRequestId = 'recovery-1';
    fixture.componentInstance.approvalStepUpCode = '123456';

    fixture.componentInstance.approveRecovery();

    expect(api.previewRecoveryApproval).toHaveBeenCalledWith('recovery-1');
    expect(api.stepUp).toHaveBeenCalledWith('123456', 'approval-hash');
    expect(api.approveRecoveryRequest).toHaveBeenCalledWith('recovery-1', 'step-up-token');
    expect(fixture.componentInstance.notice()).toContain('pending activation');
    expect(fixture.componentInstance.approvalStepUpCode).toBe('');
    fixture.destroy();
  });

  it('clears every staff one-time code after terminal failure responses', async () => {
    const fixture = await create();
    fixture.componentInstance.detailState.set('ready');

    api.previewCreateStaff.mockReturnValueOnce(throwError(() => new Error('FAILED')));
    fixture.componentInstance.newDisplayName = 'New Operator';
    fixture.componentInstance.newEmail = 'new.operator@tyre.ge';
    fixture.componentInstance.newRoleIds = ['role-ops'];
    fixture.componentInstance.createStepUpCode = '111111';
    fixture.componentInstance.createStaff();
    expect(fixture.componentInstance.createStepUpCode).toBe('');

    api.previewRoleAssignments.mockReturnValueOnce(throwError(() => new Error('FAILED')));
    fixture.componentInstance.detailState.set('ready');
    fixture.componentInstance.editRoleIds = ['role-ops'];
    fixture.componentInstance.roleStepUpCode = '222222';
    fixture.componentInstance.saveAssignments(member);
    expect(fixture.componentInstance.roleStepUpCode).toBe('');

    api.previewStaffAction.mockReturnValueOnce(throwError(() => new Error('FAILED')));
    fixture.componentInstance.detailState.set('ready');
    fixture.componentInstance.stepUpCode = '333333';
    fixture.componentInstance.runAction(nonMfaMember, 'disable');
    expect(fixture.componentInstance.stepUpCode).toBe('');

    api.previewInvitationResend.mockReturnValueOnce(throwError(() => new Error('FAILED')));
    fixture.componentInstance.detailState.set('ready');
    fixture.componentInstance.actionReason = 'Resend requested';
    fixture.componentInstance.stepUpCode = '343434';
    fixture.componentInstance.resendInvitation(fixtureMember('invited', false));
    expect(fixture.componentInstance.stepUpCode).toBe('');

    auth.hasPermission.mockImplementation(
      (permission: string) =>
        permission === 'staff.manage' ||
        permission === 'roles.assign' ||
        permission === 'sessions.manage',
    );
    api.previewTargetSessionRevoke.mockReturnValueOnce(throwError(() => new Error('FAILED')));
    fixture.componentInstance.detailState.set('ready');
    fixture.componentInstance.stepUpCode = '353535';
    fixture.componentInstance.revokeTargetSession(member, {
      id: 'session-failed',
      createdAt: '2026-07-29T10:00:00Z',
      lastSeenAt: '2026-07-30T09:00:00Z',
      idleExpiresAt: '2026-07-30T10:00:00Z',
      absoluteExpiresAt: '2026-08-10T10:00:00Z',
      revokedAt: null,
      deviceLabel: null,
      browserFamily: null,
      osFamily: null,
      mfaSatisfiedAt: null,
      authMethod: 'password',
    });
    expect(fixture.componentInstance.stepUpCode).toBe('');

    api.previewRecoveryRequest.mockReturnValueOnce(throwError(() => new Error('FAILED')));
    auth.hasPermission.mockImplementation(
      (permission: string) =>
        permission === 'staff.manage' ||
        permission === 'roles.assign' ||
        permission === 'staff.recovery.request',
    );
    fixture.componentInstance.detailState.set('ready');
    fixture.componentInstance.recoveryReason = 'Lost authenticator';
    fixture.componentInstance.recoveryStepUpCode = '444444';
    fixture.componentInstance.requestRecovery(member);
    expect(fixture.componentInstance.recoveryStepUpCode).toBe('');

    api.previewRecoveryApproval.mockReturnValueOnce(throwError(() => new Error('FAILED')));
    fixture.componentInstance.approvalRequestId = 'recovery-1';
    fixture.componentInstance.approvalStepUpCode = '555555';
    fixture.componentInstance.approveRecovery();
    expect(fixture.componentInstance.approvalStepUpCode).toBe('');
    fixture.destroy();
  });
});

function fixtureMember(status: StaffListItem['status'], mfaRequired: boolean): StaffListItem {
  return {
    id: `staff-${status}`,
    email: `${status}@tyre.ge`,
    displayName: status,
    status,
    mfaRequired,
    mfaEnrolled: mfaRequired,
    lastActivityAt: null,
    version: 2,
    assignments: [
      {
        role: { id: 'role-ops', key: 'ops', name: 'Operations' },
        scopeType: 'global',
        scopeId: '',
      },
    ],
  };
}
