import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AdminInfo } from '@tyre/shared';

import { AuthService } from '../../core/auth.service';
import { MfaRequiredLoginResult } from '../../core/identity-contract';
import { LoginPage } from './login.page';

const STAFF: AdminInfo = {
  id: 'staff-1',
  email: 'ops@tyre.ge',
  role: 'admin',
  enabled: true,
  permissions: ['*'],
  permissionGrants: [{ permission: '*', scopeType: 'global', scopeId: '' }],
};

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  const pendingMfa = signal<MfaRequiredLoginResult | null>(null);
  const auth = {
    pendingMfa,
    login: vi.fn(),
    completeMfa: vi.fn(),
    cancelMfa: vi.fn(() => pendingMfa.set(null)),
  };

  beforeEach(async () => {
    pendingMfa.set(null);
    auth.login.mockReset();
    auth.completeMfa.mockReset();
    auth.cancelMfa.mockClear();
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('moves a discriminated login challenge to MFA and focuses its code field', async () => {
    const challenge: MfaRequiredLoginResult = {
      status: 'mfa_required',
      challengeToken: 'memory-only-challenge',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    auth.login.mockImplementation(() => {
      pendingMfa.set(challenge);
      return of(challenge);
    });
    fixture.componentInstance.loginForm.setValue({
      email: 'ops@tyre.ge',
      password: 'private-password',
    });

    fixture.componentInstance.submitPassword();
    fixture.detectChanges();
    await Promise.resolve();

    expect(fixture.componentInstance.mode()).toBe('mfa');
    expect(fixture.componentInstance.loginForm.controls.password.value).toBe('');
    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#mfa-code'),
    );
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#mfa-code',
    )!;
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('numeric');
    expect(input.pattern).toBe('[0-9]{6}');
    expect(input.autocomplete).toBe('one-time-code');
  });

  it('switches to a text-capable accessible recovery-code input and validates exact base64url', async () => {
    fixture.componentInstance.mode.set('mfa');
    fixture.componentInstance.remainingSeconds.set(300);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLInputElement>('input[value="recovery"]')!.click();
    fixture.detectChanges();
    await Promise.resolve();

    const input = host.querySelector<HTMLInputElement>('#mfa-code')!;
    expect(fixture.componentInstance.mfaCodeMode()).toBe('recovery');
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('text');
    expect(input.pattern).toBe('[A-Za-z0-9_-]{22}');
    expect(input.autocomplete).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('aria-describedby')).toContain('mfa-code-help');
    expect(document.activeElement).toBe(input);

    fixture.componentInstance.mfaForm.controls.code.setValue('123456');
    expect(fixture.componentInstance.mfaForm.invalid).toBe(true);
    fixture.componentInstance.mfaForm.controls.code.setValue('AbcdEFGHij_klmnop-1234');
    expect(fixture.componentInstance.mfaForm.valid).toBe(true);
  });

  it('submits letters, underscore, and hyphen unchanged in recovery mode', () => {
    auth.completeMfa.mockReturnValue(of({ status: 'authenticated' }));
    fixture.componentInstance.mode.set('mfa');
    fixture.componentInstance.remainingSeconds.set(300);
    fixture.componentInstance.selectMfaCodeMode('recovery');
    const recoveryCode = 'AbcdEFGHij_klmnop-1234';
    fixture.componentInstance.mfaForm.controls.code.setValue(recoveryCode);

    fixture.componentInstance.submitMfa();

    expect(auth.completeMfa).toHaveBeenCalledWith(recoveryCode);
  });

  it('returns an expired challenge to password entry without navigating', async () => {
    pendingMfa.set({
      status: 'mfa_required',
      challengeToken: 'expired',
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
    auth.completeMfa.mockReturnValue(throwError(() => new Error('MFA_CHALLENGE_EXPIRED')));
    fixture.componentInstance.mode.set('mfa');
    fixture.componentInstance.mfaForm.setValue({ code: '123456' });
    fixture.detectChanges();

    fixture.componentInstance.submitMfa();
    fixture.detectChanges();
    await Promise.resolve();

    expect(fixture.componentInstance.mode()).toBe('password');
    expect(auth.cancelMfa).toHaveBeenCalledOnce();
    expect(TestBed.inject(Router).url).toBe('/');
    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#login-email'),
    );
  });

  it('navigates only after an authenticated result', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    auth.login.mockReturnValue(
      of({
        status: 'authenticated',
        accessToken: 'memory-token',
        accessExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        staff: STAFF,
      }),
    );
    fixture.componentInstance.loginForm.setValue({
      email: 'ops@tyre.ge',
      password: 'private-password',
    });

    fixture.componentInstance.submitPassword();

    expect(navigate).toHaveBeenCalledWith('/');
  });
});
