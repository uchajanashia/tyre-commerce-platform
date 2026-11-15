import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import {
  Subject,
  catchError,
  combineLatest,
  map,
  of,
  startWith,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';

import {
  AuditEventDetail,
  AuditEventListResult,
  AuditEventOutcome,
  AuditEventSource,
  AuditEventSummary,
  AuditSafeField,
  AuditSafeFieldClassification,
} from '@tyre/shared';

import { AuthService } from '../../core/auth.service';
import {
  AUDIT_EVENT_OUTCOMES,
  AUDIT_EVENT_SOURCES,
  AUDIT_SORT_DIRECTIONS,
  AUDIT_SORT_FIELDS,
  AuditReaderRequest,
} from '../../core/audit-transport';
import { GovernanceApiService } from '../../core/governance-api.service';
import { GovernanceApiError, GovernanceErrorKind } from '../../core/governance-contract';

type ViewState = 'loading' | 'ready' | 'empty' | 'disabled' | 'error';
type FocusKey =
  | 'workspace'
  | 'reload'
  | 'filter-submit'
  | 'filter-reset'
  | 'page-next'
  | 'page-back';

interface AuditSummaryView {
  readonly eventId: string;
  readonly eventType: string;
  readonly title: string;
  readonly occurredAt: string;
  readonly actorText: string;
  readonly entityText: string;
  readonly outcome: AuditEventOutcome;
  readonly serverCorrelationId: string;
}

interface AuditFieldView {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly classification: AuditSafeFieldClassification;
}

interface AuditDiffView {
  readonly key: string;
  readonly label: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly classification: AuditSafeFieldClassification;
}

interface AuditDetailView extends AuditSummaryView {
  readonly schemaVersion: number;
  readonly subjectText: string;
  readonly action: string;
  readonly entityVersionText: string;
  readonly source: AuditEventSource;
  readonly retentionClass: string;
  readonly scopeText: string;
  readonly scopeResolverText: string;
  readonly authorizationPolicyVersion: number;
  readonly reasonCode: string;
  readonly approvalRequestId: string;
  readonly approvalExecutionId: string;
  readonly causationId: string;
  readonly clientRequestId: string;
  readonly bulkOperationId: string;
  readonly bulkItemId: string;
  readonly changes: readonly AuditDiffView[];
  readonly metadata: readonly AuditFieldView[];
}

interface AuditListView {
  readonly items: readonly AuditSummaryView[];
  readonly nextCursor: string | null;
  readonly asOfOccurredAt: string;
}

type AuditRouteRequest =
  | {
      readonly kind: 'list';
      readonly query: AuditReaderRequest;
      readonly cursorStack: readonly string[];
      readonly focusKey: FocusKey;
    }
  | { readonly kind: 'detail'; readonly id: string };

type AuditRouteResult =
  | {
      readonly kind: 'list';
      readonly page: AuditListView;
      readonly cursorStack: readonly string[];
      readonly focusKey: FocusKey;
    }
  | { readonly kind: 'detail'; readonly event: AuditDetailView }
  | { readonly kind: 'error'; readonly error: unknown };

type AuditPageAction =
  | { readonly kind: 'route' }
  | { readonly kind: 'refresh'; readonly focusKey: FocusKey }
  | {
      readonly kind: 'cursor';
      readonly cursorStack: readonly string[];
      readonly focusKey: FocusKey;
    };

@Component({
  selector: 'adm-audit-operations-page',
  imports: [DatePipe, RouterLink],
  template: `
    <section
      class="governance-page"
      aria-labelledby="audit-title"
      [attr.aria-busy]="state() === 'loading' ? 'true' : null"
    >
      <header class="governance-heading">
        <div>
          <p>GOVERNANCE / AUDIT</p>
          <h1 id="audit-title">აუდიტის ოპერაციები</h1>
          <p>ავტორიზებული, უცვლელი და მხოლოდ წაკითხვადი ოპერაციული მტკიცებულება.</p>
        </div>
        <div class="governance-heading__actions">
          <span class="governance-readonly">READ ONLY</span>
          @if (detailRoute()) {
            <a routerLink="/audit" data-focus-key="reload" (click)="prepareListRouteFocus()">
              სიაში დაბრუნება
            </a>
          } @else {
            <button
              type="button"
              class="governance-secondary"
              data-focus-key="reload"
              [disabled]="state() === 'loading'"
              (click)="reloadList()"
            >
              განახლება
            </button>
          }
        </div>
      </header>

      <h2 #workspaceFocus id="audit-workspace-focus" class="sr-only" tabindex="-1">
        აუდიტის სამუშაო სივრცე
      </h2>
      <p class="sr-only" aria-live="polite">{{ liveMessage() }}</p>

      @if (state() === 'disabled') {
        <section class="governance-state" role="status">
          <strong>Audit reader გამორთულია</strong>
          <p>ფუნქცია უსაფრთხოდ არის დაბლოკილი rollout-ის დასრულებამდე.</p>
        </section>
      } @else if (state() === 'error') {
        <section
          #errorAlert
          class="governance-state governance-state--error"
          role="alert"
          tabindex="-1"
        >
          <strong>{{ errorTitle() }}</strong>
          <p>{{ errorMessage() }}</p>
          @if (canRetry()) {
            <button type="button" (click)="retry()">ხელახლა ცდა</button>
          }
        </section>
      } @else if (state() === 'loading') {
        <section class="governance-state" role="status">
          <strong>აუდიტის მტკიცებულება იტვირთება</strong>
        </section>
      } @else if (detail(); as event) {
        <article class="audit-detail" aria-labelledby="audit-detail-title">
          <header>
            <p>
              <bdi dir="auto">{{ event.eventType }}</bdi>
            </p>
            <h2 #detailHeading id="audit-detail-title" tabindex="-1">
              <bdi dir="auto">{{ event.title }}</bdi>
            </h2>
            <time [attr.datetime]="event.occurredAt">{{ event.occurredAt | date: 'medium' }}</time>
          </header>

          <dl class="governance-facts">
            <div>
              <dt>Event ID</dt>
              <dd>
                <code
                  ><bdi dir="auto">{{ event.eventId }}</bdi></code
                >
              </dd>
            </div>
            <div>
              <dt>Actor</dt>
              <dd>
                <bdi dir="auto">{{ event.actorText }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>
                <bdi dir="auto">{{ event.subjectText }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Entity</dt>
              <dd>
                <bdi dir="auto">{{ event.entityText }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Entity version</dt>
              <dd>
                <bdi dir="auto">{{ event.entityVersionText }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Action</dt>
              <dd>
                <bdi dir="auto">{{ event.action }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Outcome</dt>
              <dd>
                <bdi dir="auto">{{ event.outcome }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                <bdi dir="auto">{{ event.source }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Correlation</dt>
              <dd>
                <code
                  ><bdi dir="auto">{{ event.serverCorrelationId }}</bdi></code
                >
              </dd>
            </div>
            <div>
              <dt>Schema version</dt>
              <dd>{{ event.schemaVersion }}</dd>
            </div>
            <div>
              <dt>Retention</dt>
              <dd>
                <bdi dir="auto">{{ event.retentionClass }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Authorization scope</dt>
              <dd>
                <bdi dir="auto">{{ event.scopeText }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Scope resolver</dt>
              <dd>
                <bdi dir="auto">{{ event.scopeResolverText }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Policy version</dt>
              <dd>{{ event.authorizationPolicyVersion }}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd>
                <bdi dir="auto">{{ event.reasonCode }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Approval request</dt>
              <dd>
                <bdi dir="auto">{{ event.approvalRequestId }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Approval execution</dt>
              <dd>
                <bdi dir="auto">{{ event.approvalExecutionId }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Causation</dt>
              <dd>
                <bdi dir="auto">{{ event.causationId }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Client request</dt>
              <dd>
                <bdi dir="auto">{{ event.clientRequestId }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Bulk operation</dt>
              <dd>
                <bdi dir="auto">{{ event.bulkOperationId }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Bulk item</dt>
              <dd>
                <bdi dir="auto">{{ event.bulkItemId }}</bdi>
              </dd>
            </div>
          </dl>

          <section aria-labelledby="audit-diff-title">
            <h3 id="audit-diff-title">Before / After</h3>
            <div class="governance-table-wrap">
              <table class="governance-diff">
                <thead>
                  <tr>
                    <th id="audit-diff-field" scope="col">ველი</th>
                    <th id="audit-diff-before" scope="col">Before</th>
                    <th id="audit-diff-after" scope="col">After</th>
                    <th id="audit-diff-classification" scope="col">Classification</th>
                  </tr>
                </thead>
                <tbody>
                  @for (change of event.changes; track change.key) {
                    <tr>
                      <th id="audit-diff-row-{{ $index }}" scope="row">
                        <bdi dir="auto">{{ change.label }}</bdi>
                      </th>
                      <td headers="audit-diff-field audit-diff-before audit-diff-row-{{ $index }}">
                        <bdi dir="auto">{{ change.before ?? '—' }}</bdi>
                      </td>
                      <td headers="audit-diff-field audit-diff-after audit-diff-row-{{ $index }}">
                        <bdi dir="auto">{{ change.after ?? '—' }}</bdi>
                      </td>
                      <td
                        headers="audit-diff-field audit-diff-classification audit-diff-row-{{
                          $index
                        }}"
                      >
                        <bdi dir="auto">{{ change.classification }}</bdi>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="audit-metadata-title">
            <h3 id="audit-metadata-title">Metadata</h3>
            <dl class="governance-facts">
              @for (field of event.metadata; track field.key) {
                <div>
                  <dt>
                    <bdi dir="auto">{{ field.label }}</bdi>
                  </dt>
                  <dd>
                    <bdi dir="auto">{{ field.value }}</bdi>
                    <small
                      ><bdi dir="auto">{{ field.classification }}</bdi></small
                    >
                  </dd>
                </div>
              }
            </dl>
          </section>
        </article>
      } @else {
        <form
          class="governance-filters governance-filters--audit"
          aria-label="აუდიტის ფილტრები"
          (submit)="applyFilters($event)"
        >
          <label
            >დაწყება
            <input
              type="datetime-local"
              name="occurredFrom"
              [value]="inputDate(query().occurredFrom)"
          /></label>
          <label
            >დასრულება
            <input type="datetime-local" name="occurredTo" [value]="inputDate(query().occurredTo)"
          /></label>
          <label
            >Event family
            <input maxlength="128" name="eventFamily" [value]="query().eventFamily ?? ''"
          /></label>
          <label
            >Outcome
            <select name="outcome" [value]="query().outcome ?? ''">
              <option value="">ყველა</option>
              @for (outcome of outcomes; track outcome) {
                <option [value]="outcome">{{ outcome }}</option>
              }
            </select></label
          >
          <label
            >Actor ID <input maxlength="128" name="actorId" [value]="query().actorId ?? ''"
          /></label>
          <label
            >Entity type
            <input maxlength="128" name="entityType" [value]="query().entityType ?? ''"
          /></label>
          <label
            >Entity ID <input maxlength="128" name="entityId" [value]="query().entityId ?? ''"
          /></label>
          <label
            >Approval request
            <input
              maxlength="128"
              name="approvalRequestId"
              [value]="query().approvalRequestId ?? ''"
          /></label>
          <label
            >Approval execution
            <input
              maxlength="128"
              name="approvalExecutionId"
              [value]="query().approvalExecutionId ?? ''"
          /></label>
          <label
            >Server correlation ID
            <input
              maxlength="128"
              name="serverCorrelationId"
              [value]="query().serverCorrelationId ?? ''"
          /></label>
          <label
            >Causation ID
            <input maxlength="128" name="causationId" [value]="query().causationId ?? ''"
          /></label>
          <label
            >Bulk operation
            <input maxlength="128" name="bulkOperationId" [value]="query().bulkOperationId ?? ''"
          /></label>
          <label
            >Bulk item <input maxlength="128" name="bulkItemId" [value]="query().bulkItemId ?? ''"
          /></label>
          <label
            >Source
            <select name="source" [value]="query().source ?? ''">
              <option value="">ყველა</option>
              @for (source of sources; track source) {
                <option [value]="source">{{ source }}</option>
              }
            </select></label
          >
          <label
            >Retention class
            <input maxlength="128" name="retentionClass" [value]="query().retentionClass ?? ''"
          /></label>
          <label
            >სორტირება
            <select name="sortField" [value]="query().sortField ?? 'occurredAt'">
              @for (field of sortFields; track field) {
                <option [value]="field">{{ field }}</option>
              }
            </select></label
          >
          <label
            >მიმართულება
            <select name="sortDirection" [value]="query().sortDirection ?? 'desc'">
              <option value="desc">კლებადი</option>
              <option value="asc">ზრდადი</option>
            </select></label
          >
          <button type="submit" data-focus-key="filter-submit">გამოყენება</button>
          <button
            type="button"
            class="governance-secondary"
            data-focus-key="filter-reset"
            (click)="resetFilters()"
          >
            გასუფთავება
          </button>
        </form>

        @if (state() === 'empty') {
          <section class="governance-state" role="status">
            <strong>ჩანაწერი ვერ მოიძებნა</strong>
            <p>ამ ფილტრებით ავტორიზებული event არ დაბრუნდა.</p>
          </section>
        } @else if (list(); as page) {
          <p>
            Snapshot:
            <time [attr.datetime]="page.asOfOccurredAt">{{
              page.asOfOccurredAt | date: 'medium'
            }}</time>
          </p>
          <div class="governance-table-wrap">
            <table class="governance-table governance-table--audit">
              <thead class="governance-table__head">
                <tr>
                  <th id="audit-col-time" scope="col">დრო</th>
                  <th id="audit-col-event" scope="col">Event</th>
                  <th id="audit-col-actor" scope="col">Actor</th>
                  <th id="audit-col-entity" scope="col">Entity</th>
                  <th id="audit-col-outcome" scope="col">Outcome</th>
                  <th id="audit-col-correlation" scope="col">Correlation</th>
                  <th id="audit-col-open" scope="col">დეტალი</th>
                </tr>
              </thead>
              <tbody>
                @for (event of page.items; track event.eventId) {
                  <tr>
                    <td headers="audit-col-time" data-label="დრო">
                      <time [attr.datetime]="event.occurredAt">{{
                        event.occurredAt | date: 'short'
                      }}</time>
                    </td>
                    <td headers="audit-col-event" data-label="Event">
                      <strong
                        ><bdi dir="auto">{{ event.title }}</bdi></strong
                      ><small
                        ><bdi dir="auto">{{ event.eventType }}</bdi></small
                      >
                    </td>
                    <td headers="audit-col-actor" data-label="Actor">
                      <bdi dir="auto">{{ event.actorText }}</bdi>
                    </td>
                    <td headers="audit-col-entity" data-label="Entity">
                      <bdi dir="auto">{{ event.entityText }}</bdi>
                    </td>
                    <td headers="audit-col-outcome" data-label="Outcome">
                      <span class="governance-status" [attr.data-status]="event.outcome"
                        ><bdi dir="auto">{{ event.outcome }}</bdi></span
                      >
                    </td>
                    <td headers="audit-col-correlation" data-label="Correlation">
                      <code
                        ><bdi dir="auto">{{ event.serverCorrelationId }}</bdi></code
                      >
                    </td>
                    <td headers="audit-col-open" data-label="დეტალი">
                      <a
                        [routerLink]="['/audit', event.eventId]"
                        (click)="prepareDetailRouteFocus()"
                        >გახსნა</a
                      >
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <nav class="governance-pagination" aria-label="აუდიტის გვერდები">
            <button
              type="button"
              data-focus-key="page-back"
              [disabled]="cursorDepth() === 0"
              (click)="previousPage()"
            >
              წინა
            </button>
            <button
              type="button"
              data-focus-key="page-next"
              [disabled]="!page.nextCursor"
              (click)="nextPage()"
            >
              შემდეგი
            </button>
          </nav>
        }
      }
    </section>
  `,
})
export class AuditOperationsPage {
  private readonly api = inject(GovernanceApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly pageAction = new Subject<AuditPageAction>();
  private readonly authorizationChanged = new Subject<void>();
  private cursorStack: readonly string[] = [];
  private requestedCursorStack: readonly string[] = [];
  private pendingRouteFocus: FocusKey | 'detail' = 'workspace';
  private destroyed = false;
  private lastAuthorizationContext = this.authorizationContext();

  @ViewChild('workspaceFocus', { static: true }) private workspaceFocus?: ElementRef<HTMLElement>;
  @ViewChild('detailHeading') private detailHeading?: ElementRef<HTMLElement>;
  @ViewChild('errorAlert') private errorAlert?: ElementRef<HTMLElement>;

  readonly sortFields = AUDIT_SORT_FIELDS;
  readonly sources = AUDIT_EVENT_SOURCES;
  readonly outcomes = AUDIT_EVENT_OUTCOMES;
  readonly state = signal<ViewState>('loading');
  readonly list = signal<AuditListView | null>(null);
  readonly detail = signal<AuditDetailView | null>(null);
  readonly query = signal<AuditReaderRequest>({});
  readonly cursorDepth = signal(0);
  readonly detailRoute = signal(false);
  readonly errorKind = signal<GovernanceErrorKind | null>(null);
  readonly liveMessage = signal('');

  constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));
    if (!this.api.config.auditReaderEnabled) {
      this.state.set('disabled');
      this.liveMessage.set('Audit reader გამორთულია.');
      return;
    }
    if (!this.auth.hasExactPermission('audit.read')) {
      this.errorKind.set('forbidden');
      this.state.set('error');
      this.liveMessage.set(this.errorTitle());
      return;
    }

    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(
        switchMap(([routeParams, queryParams]) => {
          const id = routeParams.get('id');
          const baseQuery = readAuditQuery(queryParams);
          return this.pageAction.pipe(
            startWith<AuditPageAction>({ kind: 'route' }),
            map((action): AuditRouteRequest => {
              if (id) return { kind: 'detail', id };
              const cursorStack = action.kind === 'cursor' ? action.cursorStack : [];
              const cursor = cursorStack.at(-1);
              const focusKey = action.kind === 'route' ? this.consumeRouteFocus() : action.focusKey;
              return {
                kind: 'list',
                query: { ...baseQuery, ...(cursor ? { cursor } : {}) },
                cursorStack,
                focusKey,
              };
            }),
          );
        }),
        tap((request) => this.beginRouteRequest(request)),
        switchMap((request) =>
          (request.kind === 'detail'
            ? this.api.getAuditEvent(request.id).pipe(
                map(
                  (event): AuditRouteResult => ({
                    kind: 'detail',
                    event: adaptAuditDetail(event),
                  }),
                ),
              )
            : this.api.listAuditEvents(request.query).pipe(
                map(
                  (page): AuditRouteResult => ({
                    kind: 'list',
                    page: adaptAuditList(page),
                    cursorStack: request.cursorStack,
                    focusKey: request.focusKey,
                  }),
                ),
              )
          ).pipe(
            takeUntil(this.authorizationChanged),
            catchError((error: unknown) => of<AuditRouteResult>({ kind: 'error', error })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => this.applyRouteResult(result));

    effect(() => {
      const context = this.authorizationContext();
      if (context === this.lastAuthorizationContext) return;
      this.lastAuthorizationContext = context;
      this.authorizationChanged.next();
      this.clearEvidence();
      this.cursorStack = [];
      this.requestedCursorStack = [];
      this.cursorDepth.set(0);
      if (!context) {
        this.errorKind.set('stale_auth');
        this.state.set('error');
        this.liveMessage.set(this.errorTitle());
        this.queueFocus('error');
        return;
      }
      this.pageAction.next({ kind: 'refresh', focusKey: 'workspace' });
    });
  }

  reloadList(): void {
    this.pageAction.next({ kind: 'refresh', focusKey: 'reload' });
  }

  retry(): void {
    const stack = this.errorKind() === 'invalid_cursor' ? [] : this.requestedCursorStack;
    this.pageAction.next({ kind: 'cursor', cursorStack: stack, focusKey: 'workspace' });
  }

  nextPage(): void {
    const cursor = this.list()?.nextCursor;
    if (!cursor) return;
    this.pageAction.next({
      kind: 'cursor',
      cursorStack: [...this.cursorStack, cursor],
      focusKey: 'page-next',
    });
  }

  previousPage(): void {
    if (this.cursorStack.length === 0) return;
    this.pageAction.next({
      kind: 'cursor',
      cursorStack: this.cursorStack.slice(0, -1),
      focusKey: 'page-back',
    });
  }

  applyFilters(event: Event): void {
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLFormElement)) return;
    const data = new FormData(event.currentTarget);
    this.pendingRouteFocus = 'filter-submit';
    void this.router.navigate(['/audit'], {
      queryParams: compactParams({
        occurredFrom: toIsoTimestamp(formValue(data, 'occurredFrom')),
        occurredTo: toIsoTimestamp(formValue(data, 'occurredTo')),
        eventFamily: formValue(data, 'eventFamily'),
        outcome: formValue(data, 'outcome'),
        actorId: formValue(data, 'actorId'),
        entityType: formValue(data, 'entityType'),
        entityId: formValue(data, 'entityId'),
        approvalRequestId: formValue(data, 'approvalRequestId'),
        approvalExecutionId: formValue(data, 'approvalExecutionId'),
        serverCorrelationId: formValue(data, 'serverCorrelationId'),
        causationId: formValue(data, 'causationId'),
        bulkOperationId: formValue(data, 'bulkOperationId'),
        bulkItemId: formValue(data, 'bulkItemId'),
        source: formValue(data, 'source'),
        retentionClass: formValue(data, 'retentionClass'),
        sortField: formValue(data, 'sortField'),
        sortDirection: formValue(data, 'sortDirection'),
      }),
    });
  }

  resetFilters(): void {
    this.pendingRouteFocus = 'filter-reset';
    void this.router.navigate(['/audit']);
  }

  prepareDetailRouteFocus(): void {
    this.pendingRouteFocus = 'detail';
  }

  prepareListRouteFocus(): void {
    this.pendingRouteFocus = 'workspace';
  }

  inputDate(value: string | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  errorTitle(): string {
    const kind = this.errorKind();
    if (kind === 'forbidden') return 'აუდიტზე წვდომა აკრძალულია';
    if (kind === 'not_found') return 'Event ვერ მოიძებნა';
    if (kind === 'invalid_cursor') return 'გვერდის გაგრძელება აღარ მოქმედებს';
    if (kind === 'stale_auth') return 'სესია ან წვდომა შეიცვალა';
    if (kind === 'disabled' || kind === 'unavailable') return 'Audit reader უსაფრთხოდ მიუწვდომელია';
    return 'აუდიტის მონაცემები ვერ ჩაიტვირთა';
  }

  errorMessage(): string {
    const kind = this.errorKind();
    if (kind === 'forbidden')
      return 'ზუსტი audit.read უფლება ამ workspace-ისთვის არ არის მინიჭებული.';
    if (kind === 'not_found')
      return 'ჩანაწერი არ არსებობს ან მისი არსებობის გამჟღავნება დაუშვებელია.';
    if (kind === 'invalid_cursor') return 'დაიწყეთ თავიდან პირველი გვერდიდან.';
    if (kind === 'stale_auth')
      return 'ძველი ავტორიზაციის კონტექსტით მიღებული მტკიცებულება წაიშალა.';
    if (kind === 'disabled' || kind === 'unavailable')
      return 'Backend reader ან feature flag აქტიური არ არის.';
    if (kind === 'dependency') return 'დამოკიდებული reader სერვისი დროებით მიუწვდომელია.';
    return 'სცადეთ ხელახლა; UI მონაცემს არ შეავსებს და არ გამოიგონებს.';
  }

  canRetry(): boolean {
    return !['forbidden', 'not_found', 'disabled', 'stale_auth', 'unavailable'].includes(
      this.errorKind() ?? '',
    );
  }

  private consumeRouteFocus(): FocusKey {
    const focus = this.pendingRouteFocus;
    this.pendingRouteFocus = 'workspace';
    return focus === 'detail' ? 'workspace' : focus;
  }

  private beginRouteRequest(request: AuditRouteRequest): void {
    this.focusWorkspace();
    this.clearEvidence();
    this.detailRoute.set(request.kind === 'detail');
    if (request.kind === 'list') {
      const { cursor: _cursor, ...baseQuery } = request.query;
      this.query.set(baseQuery);
      this.requestedCursorStack = request.cursorStack;
    }
    this.state.set('loading');
    this.errorKind.set(null);
  }

  private applyRouteResult(result: AuditRouteResult): void {
    if (result.kind === 'error') {
      this.showError(result.error);
      return;
    }
    if (result.kind === 'detail') {
      this.detail.set(result.event);
      this.state.set('ready');
      this.liveMessage.set('Audit event ჩაიტვირთა.');
      this.queueFocus('detail');
      return;
    }
    this.cursorStack = [...result.cursorStack];
    this.cursorDepth.set(this.cursorStack.length);
    this.list.set(result.page);
    this.state.set(result.page.items.length ? 'ready' : 'empty');
    this.liveMessage.set(`${result.page.items.length} audit event ჩაიტვირთა.`);
    this.queueFocus(result.focusKey);
  }

  private showError(error: unknown): void {
    const kind = error instanceof GovernanceApiError ? error.kind : 'unknown';
    this.clearEvidence();
    if (kind === 'invalid_cursor') {
      this.cursorStack = [];
      this.requestedCursorStack = [];
      this.cursorDepth.set(0);
    }
    this.errorKind.set(kind);
    this.state.set(kind === 'disabled' ? 'disabled' : 'error');
    this.liveMessage.set(this.errorTitle());
    this.queueFocus('error');
  }

  private clearEvidence(): void {
    this.list.set(null);
    this.detail.set(null);
  }

  private focusWorkspace(): void {
    const element = this.workspaceFocus?.nativeElement;
    if (!this.destroyed && element?.isConnected) element.focus();
  }

  private queueFocus(target: FocusKey | 'detail' | 'error'): void {
    globalThis.setTimeout(() => {
      if (this.destroyed) return;
      const element =
        target === 'detail'
          ? this.detailHeading?.nativeElement
          : target === 'error'
            ? this.errorAlert?.nativeElement
            : target === 'workspace'
              ? this.workspaceFocus?.nativeElement
              : this.host.nativeElement.querySelector<HTMLElement>(`[data-focus-key="${target}"]`);
      const fallback = this.workspaceFocus?.nativeElement;
      if (element?.isConnected) element.focus();
      else if (fallback?.isConnected) fallback.focus();
    }, 0);
  }

  private authorizationContext(): string {
    if (!this.auth.hasExactPermission('audit.read')) return '';
    const admin = this.auth.admin();
    if (!admin) return '';
    return JSON.stringify({
      id: admin.id,
      enabled: admin.enabled,
      grants: admin.permissionGrants
        .filter((grant) => grant.permission === 'audit.read')
        .map((grant) => `${grant.permission}\u0000${grant.scopeType}\u0000${grant.scopeId}`)
        .sort(),
    });
  }
}

export function adaptAuditList(wire: AuditEventListResult): AuditListView {
  return {
    items: wire.items.map((event) => adaptAuditSummary(event)),
    nextCursor: wire.nextCursor ?? null,
    asOfOccurredAt: wire.asOfOccurredAt,
  };
}

export function adaptAuditSummary(wire: AuditEventSummary): AuditSummaryView {
  return {
    eventId: wire.eventId,
    eventType: wire.eventType,
    title: wire.action,
    occurredAt: wire.occurredAt,
    actorText: `${wire.actorType} · ${wire.actorId}`,
    entityText: `${wire.entityType} · ${wire.entityId ?? '—'}`,
    outcome: wire.outcome,
    serverCorrelationId: wire.serverCorrelationId,
  };
}

export function adaptAuditDetail(wire: AuditEventDetail): AuditDetailView {
  const before = new Map(wire.before.map((field) => [field.key, field]));
  const after = new Map(wire.after.map((field) => [field.key, field]));
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  return {
    ...adaptAuditSummary(wire),
    schemaVersion: wire.schemaVersion,
    subjectText: `${wire.subjectType} · ${wire.subjectId ?? '—'}`,
    action: wire.action,
    entityVersionText: wire.entityVersion ?? '—',
    source: wire.source,
    retentionClass: wire.retentionClass,
    scopeText: `${wire.authorizationScopeKind} · ${wire.scopeMatchMode} · ${wire.authorizationScopeRefs.map((ref) => `${ref.dimension}:${ref.id}`).join(', ') || '—'}`,
    scopeResolverText: `${wire.scopeResolverId} · ${wire.scopeResolverVersion}`,
    authorizationPolicyVersion: wire.authorizationPolicyVersion,
    reasonCode: wire.reasonCode ?? '—',
    approvalRequestId: wire.approvalRequestId ?? '—',
    approvalExecutionId: wire.approvalExecutionId ?? '—',
    causationId: wire.causationId ?? '—',
    clientRequestId: wire.clientRequestId ?? '—',
    bulkOperationId: wire.bulkOperationId ?? '—',
    bulkItemId: wire.bulkItemId ?? '—',
    changes: keys.map((key) => adaptDiff(key, before.get(key), after.get(key))),
    metadata: wire.metadata.map((field) => adaptField(field)),
  };
}

export function readAuditQuery(params: ParamMap): AuditReaderRequest {
  const occurredFrom = validAuditDate(params, 'occurredFrom');
  const occurredTo = validAuditDate(params, 'occurredTo');
  const eventFamily = safeText(params, 'eventFamily');
  const actorId = safeText(params, 'actorId');
  const entityType = safeText(params, 'entityType');
  const entityId = safeText(params, 'entityId');
  const approvalRequestId = safeText(params, 'approvalRequestId');
  const approvalExecutionId = safeText(params, 'approvalExecutionId');
  const serverCorrelationId = safeText(params, 'serverCorrelationId');
  const causationId = safeText(params, 'causationId');
  const bulkOperationId = safeText(params, 'bulkOperationId');
  const bulkItemId = safeText(params, 'bulkItemId');
  const retentionClass = safeText(params, 'retentionClass');
  const outcome = enumValue(params.get('outcome'), AUDIT_EVENT_OUTCOMES);
  const source = enumValue(params.get('source'), AUDIT_EVENT_SOURCES);
  const sortField = enumValue(params.get('sortField'), AUDIT_SORT_FIELDS);
  const sortDirection = enumValue(params.get('sortDirection'), AUDIT_SORT_DIRECTIONS);
  return {
    ...(occurredFrom ? { occurredFrom } : {}),
    ...(occurredTo ? { occurredTo } : {}),
    ...(eventFamily ? { eventFamily } : {}),
    ...(outcome ? { outcome } : {}),
    ...(actorId ? { actorId } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(approvalRequestId ? { approvalRequestId } : {}),
    ...(approvalExecutionId ? { approvalExecutionId } : {}),
    ...(serverCorrelationId ? { serverCorrelationId } : {}),
    ...(causationId ? { causationId } : {}),
    ...(bulkOperationId ? { bulkOperationId } : {}),
    ...(bulkItemId ? { bulkItemId } : {}),
    ...(source ? { source } : {}),
    ...(retentionClass ? { retentionClass } : {}),
    ...(sortField ? { sortField } : {}),
    ...(sortDirection ? { sortDirection } : {}),
  };
}

function adaptField(field: AuditSafeField): AuditFieldView {
  return {
    key: field.key,
    label: field.label,
    value: safeValue(field.value),
    classification: field.classification,
  };
}

function adaptDiff(
  key: string,
  before: AuditSafeField | undefined,
  after: AuditSafeField | undefined,
): AuditDiffView {
  const evidence = after ?? before;
  if (!evidence) throw new Error('Unreachable audit diff');
  return {
    key,
    label: evidence.label,
    before: before ? safeValue(before.value) : null,
    after: after ? safeValue(after.value) : null,
    classification: evidence.classification,
  };
}

function safeValue(value: AuditSafeField['value']): string {
  return value === null ? '—' : String(value);
}

function enumValue<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  if (value === null) return undefined;
  for (const candidate of allowed) if (candidate === value) return candidate;
  return undefined;
}

function safeText(params: ParamMap, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value && value.length <= 128 ? value : undefined;
}

function validAuditDate(params: ParamMap, key: 'occurredFrom' | 'occurredTo'): string | undefined {
  const value = params.get(key);
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function compactParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== ''));
}

function formValue(data: FormData, key: string): string {
  return String(data.get(key) ?? '').trim();
}

function toIsoTimestamp(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
