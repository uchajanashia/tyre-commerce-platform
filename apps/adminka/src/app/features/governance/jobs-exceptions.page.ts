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
  JOB_SORT_DIRECTIONS,
  JOB_SORT_FIELDS,
  JOB_STATES,
  JobDetail,
  JobListResult,
  JobSafeField,
  JobSummary,
} from '@tyre/shared';

import { AuthService } from '../../core/auth.service';
import { GovernanceApiService } from '../../core/governance-api.service';
import { GovernanceApiError, GovernanceErrorKind } from '../../core/governance-contract';
import { JobReaderRequest } from '../../core/jobs-transport';

type ViewState = 'loading' | 'ready' | 'empty' | 'disabled' | 'error';
type FocusKey =
  | 'workspace'
  | 'reload'
  | 'filter-submit'
  | 'filter-reset'
  | 'page-next'
  | 'page-back';
type PageAction =
  | { readonly kind: 'route' }
  | { readonly kind: 'refresh'; readonly focusKey: FocusKey }
  | { readonly kind: 'cursor'; readonly stack: readonly string[]; readonly focusKey: FocusKey };
type RouteRequest =
  | { readonly kind: 'detail'; readonly id: string }
  | {
      readonly kind: 'list';
      readonly query: JobReaderRequest;
      readonly stack: readonly string[];
      readonly focusKey: FocusKey;
    };
type RouteResult =
  | { readonly kind: 'detail'; readonly job: JobDetail }
  | {
      readonly kind: 'list';
      readonly page: JobListResult;
      readonly stack: readonly string[];
      readonly focusKey: FocusKey;
    }
  | { readonly kind: 'error'; readonly error: unknown };

