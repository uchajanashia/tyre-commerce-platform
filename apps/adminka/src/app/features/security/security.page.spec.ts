import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';

import { AuthService } from '../../core/auth.service';
import { IdentityApiService } from '../../core/identity-api.service';
import { StaffSessionItem, StaffSessionList } from '../../core/identity-contract';
import { SecurityPage } from './security.page';

const SESSION: StaffSessionItem = {
  id: 'session-current',
  current: true,
  deviceLabel: 'Operations laptop',
  createdAt: '2026-07-29T10:00:00.000Z',
  lastSeenAt: '2026-07-29T11:00:00.000Z',
  idleExpiresAt: '2026-07-29T12:00:00.000Z',
  absoluteExpiresAt: '2026-08-01T10:00:00.000Z',
  mfaSatisfiedAt: '2026-07-29T10:00:00.000Z',
  authMethod: 'totp',
};

const OTHER_SESSION: StaffSessionItem = {
  ...SESSION,
  id: 'session-other',
  current: false,
  deviceLabel: 'Warehouse tablet',
};

describe('SecurityPage', () => {
  const api = {
    sessions: vi.fn(
      (_cursor?: string): Observable<StaffSessionList> =>
        of({ items: [SESSION, OTHER_SESSION], currentSessionId: SESSION.id }),
    ),
    revokeSession: vi.fn(() => of(undefined)),
    startMfaEnrollment: vi.fn(() =>
      of({
        enrollmentToken: 'enrollment-secret',
        otpauthUri: 'otpauth://totp/tyre',
        expiresAt: '2026-07-29T12:00:00.000Z',
      }),
    ),
    confirmMfaEnrollment: vi.fn(() =>
      of({ confirmed: true, recoveryCodes: ['one-use-a', 'one-use-b'] }),
    ),
    stepUp: vi.fn(() => of({ stepUpProof: 'proof', expiresAt: '2026-07-29T12:00:00.000Z' })),
    revokeAll: vi.fn(() => of(undefined)),
  };
  const auth = {
    identityV2Enabled: true,
    csrfToken: vi.fn(() => of('csrf')),
    clearLocalSession: vi.fn(),
  };

  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockClear());
    auth.identityV2Enabled = true;
    auth.csrfToken.mockClear();
    auth.clearLocalSession.mockClear();
  });

  async function create(): Promise<ComponentFixture<SecurityPage>> {
    await TestBed.configureTestingModule({
      imports: [SecurityPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: IdentityApiService, useValue: api },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(SecurityPage);
    fixture.detectChanges();
    return fixture;
  }

  it('shows a truthful unavailable state without making session calls when disabled', async () => {
    auth.identityV2Enabled = false;
    const fixture = await create();

    expect(fixture.componentInstance.sessionsState()).toBe('unavailable');
    expect(api.sessions).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
    fixture.destroy();
  });

  it('revokes the current session with CSRF and clears the local identity', async () => {
    const fixture = await create();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');

    fixture.componentInstance.confirmRevoke(SESSION);
    await Promise.resolve();

    expect(auth.csrfToken).toHaveBeenCalledOnce();
    expect(api.revokeSession).toHaveBeenCalledWith(SESSION.id, 'csrf');
    expect(auth.clearLocalSession).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/login']);
    fixture.destroy();
  });

  it('renders unsupported security actions as disabled foundation without secret inputs or calls', async () => {
    const fixture = await create();
    const element = fixture.nativeElement as HTMLElement;
    const disabled = [...element.querySelectorAll<HTMLButtonElement>('button:disabled')];

    expect(element.querySelector('#enrollment-code')).toBeNull();
    expect(element.querySelector('#revoke-all-code')).toBeNull();
    expect(element.querySelector('input[autocomplete="one-time-code"]')).toBeNull();
    expect(disabled.some((button) => button.textContent?.includes('Authenticator'))).toBe(true);
    expect(disabled.some((button) => button.textContent?.includes('ყველა სესიის'))).toBe(true);
    expect(api.startMfaEnrollment).not.toHaveBeenCalled();
    expect(api.confirmMfaEnrollment).not.toHaveBeenCalled();
    expect(api.stepUp).not.toHaveBeenCalled();
    expect(api.revokeAll).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('contains revoke focus, blocks nested dialogs and restores the initiating control on cancel and success', async () => {
    const fixture = await create();
    const element = fixture.nativeElement as HTMLElement;
    const triggers = [...element.querySelectorAll<HTMLButtonElement>('.session-row .danger-text')];
    const currentTrigger = triggers[0];
    const otherTrigger = triggers[1];

    otherTrigger.click();
    fixture.detectChanges();
    await Promise.resolve();

    const background = element.querySelector<HTMLElement>('.security-page__content');
    const dialog = element.querySelector<HTMLElement>('[role="alertdialog"]');
    const controls = [...dialog!.querySelectorAll<HTMLButtonElement>('button')];
    const confirm = controls[0];
    const cancel = controls[1];
    expect(background?.hasAttribute('inert')).toBe(true);
    expect(background?.getAttribute('aria-hidden')).toBe('true');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(confirm);

    fixture.componentInstance.requestRevoke(SESSION, {
      currentTarget: currentTrigger,
    } as unknown as Event);
    expect(fixture.componentInstance.confirmingSession()?.id).toBe(OTHER_SESSION.id);

    cancel.focus();
    dialog?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(confirm);
    confirm.focus();
    dialog?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(cancel);

    dialog?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    await Promise.resolve();
    expect(element.querySelector('[role="alertdialog"]')).toBeNull();
    expect(background?.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(otherTrigger);

    otherTrigger.click();
    fixture.detectChanges();
    await Promise.resolve();
    element.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')[1]?.click();
    fixture.detectChanges();
    await Promise.resolve();
    expect(element.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(otherTrigger);

    otherTrigger.click();
    fixture.detectChanges();
    await Promise.resolve();
    element.querySelector<HTMLButtonElement>('[role="alertdialog"] .danger-button')?.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(api.revokeSession).toHaveBeenCalledWith(OTHER_SESSION.id, 'csrf');
    expect(element.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(otherTrigger);
    expect(otherTrigger.getAttribute('aria-disabled')).toBe('true');
    fixture.destroy();
  });

  it('loads cursor pages, deduplicates sessions, announces the end, and preserves focus', async () => {
    api.sessions
      .mockReturnValueOnce(
        of({ items: [SESSION], nextCursor: 'cursor-2', currentSessionId: SESSION.id }),
      )
      .mockReturnValueOnce(
        of({
          items: [{ ...SESSION, deviceLabel: 'Updated laptop' }, OTHER_SESSION],
          nextCursor: undefined,
          currentSessionId: SESSION.id,
        }),
      );
    const fixture = await create();
    const host = fixture.nativeElement as HTMLElement;
    const loadMore = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('მეტი სესიის'),
    )!;
    loadMore.focus();
    loadMore.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(api.sessions).toHaveBeenNthCalledWith(2, 'cursor-2');
    expect(fixture.componentInstance.sessions()?.items.map(({ id }) => id)).toEqual([
      SESSION.id,
      OTHER_SESSION.id,
    ]);
    expect(fixture.componentInstance.sessions()?.items[0].deviceLabel).toBe('Updated laptop');
    expect(fixture.componentInstance.sessionsNextCursor()).toBeNull();
    expect(host.textContent).toContain('ყველა სესია ჩატვირთულია');
    expect(document.activeElement).toBe(host.querySelector('.identity-pagination'));
    fixture.componentInstance.confirmRevoke(OTHER_SESSION);
    expect(fixture.componentInstance.isRevoked(OTHER_SESSION.id)).toBe(true);
    expect(fixture.componentInstance.sessions()?.items).toHaveLength(2);
    fixture.destroy();
  });

  it('retains loaded sessions on page error, blocks concurrent fetches, retries, and resets cleanly', async () => {
    const pendingPage = new Subject<ReturnType<typeof sessionPage>>();
    api.sessions
      .mockReturnValueOnce(of(sessionPage([SESSION], 'cursor-2')))
      .mockReturnValueOnce(pendingPage)
      .mockReturnValueOnce(throwError(() => new Error('PAGE_FAILED')))
      .mockReturnValueOnce(of(sessionPage([OTHER_SESSION], undefined)))
      .mockReturnValueOnce(of(sessionPage([OTHER_SESSION], undefined)));
    const fixture = await create();

    fixture.componentInstance.loadMoreSessions();
    fixture.componentInstance.loadMoreSessions();
    expect(api.sessions).toHaveBeenCalledTimes(2);
    pendingPage.error(new Error('PAGE_FAILED'));
    expect(fixture.componentInstance.sessions()?.items).toEqual([SESSION]);
    expect(fixture.componentInstance.sessionsPageError()).toBe(true);
    expect(fixture.componentInstance.sessionsNextCursor()).toBe('cursor-2');

    fixture.componentInstance.loadMoreSessions();
    expect(fixture.componentInstance.sessions()?.items.map(({ id }) => id)).toEqual([SESSION.id]);
    expect(fixture.componentInstance.sessionsPageError()).toBe(true);
    fixture.componentInstance.loadMoreSessions();
    expect(fixture.componentInstance.sessions()?.items.map(({ id }) => id)).toEqual([
      SESSION.id,
      OTHER_SESSION.id,
    ]);

    fixture.componentInstance.loadSessions();
    expect(api.sessions).toHaveBeenLastCalledWith();
    expect(fixture.componentInstance.sessions()?.items).toEqual([OTHER_SESSION]);
    expect(fixture.componentInstance.sessionsNextCursor()).toBeNull();
    expect(fixture.componentInstance.sessionsPageError()).toBe(false);
    fixture.destroy();
  });
});

function sessionPage(items: StaffSessionItem[], nextCursor?: string) {
  return { items, nextCursor, currentSessionId: SESSION.id };
}
