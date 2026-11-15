import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { switchMap } from 'rxjs';

import { AuthService } from '../../core/auth.service';
import { IdentityApiService } from '../../core/identity-api.service';
import { StaffSessionItem, StaffSessionList } from '../../core/identity-contract';

type PageState = 'loading' | 'ready' | 'unavailable' | 'error';

@Component({
  selector: 'adm-security-page',
  template: `
    <div class="identity-page">
      <div
        class="security-page__content"
        [attr.inert]="confirmingSession() ? '' : null"
        [attr.aria-hidden]="confirmingSession() ? 'true' : null"
      >
        <header class="identity-heading">
          <div>
            <p>ანგარიში</p>
            <h1>უსაფრთხოება და სესიები</h1>
          </div>
          <span>Secrets memory-only</span>
        </header>

        @if (!auth.identityV2Enabled) {
          <section class="identity-unavailable" role="status">
            <strong>Identity v2 ამ გარემოში გამორთულია</strong>
            <p>
              სესიებისა და MFA-ის მართვა ჩაირთვება same-origin proxy/TLS rollout evidence-ის შემდეგ.
            </p>
          </section>
        } @else {
          <section class="identity-section" aria-labelledby="sessions-title">
            <div class="identity-section__heading">
              <div>
                <p>წვდომა</p>
                <h2 id="sessions-title">აქტიური მოწყობილობები</h2>
              </div>
              <button
                type="button"
                class="quiet-button"
                (click)="loadSessions()"
                [disabled]="sessionsState() === 'loading' || sessionsLoadingMore()"
              >
                განახლება
              </button>
            </div>

            @if (sessionsState() === 'loading') {
              <p class="identity-loading">სესიები იტვირთება…</p>
            } @else if (sessionsState() === 'unavailable') {
              <p class="identity-inline-state">Session API ჯერ არ არის ჩართული ამ გარემოში.</p>
            } @else if (sessionsState() === 'error') {
              <p class="identity-inline-state identity-inline-state--error" role="alert">
                სესიები ვერ ჩაიტვირთა. თავიდან სცადეთ.
              </p>
            } @else if (sessions(); as list) {
              <div class="session-list" role="list">
                @for (session of list.items; track session.id) {
                  <article class="session-row" role="listitem">
                    <span class="session-row__device" aria-hidden="true"></span>
                    <div>
                      <strong>{{ sessionLabel(session) }}</strong>
                      <p>
                        შექმნა {{ formatDate(session.createdAt) }} · ბოლო აქტივობა
                        {{ formatDate(session.lastSeenAt) }}
                      </p>
                    </div>
                    @if (session.id === list.currentSessionId) {
                      <span class="current-tag">მიმდინარე</span>
                    }
                    <button
                      type="button"
                      class="danger-text"
                      (click)="requestRevoke(session, $event)"
                      [disabled]="busy()"
                      [attr.aria-disabled]="isRevoked(session.id) ? 'true' : null"
                    >
                      {{ isRevoked(session.id) ? 'გაუქმებულია' : 'გაუქმება' }}
                    </button>
                  </article>
                } @empty {
                  <p class="identity-inline-state">აქტიური სესიები არ მოიძებნა.</p>
                }
              </div>
              <div
                #sessionsPagingStatus
                class="identity-pagination"
                aria-live="polite"
                aria-atomic="true"
                tabindex="-1"
              >
                @if (sessionsLoadingMore()) {
                  <p class="identity-loading">შემდეგი სესიები იტვირთება…</p>
                } @else if (sessionsPageError()) {
                  <p class="identity-inline-state identity-inline-state--error" role="alert">
                    შემდეგი გვერდი ვერ ჩაიტვირთა; ნაჩვენები სესიები შენარჩუნებულია.
                  </p>
                  <button type="button" class="quiet-button" (click)="loadMoreSessions($event)">
                    თავიდან ცდა
                  </button>
                } @else if (sessionsNextCursor()) {
                  <button type="button" class="quiet-button" (click)="loadMoreSessions($event)">
                    მეტი სესიის ჩატვირთვა
                  </button>
                } @else {
                  <p class="identity-inline-state">ყველა სესია ჩატვირთულია.</p>
                }
              </div>
            }
          </section>

          <section class="identity-section" aria-labelledby="mfa-title">
            <div class="identity-section__heading">
              <div>
                <p>მეორე ფაქტორი</p>
                <h2 id="mfa-title">Authenticator და recovery codes</h2>
              </div>
            </div>
            <div class="identity-foundation" role="status">
              <strong>Foundation — read only</strong>
              <p>
                აქტიური სესიიდან MFA enrollment-ის proof contract ჯერ არ არის გამოქვეყნებული. MFA
                მხოლოდ მოწვევის ან recovery-ის დაცულ ერთჯერად flow-ში იმართება.
              </p>
              <button type="button" disabled aria-disabled="true">
                Authenticator-ის დაკავშირება — მიუწვდომელია
              </button>
            </div>
          </section>

          <section class="identity-section" aria-labelledby="revoke-all-title">
            <div class="identity-section__heading">
              <div>
                <p>საგანგებო მოქმედება</p>
                <h2 id="revoke-all-title">ყველა სესიის გაუქმება</h2>
              </div>
            </div>
            <p class="identity-copy">
              Revoke-all action preview contract ჯერ არ არის გამოქვეყნებული. უსაფრთხოების გამო ეს
              foundation კონტროლი არ აგროვებს MFA კოდს და მოთხოვნას არ აგზავნის.
            </p>
            <button type="button" class="danger-button" disabled aria-disabled="true">
              ყველა სესიის გაუქმება — მიუწვდომელია
            </button>
          </section>
        }

        @if (notice(); as message) {
          <p class="identity-toast" role="status">{{ message }}</p>
        }
      </div>

      @if (confirmingSession(); as session) {
        <div class="identity-confirm-backdrop" aria-hidden="true"></div>
        <div
          #revokeDialog
          class="identity-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="revoke-session-title"
          aria-describedby="revoke-session-description"
          (keydown)="onDialogKeydown($event)"
        >
          <h3 id="revoke-session-title">სესიის გაუქმება</h3>
          <p id="revoke-session-description">
            {{ sessionLabel(session) }} დაუყოვნებლივ დაკარგავს წვდომას.
          </p>
          <div>
            <button
              #confirmRevokeButton
              type="button"
              class="danger-button"
              (click)="confirmRevoke(session)"
              [disabled]="busy()"
            >
              გაუქმება</button
            ><button
              type="button"
              class="quiet-button"
              (click)="cancelRevoke()"
              [disabled]="busy()"
            >
              დახურვა
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class SecurityPage {
  readonly auth = inject(AuthService);
  private readonly api = inject(IdentityApiService);
  private readonly router = inject(Router);

  readonly sessionsState = signal<PageState>('loading');
  readonly sessions = signal<StaffSessionList | null>(null);
  readonly sessionsNextCursor = signal<string | null>(null);
  readonly sessionsLoadingMore = signal(false);
  readonly sessionsPageError = signal(false);
  readonly confirmingSession = signal<StaffSessionItem | null>(null);
  readonly revokedSessionIds = signal<ReadonlySet<string>>(new Set());
  readonly busy = signal(false);
  readonly notice = signal<string | null>(null);
  private revokeTrigger: HTMLElement | null = null;
  private sessionsRequestInFlight = false;

  @ViewChild('revokeDialog') private revokeDialog?: ElementRef<HTMLElement>;
  @ViewChild('confirmRevokeButton') private confirmRevokeButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('sessionsPagingStatus') private sessionsPagingStatus?: ElementRef<HTMLElement>;

  constructor() {
    if (this.auth.identityV2Enabled) this.loadSessions();
    else this.sessionsState.set('unavailable');
  }

  loadSessions(): void {
    if (this.sessionsRequestInFlight || this.sessionsLoadingMore()) return;
    this.sessionsRequestInFlight = true;
    this.sessionsState.set('loading');
    this.sessions.set(null);
    this.sessionsNextCursor.set(null);
    this.sessionsPageError.set(false);
    this.api.sessions().subscribe({
      next: (sessions) => {
        this.sessionsRequestInFlight = false;
        this.sessions.set(sessions);
        this.sessionsNextCursor.set(sessions.nextCursor ?? null);
        this.revokedSessionIds.set(new Set());
        this.sessionsState.set('ready');
      },
      error: (error: unknown) => {
        this.sessionsRequestInFlight = false;
        this.sessionsState.set(isUnavailable(error) ? 'unavailable' : 'error');
      },
    });
  }

  loadMoreSessions(event?: Event): void {
    const cursor = this.sessionsNextCursor();
    if (!cursor || this.sessionsLoadingMore() || this.sessionsState() !== 'ready') return;
    const trigger = event?.currentTarget as HTMLElement | null;
    this.sessionsLoadingMore.set(true);
    this.sessionsPageError.set(false);
    this.api.sessions(cursor).subscribe({
      next: (page) => {
        const current = this.sessions();
        if (current) {
          this.sessions.set({
            ...current,
            items: dedupeSessions(current.items, page.items),
          });
        }
        this.sessionsNextCursor.set(page.nextCursor ?? null);
        this.sessionsLoadingMore.set(false);
        queueMicrotask(() =>
          page.nextCursor ? trigger?.focus() : this.sessionsPagingStatus?.nativeElement.focus(),
        );
      },
      error: () => {
        this.sessionsLoadingMore.set(false);
        this.sessionsPageError.set(true);
        queueMicrotask(() => this.sessionsPagingStatus?.nativeElement.focus());
      },
    });
  }

  requestRevoke(session: StaffSessionItem, event: Event): void {
    if (this.confirmingSession() || this.isRevoked(session.id)) return;
    this.revokeTrigger = event.currentTarget as HTMLElement;
    this.confirmingSession.set(session);
    queueMicrotask(() => this.confirmRevokeButton?.nativeElement.focus());
  }

  cancelRevoke(): void {
    if (this.busy()) return;
    this.closeRevokeDialog();
  }

  onDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelRevoke();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = this.revokeDialog?.nativeElement;
    if (!dialog) return;
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ];
    const first = controls.at(0);
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  confirmRevoke(session: StaffSessionItem): void {
    this.busy.set(true);
    this.auth
      .csrfToken()
      .pipe(switchMap((csrf) => this.api.revokeSession(session.id, csrf)))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.revokedSessionIds.update((ids) => new Set([...ids, session.id]));
          this.notice.set('სესია გაუქმდა.');
          this.closeRevokeDialog();
          if (session.id === this.sessions()?.currentSessionId) {
            queueMicrotask(() => {
              this.auth.clearLocalSession();
              void this.router.navigate(['/login']);
            });
          }
        },
        error: () => {
          this.busy.set(false);
          this.notice.set('სესიის გაუქმება ვერ შესრულდა.');
        },
      });
  }

  isRevoked(sessionId: string): boolean {
    return this.revokedSessionIds().has(sessionId);
  }

  sessionLabel(session: StaffSessionItem): string {
    return (
      session.deviceLabel ||
      [session.browserFamily, session.osFamily].filter(Boolean).join(' · ') ||
      'უცნობი მოწყობილობა'
    );
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat('ka-GE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tbilisi',
    }).format(new Date(value));
  }

  private closeRevokeDialog(): void {
    const trigger = this.revokeTrigger;
    this.confirmingSession.set(null);
    this.revokeTrigger = null;
    queueMicrotask(() => trigger?.focus());
  }
}

function dedupeSessions(
  current: StaffSessionItem[],
  incoming: StaffSessionItem[],
): StaffSessionItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

function isUnavailable(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    ([404, 501, 503].includes(error.status) || error.error?.code === 'IDENTITY_V2_DISABLED')
  );
}
