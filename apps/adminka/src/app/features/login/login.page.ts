import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'adm-login-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="auth-workspace">
      <section class="auth-panel" aria-labelledby="auth-title">
        <div class="auth-brand"><span aria-hidden="true"></span>tyre.ge <small>OPS</small></div>

        @if (mode() === 'password') {
          <form [formGroup]="loginForm" (ngSubmit)="submitPassword()">
            <p class="auth-kicker">დაცული წვდომა</p>
            <h1 id="auth-title">ადმინისტრაციაში შესვლა</h1>
            <p class="auth-copy">გამოიყენეთ მხოლოდ თქვენთვის მინიჭებული სამუშაო ანგარიში.</p>

            <label for="login-email">ელფოსტა</label>
            <input
              #emailInput
              id="login-email"
              type="email"
              formControlName="email"
              autocomplete="username"
              [attr.aria-invalid]="
                loginForm.controls.email.touched && loginForm.controls.email.invalid
              "
            />
            @if (loginForm.controls.email.touched && loginForm.controls.email.invalid) {
              <p class="field-error">შეიყვანეთ სწორი ელფოსტა</p>
            }

            <label for="login-password">პაროლი</label>
            <input
              id="login-password"
              type="password"
              formControlName="password"
              autocomplete="current-password"
              [attr.aria-invalid]="
                loginForm.controls.password.touched && loginForm.controls.password.invalid
              "
            />
            @if (loginForm.controls.password.touched && loginForm.controls.password.invalid) {
              <p class="field-error">პაროლი აუცილებელია</p>
            }

            @if (error(); as message) {
              <p class="form-error" role="alert">{{ message }}</p>
            }

            <a class="auth-reset-link" routerLink="/password-reset/request">პაროლი დაგავიწყდათ?</a>
            <button type="submit" [disabled]="loginForm.invalid || busy()">
              {{ busy() ? 'მოწმდება…' : 'გაგრძელება' }}
            </button>
          </form>
        } @else {
          <form [formGroup]="mfaForm" (ngSubmit)="submitMfa()">
            <p class="auth-kicker">მეორე ფაქტორი</p>
            <h1 id="auth-title">დაადასტურეთ შესვლა</h1>
            <p class="auth-copy">
              აირჩიეთ authenticator-ის 6-ნიშნა კოდი ან ერთჯერადი recovery code.
            </p>

            <fieldset class="mfa-method" aria-describedby="mfa-method-help">
              <legend>დადასტურების მეთოდი</legend>
              <label>
                <input
                  type="radio"
                  name="mfa-code-mode"
                  value="totp"
                  [checked]="mfaCodeMode() === 'totp'"
                  (change)="selectMfaCodeMode('totp')"
                />
                Authenticator code
              </label>
              <label>
                <input
                  type="radio"
                  name="mfa-code-mode"
                  value="recovery"
                  [checked]="mfaCodeMode() === 'recovery'"
                  (change)="selectMfaCodeMode('recovery')"
                />
                Recovery code
              </label>
            </fieldset>
            <p id="mfa-method-help" class="auth-expiry">
              Recovery code არის 22-სიმბოლოიანი, ერთჯერადი base64url კოდი; მხარდაჭერას არასოდეს
              გაუზიაროთ.
            </p>

            <label for="mfa-code">
              {{
                mfaCodeMode() === 'totp' ? '6-ნიშნა Authenticator code' : 'ერთჯერადი recovery code'
              }}
            </label>
            <input
              #mfaInput
              id="mfa-code"
              type="text"
              formControlName="code"
              [attr.inputmode]="mfaCodeMode() === 'totp' ? 'numeric' : 'text'"
              [attr.pattern]="mfaCodeMode() === 'totp' ? '[0-9]{6}' : '[A-Za-z0-9_-]{22}'"
              [attr.autocomplete]="mfaCodeMode() === 'totp' ? 'one-time-code' : 'off'"
              aria-describedby="mfa-code-help mfa-method-help"
              [attr.aria-invalid]="mfaForm.controls.code.touched && mfaForm.controls.code.invalid"
              autocapitalize="none"
              spellcheck="false"
            />
            <p id="mfa-code-help" class="auth-expiry">
              @if (mfaCodeMode() === 'totp') {
                მხოლოდ 6 ციფრი.
              } @else {
                დასაშვებია ასოები, ციფრები, დეფისი და ქვედა ტირე. კოდი გამოყენების შემდეგ უქმდება.
              }
            </p>
            <p class="auth-expiry" [class.auth-expiry--urgent]="remainingSeconds() <= 60">
              @if (remainingSeconds() > 0) {
                კოდი მოქმედებს კიდევ {{ remainingLabel() }}
              } @else {
                challenge-ის ვადა ამოიწურა
              }
            </p>

            @if (error(); as message) {
              <p class="form-error" role="alert">{{ message }}</p>
            }

            <button type="submit" [disabled]="mfaForm.invalid || busy() || remainingSeconds() <= 0">
              {{ busy() ? 'მოწმდება…' : 'შესვლის დადასტურება' }}
            </button>
            <button type="button" class="auth-secondary" (click)="restartLogin()">
              სხვა ანგარიშით შესვლა
            </button>
          </form>
        }

        <footer>
          Access token ინახება მხოლოდ ამ გვერდის მეხსიერებაში. მხარდაჭერა პაროლს ან MFA კოდს
          არასოდეს მოგთხოვთ.
        </footer>
      </section>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100svh;
      background: #f4f5f7;
      color: #171a1f;
    }
    .auth-workspace {
      min-height: 100svh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .auth-panel {
      width: min(420px, 100%);
    }
    .auth-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 34px;
      font-size: 15px;
      font-weight: 700;
    }
    .auth-brand > span {
      width: 18px;
      height: 18px;
      border: 5px solid #2969e8;
      border-radius: 50%;
    }
    .auth-brand small {
      padding-left: 8px;
      border-left: 1px solid #cfd4db;
      color: #66707d;
      font-size: 9px;
      letter-spacing: 0.12em;
    }
    form {
      display: grid;
      gap: 9px;
      padding: 28px;
      border: 1px solid #dfe3e8;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 12px 36px rgba(18, 24, 34, 0.06);
    }
    .auth-kicker {
      margin: 0 0 -2px;
      color: #2969e8;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      letter-spacing: -0.035em;
    }
    .auth-copy {
      margin: 0 0 13px;
      color: #5d6470;
      font-size: 12px;
      line-height: 1.6;
    }
    label {
      margin-top: 5px;
      color: #4e5662;
      font-size: 11px;
      font-weight: 600;
    }
    .mfa-method {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 18px;
      margin: 4px 0 0;
      padding: 10px 12px;
      border: 1px solid #dfe3e8;
      border-radius: 6px;
    }
    .mfa-method legend {
      padding: 0 4px;
      color: #4e5662;
      font-size: 10px;
      font-weight: 600;
    }
    .mfa-method label {
      display: inline-flex;
      gap: 7px;
      align-items: center;
      margin: 0;
    }
    .mfa-method input {
      min-height: auto;
      margin: 0;
      padding: 0;
    }
    input {
      min-height: 42px;
      padding: 8px 11px;
      border: 1px solid #cfd4db;
      border-radius: 6px;
      background: #fff;
      font-size: 14px;
    }
    input:focus {
      border-color: #2969e8;
    }
    button {
      min-height: 42px;
      margin-top: 10px;
      border: 0;
      border-radius: 6px;
      background: #2969e8;
      color: #fff;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.55;
    }
    .auth-secondary {
      margin-top: 0;
      border: 1px solid #d5d9df;
      background: #fff;
      color: #374151;
    }
    .auth-reset-link {
      justify-self: end;
      color: #2459b8;
      font-size: 11px;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
    }
    .field-error {
      margin: -3px 0 0;
      color: #a8202c;
      font-size: 10px;
    }
    .form-error {
      margin: 5px 0 0;
      padding: 9px 10px;
      border-left: 2px solid #bb2c37;
      background: #fff2f3;
      color: #8f1722;
      font-size: 10px;
      line-height: 1.5;
    }
    .auth-expiry {
      margin: 0;
      color: #5d6470;
      font-size: 10px;
    }
    .auth-expiry--urgent {
      color: #9a5f08;
    }
    footer {
      margin-top: 18px;
      color: #66707d;
      font-size: 9px;
      line-height: 1.6;
      text-align: center;
    }
    @media (max-width: 520px) {
      .auth-workspace {
        align-items: start;
        padding: 24px 16px;
      }
      .auth-brand {
        margin-bottom: 24px;
      }
      form {
        padding: 22px 18px;
      }
    }
  `,
})
export class LoginPage {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly mode = signal<'password' | 'mfa'>('password');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly remainingSeconds = signal(0);
  readonly mfaCodeMode = signal<'totp' | 'recovery'>('totp');

  readonly loginForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  readonly mfaForm = this.fb.nonNullable.group({
    code: ['', totpValidators()],
  });

  @ViewChild('emailInput') private emailInput?: ElementRef<HTMLInputElement>;
  @ViewChild('mfaInput') private mfaInput?: ElementRef<HTMLInputElement>;

  constructor() {
    const timer = window.setInterval(() => this.updateRemainingTime(), 1000);
    this.destroyRef.onDestroy(() => window.clearInterval(timer));
  }

  submitPassword(): void {
    if (this.loginForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const { email, password } = this.loginForm.getRawValue();
    this.auth.login(email, password).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.loginForm.controls.password.reset('');
        if (result.status === 'mfa_required') {
          this.mode.set('mfa');
          this.resetMfaCodeMode();
          this.updateRemainingTime();
          queueMicrotask(() => this.mfaInput?.nativeElement.focus());
          return;
        }
        this.finishLogin();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(loginErrorMessage(error));
      },
    });
  }

  submitMfa(): void {
    if (this.mfaForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.auth.completeMfa(this.mfaForm.controls.code.value.trim()).subscribe({
      next: () => this.finishLogin(),
      error: (error: unknown) => {
        this.busy.set(false);
        this.mfaForm.reset();
        if (isExpiredChallenge(error)) {
          this.restartLogin('დადასტურების დრო ამოიწურა. დაიწყეთ შესვლა თავიდან.');
        } else {
          this.error.set('კოდი არასწორია ან უკვე გამოყენებულია. სცადეთ თავიდან.');
          queueMicrotask(() => this.mfaInput?.nativeElement.focus());
        }
      },
    });
  }

  selectMfaCodeMode(mode: 'totp' | 'recovery'): void {
    if (this.mfaCodeMode() === mode) return;
    this.mfaCodeMode.set(mode);
    const control = this.mfaForm.controls.code;
    control.reset('');
    control.setValidators(mode === 'totp' ? totpValidators() : recoveryCodeValidators());
    control.updateValueAndValidity();
    queueMicrotask(() => this.mfaInput?.nativeElement.focus());
  }

  restartLogin(message: string | null = null): void {
    this.auth.cancelMfa();
    this.mode.set('password');
    this.mfaForm.reset();
    this.resetMfaCodeMode();
    this.error.set(message);
    this.remainingSeconds.set(0);
    queueMicrotask(() => this.emailInput?.nativeElement.focus());
  }

  remainingLabel(): string {
    const seconds = this.remainingSeconds();
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  private updateRemainingTime(): void {
    const expiry = this.auth.pendingMfa()?.expiresAt;
    this.remainingSeconds.set(
      expiry ? Math.max(0, Math.ceil((Date.parse(expiry) - Date.now()) / 1000)) : 0,
    );
  }

  private resetMfaCodeMode(): void {
    this.mfaCodeMode.set('totp');
    const control = this.mfaForm.controls.code;
    control.setValidators(totpValidators());
    control.updateValueAndValidity();
  }

  private finishLogin(): void {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
    void this.router.navigateByUrl(returnUrl);
  }
}

function totpValidators() {
  return [Validators.required, Validators.pattern(/^\d{6}$/)];
}

function recoveryCodeValidators() {
  return [
    Validators.required,
    Validators.minLength(22),
    Validators.maxLength(22),
    Validators.pattern(/^[A-Za-z0-9_-]{22}$/),
  ];
}

function loginErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 429) {
    return 'ცდების ლიმიტი ამოიწურა. დაელოდეთ და მოგვიანებით სცადეთ.';
  }
  if (error instanceof HttpErrorResponse && error.status === 503) {
    return 'ახალი უსაფრთხო სესიის სერვისი ამ გარემოში ჯერ არ არის ჩართული.';
  }
  if (error instanceof HttpErrorResponse && error.status === 401) {
    return 'ელფოსტა ან პაროლი არასწორია.';
  }
  return 'შესვლა ვერ შესრულდა. კავშირი გადაამოწმეთ და თავიდან სცადეთ.';
}

function isExpiredChallenge(error: unknown): boolean {
  return (
    (error instanceof Error && error.message === 'MFA_CHALLENGE_EXPIRED') ||
    (error instanceof HttpErrorResponse && [409, 410].includes(error.status))
  );
}
