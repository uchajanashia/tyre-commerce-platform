import { DOCUMENT, DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { Subject, catchError, combineLatest, map, of, startWith, switchMap, tap } from 'rxjs';

import {
  ApprovalActionIntent,
  ApprovalAllowedAction,
  ApprovalDetail,
  ApprovalListQuery,
  ApprovalListResponse,
  ApprovalSortField,
  ApprovalStatus,
  GovernanceApiError,
  GovernanceErrorKind,
  SortDirection,
} from '../../core/governance-contract';
import { GovernanceApiService } from '../../core/governance-api.service';

type ViewState = 'loading' | 'ready' | 'empty' | 'disabled' | 'error';
type ActionPhase = 'reason' | 'step_up';

interface ApprovalActionDialog {
  readonly action: ApprovalAllowedAction;
  readonly phase: ActionPhase;
  readonly reason: string;
  readonly stepUpCode: string;
  readonly intent: ApprovalActionIntent | null;
  readonly busy: boolean;
  readonly error: string | null;
}

interface BackgroundIsolationSnapshot {
  readonly element: HTMLElement;
  readonly inert: boolean;
  readonly ariaHidden: string | null;
}

type ApprovalRouteRequest =
  | { readonly kind: 'list'; readonly query: ApprovalListQuery }
  | { readonly kind: 'detail'; readonly id: string };

type ApprovalRouteResult =
  | { readonly kind: 'list'; readonly page: ApprovalListResponse }
  | { readonly kind: 'detail'; readonly request: ApprovalDetail }
  | { readonly kind: 'error'; readonly error: unknown };

const APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'expired',
  'stale',
  'executing',
  'executed',
  'known_safe_execution_failed',
  'external_outcome_unknown',
  'reconciling',
  'dead_lettered',
];

const SORT_FIELDS: readonly ApprovalSortField[] = [
  'createdAt',
  'expiresAt',
  'status',
  'actionType',
];

