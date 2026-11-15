import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { IdentityApiService } from '../../core/identity-api.service';
import { PasswordResetPage } from './password-reset.page';

const TOKEN = `selector.${'r'.repeat(60)}`;

describe('PasswordResetPage', () => {
  let fixture: ComponentFixture<PasswordResetPage>;
  let fragment: string | null;
  const api = {
    config: { apiBaseUrl: '/admin/v1', enabled: true, passwordResetDelivery: 'email' as 'manual' | 'email' },
    inspectInvitation: vi.fn(),
    requestPasswordReset: vi.fn(),
    completePasswordReset: vi.fn(),
  };

  beforeEach(() => {
    fragment = null;
    api.config.enabled = true;
    api.config.passwordResetDelivery = 'email';
    Object.values(api)
      .filter((value) => typeof value === 'function')
      .forEach((mock) => (mock as ReturnType<typeof vi.fn>).mockReset());
  });

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [PasswordResetPage],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get fragment() {
                return fragment;
              },
            },
          },
        },
        { provide: IdentityApiService, useValue: api },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(PasswordResetPage);
    fixture.detectChanges();
    await Promise.resolve();
  }

  afterEach(() => fixture?.destroy());

  it('does not promise an email when delivery is manual, regardless of account existence', async () => {
    api.config.passwordResetDelivery = 'manual';
    api.requestPasswordReset.mockReturnValue(of({ accepted: true }));
    await create();
    fixture.componentInstance.requestForm.setValue({ email: 'possibly-missing@tyre.ge' });
    fixture.componentInstance.requestReset();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('ამ გარემოში წერილი არ იგზავნება');
    expect(fixture.nativeElement.textContent).not.toContain('ინსტრუქცია გაიგზავნება');
    expect(fixture.nativeElement.textContent).not.toContain('possibly-missing@tyre.ge');
  });

  it('focuses the email request and always renders non-enumerating success copy', async () => {
    api.requestPasswordReset.mockReturnValue(of({ accepted: true }));
    await create();
    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('#reset-email'),
    );
    fixture.componentInstance.requestForm.setValue({ email: 'possibly-missing@tyre.ge' });

    fixture.componentInstance.requestReset();
    fixture.detectChanges();
    await Promise.resolve();

    const text = fixture.nativeElement.textContent as string;
    expect(api.requestPasswordReset).toHaveBeenCalledWith('possibly-missing@tyre.ge');
    expect(text).toContain('თუ ამ ელფოსტით აქტიური ანგარიში არსებობს');
    expect(text).not.toContain('possibly-missing@tyre.ge');
    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('[role="status"]'),
    );
  });

  it('keeps a stable email error and exposes the remedy when submit is disabled', async () => {
    await create();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>('#reset-email')!;
    const error = host.querySelector<HTMLElement>('#reset-email-error')!;
    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(input.getAttribute('aria-describedby')).toBe('reset-email-hint reset-email-error');
    expect(error.hidden).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(host.querySelector('#reset-email-hint')?.textContent).toContain('name@company.ge');

    fixture.componentInstance.requestForm.controls.email.setValue('not-an-email');
    fixture.componentInstance.requestForm.controls.email.markAsTouched();
    fixture.detectChanges();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain('სწორი ელფოსტა');

    fixture.componentInstance.requestForm.reset();
    fixture.componentInstance.requestReset();
    fixture.detectChanges();
    expect(fixture.componentInstance.requestSubmitAttempted()).toBe(true);
    expect(error.hidden).toBe(false);
    expect(api.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('inspects a reset token, clears the landing fragment and focuses the new password', async () => {
    fragment = TOKEN;
    const replace = vi.spyOn(history, 'replaceState');
    api.inspectInvitation.mockReturnValue(
      of({
        purpose: 'password_reset',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );

    await create();

    expect(replace).toHaveBeenCalled();
    expect(api.inspectInvitation).toHaveBeenCalledWith(TOKEN);
    expect(fixture.componentInstance.state()).toBe('reset');
    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('#reset-password'),
    );
    replace.mockRestore();
  });

  it('blocks an expired reset token without calling the completion endpoint', async () => {
    fragment = TOKEN;
    api.inspectInvitation.mockReturnValue(
      of({ purpose: 'password_reset', expiresAt: new Date(Date.now() - 1_000).toISOString() }),
    );
    await create();

    expect(fixture.componentInstance.state()).toBe('expired');
    fixture.componentInstance.completeReset();
    expect(api.completePasswordReset).not.toHaveBeenCalled();
  });

  it('wires stable password and mismatch errors with touched and submit-attempt semantics', async () => {
    fragment = TOKEN;
    api.inspectInvitation.mockReturnValue(
      of({
        purpose: 'password_reset',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    await create();
    const host = fixture.nativeElement as HTMLElement;
    const password = host.querySelector<HTMLInputElement>('#reset-password')!;
    const confirmation = host.querySelector<HTMLInputElement>('#reset-confirmation')!;
    const passwordError = host.querySelector<HTMLElement>('#reset-password-error')!;
    const confirmationError = host.querySelector<HTMLElement>('#reset-confirmation-error')!;
    expect(password.getAttribute('aria-describedby')).toBe(
      'reset-password-hint reset-password-error',
    );
    expect(confirmation.getAttribute('aria-describedby')).toBe(
      'reset-confirmation-hint reset-confirmation-error',
    );
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);

    fixture.componentInstance.resetForm.setValue({
      password: 'short',
      confirmation: 'different-password',
    });
    fixture.componentInstance.resetForm.markAllAsTouched();
    fixture.detectChanges();
    expect(password.getAttribute('aria-invalid')).toBe('true');
    expect(confirmation.getAttribute('aria-invalid')).toBe('true');
    expect(passwordError.hidden).toBe(false);
    expect(passwordError.textContent).toContain('მინიმუმ 12');
    expect(confirmationError.hidden).toBe(false);
    expect(confirmationError.textContent).toContain('არ ემთხვევა');

    fixture.componentInstance.resetForm.reset();
    fixture.componentInstance.completeReset();
    fixture.detectChanges();
    expect(fixture.componentInstance.resetSubmitAttempted()).toBe(true);
    expect(passwordError.hidden).toBe(false);
    expect(confirmationError.hidden).toBe(false);
    expect(api.completePasswordReset).not.toHaveBeenCalled();
  });

  it('completes with the exact body values and clears password inputs', async () => {
    fragment = TOKEN;
    api.inspectInvitation.mockReturnValue(
      of({
        purpose: 'password_reset',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    api.completePasswordReset.mockReturnValue(of({ completed: true }));
    await create();
    fixture.componentInstance.resetForm.setValue({
      password: 'another-private-password',
      confirmation: 'another-private-password',
    });

    fixture.componentInstance.completeReset();

    expect(api.completePasswordReset).toHaveBeenCalledWith(TOKEN, 'another-private-password');
    expect(fixture.componentInstance.state()).toBe('completed');
    expect(fixture.componentInstance.resetForm.controls.password.value).toBe('');
  });
});
