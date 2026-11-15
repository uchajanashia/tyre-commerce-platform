import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { IdentityApiService } from '../../core/identity-api.service';
import { takeOneTimeToken } from './one-time-token';

type ResetState =
  | 'checking'
  | 'request'
  | 'request_sent'
  | 'reset'
  | 'completed'
  | 'expired'
  | 'invalid'
  | 'unavailable';

@Component({
  selector: 'adm-password-reset-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="public-auth">
      <section class="public-auth__panel" aria-labelledby="reset-title">
        <a class="public-auth__brand" routerLink="/login"
          ><span aria-hidden="true"></span>tyre.ge <small>OPS</small></a
        >
        <p class="public-auth__kicker">ანგარიშის აღდგენა</p>
        <h1 id="reset-title">პაროლის აღდგენა</h1>

        @switch (state()) {
          @case ('checking') {
            <p role="status">ბმული მოწმდება…</p>
          }
          @case ('unavailable') {
            <div class="public-auth__state" role="status">
              <strong>აღდგენის სერვისი გამორთულია</strong>
              <p>ამ გარემოში Identity v2 ჯერ არ არის ჩართული.</p>
            </div>
          }
          @case ('expired') {
            <div class="public-auth__state public-auth__state--error" role="alert">
              <strong>ბმულის ვადა ამოიწურა</strong>
              <p>მოითხოვეთ ახალი აღდგენის ბმული.</p>
            </div>
          }
          @case ('invalid') {
            <div class="public-auth__state public-auth__state--error" role="alert">
              <strong>ბმული ვერ დადასტურდა</strong>
              <p>ის არასწორია, გაუქმებულია ან უკვე გამოყენებულია.</p>
            </div>
          }
          @case ('request_sent') {
            <div
              class="public-auth__state public-auth__state--success"
              role="status"
              tabindex="-1"
              #resultPanel
            >
              <strong>მოთხოვნა მიღებულია</strong>
              @if (manualDelivery) {
                <p>ამ გარემოში წერილი არ იგზავნება. აღდგენის ბმულისთვის მიმართეთ ადმინისტრატორს.</p>
              } @else {
                <p>თუ ამ ელფოსტით აქტიური ანგარიში არსებობს, აღდგენის ინსტრუქცია გაიგზავნება.</p>
              }
            </div>
          }
          @case ('completed') {
            <div
              class="public-auth__state public-auth__state--success"
              role="status"
              tabindex="-1"
              #resultPanel
            >
              <strong>პაროლი განახლდა</strong>
              <p>შედით ახალი პაროლით და Authenticator-ის კოდით.</p>
              <a routerLink="/login">შესვლა</a>
            </div>
          }
          @case ('request') {
            @if (manualDelivery) {
              <p class="public-auth__copy">წერილის გაგზავნა გამორთულია. ბმულს ადმინისტრატორი მოგაწვდით.</p>
            }
            <form [formGroup]="requestForm" (ngSubmit)="requestReset()">
              <label for="reset-email">სამუშაო ელფოსტა</label>
              <input
                #emailInput
                id="reset-email"
                type="email"
                formControlName="email"
                autocomplete="email"
                aria-describedby="reset-email-hint reset-email-error"
                [attr.aria-invalid]="showEmailError() ? 'true' : null"
              />
              <p id="reset-email-hint" class="public-auth__field-hint">
                შეიყვანეთ სრული სამუშაო ელფოსტა, მაგალითად name&#64;company.ge.
              </p>
              <p
                id="reset-email-error"
                class="public-auth__field-error"
                [hidden]="!showEmailError()"
              >
                შეიყვანეთ სწორი ელფოსტა ფორმატით name&#64;company.ge.
              </p>
              @if (error()) {
                <p class="public-auth__error" role="alert">
                  მოთხოვნა ვერ გაიგზავნა. კავშირი გადაამოწმეთ და მოგვიანებით სცადეთ.
                </p>
              }
              <button type="submit" [disabled]="requestForm.invalid || busy()">
                {{ busy() ? 'იგზავნება…' : 'აღდგენის მოთხოვნა' }}
              </button>
            </form>
          }
          @case ('reset') {
            <p class="public-auth__copy">შექმენით მინიმუმ 12-სიმბოლოიანი ახალი პაროლი.</p>
            <form [formGroup]="resetForm" (ngSubmit)="completeReset()">
              <label for="reset-password">ახალი პაროლი</label>
              <input
                #passwordInput
                id="reset-password"
                type="password"
                formControlName="password"
                autocomplete="new-password"
                aria-describedby="reset-password-hint reset-password-error"
                [attr.aria-invalid]="showPasswordError() ? 'true' : null"
              />
              <p id="reset-password-hint" class="public-auth__field-hint">
                გამოიყენეთ მინიმუმ 12 სიმბოლო; მაქსიმუმ 256.
              </p>
              <p
                id="reset-password-error"
                class="public-auth__field-error"
                [hidden]="!showPasswordError()"
              >
                პაროლი უნდა შეიცავდეს მინიმუმ 12 სიმბოლოს.
              </p>
              <label for="reset-confirmation">გაიმეორეთ პაროლი</label>
              <input
                id="reset-confirmation"
                type="password"
                formControlName="confirmation"
                autocomplete="new-password"
                aria-describedby="reset-confirmation-hint reset-confirmation-error"
                [attr.aria-invalid]="showConfirmationError() ? 'true' : null"
              />
              <p id="reset-confirmation-hint" class="public-auth__field-hint">
                ზუსტად გაიმეორეთ ახალი პაროლი.
              </p>
              <p
                id="reset-confirmation-error"
                class="public-auth__field-error"
                [hidden]="!showConfirmationError()"
              >
                {{
                  resetForm.controls.confirmation.value.length === 0
                    ? 'პაროლის გამეორება აუცილებელია.'
                    : 'პაროლები არ ემთხვევა.'
                }}
              </p>
              @if (error()) {
                <p class="public-auth__error" role="alert">
                  პაროლი ვერ განახლდა. ბმული შესაძლოა უკვე გამოყენებულია ან გაუქმებულია.
                </p>
              }
              <button type="submit" [disabled]="!canComplete()">
                {{ busy() ? 'მუშავდება…' : 'პაროლის განახლება' }}
              </button>
            </form>
          }
        }
      </section>
    </main>
  `,
})
export class PasswordResetPage {
  private readonly api = inject(IdentityApiService);
  readonly manualDelivery = this.api.config.passwordResetDelivery !== 'email';
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private token: string | null = null;

  readonly state = signal<ResetState>('checking');
  readonly busy = signal(false);
  readonly error = signal(false);
  readonly requestSubmitAttempted = signal(false);
  readonly resetSubmitAttempted = signal(false);
  readonly requestForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });
  readonly resetForm = this.fb.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(256)]],
    confirmation: ['', Validators.required],
  });

  @ViewChild('emailInput') private emailInput?: ElementRef<HTMLInputElement>;
  @ViewChild('passwordInput') private passwordInput?: ElementRef<HTMLInputElement>;
  @ViewChild('resultPanel') private resultPanel?: ElementRef<HTMLElement>;

  constructor() {
    const token = takeOneTimeToken(this.route.snapshot.fragment);
    if (!this.api.config.enabled) {
      this.state.set('unavailable');
      return;
    }
    if (!token) {
      this.state.set('request');
      queueMicrotask(() => this.emailInput?.nativeElement.focus());
      return;
    }
    this.token = token;
    this.api.inspectInvitation(token).subscribe({
      next: (result) => {
        const expiry = Date.parse(result.expiresAt);
        if (result.purpose !== 'password_reset') return this.invalidate();
        if (!Number.isFinite(expiry) || expiry <= Date.now()) {
          this.token = null;
          this.state.set('expired');
          return;
        }
        this.state.set('reset');
        queueMicrotask(() => this.passwordInput?.nativeElement.focus());
      },
      error: (error: unknown) => {
        this.token = null;
        this.state.set(isExpired(error) ? 'expired' : 'invalid');
      },
    });
  }

  requestReset(): void {
    this.requestSubmitAttempted.set(true);
    this.requestForm.markAllAsTouched();
    if (this.requestForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(false);
    this.api.requestPasswordReset(this.requestForm.controls.email.value.trim()).subscribe({
      next: () => {
        this.requestForm.reset();
        this.busy.set(false);
        this.state.set('request_sent');
        queueMicrotask(() => this.resultPanel?.nativeElement.focus());
      },
      error: () => {
        this.busy.set(false);
        this.error.set(true);
      },
    });
  }

  passwordMismatch(): boolean {
    const { password, confirmation } = this.resetForm.getRawValue();
    return confirmation.length > 0 && password !== confirmation;
  }

  canComplete(): boolean {
    return this.resetForm.valid && !this.passwordMismatch() && !this.busy();
  }

  showEmailError(): boolean {
    const control = this.requestForm.controls.email;
    return control.invalid && (control.touched || control.dirty || this.requestSubmitAttempted());
  }

  showPasswordError(): boolean {
    const control = this.resetForm.controls.password;
    return control.invalid && (control.touched || control.dirty || this.resetSubmitAttempted());
  }

  showConfirmationError(): boolean {
    const control = this.resetForm.controls.confirmation;
    return (
      (control.invalid || this.passwordMismatch()) &&
      (control.touched || control.dirty || this.resetSubmitAttempted())
    );
  }

  completeReset(): void {
    this.resetSubmitAttempted.set(true);
    this.resetForm.markAllAsTouched();
    if (!this.token || !this.canComplete()) return;
    this.busy.set(true);
    this.error.set(false);
    this.api.completePasswordReset(this.token, this.resetForm.controls.password.value).subscribe({
      next: () => {
        this.token = null;
        this.resetForm.reset();
        this.busy.set(false);
        this.state.set('completed');
        queueMicrotask(() => this.resultPanel?.nativeElement.focus());
      },
      error: () => {
        this.busy.set(false);
        this.error.set(true);
      },
    });
  }

  private invalidate(): void {
    this.token = null;
    this.state.set('invalid');
  }
}

function isExpired(error: unknown): boolean {
  return error instanceof HttpErrorResponse && [409, 410].includes(error.status);
}
