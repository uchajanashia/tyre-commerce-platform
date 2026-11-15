import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { IdentityApiService } from '../../core/identity-api.service';
import { MfaEnrollmentStart } from '../../core/identity-contract';
import { takeOneTimeToken } from './one-time-token';
import { AuthenticatorQr } from './authenticator-qr';

type InviteState =
  | 'checking'
  | 'ready'
  | 'enrolling'
  | 'mfa'
  | 'recovery'
  | 'expired'
  | 'invalid'
  | 'pending'
  | 'unavailable';

@Component({
  selector: 'adm-invitation-accept-page',
  imports: [ReactiveFormsModule, RouterLink, AuthenticatorQr],
  template: `
    <main class="public-auth">
      <section class="public-auth__panel" aria-labelledby="invite-title">
        <a class="public-auth__brand" routerLink="/login"
          ><span aria-hidden="true"></span>tyre.ge <small>OPS</small></a
        >
        <p class="public-auth__kicker">
          {{ flowPurpose() === 'recovery' ? 'დაცული MFA recovery' : 'დაცული მოწვევა' }}
        </p>
        <h1 id="invite-title">სამუშაო ანგარიშის გააქტიურება</h1>

        @switch (state()) {
          @case ('checking') {
            <p role="status">მოწვევა მოწმდება…</p>
          }
          @case ('unavailable') {
            <div class="public-auth__state" role="status">
              <strong>აქტივაციის სერვისი ამ გარემოში გამორთულია</strong>
              <p>ბმული არ გააზიაროთ. სცადეთ მხოლოდ ოფიციალური rollout-ის შემდეგ.</p>
            </div>
          }
          @case ('expired') {
            <div class="public-auth__state public-auth__state--error" role="alert">
              <strong>მოწვევის ვადა ამოიწურა</strong>
              <p>მოითხოვეთ ახალი მოწვევა ადმინისტრატორისგან.</p>
            </div>
          }
          @case ('invalid') {
            <div class="public-auth__state public-auth__state--error" role="alert">
              <strong>მოწვევა ვერ დადასტურდა</strong>
              <p>ბმული არასწორია, გაუქმებულია ან უკვე გამოყენებულია.</p>
            </div>
          }
          @case ('enrolling') {
            <p role="status">QR კოდი მზადდება…</p>
          }
          @case ('mfa') {
            @if (enrollment(); as setup) {
              <p class="public-auth__copy">
                Authenticator-ში აირჩიეთ „+“ → „QR კოდის სკანირება“.
              </p>
              <adm-authenticator-qr [uri]="setup.otpauthUri" />
              <details>
                <summary>ხელით დამატება</summary>
                <label for="invite-totp-key">დაყენების გასაღები</label>
                <input id="invite-totp-key" [value]="manualSetupKey()" readonly autocomplete="off" />
              </details>
              <form [formGroup]="mfaForm" (ngSubmit)="confirmMfa()">
                <label for="invite-mfa-code">Authenticator-ის 6-ნიშნა კოდი</label>
                <input
                  #mfaInput
                  id="invite-mfa-code"
                  formControlName="code"
                  inputmode="numeric"
                  pattern="[0-9]{6}"
                  autocomplete="one-time-code"
                  maxlength="6"
                  aria-describedby="invite-mfa-code-hint invite-mfa-code-error"
                  [attr.aria-invalid]="showMfaCodeError() ? 'true' : null"
                />
                <p id="invite-mfa-code-hint" class="public-auth__field-hint">
                  შეიყვანეთ ზუსტად 6 ციფრი authenticator-იდან.
                </p>
                <p
                  id="invite-mfa-code-error"
                  class="public-auth__field-error"
                  [hidden]="!showMfaCodeError()"
                >
                  Authenticator code უნდა შეიცავდეს ზუსტად 6 ციფრს.
                </p>
                @if (error()) {
                  <p class="public-auth__error" role="alert">
                    კოდი არასწორია ან დაყენების ვადა ამოიწურა.
                  </p>
                }
                <button type="submit" [disabled]="mfaForm.invalid || busy()">
                  {{ busy() ? 'მოწმდება…' : 'დადასტურება' }}
                </button>
              </form>
            }
          }
          @case ('recovery') {
            @if (recoveryCodes(); as codes) {
              <div
                #recoveryPanel
                class="public-auth__state public-auth__state--success"
                role="region"
                aria-live="assertive"
                aria-atomic="true"
                aria-labelledby="invite-recovery-title"
                tabindex="-1"
              >
                <strong id="invite-recovery-title">Recovery codes — მხოლოდ ერთხელ</strong>
                <p>
                  შეინახეთ ოფლაინ უსაფრთხო ადგილას. ამ გვერდის დახურვის შემდეგ კოდები აღარ
                  გამოჩნდება.
                </p>
                <ol class="public-auth__codes">
                  @for (code of codes; track code) {
                    <li>
                      <code>{{ code }}</code>
                    </li>
                  }
                </ol>
                <label class="public-auth__ack"
                  ><input
                    type="checkbox"
                    [checked]="codesSaved"
                    (change)="codesSaved = $any($event.target).checked"
                  />
                  კოდები უსაფრთხოდ შევინახე</label
                >
                <button type="button" (click)="finishRecovery()" [disabled]="!codesSaved">
                  დასრულება
                </button>
              </div>
            }
          }
          @case ('pending') {
            <div
              class="public-auth__state public-auth__state--success"
              role="status"
              tabindex="-1"
              #resultPanel
            >
              <strong>პაროლი დაყენებულია</strong>
              <p>
                ანგარიში აქტივაციის მოლოდინშია.
                @if (mfaRequired()) {
                  MFA დასრულებულია; საბოლოო აქტივაციას უფლებამოსილი ადმინისტრატორი დაადასტურებს.
                }
              </p>
              <a routerLink="/login">შესვლის გვერდზე დაბრუნება</a>
            </div>
          }
          @case ('ready') {
            <p class="public-auth__copy">შექმენით მინიმუმ 12-სიმბოლოიანი უნიკალური პაროლი.</p>
            <p class="public-auth__expiry">მოწვევა მოქმედებს {{ remainingLabel() }}</p>
            <form [formGroup]="form" (ngSubmit)="accept()">
              <label for="invite-password">ახალი პაროლი</label>
              <input
                #passwordInput
                id="invite-password"
                type="password"
                formControlName="password"
                autocomplete="new-password"
                aria-describedby="invite-password-hint invite-password-error"
                [attr.aria-invalid]="showPasswordError() ? 'true' : null"
              />
              <p id="invite-password-hint" class="public-auth__field-hint">
                გამოიყენეთ მინიმუმ 12 სიმბოლო; მაქსიმუმ 256.
              </p>
              <p
                id="invite-password-error"
                class="public-auth__field-error"
                [hidden]="!showPasswordError()"
              >
                პაროლი უნდა შეიცავდეს მინიმუმ 12 სიმბოლოს.
              </p>
              <label for="invite-password-confirm">გაიმეორეთ პაროლი</label>
              <input
                id="invite-password-confirm"
                type="password"
                formControlName="confirmation"
                autocomplete="new-password"
                aria-describedby="invite-confirmation-hint invite-confirmation-error"
                [attr.aria-invalid]="showConfirmationError() ? 'true' : null"
              />
              <p id="invite-confirmation-hint" class="public-auth__field-hint">
                ზუსტად გაიმეორეთ ახალი პაროლი.
              </p>
              <p
                id="invite-confirmation-error"
                class="public-auth__field-error"
                [hidden]="!showConfirmationError()"
              >
                {{
                  form.controls.confirmation.value.length === 0
                    ? 'პაროლის გამეორება აუცილებელია.'
                    : 'პაროლები არ ემთხვევა.'
                }}
              </p>
              @if (error()) {
                <p class="public-auth__error" role="alert">
                  აქტივაცია ვერ დასრულდა. ბმული შესაძლოა უკვე გამოყენებულია ან გაუქმებულია.
                </p>
              }
              <button type="submit" [disabled]="!canSubmit()">
                {{ busy() ? 'მუშავდება…' : 'პაროლის დაყენება' }}
              </button>
            </form>
          }
        }
      </section>
    </main>
  `,
})
export class InvitationAcceptPage {
  private readonly api = inject(IdentityApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private token: string | null = null;
  private enrollmentToken: string | null = null;
  private expiresAt = 0;

  readonly state = signal<InviteState>('checking');
  readonly busy = signal(false);
  readonly error = signal(false);
  readonly mfaRequired = signal(false);
  readonly flowPurpose = signal<'invite' | 'recovery'>('invite');
  readonly enrollment = signal<MfaEnrollmentStart | null>(null);
  readonly recoveryCodes = signal<string[] | null>(null);
  readonly remainingSeconds = signal(0);
  readonly submitAttempted = signal(false);
  readonly mfaSubmitAttempted = signal(false);
  codesSaved = false;
  readonly form = this.fb.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(256)]],
    confirmation: ['', Validators.required],
  });
  readonly mfaForm = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  @ViewChild('passwordInput') private passwordInput?: ElementRef<HTMLInputElement>;
  @ViewChild('mfaInput') private mfaInput?: ElementRef<HTMLInputElement>;
  @ViewChild('resultPanel') private resultPanel?: ElementRef<HTMLElement>;
  @ViewChild('recoveryPanel') private recoveryPanel?: ElementRef<HTMLElement>;

  constructor() {
    const timer = window.setInterval(() => this.updateExpiry(), 1000);
    this.destroyRef.onDestroy(() => window.clearInterval(timer));
    const token = takeOneTimeToken(this.route.snapshot.fragment);
    if (!this.api.config.enabled) {
      this.state.set('unavailable');
      return;
    }
    if (!token) {
      this.state.set('invalid');
      return;
    }
    this.token = token;
    if (this.route.snapshot.data?.['enrollmentOnly']) {
      this.token = null;
      this.mfaRequired.set(true);
      this.startEnrollment(token);
      return;
    }
    this.api.inspectInvitation(token).subscribe({
      next: (result) => {
        if (result.purpose !== 'invite' && result.purpose !== 'recovery') return this.invalidate();
        this.flowPurpose.set(result.purpose);
        this.expiresAt = Date.parse(result.expiresAt);
        this.updateExpiry();
        if (!Number.isFinite(this.expiresAt) || this.expiresAt <= Date.now()) {
          this.token = null;
          this.state.set('expired');
          return;
        }
        this.state.set('ready');
        queueMicrotask(() => this.passwordInput?.nativeElement.focus());
      },
      error: (error: unknown) => {
        this.token = null;
        this.state.set(isExpired(error) ? 'expired' : 'invalid');
      },
    });
  }

  passwordMismatch(): boolean {
    const { password, confirmation } = this.form.getRawValue();
    return confirmation.length > 0 && password !== confirmation;
  }

  canSubmit(): boolean {
    return (
      this.form.valid && !this.passwordMismatch() && !this.busy() && this.remainingSeconds() > 0
    );
  }

  showPasswordError(): boolean {
    const control = this.form.controls.password;
    return control.invalid && (control.touched || control.dirty || this.submitAttempted());
  }

  showConfirmationError(): boolean {
    const control = this.form.controls.confirmation;
    return (
      (control.invalid || this.passwordMismatch()) &&
      (control.touched || control.dirty || this.submitAttempted())
    );
  }

  showMfaCodeError(): boolean {
    const control = this.mfaForm.controls.code;
    return control.invalid && (control.touched || control.dirty || this.mfaSubmitAttempted());
  }

  accept(): void {
    this.submitAttempted.set(true);
    this.form.markAllAsTouched();
    if (!this.token || !this.canSubmit()) return;
    this.busy.set(true);
    this.error.set(false);
    this.api.acceptInvitation(this.token, this.form.controls.password.value).subscribe({
      next: (result) => {
        this.token = null;
        this.form.reset();
        this.busy.set(false);
        this.mfaRequired.set(result.mfaRequired);
        if (!result.mfaRequired) {
          this.finishPending();
          return;
        }
        if (!result.activationProof) {
          this.invalidate();
          return;
        }
        this.startEnrollment(result.activationProof);
      },
      error: () => {
        this.busy.set(false);
        this.error.set(true);
      },
    });
  }

  manualSetupKey(): string {
    try { return new URL(this.enrollment()?.otpauthUri ?? '').searchParams.get('secret') ?? ''; }
    catch { return ''; }
  }

  private startEnrollment(proof: string): void {
    this.state.set('enrolling');
    this.api.startMfaEnrollment(proof).subscribe({
          next: (enrollment) => {
            this.enrollmentToken = enrollment.enrollmentToken;
            this.enrollment.set(enrollment);
            this.expiresAt = Date.parse(enrollment.expiresAt);
            this.updateExpiry();
            if (!Number.isFinite(this.expiresAt) || this.expiresAt <= Date.now()) {
              this.expireEnrollment();
              return;
            }
            this.state.set('mfa');
            queueMicrotask(() => this.mfaInput?.nativeElement.focus());
          },
          error: () => this.expireEnrollment(),
    });
  }

  confirmMfa(): void {
    this.mfaSubmitAttempted.set(true);
    this.mfaForm.markAllAsTouched();
    if (!this.enrollmentToken || this.mfaForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(false);
    this.api
      .confirmMfaEnrollment(this.enrollmentToken, this.mfaForm.controls.code.value)
      .subscribe({
        next: ({ recoveryCodes }) => {
          this.busy.set(false);
          this.enrollmentToken = null;
          this.enrollment.set(null);
          this.mfaForm.reset();
          this.mfaSubmitAttempted.set(false);
          this.recoveryCodes.set(recoveryCodes);
          this.state.set('recovery');
          queueMicrotask(() => this.recoveryPanel?.nativeElement.focus());
        },
        error: () => {
          this.busy.set(false);
          this.mfaForm.reset();
          this.mfaSubmitAttempted.set(false);
          this.error.set(true);
          queueMicrotask(() => this.mfaInput?.nativeElement.focus());
        },
      });
  }

  finishRecovery(): void {
    if (!this.codesSaved) return;
    this.recoveryCodes.set(null);
    this.codesSaved = false;
    this.finishPending();
  }

  remainingLabel(): string {
    const seconds = this.remainingSeconds();
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours} სთ ${minutes} წთ` : `${minutes} წთ`;
  }

  private updateExpiry(): void {
    const remaining = Math.max(0, Math.ceil((this.expiresAt - Date.now()) / 1000));
    this.remainingSeconds.set(remaining);
    if (remaining === 0 && this.state() === 'ready') {
      this.token = null;
      this.state.set('expired');
    }
    if (remaining === 0 && this.state() === 'mfa') this.expireEnrollment();
  }

  private invalidate(): void {
    this.token = null;
    this.enrollmentToken = null;
    this.enrollment.set(null);
    this.state.set('invalid');
  }

  private expireEnrollment(): void {
    this.enrollmentToken = null;
    this.enrollment.set(null);
    this.state.set('expired');
  }

  private finishPending(): void {
    this.state.set('pending');
    queueMicrotask(() => this.resultPanel?.nativeElement.focus());
  }
}

function isExpired(error: unknown): boolean {
  return error instanceof HttpErrorResponse && [409, 410].includes(error.status);
}