@Component({
  selector: 'adm-approval-center-page',
  imports: [DatePipe, RouterLink],
  template: `
    <section #pageBackground class="governance-page" aria-labelledby="approval-title">
      <header class="governance-heading">
        <div>
          <p>GOVERNANCE / APPROVALS</p>
          <h1 id="approval-title">დამტკიცების ცენტრი</h1>
          <span>სერვერის მიერ ავტორიზებული რიგი და უცვლელი გადაწყვეტილების მტკიცებულება.</span>
        </div>
        @if (detail()) {
          <a class="governance-back" routerLink="/approvals">← რიგზე დაბრუნება</a>
        } @else if (state() === 'ready' || state() === 'empty') {
          <button type="button" class="governance-secondary" (click)="reloadList()">
            განახლება
          </button>
        }
      </header>

      <p class="sr-only" aria-live="polite" aria-atomic="true">{{ liveMessage() }}</p>

      @if (state() === 'disabled') {
        <section class="governance-state governance-state--disabled" role="status">
          <strong>დამტკიცების პლატფორმა უსაფრთხოდ გამორთულია</strong>
          <p>
            UI და API საზღვარი არსებობს, თუმცა feature flag და სერვერის პოლიტიკა აქტიური არ არის.
            არც ერთი ქმედება არ შესრულდება.
          </p>
        </section>
      } @else if (state() === 'loading') {
        <section class="governance-state" role="status">
          <strong>მონაცემები იტვირთება</strong>
          <p>სერვერის ავტორიზებული ხედის მიღება მიმდინარეობს…</p>
        </section>
      } @else if (state() === 'error') {
        <section class="governance-state governance-state--error" role="alert">
          <strong>{{ errorTitle() }}</strong>
          <p>{{ errorMessage() }}</p>
          @if (canRetry()) {
            <button type="button" class="governance-secondary" (click)="retry()">
              ხელახლა ცდა
            </button>
          }
        </section>
      } @else if (detail(); as request) {
        <article class="approval-detail" aria-labelledby="approval-detail-title">
          <div class="approval-detail__lead">
            <div>
              <span class="governance-status" [attr.data-status]="request.status">
                <bdi dir="auto">{{ request.status }}</bdi>
              </span>
              <h2 #detailHeading id="approval-detail-title" tabindex="-1">
                <bdi dir="auto">{{ request.actionLabel }}</bdi>
              </h2>
              <p>
                <bdi dir="auto">{{ request.targetSummary }}</bdi>
              </p>
            </div>
            <div class="approval-actions" aria-label="დაშვებული მოქმედებები">
              @for (action of availableActions(request); track action) {
                <button
                  type="button"
                  [class.governance-danger]="action === 'reject' || action === 'cancel'"
                  (click)="openAction(action, $event)"
                >
                  {{ actionLabel(action) }}
                </button>
              } @empty {
                <span>სერვერს მოქმედება არ დაუშვია</span>
              }
            </div>
          </div>

          <section class="governance-section" aria-labelledby="approval-facts-title">
            <header><h3 id="approval-facts-title">უცვლელი მოთხოვნა</h3></header>
            <dl class="governance-facts">
              <div>
                <dt>მოთხოვნა</dt>
                <dd>
                  <bdi dir="auto">{{ request.id }}</bdi>
                </dd>
              </div>
              <div>
                <dt>ვერსია</dt>
                <dd>{{ request.version }}</dd>
              </div>
              <div>
                <dt>Action type</dt>
                <dd>
                  <bdi dir="auto">{{ request.actionType }}</bdi>
                </dd>
              </div>
              <div>
                <dt>მომთხოვნი</dt>
                <dd>
                  <bdi dir="auto">{{ request.requester.displayName }}</bdi>
                </dd>
              </div>
              <div>
                <dt>შექმნილია</dt>
                <dd>{{ request.createdAt | date: 'medium' }}</dd>
              </div>
              <div>
                <dt>ვადა</dt>
                <dd>
                  {{
                    request.expiresAt
                      ? (request.expiresAt | date: 'medium')
                      : 'სერვერს არ მოუწოდებია'
                  }}
                </dd>
              </div>
              <div>
                <dt>Schema</dt>
                <dd>{{ request.immutable.schemaVersion }}</dd>
              </div>
              <div>
                <dt>Adapter</dt>
                <dd>
                  <bdi dir="auto">{{ request.immutable.adapterVersion }}</bdi>
                </dd>
              </div>
              <div>
                <dt>Policy version</dt>
                <dd>
                  <bdi dir="auto">{{ request.immutable.policyVersion }}</bdi>
                </dd>
              </div>
              @if (request.quorum; as quorum) {
                <div>
                  <dt>Quorum</dt>
                  <dd>{{ quorum.satisfied }} / {{ quorum.required }}</dd>
                </div>
              }
            </dl>
            <div class="governance-hashes">
              <span
                >Payload hash
                <code
                  ><bdi dir="auto">{{ request.immutable.payloadHash }}</bdi></code
                ></span
              >
              <span
                >Target-set hash
                <code
                  ><bdi dir="auto">{{ request.immutable.targetSetHash }}</bdi></code
                ></span
              >
              <span
                >Policy hash
                <code
                  ><bdi dir="auto">{{ request.immutable.policyHash }}</bdi></code
                ></span
              >
            </div>
          </section>

          <section class="governance-section" aria-labelledby="approval-targets-title">
            <header><h3 id="approval-targets-title">სამიზნეები და უსაფრთხო preview</h3></header>
            <ul class="governance-targets">
              @for (target of request.immutable.targets; track target.type + target.id) {
                <li>
                  <strong
                    ><bdi dir="auto">{{ target.label }}</bdi></strong
                  >
                  <span
                    ><bdi dir="auto">{{ target.type }} · {{ target.id }}</bdi> · v{{
                      target.version
                    }}</span
                  >
                </li>
              }
            </ul>
            <dl class="governance-projection">
              @for (field of request.preview.fields; track field.key) {
                <div>
                  <dt>
                    <bdi dir="auto">{{ field.label }}</bdi>
                  </dt>
                  <dd>
                    <bdi dir="auto">{{ field.value }}</bdi>
                  </dd>
                </div>
              } @empty {
                <div>
                  <dt>Preview</dt>
                  <dd>სერვერს უსაფრთხო projection არ მოუწოდებია.</dd>
                </div>
              }
            </dl>
            @if (request.preview.changes.length) {
              <div class="governance-table-wrap">
                <table class="governance-diff" aria-label="ცვლილებების უსაფრთხო შედარება">
                  <thead>
                    <tr>
                      <th id="approval-diff-field" scope="col">ველი</th>
                      <th id="approval-diff-before" scope="col">მანამდე</th>
                      <th id="approval-diff-after" scope="col">შემდეგ</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (change of request.preview.changes; track change.key) {
                      <tr>
                        <th scope="row">
                          <bdi dir="auto">{{ change.label }}</bdi>
                        </th>
                        <td headers="approval-diff-field approval-diff-before">
                          <bdi dir="auto">{{ change.before ?? '—' }}</bdi>
                        </td>
                        <td headers="approval-diff-field approval-diff-after">
                          <bdi dir="auto">{{ change.after ?? '—' }}</bdi>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>

          <section class="governance-section" aria-labelledby="approval-timeline-title">
            <header><h3 id="approval-timeline-title">Timeline</h3></header>
            <ol class="governance-timeline">
              @for (entry of request.timeline; track entry.id) {
                <li>
                  <time [attr.datetime]="entry.occurredAt">{{
                    entry.occurredAt | date: 'medium'
                  }}</time>
                  <strong
                    ><bdi dir="auto">{{ entry.label }}</bdi></strong
                  >
                  <span
                    ><bdi dir="auto">{{ entry.actor?.displayName ?? 'სისტემა' }}</bdi>
                    @if (entry.outcome) {
                      · <bdi dir="auto">{{ entry.outcome }}</bdi>
                    }
                  </span>
                  @if (entry.reason) {
                    <p>
                      <bdi dir="auto">{{ entry.reason }}</bdi>
                    </p>
                  }
                </li>
              }
            </ol>
          </section>
        </article>
      } @else {
        <form
          class="governance-filters"
          aria-label="დამტკიცებების ფილტრები"
          (submit)="applyFilters($event)"
        >
          <label
            >სტატუსი
            <select name="status" [value]="query().status ?? ''">
              <option value="">ყველა</option>
              @for (status of statuses; track status) {
                <option [value]="status">{{ status }}</option>
              }
            </select>
          </label>
          <label>Action type <input name="actionType" [value]="query().actionType ?? ''" /></label>
          <label
            >მომთხოვნის ID <input name="requesterId" [value]="query().requesterId ?? ''"
          /></label>
          <label
            >სორტირება
            <select name="sort" [value]="query().sort ?? 'createdAt'">
              @for (field of sortFields; track field) {
                <option [value]="field">{{ field }}</option>
              }
            </select>
          </label>
          <label
            >მიმართულება
            <select name="direction" [value]="query().direction ?? 'desc'">
              <option value="desc">კლებადი</option>
              <option value="asc">ზრდადი</option>
            </select>
          </label>
          <button type="submit">გამოყენება</button>
        </form>

        @if (state() === 'empty') {
          <section class="governance-state" role="status">
            <strong>რიგი ცარიელია</strong>
            <p>ამ ფილტრებით ავტორიზებული მოთხოვნა ვერ მოიძებნა.</p>
          </section>
        } @else if (list(); as page) {
          <div class="governance-table-wrap">
            <table class="governance-table">
              <thead class="governance-table__head">
                <tr>
                  <th id="approval-col-request" scope="col">მოთხოვნა</th>
                  <th id="approval-col-action" scope="col">Action / target</th>
                  <th id="approval-col-requester" scope="col">მომთხოვნი</th>
                  <th id="approval-col-status" scope="col">სტატუსი</th>
                  <th id="approval-col-created" scope="col">შექმნილია</th>
                  <th id="approval-col-open" scope="col">დეტალი</th>
                </tr>
              </thead>
              <tbody>
                @for (item of page.items; track item.id) {
                  <tr>
                    <td headers="approval-col-request" data-label="მოთხოვნა">
                      <strong
                        ><bdi dir="auto">{{ item.id }}</bdi></strong
                      ><small>v{{ item.version }}</small>
                    </td>
                    <td headers="approval-col-action" data-label="Action / target">
                      <strong
                        ><bdi dir="auto">{{ item.actionLabel }}</bdi></strong
                      >
                      <small
                        ><bdi dir="auto">{{ item.targetSummary }}</bdi></small
                      >
                    </td>
                    <td headers="approval-col-requester" data-label="მომთხოვნი">
                      <bdi dir="auto">{{ item.requester.displayName }}</bdi>
                    </td>
                    <td headers="approval-col-status" data-label="სტატუსი">
                      <span class="governance-status" [attr.data-status]="item.status"
                        ><bdi dir="auto">{{ item.status }}</bdi></span
                      >
                    </td>
                    <td headers="approval-col-created" data-label="შექმნილია">
                      <time [attr.datetime]="item.createdAt">{{
                        item.createdAt | date: 'short'
                      }}</time>
                    </td>
                    <td headers="approval-col-open">
                      <a [routerLink]="['/approvals', item.id]">გახსნა</a>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <nav class="governance-pagination" aria-label="დამტკიცებების გვერდები">
            <button
              type="button"
              [disabled]="!page.previousCursor"
              (click)="goToCursor(page.previousCursor)"
            >
              წინა
            </button>
            <button
              type="button"
              [disabled]="!page.nextCursor"
              (click)="goToCursor(page.nextCursor)"
            >
              შემდეგი
            </button>
          </nav>
        }
      }
    </section>

    @if (actionDialog(); as dialog) {
      <dialog
        #actionModal
        class="governance-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-action-title"
        [attr.aria-busy]="dialog.busy"
        (cancel)="handleDialogCancel($event)"
        (click)="handleDialogBackdrop($event)"
      >
        <h2 id="approval-action-title" tabindex="-1">
          {{ actionLabel(dialog.action) }} — დადასტურება
        </h2>
        @if (dialog.phase === 'reason') {
          <p>მიზეზი სავალდებულოა და გადაწყვეტილების მტკიცებულებაში plain text-ად ჩაიწერება.</p>
          <label for="approval-action-reason">მიზეზი</label>
          <textarea
            id="approval-action-reason"
            maxlength="1000"
            [value]="dialog.reason"
            [attr.aria-invalid]="dialog.error && !dialog.reason.trim() ? 'true' : null"
            (input)="updateReason($event)"
          ></textarea>
        } @else {
          <p>Action intent მიღებულია. შეიყვანეთ მიმდინარე MFA კოდი ამ კონკრეტული მოქმედებისთვის.</p>
          <label for="approval-step-up">MFA კოდი</label>
          <input
            #stepUpInput
            id="approval-step-up"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            maxlength="6"
            [value]="dialog.stepUpCode"
            (input)="updateStepUpCode($event)"
          />
        }
        @if (dialog.error) {
          <p class="governance-modal__error" role="alert">{{ dialog.error }}</p>
        }
        @if (dialog.busy) {
          <p class="governance-modal__progress" role="status" aria-live="assertive">
            ქმედება მუშავდება. ფანჯარა დასრულებამდე არ დაიხურება.
          </p>
        }
        <div class="governance-modal__actions">
          <button
            type="button"
            class="governance-secondary"
            [disabled]="dialog.busy"
            (click)="closeActionDialog()"
          >
            გაუქმება
          </button>
          @if (dialog.phase === 'reason') {
            <button type="button" [disabled]="dialog.busy" (click)="prepareAction()">
              Intent-ის მომზადება
            </button>
          } @else {
            <button type="button" [disabled]="dialog.busy" (click)="submitAction()">
              ქმედების დადასტურება
            </button>
          }
        </div>
      </dialog>
    }
  `,
})
export class ApprovalCenterPage {
  private readonly api = inject(GovernanceApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly refreshRoute = new Subject<void>();
  private actionTrigger: HTMLElement | null = null;
  private backgroundIsolation: BackgroundIsolationSnapshot[] = [];

  readonly statuses = APPROVAL_STATUSES;
  readonly sortFields = SORT_FIELDS;
  readonly state = signal<ViewState>('loading');
  readonly list = signal<ApprovalListResponse | null>(null);
  readonly detail = signal<ApprovalDetail | null>(null);
  readonly query = signal<ApprovalListQuery>({ sort: 'createdAt', direction: 'desc' });
  readonly errorKind = signal<GovernanceErrorKind | null>(null);
  readonly liveMessage = signal('');
  readonly actionDialog = signal<ApprovalActionDialog | null>(null);

  @ViewChild('actionModal') private actionModal?: ElementRef<HTMLDialogElement>;
  @ViewChild('stepUpInput') private stepUpInput?: ElementRef<HTMLInputElement>;
  @ViewChild('detailHeading') private detailHeading?: ElementRef<HTMLElement>;
  @ViewChild('pageBackground') private pageBackground?: ElementRef<HTMLElement>;

  constructor() {
    if (!this.api.config.approvalsEnabled) {
      this.state.set('disabled');
      this.liveMessage.set('დამტკიცების პლატფორმა გამორთულია.');
      return;
    }

    combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
      this.refreshRoute.pipe(startWith(undefined)),
    ])
      .pipe(
        map(([routeParams, queryParams]): ApprovalRouteRequest => {
          const id = routeParams.get('id');
          return id
            ? { kind: 'detail', id }
            : { kind: 'list', query: readApprovalQuery(queryParams) };
        }),
        tap((request) => this.beginRouteRequest(request)),
        switchMap((request) =>
          (request.kind === 'detail'
            ? this.api
                .getApproval(request.id)
                .pipe(map((detail): ApprovalRouteResult => ({ kind: 'detail', request: detail })))
            : this.api
                .listApprovals(request.query)
                .pipe(map((page): ApprovalRouteResult => ({ kind: 'list', page })))
          ).pipe(catchError((error: unknown) => of<ApprovalRouteResult>({ kind: 'error', error }))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => this.applyRouteResult(result));

    this.destroyRef.onDestroy(() => this.restoreBackgroundIsolation());
  }

  reloadList(): void {
    this.refreshRoute.next();
  }

  retry(): void {
    this.refreshRoute.next();
  }

  applyFilters(event: Event): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    void this.router.navigate(['/approvals'], {
      queryParams: compactParams({
        status: String(data.get('status') ?? ''),
        actionType: String(data.get('actionType') ?? '').trim(),
        requesterId: String(data.get('requesterId') ?? '').trim(),
        sort: String(data.get('sort') ?? 'createdAt'),
        direction: String(data.get('direction') ?? 'desc'),
      }),
    });
  }