@Component({
  selector: 'adm-jobs-exceptions-page',
  imports: [DatePipe, RouterLink],
  template: `
    <section
      class="jobs-page"
      aria-labelledby="jobs-title"
      [attr.aria-busy]="state() === 'loading' ? 'true' : null"
    >
      <header class="jobs-heading">
        <div>
          <p>GOVERNANCE / JOBS</p>
          <h1 id="jobs-title">Jobs და გამონაკლისები</h1>
          <p>
            Mask-safe, მხოლოდ წაკითხვადი რიგის, dead-letter-ისა და immutable მცდელობების
            მტკიცებულება.
          </p>
        </div>
        <div class="jobs-heading__actions">
          <span class="readonly">READ ONLY</span>
          @if (detailRoute()) {
            <a routerLink="/jobs" data-focus-key="reload" (click)="prepareListFocus()"
              >სიაში დაბრუნება</a
            >
          } @else {
            <button
              type="button"
              data-focus-key="reload"
              [disabled]="state() === 'loading'"
              (click)="reload()"
            >
              განახლება
            </button>
          }
        </div>
      </header>

      <h2 #workspaceFocus id="jobs-workspace-focus" class="sr-only" tabindex="-1">
        Jobs სამუშაო სივრცე
      </h2>
      <p class="sr-only" aria-live="polite">{{ liveMessage() }}</p>

      @if (state() === 'disabled') {
        <section class="jobs-state" role="status">
          <strong>Jobs reader გამორთულია</strong>
          <p>Rollout gate უსაფრთხოდ არის დახურული. ქსელური მოთხოვნა არ სრულდება.</p>
        </section>
      } @else if (state() === 'error') {
        <section #errorAlert class="jobs-state jobs-state--error" role="alert" tabindex="-1">
          <strong>{{ errorTitle() }}</strong>
          <p>{{ errorMessage() }}</p>
        </section>
      } @else if (state() === 'loading') {
        <section class="jobs-state" role="status">
          <strong>Jobs მტკიცებულება იტვირთება</strong>
        </section>
      } @else if (detail(); as job) {
        <article class="job-detail" aria-labelledby="job-detail-title">
          <header>
            <p>
              <bdi dir="auto">{{ job.jobType }}</bdi>
            </p>
            <h2 #detailHeading id="job-detail-title" tabindex="-1">
              <bdi dir="auto">{{ job.jobId }}</bdi>
            </h2>
            <span class="job-state" [attr.data-state]="job.state"
              ><bdi dir="auto">{{ job.state }}</bdi></span
            >
          </header>

          <dl class="facts">
            <div>
              <dt>Owner domain</dt>
              <dd>
                <bdi dir="auto">{{ job.ownerDomain }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Schema version</dt>
              <dd>{{ job.schemaVersion }}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{{ job.priority }}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>
                <time [attr.datetime]="job.createdAt">{{ job.createdAt | date: 'medium' }}</time>
              </dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd>
                <time [attr.datetime]="job.availableAt">{{
                  job.availableAt | date: 'medium'
                }}</time>
              </dd>
            </div>
            <div>
              <dt>Scope kind / match</dt>
              <dd>
                <bdi dir="auto">{{ job.authorizationScopeKind }} / {{ job.scopeMatchMode }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Scope resolver</dt>
              <dd>
                <bdi dir="auto">{{ job.scopeResolverId }}</bdi> · v{{ job.scopeResolverVersion }}
              </dd>
            </div>
            <div>
              <dt>Authorization policy</dt>
              <dd>v{{ job.authorizationPolicyVersion }}</dd>
            </div>
            <div>
              <dt>Current lease generation</dt>
              <dd>{{ job.currentLeaseGeneration }}</dd>
            </div>
            <div>
              <dt>Lease expires</dt>
              <dd>
                @if (job.leaseExpiresAt) {
                  <time [attr.datetime]="job.leaseExpiresAt">{{
                    job.leaseExpiresAt | date: 'medium'
                  }}</time>
                } @else {
                  —
                }
              </dd>
            </div>
            <div>
              <dt>Required global grant</dt>
              <dd>
                <bdi dir="auto">{{ job.requiredGlobalGrant || '—' }}</bdi>
              </dd>
            </div>
            <div>
              <dt>Server correlation</dt>
              <dd>
                <code
                  ><bdi dir="auto">{{ job.serverCorrelationId }}</bdi></code
                >
              </dd>
            </div>
            <div>
              <dt>Causation</dt>
              <dd>
                <code
                  ><bdi dir="auto">{{ job.causationId || '—' }}</bdi></code
                >
              </dd>
            </div>
            <div>
              <dt>Originating audit event</dt>
              <dd>
                <code
                  ><bdi dir="auto">{{ job.originatingAuditEventId }}</bdi></code
                >
              </dd>
            </div>
          </dl>

          <section class="evidence-section" aria-labelledby="scope-title">
            <h3 id="scope-title">ავტორიზაციის scope</h3>
            @if (job.authorizationScopeRefs.length) {
              <ul class="plain-list">
                @for (ref of job.authorizationScopeRefs; track ref.dimension + ref.id) {
                  <li>
                    <bdi dir="auto">{{ ref.dimension }}:{{ ref.id }}</bdi>
                  </li>
                }
              </ul>
            } @else {
              <p>Scope reference არ არის.</p>
            }
          </section>

          <section class="evidence-section" aria-labelledby="summary-title">
            <h3 id="summary-title">Mask-safe summary</h3>
            <dl class="safe-fields">
              @for (field of job.safeSummary; track field.key) {
                <div>
                  <dt>
                    <bdi dir="auto">{{ field.label }}</bdi>
                    <small>{{ field.classification }}</small>
                  </dt>
                  <dd>
                    <bdi dir="auto">{{ safeValue(field) }}</bdi>
                  </dd>
                </div>
              } @empty {
                <div>
                  <dt>Summary</dt>
                  <dd>უსაფრთხო ველები არ არის.</dd>
                </div>
              }
            </dl>
          </section>

          <section class="evidence-section" aria-labelledby="attempts-title">
            <h3 id="attempts-title">Immutable attempts</h3>
            <p id="attempts-timestamp-note">
              Fence age derived evidence-ია: terminal მცდელობისთვის ითვლება მხოლოდ server-ის Started
              და Outcome at timestamp-ებიდან; მიმდინარე generation-ისთვის შეიძლება გამოიყენოს
              server-ის Lease expires. Client clock არ გამოიყენება.
            </p>
            @if (job.attempts.length) {
              <div class="table-scroll">
                <table aria-labelledby="attempts-title" aria-describedby="attempts-timestamp-note">
                  <thead>
                    <tr>
                      <th id="attempt-col-id" scope="col">Attempt</th>
                      <th id="attempt-col-generation" scope="col">Generation</th>
                      <th id="attempt-col-started" scope="col">Started</th>
                      <th id="attempt-col-outcome" scope="col">Outcome</th>
                      <th id="attempt-col-outcome-at" scope="col">Outcome at</th>
                      <th id="attempt-col-fence-age" scope="col">
                        Fence age
                        <span class="sr-only">derived from server source timestamps</span>
                      </th>
                      <th id="attempt-col-reason" scope="col">Safe reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (
                      attempt of job.attempts;
                      track attempt.attemptStartedId;
                      let index = $index
                    ) {
                      <tr>
                        <td headers="attempt-col-id" data-label="Attempt">
                          <bdi dir="auto">#{{ index + 1 }} · {{ attempt.attemptStartedId }}</bdi>
                        </td>
                        <td headers="attempt-col-generation" data-label="Generation">
                          {{ attempt.leaseGeneration }}
                        </td>
                        <td headers="attempt-col-started" data-label="Started">
                          <time [attr.datetime]="attempt.startedAt">{{
                            attempt.startedAt | date: 'medium'
                          }}</time>
                        </td>
                        <td headers="attempt-col-outcome" data-label="Outcome">
                          <bdi dir="auto">{{ attempt.outcome || 'in_progress' }}</bdi>
                        </td>
                        <td headers="attempt-col-outcome-at" data-label="Outcome at">
                          @if (attempt.outcomeAt) {
                            <time
                              [attr.datetime]="attempt.outcomeAt"
                              [attr.aria-label]="'Outcome recorded at ' + attempt.outcomeAt"
                              ><bdi dir="auto">{{ attempt.outcomeAt }}</bdi></time
                            >
                          } @else {
                            <span aria-label="Outcome timestamp not recorded">—</span>
                          }
                        </td>
                        <td headers="attempt-col-fence-age" data-label="Fence age">
                          <bdi dir="auto">{{
                            fenceAge(
                              attempt.startedAt,
                              attempt.outcomeAt ||
                                (attempt.leaseGeneration === job.currentLeaseGeneration
                                  ? job.leaseExpiresAt
                                  : undefined)
                            )
                          }}</bdi>
                        </td>
                        <td headers="attempt-col-reason" data-label="Safe reason">
                          <bdi dir="auto">{{ attempt.safeReasonCode || '—' }}</bdi>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p>მცდელობის ფაქტები არ არის.</p>
            }
          </section>

          <section class="evidence-section" aria-labelledby="reconciliation-title">
            <h3 id="reconciliation-title">Reconciliation evidence</h3>
            @if (job.reconciliations.length) {
              <div class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Evidence ID</th>
                      <th scope="col">State</th>
                      <th scope="col">Occurred</th>
                      <th scope="col">Safe reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (fact of job.reconciliations; track fact.reconciliationId) {
                      <tr>
                        <td data-label="Evidence ID">
                          <bdi dir="auto">{{ fact.reconciliationId }}</bdi>
                        </td>
                        <td data-label="State">
                          <bdi dir="auto">{{ fact.state }}</bdi>
                        </td>
                        <td data-label="Occurred">
                          <time [attr.datetime]="fact.occurredAt">{{
                            fact.occurredAt | date: 'medium'
                          }}</time>
                        </td>
                        <td data-label="Safe reason">
                          <bdi dir="auto">{{ fact.safeReasonCode }}</bdi>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p>Reconciliation ფაქტები არ არის.</p>
            }
          </section>
        </article>
      } @else {
        <form class="job-filters" aria-label="Jobs ფილტრები" (submit)="applyFilters($event)">
          <label
            >State<select name="state" [value]="query().state ?? ''">
              <option value="">ყველა</option>
              @for (value of states; track value) {
                <option [value]="value">{{ value }}</option>
              }
            </select></label
          >
          <label>Job type<input name="jobType" [value]="query().jobType ?? ''" /></label>
          <label
            >Owner domain<input name="ownerDomain" [value]="query().ownerDomain ?? ''"
          /></label>
          <label
            >Correlation<input name="correlationId" [value]="query().correlationId ?? ''"
          /></label>
          <label
            >Created from<input
              type="datetime-local"
              name="createdFrom"
              [value]="inputDate(query().createdFrom)"
          /></label>
          <label
            >Created to<input
              type="datetime-local"
              name="createdTo"
              [value]="inputDate(query().createdTo)"
          /></label>
          <label
            >Sort<select name="sortField" [value]="query().sortField ?? 'createdAt'">
              @for (value of sortFields; track value) {
                <option [value]="value">{{ value }}</option>
              }
            </select></label
          >
          <label
            >Direction<select name="sortDirection" [value]="query().sortDirection ?? 'desc'">
              @for (value of sortDirections; track value) {
                <option [value]="value">{{ value }}</option>
              }
            </select></label
          >
          <div class="filter-actions">
            <button type="submit" data-focus-key="filter-submit">ფილტრების გამოყენება</button
            ><button
              type="button"
              class="secondary"
              data-focus-key="filter-reset"
              (click)="resetFilters()"
            >
              გასუფთავება
            </button>
          </div>
        </form>

        @if (state() === 'empty') {
          <section class="jobs-state" role="status">
            <strong>შესაბამისი Jobs არ არის</strong>
            <p>სერვერმა ამ ფილტრებისთვის ჩანაწერები არ დააბრუნა.</p>
          </section>
        } @else if (list(); as page) {
          <p class="as-of">
            Snapshot:
            <time [attr.datetime]="page.asOfCreatedAt">{{
              page.asOfCreatedAt | date: 'medium'
            }}</time>
          </p>
          <div class="table-scroll">
            <table class="jobs-table">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">State</th>
                  <th scope="col">Domain</th>
                  <th scope="col">Created</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Correlation</th>
                </tr>
              </thead>
              <tbody>
                @for (job of page.items; track job.jobId) {
                  <tr>
                    <td data-label="Job">
                      <a [routerLink]="['/jobs', job.jobId]" (click)="prepareDetailFocus()"
                        ><bdi dir="auto">{{ job.jobType }}</bdi
                        ><small
                          ><bdi dir="auto">{{ job.jobId }}</bdi></small
                        ></a
                      >
                    </td>
                    <td data-label="State">
                      <span class="job-state" [attr.data-state]="job.state"
                        ><bdi dir="auto">{{ job.state }}</bdi></span
                      >
                    </td>
                    <td data-label="Domain">
                      <bdi dir="auto">{{ job.ownerDomain }}</bdi>
                    </td>
                    <td data-label="Created">
                      <time [attr.datetime]="job.createdAt">{{
                        job.createdAt | date: 'medium'
                      }}</time>
                    </td>
                    <td data-label="Priority">{{ job.priority }}</td>
                    <td data-label="Correlation">
                      <code
                        ><bdi dir="auto">{{ job.serverCorrelationId }}</bdi></code
                      >
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <nav class="pagination" aria-label="Jobs pagination">
            <button
              type="button"
              data-focus-key="page-back"
              [disabled]="cursorDepth() === 0 || state() === 'loading'"
              (click)="previousPage()"
            >
              წინა</button
            ><span>გვერდი {{ cursorDepth() + 1 }}</span
            ><button
              type="button"
              data-focus-key="page-next"
              [disabled]="!page.nextCursor || state() === 'loading'"
              (click)="nextPage()"
            >
              შემდეგი
            </button>
          </nav>
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      color: #17231e;
    }
    .jobs-page {
      display: grid;
      gap: 1.25rem;
    }
    .jobs-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 2rem;
      border-bottom: 1px solid #dce4df;
      padding-bottom: 1rem;
    }
    .jobs-heading p {
      margin: 0.2rem 0;
      color: #5f6d66;
    }
    .jobs-heading > div > p:first-child {
      font-size: 0.72rem;
      letter-spacing: 0.14em;
      color: #37614d;
    }
    .jobs-heading h1 {
      margin: 0.15rem 0;
      font-size: clamp(1.65rem, 3vw, 2.35rem);
      letter-spacing: -0.035em;
    }
    .jobs-heading__actions {
      display: flex;
      align-items: center;
      gap: 0.65rem;
    }
    .readonly,
    .job-state {
      display: inline-flex;
      border: 1px solid #b8c9c0;
      border-radius: 999px;
      padding: 0.3rem 0.55rem;
      font-size: 0.72rem;
      letter-spacing: 0.04em;
      background: #f3f7f5;
    }
    .job-state[data-state='dead_lettered'],
    .job-state[data-state='external_outcome_unknown'],
    .jobs-state--error {
      color: #8a2c2c;
      border-color: #e1baba;
      background: #fff7f7;
    }
    button,
    a {
      font: inherit;
    }
    button,
    .jobs-heading a {
      min-height: 2.55rem;
      border: 1px solid #2f5b46;
      border-radius: 0.4rem;
      padding: 0.55rem 0.8rem;
      background: #2f5b46;
      color: #fff;
      text-decoration: none;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .secondary {
      background: #fff;
      color: #2f5b46;
    }
    .jobs-state {
      border: 1px solid #d9e2dd;
      border-left: 4px solid #50725f;
      padding: 1rem 1.15rem;
      background: #fbfcfb;
    }
    .jobs-state p {
      margin: 0.35rem 0 0;
    }
    .job-filters {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.8rem;
      padding: 1rem 0;
      border-block: 1px solid #dce4df;
    }
    .job-filters label {
      display: grid;
      gap: 0.3rem;
      font-size: 0.78rem;
      font-weight: 650;
      color: #43534b;
    }
    .job-filters input,
    .job-filters select {
      width: 100%;
      min-height: 2.55rem;
      border: 1px solid #becbc4;
      border-radius: 0.35rem;
      padding: 0.45rem 0.55rem;
      background: #fff;
      color: #17231e;
    }
    .filter-actions {
      display: flex;
      align-items: end;
      gap: 0.5rem;
    }
    .as-of {
      margin: 0;
      color: #66736c;
      font-size: 0.8rem;
    }
    .table-scroll {
      overflow: auto;
      border: 1px solid #dce4df;
    }
    .jobs-table,
    table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
    }
    th,
    td {
      text-align: left;
      vertical-align: top;
      padding: 0.75rem;
      border-bottom: 1px solid #e5ebe7;
      font-size: 0.82rem;
    }
    th {
      background: #f5f8f6;
      color: #4d5d55;
      font-size: 0.72rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .jobs-table a {
      color: #224c38;
      text-underline-offset: 0.18em;
    }
    .jobs-table a small {
      display: block;
      margin-top: 0.2rem;
      color: #68766f;
    }
    .pagination {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 0.75rem;
    }
    .job-detail {
      display: grid;
      gap: 1.2rem;
    }
    .job-detail > header {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .job-detail > header p,
    .job-detail > header h2 {
      margin: 0;
    }
    .job-detail > header h2 {
      font-size: 1.2rem;
    }
    .facts,
    .safe-fields {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin: 0;
      border: 1px solid #dce4df;
    }
    .facts div,
    .safe-fields div {
      padding: 0.8rem;
      border-right: 1px solid #e5ebe7;
      border-bottom: 1px solid #e5ebe7;
    }
    .facts dt,
    .safe-fields dt {
      font-size: 0.72rem;
      color: #5f6d66;
    }
    .facts dd,
    .safe-fields dd {
      margin: 0.25rem 0 0;
      overflow-wrap: anywhere;
    }
    .safe-fields small {
      display: block;
      font-weight: 400;
    }
    .evidence-section {
      border-top: 1px solid #dce4df;
      padding-top: 1rem;
    }
    .evidence-section h3 {
      margin: 0 0 0.7rem;
      font-size: 1rem;
    }
    .plain-list {
      margin: 0;
      padding-left: 1.2rem;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .sr-only:focus {
      position: static;
      width: auto;
      height: auto;
      margin: 0;
      clip: auto;
      white-space: normal;
    }
    code {
      font-size: 0.78rem;
      overflow-wrap: anywhere;
    }
    @media (max-width: 900px) {
      .job-filters {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .facts,
      .safe-fields {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 640px) {
      .jobs-heading {
        display: grid;
      }
      .jobs-heading__actions {
        justify-content: space-between;
      }
      .job-filters,
      .facts,
      .safe-fields {
        grid-template-columns: 1fr;
      }
      .filter-actions {
        grid-column: 1;
      }
      .table-scroll {
        border: 0;
        overflow: visible;
      }
      table thead {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
      }
      table,
      tbody,
      tr,
      td {
        display: block;
      }
      tr {
        border: 1px solid #dce4df;
        margin-bottom: 0.7rem;
        background: #fff;
      }
      td {
        display: grid;
        grid-template-columns: 7rem 1fr;
        gap: 0.5rem;
      }
      td::before {
        content: attr(data-label);
        font-size: 0.7rem;
        font-weight: 700;
        color: #5f6d66;
        text-transform: uppercase;
      }
      .pagination {
        justify-content: space-between;
      }
    }
  `,
})
export class JobsExceptionsPage {
  private readonly api = inject(GovernanceApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly action = new Subject<PageAction>();
  private readonly authorizationChanged = new Subject<void>();
  private cursorStack: readonly string[] = [];
  private requestedStack: readonly string[] = [];
  private pendingFocus: FocusKey | 'detail' = 'workspace';
  private destroyed = false;
  private lastAuthorizationContext = this.authorizationContext();

  @ViewChild('workspaceFocus', { static: true }) private workspaceFocus?: ElementRef<HTMLElement>;
  @ViewChild('detailHeading') private detailHeading?: ElementRef<HTMLElement>;
  @ViewChild('errorAlert') private errorAlert?: ElementRef<HTMLElement>;

  readonly states = JOB_STATES;
  readonly sortFields = JOB_SORT_FIELDS;
  readonly sortDirections = JOB_SORT_DIRECTIONS;
  readonly state = signal<ViewState>('loading');
  readonly list = signal<JobListResult | null>(null);
  readonly detail = signal<JobDetail | null>(null);
  readonly query = signal<JobReaderRequest>({});
  readonly cursorDepth = signal(0);
  readonly detailRoute = signal(false);
  readonly errorKind = signal<GovernanceErrorKind | null>(null);
  readonly liveMessage = signal('');

  constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));
    if (!this.api.config.jobsReaderEnabled) {
      this.state.set('disabled');
      this.liveMessage.set('Jobs reader გამორთულია.');
      return;
    }
    if (!this.auth.hasExactPermission('jobs.read')) {
      this.errorKind.set('forbidden');
      this.state.set('error');
      this.liveMessage.set(this.errorTitle());
      return;
    }

    combineLatest([this.route.paramMap, this.route.queryParamMap])
      .pipe(
        switchMap(([params, queryParams]) => {
          const id = params.get('id');
          const baseQuery = readJobQuery(queryParams);
          return this.action.pipe(
            startWith<PageAction>({ kind: 'route' }),
            map((action): RouteRequest => {
              if (id) return { kind: 'detail', id };
              const stack = action.kind === 'cursor' ? action.stack : [];
              const cursor = stack.at(-1);
              return {
                kind: 'list',
                query: { ...baseQuery, ...(cursor ? { cursor } : {}) },
                stack,
                focusKey: action.kind === 'route' ? this.consumeRouteFocus() : action.focusKey,
              };
            }),
          );
        }),
        tap((request) => this.beginRequest(request)),
        switchMap((request) =>
          (request.kind === 'detail'
            ? this.api.getJob(request.id).pipe(map((job): RouteResult => ({ kind: 'detail', job })))
            : this.api.listJobs(request.query).pipe(
                map(
                  (page): RouteResult => ({
                    kind: 'list',
                    page,
                    stack: request.stack,
                    focusKey: request.focusKey,
                  }),
                ),
              )
          ).pipe(
            takeUntil(this.authorizationChanged),
            catchError((error: unknown) => of<RouteResult>({ kind: 'error', error })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => this.applyResult(result));

    effect(() => {
      const context = this.authorizationContext();
      if (context === this.lastAuthorizationContext) return;
      this.lastAuthorizationContext = context;
      this.authorizationChanged.next();
      this.clearEvidence();
      this.cursorStack = [];
      this.requestedStack = [];
      this.cursorDepth.set(0);
      if (!context) {
        this.errorKind.set('stale_auth');
        this.state.set('error');
        this.liveMessage.set(this.errorTitle());
        this.queueFocus('error');
      } else {
        this.action.next({ kind: 'refresh', focusKey: 'workspace' });
      }
    });
  }

  reload(): void {
    this.action.next({ kind: 'refresh', focusKey: 'reload' });
  }
  nextPage(): void {
    const cursor = this.list()?.nextCursor;
    if (cursor)
      this.action.next({
        kind: 'cursor',
        stack: [...this.cursorStack, cursor],
        focusKey: 'page-next',
      });
  }
  previousPage(): void {
    if (this.cursorStack.length)
      this.action.next({
        kind: 'cursor',
        stack: this.cursorStack.slice(0, -1),
        focusKey: 'page-back',
      });
  }
  applyFilters(event: Event): void {
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLFormElement)) return;
    const data = new FormData(event.currentTarget);
    this.pendingFocus = 'filter-submit';
    void this.router.navigate(['/jobs'], {
      queryParams: compactParams({
        state: formValue(data, 'state'),
        jobType: formValue(data, 'jobType'),
        ownerDomain: formValue(data, 'ownerDomain'),
        correlationId: formValue(data, 'correlationId'),
        createdFrom: toIsoTimestamp(formValue(data, 'createdFrom')),
        createdTo: toIsoTimestamp(formValue(data, 'createdTo')),
        sortField: formValue(data, 'sortField'),
        sortDirection: formValue(data, 'sortDirection'),
      }),
    });
  }
  resetFilters(): void {
    this.pendingFocus = 'filter-reset';
    void this.router.navigate(['/jobs']);
  }
  prepareDetailFocus(): void {
    this.pendingFocus = 'detail';
  }
  prepareListFocus(): void {
    this.pendingFocus = 'workspace';
  }
  inputDate(value: string | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }
  safeValue(field: JobSafeField): string {
    return field.value === null ? '—' : String(field.value);
  }
  fenceAge(startedAt: string, outcomeAt?: string): string {
    if (!outcomeAt) return '—';
    const elapsed = new Date(outcomeAt).getTime() - new Date(startedAt).getTime();
    return Number.isFinite(elapsed) && elapsed >= 0 ? `${Math.floor(elapsed / 1000)}s` : '—';
  }
  errorTitle(): string {
    const kind = this.errorKind();
    if (kind === 'forbidden') return 'Jobs-ზე წვდომა აკრძალულია';
    if (kind === 'not_found') return 'Job ვერ მოიძებნა';
    if (kind === 'invalid_cursor') return 'გვერდის continuation აღარ მოქმედებს';
    if (kind === 'stale_auth') return 'სესია ან წვდომა შეიცვალა';
    if (kind === 'disabled' || kind === 'unavailable') return 'Jobs reader უსაფრთხოდ მიუწვდომელია';
    if (kind === 'dependency') return 'Jobs dependency მიუწვდომელია';
    return 'Jobs მონაცემები ვერ ჩაიტვირთა';
  }
  errorMessage(): string {
    const kind = this.errorKind();
    if (kind === 'forbidden') return 'საჭიროა ზუსტი jobs.read grant; wildcard წვდომა არ მიიღება.';
    if (kind === 'not_found')
      return 'ჩანაწერი არ არსებობს ან მისი არსებობის გამჟღავნება დაუშვებელია.';
    if (kind === 'invalid_cursor') return 'ძველი continuation გაუქმდა; დაბრუნდით პირველ გვერდზე.';
    if (kind === 'stale_auth')
      return 'ძველი ავტორიზაციის კონტექსტით მიღებული მტკიცებულება წაიშალა.';
    if (kind === 'disabled' || kind === 'unavailable')
      return 'Backend reader ან rollout gate აქტიური არ არის.';
    if (kind === 'dependency') return 'დამოკიდებული read-only სერვისი დროებით მიუწვდომელია.';
    return 'UI მონაცემს არ შეავსებს და არ გამოიგონებს.';
  }

  private consumeRouteFocus(): FocusKey {
    const focus = this.pendingFocus;
    this.pendingFocus = 'workspace';
    return focus === 'detail' ? 'workspace' : focus;
  }
  private beginRequest(request: RouteRequest): void {
    this.focusWorkspace();
    this.clearEvidence();
    this.detailRoute.set(request.kind === 'detail');
    if (request.kind === 'list') {
      const { cursor: _cursor, ...baseQuery } = request.query;
      this.query.set(baseQuery);
      this.requestedStack = request.stack;
    }
    this.errorKind.set(null);
    this.state.set('loading');
  }
  private applyResult(result: RouteResult): void {
    if (result.kind === 'error') {
      this.showError(result.error);
      return;
    }
    if (result.kind === 'detail') {
      this.detail.set(result.job);
      this.state.set('ready');
      this.liveMessage.set('Job მტკიცებულება ჩაიტვირთა.');
      this.queueFocus('detail');
      return;
    }
    this.cursorStack = [...result.stack];
    this.cursorDepth.set(this.cursorStack.length);
    this.list.set(result.page);
    this.state.set(result.page.items.length ? 'ready' : 'empty');
    this.liveMessage.set(`${result.page.items.length} Job ჩაიტვირთა.`);
    this.queueFocus(result.focusKey);
  }
  private showError(error: unknown): void {
    const kind = error instanceof GovernanceApiError ? error.kind : 'unknown';
    this.clearEvidence();
    if (kind === 'invalid_cursor') {
      this.cursorStack = [];
      this.requestedStack = [];
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
      if (element?.isConnected) element.focus();
      else if (this.workspaceFocus?.nativeElement.isConnected)
        this.workspaceFocus.nativeElement.focus();
    }, 0);
  }
  private authorizationContext(): string {
    if (!this.auth.hasExactPermission('jobs.read')) return '';
    const admin = this.auth.admin();
    if (!admin) return '';
    return JSON.stringify({
      id: admin.id,
      enabled: admin.enabled,
      grants: admin.permissionGrants
        .filter((grant) => grant.permission === 'jobs.read')
        .map((grant) => `${grant.permission}\u0000${grant.scopeType}\u0000${grant.scopeId}`)
        .sort(),
    });
  }
}

export function readJobQuery(params: ParamMap): JobReaderRequest {
  const state = valueIn(params.get('state'), JOB_STATES);
  const sortField = valueIn(params.get('sortField'), JOB_SORT_FIELDS) ?? 'createdAt';
  const sortDirection = valueIn(params.get('sortDirection'), JOB_SORT_DIRECTIONS) ?? 'desc';
  return compactParams({
    state,
    jobType: bounded(params.get('jobType')),
    ownerDomain: bounded(params.get('ownerDomain')),
    correlationId: bounded(params.get('correlationId')),
    createdFrom: validInstant(params.get('createdFrom')),
    createdTo: validInstant(params.get('createdTo')),
    sortField,
    sortDirection,
  });
}
function valueIn<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  for (const candidate of allowed) if (candidate === value) return candidate;
  return undefined;
}
function bounded(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length <= 128 ? normalized : undefined;
}
function validInstant(value: string | null): string | undefined {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}
function formValue(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
function toIsoTimestamp(value: string): string {
  return value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : '';
}
function compactParams<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== ''),
  ) as T;
}
