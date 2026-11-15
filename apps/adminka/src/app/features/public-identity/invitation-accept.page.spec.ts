import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { IdentityApiService } from '../../core/identity-api.service';
import { InvitationAcceptPage } from './invitation-accept.page';

const TOKEN = `selector.${'s'.repeat(60)}`;

describe('InvitationAcceptPage', () => {
  let fixture: ComponentFixture<InvitationAcceptPage>;
  let fragment: string | null;
  let enrollmentOnly: boolean;
  const api = {
    config: { apiBaseUrl: '/admin/v1', enabled: true },
    inspectInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
    startMfaEnrollment: vi.fn(),
    confirmMfaEnrollment: vi.fn(),
  };

  beforeEach(() => {
    fragment = TOKEN;
    enrollmentOnly = false;
    api.config.enabled = true;
    api.inspectInvitation.mockReset();
    api.acceptInvitation.mockReset();
    api.startMfaEnrollment.mockReset();
    api.confirmMfaEnrollment.mockReset();
  });

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [InvitationAcceptPage],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get data() { return { enrollmentOnly }; },
              get fragment() {
                return fragment;
              },
            },
          },
        },
        { provide: IdentityApiService, useValue: api },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(InvitationAcceptPage);
    fixture.detectChanges();
    await Promise.resolve();
  }

  afterEach(() => fixture?.destroy());

  it('resumes supervised MFA setup without resetting the accepted password, and removes expired QR', async () => {
    enrollmentOnly = true;
    api.startMfaEnrollment.mockReturnValue(of({
      enrollmentToken: 'memory-enrollment',
      otpauthUri: 'otpauth://totp/tyre?secret=JBSWY3DPEHPK3PXP',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }));
    await create();
    expect(api.inspectInvitation).not.toHaveBeenCalled();
    expect(api.acceptInvitation).not.toHaveBeenCalled();
    expect(api.startMfaEnrollment).toHaveBeenCalledWith(TOKEN);
    expect(fixture.componentInstance.manualSetupKey()).toBe('JBSWY3DPEHPK3PXP');
    expect(fixture.nativeElement.querySelector('adm-authenticator-qr svg')).not.toBeNull();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.now() + 301_000));
      (fixture.componentInstance as any).updateExpiry();
      fixture.detectChanges();
      expect(fixture.componentInstance.enrollment()).toBeNull();
      expect(fixture.nativeElement.querySelector('adm-authenticator-qr')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('clears the fragment, inspects the opaque token and focuses password entry', async () => {
    const replace = vi.spyOn(history, 'replaceState');
    api.inspectInvitation.mockReturnValue(
      of({ purpose: 'invite', expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
    );

    await create();

    expect(replace).toHaveBeenCalled();
    expect(api.inspectInvitation).toHaveBeenCalledWith(TOKEN);
    expect(fixture.componentInstance.state()).toBe('ready');
    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('#invite-password'),
    );
    replace.mockRestore();
  });

  it('rejects an expired invite before password submission', async () => {
    api.inspectInvitation.mockReturnValue(
      of({ purpose: 'invite', expiresAt: new Date(Date.now() - 1_000).toISOString() }),
    );

    await create();

    expect(fixture.componentInstance.state()).toBe('expired');
    fixture.componentInstance.form.setValue({
      password: 'long-private-password',
      confirmation: 'long-private-password',
    });
    fixture.componentInstance.accept();
    expect(api.acceptInvitation).not.toHaveBeenCalled();
  });

  it('accepts the same one-time landing contract for approved administrative recovery', async () => {
    api.inspectInvitation.mockReturnValue(
      of({ purpose: 'recovery', expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    );

    await create();

    expect(fixture.componentInstance.state()).toBe('ready');
    expect(fixture.componentInstance.flowPurpose()).toBe('recovery');
    expect(fixture.nativeElement.textContent).toContain('MFA recovery');
  });

  it('runs invite → MFA enrollment → one-time recovery codes → pending activation in memory', async () => {
    api.inspectInvitation.mockReturnValue(
      of({ purpose: 'invite', expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
    );
    api.acceptInvitation.mockReturnValue(
      of({ status: 'pending_activation', mfaRequired: true, activationProof: 'memory-proof' }),
    );
    api.startMfaEnrollment.mockReturnValue(
      of({
        enrollmentToken: 'memory-enrollment-token',
        otpauthUri: 'otpauth://totp/tyre-ops?secret=one-time',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    );
    api.confirmMfaEnrollment.mockReturnValue(
      of({ confirmed: true, recoveryCodes: ['recovery-a', 'recovery-b'] }),
    );
    await create();
    fixture.componentInstance.form.setValue({
      password: 'long-private-password',
      confirmation: 'long-private-password',
    });

    fixture.componentInstance.accept();
    fixture.detectChanges();
    await Promise.resolve();

    expect(api.acceptInvitation).toHaveBeenCalledWith(TOKEN, 'long-private-password');
    expect(api.startMfaEnrollment).toHaveBeenCalledWith('memory-proof');
    expect(fixture.componentInstance.state()).toBe('mfa');
    expect(fixture.componentInstance.mfaRequired()).toBe(true);
    expect(fixture.nativeElement.querySelector('adm-authenticator-qr svg')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('memory-proof');
    fixture.componentInstance.mfaForm.setValue({ code: '123456' });

    fixture.componentInstance.confirmMfa();
    fixture.detectChanges();
    await Promise.resolve();

    expect(api.confirmMfaEnrollment).toHaveBeenCalledWith('memory-enrollment-token', '123456');
    expect(fixture.componentInstance.state()).toBe('recovery');
    expect(fixture.nativeElement.querySelector('adm-authenticator-qr')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('recovery-a');
    const recoveryRegion = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[role="region"]',
    )!;
    expect(recoveryRegion.tabIndex).toBe(-1);
    expect(recoveryRegion.getAttribute('aria-live')).toBe('assertive');
    expect(recoveryRegion.getAttribute('aria-atomic')).toBe('true');
    expect(document.activeElement).toBe(recoveryRegion);
    fixture.componentInstance.finishRecovery();
    expect(fixture.componentInstance.state()).toBe('recovery');
    fixture.componentInstance.codesSaved = true;
    fixture.componentInstance.finishRecovery();
    fixture.detectChanges();
    await Promise.resolve();

    expect(fixture.componentInstance.state()).toBe('pending');
    expect(fixture.componentInstance.recoveryCodes()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('recovery-a');
    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('[role="status"]'),
    );
  });

  it('fails closed when the enrollment token is already expired', async () => {
    api.inspectInvitation.mockReturnValue(
      of({ purpose: 'invite', expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
    );
    api.acceptInvitation.mockReturnValue(
      of({ status: 'pending_activation', mfaRequired: true, activationProof: 'memory-proof' }),
    );
    api.startMfaEnrollment.mockReturnValue(
      of({
        enrollmentToken: 'expired-enrollment-token',
        otpauthUri: 'otpauth://totp/expired',
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    );
    await create();
    fixture.componentInstance.form.setValue({
      password: 'long-private-password',
      confirmation: 'long-private-password',
    });

    fixture.componentInstance.accept();

    expect(fixture.componentInstance.state()).toBe('expired');
    fixture.componentInstance.mfaForm.setValue({ code: '123456' });
    fixture.componentInstance.confirmMfa();
    expect(api.confirmMfaEnrollment).not.toHaveBeenCalled();
  });

  it('keeps stable password errors wired to invalid fields and exposes disabled-submit remedies', async () => {
    api.inspectInvitation.mockReturnValue(
      of({ purpose: 'invite', expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
    );
    await create();
    const host = fixture.nativeElement as HTMLElement;
    const password = host.querySelector<HTMLInputElement>('#invite-password')!;
    const confirmation = host.querySelector<HTMLInputElement>('#invite-password-confirm')!;
    const passwordError = host.querySelector<HTMLElement>('#invite-password-error')!;
    const confirmationError = host.querySelector<HTMLElement>('#invite-confirmation-error')!;

    expect(password.getAttribute('aria-describedby')).toBe(
      'invite-password-hint invite-password-error',
    );
    expect(confirmation.getAttribute('aria-describedby')).toBe(
      'invite-confirmation-hint invite-confirmation-error',
    );
    expect(passwordError.hidden).toBe(true);
    expect(confirmationError.hidden).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);

    fixture.componentInstance.form.setValue({
      password: 'short',
      confirmation: 'different-password',
    });
    fixture.componentInstance.form.markAllAsTouched();
    fixture.detectChanges();
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(confirmation.getAttribute('aria-invalid')).toBe('true');
    expect(passwordError.hidden).toBe(false);
    expect(passwordError.textContent).toContain('მინიმუმ 12');
    expect(confirmationError.hidden).toBe(false);
    expect(confirmationError.textContent).toContain('არ ემთხვევა');

    fixture.componentInstance.form.reset();
    fixture.componentInstance.accept();
    fixture.detectChanges();
    expect(fixture.componentInstance.submitAttempted()).toBe(true);
    expect(passwordError.hidden).toBe(false);
    expect(confirmationError.hidden).toBe(false);
    expect(api.acceptInvitation).not.toHaveBeenCalled();
  });

  it('wires the MFA field to a stable exact-format error', async () => {
    api.inspectInvitation.mockReturnValue(
      of({ purpose: 'invite', expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
    );
    api.acceptInvitation.mockReturnValue(
      of({ status: 'pending_activation', mfaRequired: true, activationProof: 'memory-proof' }),
    );
    api.startMfaEnrollment.mockReturnValue(
      of({
        enrollmentToken: 'memory-enrollment-token',
        otpauthUri: 'otpauth://totp/tyre-ops?secret=one-time',
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    );
    await create();
    fixture.componentInstance.form.setValue({
      password: 'long-private-password',
      confirmation: 'long-private-password',
    });
    fixture.componentInstance.accept();
    fixture.detectChanges();
    fixture.componentInstance.mfaForm.controls.code.setValue('12ab');
    fixture.componentInstance.mfaForm.controls.code.markAsTouched();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>('#invite-mfa-code')!;
    const error = host.querySelector<HTMLElement>('#invite-mfa-code-error')!;
    expect(input.getAttribute('aria-describedby')).toBe(
      'invite-mfa-code-hint invite-mfa-code-error',
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain('ზუსტად 6 ციფრს');
  });

  it('fails closed and does not inspect a token while identity-v2 is disabled', async () => {
    api.config.enabled = false;
    await create();

    expect(fixture.componentInstance.state()).toBe('unavailable');
    expect(api.inspectInvitation).not.toHaveBeenCalled();
  });
});