  goToCursor(cursor: string | null): void {
    if (!cursor) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { cursor },
      queryParamsHandling: 'merge',
    });
  }

  openAction(action: ApprovalAllowedAction, event: Event): void {
    const request = this.detail();
    if (this.actionDialog() || !request || !this.availableActions(request).includes(action)) return;
    this.actionTrigger = event.currentTarget as HTMLElement;
    this.actionDialog.set({
      action,
      phase: 'reason',
      reason: '',
      stepUpCode: '',
      intent: null,
      busy: false,
      error: null,
    });
    queueMicrotask(() => {
      const modal = this.actionModal?.nativeElement;
      if (!modal) return;
      this.isolateBackground();
      if (typeof modal.showModal === 'function' && !modal.open) modal.showModal();
      else modal.setAttribute('open', '');
      modal.querySelector<HTMLElement>('h2')?.focus();
    });
  }

  updateReason(event: Event): void {
    this.patchDialog({ reason: (event.target as HTMLTextAreaElement).value, error: null });
  }

  updateStepUpCode(event: Event): void {
    this.patchDialog({ stepUpCode: (event.target as HTMLInputElement).value, error: null });
  }

  prepareAction(): void {
    const request = this.detail();
    const dialog = this.actionDialog();
    if (!request || !dialog || dialog.busy) return;
    if (!dialog.reason.trim()) {
      this.patchDialog({ error: 'მიუთითეთ მიზეზი.' });
      return;
    }
    this.patchDialog({ busy: true, error: null });
    this.api
      .prepareApprovalAction(request, dialog.action)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (intent) => {
          this.patchDialog({ phase: 'step_up', intent, busy: false });
          this.liveMessage.set('Action intent მზადაა; საჭიროა MFA დადასტურება.');
          queueMicrotask(() => this.stepUpInput?.nativeElement.focus());
        },
        error: (error: unknown) =>
          this.patchDialog({ busy: false, error: actionErrorMessage(error) }),
      });
  }

  submitAction(): void {
    const request = this.detail();
    const dialog = this.actionDialog();
    if (!request || !dialog?.intent || dialog.busy) return;
    if (!/^\d{6}$/u.test(dialog.stepUpCode)) {
      this.patchDialog({ error: 'MFA კოდი ზუსტად 6 ციფრი უნდა იყოს.' });
      return;
    }
    if (Date.parse(dialog.intent.expiresAt) <= Date.now()) {
      this.patchDialog({
        phase: 'reason',
        intent: null,
        stepUpCode: '',
        error: 'Action intent-ის ვადა გავიდა. მოამზადეთ თავიდან.',
      });
      return;
    }
    this.patchDialog({ busy: true, error: null });
    this.api
      .executeApprovalAction(
        request,
        dialog.action,
        dialog.reason.trim(),
        dialog.stepUpCode,
        dialog.intent,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ request: updated }) => {
          this.detail.set(updated);
          this.liveMessage.set('დამტკიცების მოთხოვნა განახლდა.');
          this.closeActionDialog(true);
        },
        error: (error: unknown) =>
          this.patchDialog({ busy: false, error: actionErrorMessage(error) }),
      });
  }

  closeActionDialog(force = false): boolean {
    const current = this.actionDialog();
    if (current?.busy && !force) return false;
    const hadDialog = current !== null;
    const modal = this.actionModal?.nativeElement;
    if (modal?.open && typeof modal.close === 'function') modal.close();
    else modal?.removeAttribute('open');
    this.actionDialog.set(null);
    this.restoreBackgroundIsolation();
    if (hadDialog) {
      queueMicrotask(() => {
        const target = this.actionTrigger?.isConnected
          ? this.actionTrigger
          : this.detailHeading?.nativeElement;
        target?.focus();
      });
    }
    return hadDialog;
  }

  handleDialogCancel(event: Event): void {
    event.preventDefault();
    this.closeActionDialog();
  }

  handleDialogBackdrop(event: MouseEvent): void {
    const modal = this.actionModal?.nativeElement;
    if (event.target !== modal || !modal) return;
    const bounds = modal.getBoundingClientRect();
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outside) this.closeActionDialog();
  }

  canLeaveGovernance(): boolean {
    return !this.actionDialog()?.busy;
  }

  actionLabel(action: ApprovalAllowedAction): string {
    return action === 'approve' ? 'დამტკიცება' : action === 'reject' ? 'უარყოფა' : 'გაუქმება';
  }

  availableActions(request: ApprovalDetail): readonly ApprovalAllowedAction[] {
    if (request.status !== 'pending') return [];
    const known = new Set<ApprovalAllowedAction>(['approve', 'reject', 'cancel']);
    return [...new Set(request.allowedActions.filter((action) => known.has(action)))];
  }

  errorTitle(): string {
    const kind = this.errorKind();
    if (kind === 'forbidden') return 'წვდომა აკრძალულია';
    if (kind === 'not_found') return 'მოთხოვნა ვერ მოიძებნა';
    if (kind === 'stale') return 'მოთხოვნა მოძველდა';
    if (kind === 'expired') return 'მოთხოვნის ვადა გავიდა';
    if (kind === 'conflict') return 'ვერსიის კონფლიქტი';
    if (kind === 'disabled' || kind === 'unavailable') return 'სერვისი უსაფრთხოდ მიუწვდომელია';
    return 'მონაცემების მიღება ვერ მოხერხდა';
  }

  errorMessage(): string {
    const kind = this.errorKind();
    if (kind === 'forbidden')
      return 'თქვენს მიმდინარე უფლებებსა და scope-ს ეს ჩანაწერი არ ეკუთვნის.';
    if (kind === 'not_found')
      return 'ჩანაწერი არ არსებობს ან მისი არსებობის გამჟღავნება დაუშვებელია.';
    if (kind === 'stale') return 'სამიზნე, policy ან ვერსია შეიცვალა; მოქმედება არ შესრულებულა.';
    if (kind === 'expired') return 'ვადის გასვლის შემდეგ გადაწყვეტილება არ მიიღება.';
    if (kind === 'conflict') return 'სერვერზე უფრო ახალი ვერსია არსებობს. განაახლეთ მონაცემები.';
    if (kind === 'disabled' || kind === 'unavailable')
      return 'საჭირო backend capability ან policy აქტიური არ არის; მოქმედება დაბლოკილია.';
    if (kind === 'dependency')
      return 'დამოკიდებული სერვისი მიუწვდომელია. უსაფრთხო მდგომარეობა შენარჩუნებულია.';
    return 'სცადეთ ხელახლა. გაურკვეველი შედეგი წარმატებად არ ითვლება.';
  }

  canRetry(): boolean {
    return !['forbidden', 'not_found', 'disabled', 'unavailable'].includes(this.errorKind() ?? '');
  }

  @HostListener('document:keydown', ['$event'])
  handleDialogKeys(event: KeyboardEvent): void {
    if (!this.actionDialog()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeActionDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [
      ...(this.actionModal?.nativeElement.querySelectorAll<HTMLElement>(
        '[tabindex="-1"], button:not(:disabled), input:not(:disabled), textarea:not(:disabled)',
      ) ?? []),
    ];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private beginRouteRequest(request: ApprovalRouteRequest): void {
    if (this.actionDialog() && !this.actionDialog()?.busy) this.closeActionDialog();
    if (request.kind === 'list') {
      this.query.set(request.query);
      this.detail.set(null);
    } else {
      this.list.set(null);
      this.detail.set(null);
    }
    this.state.set('loading');
    this.errorKind.set(null);
  }

  private applyRouteResult(result: ApprovalRouteResult): void {
    if (result.kind === 'error') {
      this.showError(result.error);
      return;
    }
    if (result.kind === 'detail') {
      this.detail.set(result.request);
      this.state.set('ready');
      this.liveMessage.set('დამტკიცების დეტალი ჩაიტვირთა.');
      return;
    }
    this.list.set(result.page);
    this.state.set(result.page.items.length ? 'ready' : 'empty');
    this.liveMessage.set(`${result.page.items.length} მოთხოვნა ჩაიტვირთა.`);
  }

  private showError(error: unknown): void {
    const kind = error instanceof GovernanceApiError ? error.kind : 'unknown';
    this.errorKind.set(kind);
    this.state.set(kind === 'disabled' ? 'disabled' : 'error');
    this.liveMessage.set(this.errorTitle());
  }

  private patchDialog(patch: Partial<ApprovalActionDialog>): void {
    const current = this.actionDialog();
    if (current) this.actionDialog.set({ ...current, ...patch });
  }

  private isolateBackground(): void {
    if (this.backgroundIsolation.length) return;
    const candidates = [
      this.pageBackground?.nativeElement,
      this.document.querySelector<HTMLElement>('.admin-sidebar'),
      this.document.querySelector<HTMLElement>('.admin-topbar'),
    ].filter((element): element is HTMLElement => element !== undefined && element !== null);
    this.backgroundIsolation = candidates.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    }));
    for (const { element } of this.backgroundIsolation) {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    }
  }

  private restoreBackgroundIsolation(): void {
    for (const snapshot of this.backgroundIsolation) {
      snapshot.element.inert = snapshot.inert;
      if (snapshot.ariaHidden === null) snapshot.element.removeAttribute('aria-hidden');
      else snapshot.element.setAttribute('aria-hidden', snapshot.ariaHidden);
    }
    this.backgroundIsolation = [];
  }
}

export function readApprovalQuery(params: ParamMap): ApprovalListQuery {
  const statusValue = params.get('status');
  const sortValue = params.get('sort');
  const directionValue = params.get('direction');
  return {
    ...(APPROVAL_STATUSES.includes(statusValue as ApprovalStatus)
      ? { status: statusValue as ApprovalStatus }
      : {}),
    ...(params.get('actionType') ? { actionType: params.get('actionType')! } : {}),
    ...(params.get('requesterId') ? { requesterId: params.get('requesterId')! } : {}),
    sort: SORT_FIELDS.includes(sortValue as ApprovalSortField)
      ? (sortValue as ApprovalSortField)
      : 'createdAt',
    direction: directionValue === 'asc' ? 'asc' : ('desc' as SortDirection),
    ...(params.get('cursor') ? { cursor: params.get('cursor')! } : {}),
  };
}

function compactParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== ''));
}

function actionErrorMessage(error: unknown): string {
  const kind = error instanceof GovernanceApiError ? error.kind : 'unknown';
  if (kind === 'stale') return 'მოთხოვნა მოძველდა; ქმედება არ შესრულებულა.';
  if (kind === 'expired') return 'მოთხოვნის ან intent-ის ვადა გავიდა.';
  if (kind === 'conflict') return 'ვერსიის კონფლიქტი. დახურეთ ფანჯარა და განაახლეთ დეტალი.';
  if (kind === 'forbidden') return 'სერვერმა მოქმედება მიმდინარე უფლებებით არ დაუშვა.';
  if (kind === 'disabled' || kind === 'unavailable') return 'ქმედება უსაფრთხოდ გამორთულია.';
  return 'ქმედება ვერ დასრულდა. წარმატება არ დაფიქსირებულა.';
}
