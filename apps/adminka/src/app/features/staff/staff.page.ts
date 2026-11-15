import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, map, switchMap } from 'rxjs';

import { AuthService } from '../../core/auth.service';
import { IdentityApiService } from '../../core/identity-api.service';
import {
  RoleCatalogItem,
  StaffDetailResponse,
  StaffListItem,
  StaffListResponse,
  StaffStatus,
  TargetStaffSessionItem,
} from '../../core/identity-contract';

@Component({
  selector: 'adm-staff-page',
  imports: [FormsModule],
  template: `
    <div class="identity-page">
      <header
        class="identity-heading"
        [attr.inert]="dialogOpen() ? '' : null"
        [attr.aria-hidden]="dialogOpen() ? 'true' : null"
      >
        <div>
          <p>წვდომის მართვა</p>
          <h1>გუნდი და უფლებები</h1>
        </div>
        <button
          type="button"
          (click)="openCreate($event)"
          [disabled]="!canManage() || !canAssignRoles() || roles().length === 0"
          [attr.title]="!canAssignRoles() ? 'საჭიროა roles.assign უფლება' : null"
        >
          თანამშრომლის დამატება
        </button>
      </header>

      @if (!auth.identityV2Enabled) {
        <section class="identity-unavailable" role="status">
          <strong>Staff management ჯერ გამორთულია</strong>
          <p>Identity v2 same-origin rollout-ის შემდეგ გახდება ხელმისაწვდომი.</p>
        </section>
      } @else {
        <div
          class="staff-page__content"
          [attr.inert]="dialogOpen() ? '' : null"
          [attr.aria-hidden]="dialogOpen() ? 'true' : null"
        >
          <div class="staff-toolbar">
            <label for="staff-search">ძებნა</label
            ><input
              id="staff-search"
              [(ngModel)]="query"
              (ngModelChange)="load()"
              placeholder="სახელი ან ელფოსტა"
            />
            <label for="staff-status">სტატუსი</label
            ><select id="staff-status" [(ngModel)]="status" (ngModelChange)="load()">
              <option value="">ყველა</option>
              <option value="invited">Invited</option>
              <option value="pending_activation">Pending activation</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
            <button
              type="button"
              class="quiet-button"
              (click)="load()"
              [disabled]="state() === 'loading' || staffLoadingMore()"
            >
              განახლება
            </button>
          </div>

          @if (canApproveRecovery()) {
            <section
              class="identity-section staff-recovery-approval"
              aria-labelledby="recovery-approval-title"
            >
              <div>
                <p>ოთხი თვალის პრინციპი</p>
                <h2 id="recovery-approval-title">MFA recovery approval</h2>
              </div>
              <label for="recovery-request-id">Recovery request ID</label>
              <input id="recovery-request-id" [(ngModel)]="approvalRequestId" autocomplete="off" />
              <label for="recovery-approval-code">თქვენი Authenticator code</label>
              <input
                id="recovery-approval-code"
                [(ngModel)]="approvalStepUpCode"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
              />
              <button
                type="button"
                (click)="approveRecovery()"
                [disabled]="
                  approvalRequestId.trim().length === 0 || approvalStepUpCode.trim().length !== 6
                "
              >
                მოთხოვნის გადამოწმება და დამტკიცება
              </button>
            </section>
          }

          @if (state() === 'loading') {
            <p class="identity-loading">თანამშრომლები იტვირთება…</p>
          } @else if (state() === 'unavailable') {
            <p class="identity-inline-state">Staff API ამ გარემოში ჯერ არ არის ჩართული.</p>
          } @else if (state() === 'error') {
            <p class="identity-inline-state identity-inline-state--error" role="alert">
              სია ვერ ჩაიტვირთა.
            </p>
          } @else if (staff(); as result) {
            <div class="staff-table-wrap">
              <table class="staff-table">
                <thead>
                  <tr>
                    <th>თანამშრომელი</th>
                    <th>სტატუსი</th>
                    <th>როლები და scope</th>
                    <th>MFA</th>
                    <th>ბოლო აქტივობა</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (member of filteredItems(result.items); track member.id) {
                    <tr>
                      <td>
                        <strong>{{ member.displayName || member.email }}</strong
                        ><small>{{ member.email }}</small>
                      </td>
                      <td>
                        <span class="staff-status" [attr.data-status]="member.status">{{
                          statusLabel(member.status)
                        }}</span>
                      </td>
                      <td>
                        <span class="assignment-summary">{{ assignmentSummary(member) }}</span>
                      </td>
                      <td>
                        {{
                          member.mfaEnrolled
                            ? 'ჩართულია'
                            : member.mfaRequired
                              ? 'სავალდებულოა'
                              : 'არ არის'
                        }}
                      </td>
                      <td>{{ member.lastActivityAt ? formatDate(member.lastActivityAt) : '—' }}</td>
                      <td>
                        <button
                          type="button"
                          class="quiet-button"
                          (click)="openDetail(member, $event)"
                        >
                          მართვა
                        </button>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6" class="identity-inline-state">თანამშრომლები არ მოიძებნა.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div
              #staffPagingStatus
              class="identity-pagination"
              aria-live="polite"
              aria-atomic="true"
              tabindex="-1"
            >
              @if (staffLoadingMore()) {
                <p class="identity-loading">შემდეგი თანამშრომლები იტვირთება…</p>
              } @else if (staffPageError()) {
                <p class="identity-inline-state identity-inline-state--error" role="alert">
                  შემდეგი გვერდი ვერ ჩაიტვირთა; ნაჩვენები ჩანაწერები შენარჩუნებულია.
                </p>
                <button type="button" class="quiet-button" (click)="loadMoreStaff($event)">
                  თავიდან ცდა
                </button>
              } @else if (staffNextCursor()) {
                <button type="button" class="quiet-button" (click)="loadMoreStaff($event)">
                  მეტი თანამშრომლის ჩატვირთვა
                </button>
              } @else {
                <p class="identity-inline-state">ყველა თანამშრომელი ჩატვირთულია.</p>
              }
            </div>
          }
        </div>

        @if (createOpen()) {
          <div class="identity-drawer-backdrop" aria-hidden="true"></div>
          <section
            #createDialog
            class="identity-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-staff-title"
            aria-describedby="create-staff-description"
            (keydown)="onDialogKeydown($event)"
          >
            <h2 id="create-staff-title">თანამშრომლის მოწვევა</h2>
            <p id="create-staff-description">Identity → roles/scopes → review → invite</p>
            <label for="new-staff-name">სახელი</label
            ><input #createNameInput id="new-staff-name" [(ngModel)]="newDisplayName" />
            <label for="new-staff-email">ელფოსტა</label
            ><input id="new-staff-email" type="email" [(ngModel)]="newEmail" />
            <fieldset>
              <legend>Global roles</legend>
              @for (role of roles(); track role.id) {
                <label class="role-option"
                  ><input
                    type="checkbox"
                    [checked]="newRoleIds.includes(role.id)"
                    [disabled]="!canAssignRoles() || !role.assignmentAllowed || dialogBusy()"
                    (change)="toggleRole(role.id, $event)"
                  />
                  <span
                    ><strong>{{ role.name }}</strong
                    ><small>{{ role.description || role.key }}</small>
                    @if (role.mfaRequired) {
                      <small>MFA სავალდებულო გახდება</small>
                    }
                    @if (!role.assignmentAllowed) {
                      <small>D-05 policy: {{ role.blockReasonCode }}</small>
                    }
                  </span></label
                >
              }
            </fieldset>
            <label class="role-option">
              <input type="checkbox" [(ngModel)]="newMfaRequired" [disabled]="dialogBusy()" />
              <span
                ><strong>MFA სავალდებულოა</strong
                ><small>მოწვევის მიღებისას TOTP enrollment დასრულდება.</small></span
              >
            </label>
            <p class="identity-inline-state">
              Warehouse/channel/company scope assignment disabled-ია domain-owned scope catalog-ების
              მოსვლამდე.
            </p>
            <label for="new-staff-step-up">თქვენი Authenticator code</label
            ><input
              id="new-staff-step-up"
              [(ngModel)]="createStepUpCode"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              [disabled]="dialogBusy()"
            />
            <div class="drawer-actions">
              <button
                type="button"
                (click)="createStaff()"
                [disabled]="!createReady() || dialogBusy()"
              >
                მოწვევის გაგზავნა</button
              ><button
                type="button"
                class="quiet-button"
                (click)="closeCreate()"
                [disabled]="dialogBusy()"
              >
                დახურვა
              </button>
            </div>
          </section>
        }

        @if (selected(); as member) {
          <div class="identity-drawer-backdrop" aria-hidden="true"></div>
          <section
            #detailDialog
            class="identity-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-detail-title"
            aria-describedby="staff-detail-description"
            (keydown)="onDialogKeydown($event)"
          >
            <h2 id="staff-detail-title">{{ member.displayName }}</h2>
            <p id="staff-detail-description">{{ member.email }}</p>
            <p class="identity-inline-state">
              {{ statusLabel(member.status) }} · version {{ member.version }}
            </p>
            @if (detailState() === 'loading') {
              <p class="identity-loading">აქტუალური ჩანაწერი იტვირთება…</p>
            } @else if (detailState() === 'error') {
              <p class="identity-inline-state identity-inline-state--error" role="alert">
                აქტუალური ჩანაწერი ვერ ჩაიტვირთა; ცვლილებები დაბლოკილია.
              </p>
            }
            <h3>Global role assignments</h3>
            @for (role of roles(); track role.id) {
              <label class="role-option"
                ><input
                  type="checkbox"
                  [checked]="editRoleIds.includes(role.id)"
                  [disabled]="
                    !canAssignRoles() ||
                    detailState() !== 'ready' ||
                    dialogBusy() ||
                    (!role.assignmentAllowed && !editRoleIds.includes(role.id))
                  "
                  (change)="toggleEditRole(role.id, $event)"
                />
                <span
                  ><strong>{{ role.name }}</strong
                  ><small>{{ role.key }}</small>
                  @if (role.mfaRequired) {
                    <small>MFA სავალდებულო გახდება</small>
                  }
                  @if (!role.assignmentAllowed) {
                    <small>D-05 policy: ახალი მინიჭება დაბლოკილია</small>
                  }
                </span></label
              >
            }
            @if (!canAssignRoles()) {
              <p class="identity-inline-state">
                როლები მხოლოდ სანახავადაა — ცვლილებას roles.assign უფლება სჭირდება.
              </p>
            }
            @if (hasScopedAssignments(member)) {
              <p class="identity-inline-state">
                არსებული scoped assignments ჩანს სიაში, მაგრამ domain scope catalog-ის გარეშე ამ
                UI-დან არ რედაქტირდება.
              </p>
            }
            @if (canAssignRoles()) {
              <label for="staff-role-step-up">როლების ცვლილების Authenticator code</label
              ><input
                id="staff-role-step-up"
                [(ngModel)]="roleStepUpCode"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                [disabled]="dialogBusy()"
              />
              <div class="drawer-actions">
                <button
                  type="button"
                  (click)="saveAssignments(member)"
                  [disabled]="
                    roleStepUpCode.trim().length !== 6 ||
                    !assignmentsReady() ||
                    dialogBusy() ||
                    detailState() !== 'ready'
                  "
                >
                  როლების შენახვა
                </button>
              </div>
            }
            @if (canManage()) {
              <label for="staff-action-reason-code">მიზეზის კოდი</label>
              <select
                id="staff-action-reason-code"
                [(ngModel)]="actionReasonCode"
                [disabled]="detailState() !== 'ready' || dialogBusy()"
              >
                <option value="status_change">სტატუსის ცვლილება</option>
                <option value="security_incident">უსაფრთხოების ინციდენტი</option>
                <option value="access_review">წვდომის გადახედვა</option>
              </select>
              <label for="staff-action-reason">მოქმედების მიზეზი</label
              ><textarea
                id="staff-action-reason"
                [(ngModel)]="actionReason"
                [disabled]="detailState() !== 'ready' || dialogBusy()"
              ></textarea>
              <label for="staff-action-step-up">მოქმედების Authenticator code</label
              ><input
                id="staff-action-step-up"
                [(ngModel)]="stepUpCode"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                [disabled]="detailState() !== 'ready' || dialogBusy()"
              />
              <div class="drawer-actions">
                @if (canResendInvitation(member)) {
                  <button
                    type="button"
                    (click)="resendInvitation(member)"
                    [disabled]="!actionReady() || detailState() !== 'ready' || dialogBusy()"
                  >
                    მოწვევის ხელახლა გაგზავნა
                  </button>
                }
                @if (member.status === 'disabled') {
                  <button
                    type="button"
                    (click)="runAction(member, 'reenable')"
                    [disabled]="!actionReady() || detailState() !== 'ready' || dialogBusy()"
                  >
                    ხელახლა ჩართვა
                  </button>
                } @else if (member.status === 'pending_activation') {
                  <button
                    type="button"
                    (click)="runAction(member, 'activate')"
                    [disabled]="
                      stepUpCode.trim().length !== 6 || detailState() !== 'ready' || dialogBusy()
                    "
                  >
                    გააქტიურება
                  </button>
                }
                @if (canDisable(member)) {
                  <button
                    type="button"
                    class="danger-button"
                    (click)="runAction(member, 'disable')"
                    [disabled]="!actionReady() || detailState() !== 'ready' || dialogBusy()"
                  >
                    გამორთვა
                  </button>
                }
              </div>
              @if (disableBlockedByPolicy(member)) {
                <p class="identity-inline-state">
                  MFA-სავალდებულო ანგარიშის გამორთვა D-05 emergency ownership policy-ის
                  დამტკიცებამდე დაბლოკილია.
                </p>
              }
            }
            @if (canRequestRecovery()) {
              <h3>MFA recovery მოთხოვნა</h3>
              <p class="identity-inline-state">
                დამოუკიდებელი recovery workflow — საჭიროებს staff.recovery.request უფლებასა და
                თქვენს ბოლო MFA დადასტურებას.
              </p>
              <label for="staff-recovery-reason-code">Recovery მიზეზის კოდი</label>
              <select
                id="staff-recovery-reason-code"
                [(ngModel)]="recoveryReasonCode"
                [disabled]="detailState() !== 'ready' || dialogBusy()"
              >
                <option value="lost_authenticator">Authenticator დაკარგულია</option>
                <option value="security_incident">უსაფრთხოების ინციდენტი</option>
                <option value="access_restore">წვდომის აღდგენა</option>
              </select>
              <label for="staff-recovery-reason">Recovery მოთხოვნის დასაბუთება</label
              ><textarea
                id="staff-recovery-reason"
                [(ngModel)]="recoveryReason"
                [disabled]="detailState() !== 'ready' || dialogBusy()"
              ></textarea>
              <label for="staff-recovery-step-up">Recovery Authenticator code</label
              ><input
                id="staff-recovery-step-up"
                [(ngModel)]="recoveryStepUpCode"
                inputmode="numeric"
                pattern="[0-9]{6}"
                autocomplete="one-time-code"
                maxlength="6"
                [disabled]="detailState() !== 'ready' || dialogBusy()"
              />
              <div class="drawer-actions">
                <button
                  type="button"
                  (click)="requestRecovery(member)"
                  [disabled]="!recoveryReady() || detailState() !== 'ready' || dialogBusy()"
                >
                  MFA recovery მოთხოვნის შექმნა
                </button>
              </div>
            }
            @if (canManageSessions()) {
              <h3>სამიზნე ანგარიშის სესიები</h3>
              @if (targetSessionsState() === 'loading') {
                <p class="identity-loading">სესიები იტვირთება…</p>
              } @else if (targetSessionsState() === 'error') {
                <p class="identity-inline-state identity-inline-state--error" role="alert">
                  სესიები ვერ ჩაიტვირთა.
                </p>
                <button
                  type="button"
                  class="quiet-button"
                  (click)="reloadTargetSessions(member)"
                  [disabled]="dialogBusy()"
                >
                  თავიდან ცდა
                </button>
              } @else {
                <div class="target-session-list">
                  @for (session of targetSessions(); track session.id) {
                    <article class="target-session-item">
                      <strong>{{ targetSessionLabel(session) }}</strong>
                      <small>ბოლო აქტივობა: {{ formatDateTime(session.lastSeenAt) }}</small>
                      @if (session.revokedAt) {
                        <span>გაუქმებულია</span>
                      } @else {
                        <button
                          type="button"
                          class="quiet-button"
                          (click)="revokeTargetSession(member, session)"
                          [disabled]="
                            stepUpCode.trim().length !== 6 ||
                            detailState() !== 'ready' ||
                            dialogBusy()
                          "
                        >
                          სესიის გაუქმება
                        </button>
                      }
                    </article>
                  } @empty {
                    <p class="identity-inline-state">სესიები არ მოიძებნა.</p>
                  }
                </div>
                <div
                  #targetSessionsPagingStatus
                  class="identity-pagination"
                  aria-live="polite"
                  aria-atomic="true"
                  tabindex="-1"
                >
                  @if (targetSessionsLoadingMore()) {
                    <p class="identity-loading">შემდეგი სესიები იტვირთება…</p>
                  } @else if (targetSessionsPageError()) {
                    <p class="identity-inline-state identity-inline-state--error" role="alert">
                      შემდეგი გვერდი ვერ ჩაიტვირთა; ნაჩვენები სესიები შენარჩუნებულია.
                    </p>
                    <button
                      type="button"
                      class="quiet-button"
                      (click)="loadMoreTargetSessions(member, $event)"
                    >
                      თავიდან ცდა
                    </button>
                  } @else if (targetSessionsNextCursor()) {
                    <button
                      type="button"
                      class="quiet-button"
                      (click)="loadMoreTargetSessions(member, $event)"
                    >
                      მეტი სესიის ჩატვირთვა
                    </button>
                  } @else {
                    <p class="identity-inline-state">ყველა სესია ჩატვირთულია.</p>
                  }
                </div>
              }
            }
            <button
              #detailCloseButton
              type="button"
              class="quiet-button"
              (click)="closeDetail()"
              [disabled]="dialogBusy()"
            >
              დახურვა
            </button>
          </section>
        }
      }
      @if (notice(); as message) {
        <p class="identity-toast" role="status">{{ message }}</p>
      }
    </div>
  `,
})
export class StaffPage {
  readonly auth = inject(AuthService);
  private readonly api = inject(IdentityApiService);
  readonly state = signal<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  readonly staff = signal<StaffListResponse | null>(null);
  readonly staffNextCursor = signal<string | null>(null);
  readonly staffLoadingMore = signal(false);
  readonly staffPageError = signal(false);
  readonly selected = signal<StaffListItem | null>(null);
  readonly detailState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly targetSessionsState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly targetSessions = signal<TargetStaffSessionItem[]>([]);
  readonly targetSessionsNextCursor = signal<string | null>(null);
  readonly targetSessionsLoadingMore = signal(false);
  readonly targetSessionsPageError = signal(false);
  readonly roles = signal<RoleCatalogItem[]>([]);
  readonly createOpen = signal(false);
  readonly dialogBusy = signal(false);
  readonly notice = signal<string | null>(null);
  private dialogTrigger: HTMLElement | null = null;
  private directoryRequestGeneration = 0;
  private targetSessionsRequestGeneration = 0;

  @ViewChild('createDialog') private createDialog?: ElementRef<HTMLElement>;
  @ViewChild('createNameInput') private createNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('detailDialog') private detailDialog?: ElementRef<HTMLElement>;
  @ViewChild('detailCloseButton') private detailCloseButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('staffPagingStatus') private staffPagingStatus?: ElementRef<HTMLElement>;
  @ViewChild('targetSessionsPagingStatus')
  private targetSessionsPagingStatus?: ElementRef<HTMLElement>;
  query = '';
  status = '';
  newDisplayName = '';
  newEmail = '';
  newMfaRequired = true;
  actionReason = '';
  actionReasonCode = 'status_change';
  stepUpCode = '';
  recoveryReason = '';
  recoveryReasonCode = 'lost_authenticator';
  recoveryStepUpCode = '';
  roleStepUpCode = '';
  createStepUpCode = '';
  approvalRequestId = '';
  approvalStepUpCode = '';
  newRoleIds: string[] = [];
  editRoleIds: string[] = [];

  constructor() {
    if (this.auth.identityV2Enabled) this.load();
    else this.state.set('unavailable');
  }
  canManage(): boolean {
    return this.auth.hasPermission('staff.manage');
  }
  canAssignRoles(): boolean {
    return this.auth.hasPermission('roles.assign');
  }
  canManageSessions(): boolean {
    return this.auth.hasPermission('sessions.manage');
  }
  canRequestRecovery(): boolean {
    return this.auth.hasPermission('staff.recovery.request');
  }
  canApproveRecovery(): boolean {
    return this.auth.hasPermission('staff.recovery.approve');
  }
  actionReady(): boolean {
    return this.actionReason.trim().length >= 3 && this.stepUpCode.trim().length === 6;
  }
  recoveryReady(): boolean {
    return this.recoveryReason.trim().length >= 3 && /^\d{6}$/.test(this.recoveryStepUpCode.trim());
  }
  assignmentsReady(): boolean {
    return (
      this.editRoleIds.length > 0 &&
      this.editRoleIds.every(
        (roleId) => this.roles().find((role) => role.id === roleId)?.assignmentAllowed,
      )
    );
  }

  load(): void {
    const generation = ++this.directoryRequestGeneration;
    this.state.set('loading');
    this.staff.set(null);
    this.staffNextCursor.set(null);
    this.staffLoadingMore.set(false);
    this.staffPageError.set(false);
    forkJoin({
      staff: this.api.listStaff({
        q: this.query.trim() || undefined,
        status: this.status || undefined,
      }),
      roles: this.api.listRoles(),
    }).subscribe({
      next: ({ staff, roles }) => {
        if (generation !== this.directoryRequestGeneration) return;
        this.staff.set(staff);
        this.staffNextCursor.set(staff.nextCursor ?? null);
        this.roles.set(roles.items);
        this.state.set('ready');
      },
      error: (error: unknown) => {
        if (generation !== this.directoryRequestGeneration) return;
        this.state.set(isUnavailable(error) ? 'unavailable' : 'error');
      },
    });
  }

  loadMoreStaff(event?: Event): void {
    const cursor = this.staffNextCursor();
    if (!cursor || this.staffLoadingMore() || this.state() !== 'ready') return;
    const generation = this.directoryRequestGeneration;
    const trigger = event?.currentTarget as HTMLElement | null;
    this.staffLoadingMore.set(true);
    this.staffPageError.set(false);
    this.api
      .listStaff({
        q: this.query.trim() || undefined,
        status: this.status || undefined,
        cursor,
      })
      .subscribe({
        next: (page) => {
          if (generation !== this.directoryRequestGeneration) return;
          this.staff.update((current) =>
            current ? { ...current, items: dedupeById(current.items, page.items) } : page,
          );
          this.staffNextCursor.set(page.nextCursor ?? null);
          this.staffLoadingMore.set(false);
          queueMicrotask(() =>
            page.nextCursor ? trigger?.focus() : this.staffPagingStatus?.nativeElement.focus(),
          );
        },
        error: () => {
          if (generation !== this.directoryRequestGeneration) return;
          this.staffLoadingMore.set(false);
          this.staffPageError.set(true);
          queueMicrotask(() => this.staffPagingStatus?.nativeElement.focus());
        },
      });
  }

  filteredItems(items: StaffListItem[]): StaffListItem[] {
    const query = this.query.trim().toLocaleLowerCase('ka-GE');
    if (!query) return items;
    return items.filter((item) =>
      `${item.displayName ?? ''} ${item.email}`.toLocaleLowerCase('ka-GE').includes(query),
    );
  }

  dialogOpen(): boolean {
    return this.createOpen() || this.selected() !== null;
  }

  openCreate(event?: Event): void {
    if (this.dialogOpen() || !this.canManage() || !this.canAssignRoles()) return;
    this.dialogTrigger = event?.currentTarget as HTMLElement | null;
    this.newDisplayName = '';
    this.newEmail = '';
    this.newRoleIds = [];
    this.newMfaRequired = true;
    this.createStepUpCode = '';
    this.createOpen.set(true);
    queueMicrotask(() => this.createNameInput?.nativeElement.focus());
  }

  openDetail(member: StaffListItem, event?: Event): void {
    if (this.dialogOpen()) return;
    this.dialogTrigger = event?.currentTarget as HTMLElement | null;
    this.selected.set(member);
    this.roleStepUpCode = '';
    this.editRoleIds = member.assignments
      .filter((assignment) => assignment.scopeType === 'global')
      .map((assignment) => assignment.role.id);
    this.refreshStaffDetail(member.id);
    if (this.canManageSessions()) this.loadTargetSessions(member.id);
    else {
      this.targetSessionsRequestGeneration++;
      this.targetSessions.set([]);
      this.targetSessionsState.set('idle');
      this.targetSessionsNextCursor.set(null);
      this.targetSessionsLoadingMore.set(false);
      this.targetSessionsPageError.set(false);
    }
    queueMicrotask(() => this.detailCloseButton?.nativeElement.focus());
  }

  createReady(): boolean {
    return (
      this.canManage() &&
      this.canAssignRoles() &&
      this.newDisplayName.trim().length > 1 &&
      /.+@.+\..+/.test(this.newEmail) &&
      this.newRoleIds.length > 0 &&
      this.newRoleIds.every(
        (roleId) => this.roles().find((role) => role.id === roleId)?.assignmentAllowed,
      ) &&
      this.createStepUpCode.trim().length === 6
    );
  }

  toggleRole(roleId: string, event: Event): void {
    if (!this.canAssignRoles() || this.dialogBusy()) return;
    const checked = (event.target as HTMLInputElement).checked;
    if (checked && !this.roles().find((role) => role.id === roleId)?.assignmentAllowed) return;
    this.newRoleIds = toggleId(this.newRoleIds, roleId, checked);
  }

  toggleEditRole(roleId: string, event: Event): void {
    if (!this.canAssignRoles() || this.dialogBusy()) return;
    const checked = (event.target as HTMLInputElement).checked;
    if (checked && !this.roles().find((role) => role.id === roleId)?.assignmentAllowed) return;
    this.editRoleIds = toggleId(this.editRoleIds, roleId, checked);
  }

  createStaff(): void {
    if (!this.createReady() || this.dialogBusy()) return;
    this.dialogBusy.set(true);
    const preview = {
      email: this.newEmail.trim(),
      displayName: this.newDisplayName.trim(),
      mfaRequired: this.newMfaRequired,
      assignments: this.newRoleIds.map((roleId) => ({
        roleId,
        scopeType: 'global' as const,
        scopeId: '',
      })),
    };
    this.api
      .previewCreateStaff(preview)
      .pipe(
        switchMap((serverPreview) =>
          this.api
            .stepUp(this.createStepUpCode.trim(), serverPreview.requestedActionHash)
            .pipe(map(({ stepUpToken }) => ({ serverPreview, stepUpToken }))),
        ),
        switchMap(({ serverPreview, stepUpToken }) =>
          this.api.createStaff(
            {
              ...preview,
              mfaRequired: serverPreview.mfaRequired,
              assignments: serverPreview.assignments,
              idempotencyKey: crypto.randomUUID(),
            },
            stepUpToken,
          ),
        ),
      )
      .subscribe({
        next: () => {
          this.dialogBusy.set(false);
          this.createStepUpCode = '';
          this.notice.set('თანამშრომლის მოწვევა შეიქმნა.');
          this.closeCreate();
          this.load();
        },
        error: () => {
          this.dialogBusy.set(false);
          this.createStepUpCode = '';
          this.notice.set('მოწვევა ვერ შეიქმნა ან step-up ვერ დადასტურდა.');
        },
      });
  }

  saveAssignments(member: StaffListItem): void {
    if (
      !this.canAssignRoles() ||
      this.detailState() !== 'ready' ||
      this.dialogBusy() ||
      this.roleStepUpCode.trim().length !== 6 ||
      !this.assignmentsReady()
    ) {
      return;
    }
    this.dialogBusy.set(true);
    const assignments = this.editRoleIds.map((roleId) => ({
      roleId,
      scopeType: 'global' as const,
      scopeId: '',
    }));
    this.api
      .previewRoleAssignments(member.id, member.version, assignments)
      .pipe(
        switchMap((serverPreview) =>
          this.api
            .stepUp(this.roleStepUpCode.trim(), serverPreview.requestedActionHash)
            .pipe(map(({ stepUpToken }) => ({ serverPreview, stepUpToken }))),
        ),
        switchMap(({ serverPreview, stepUpToken }) =>
          this.api.updateRoleAssignments(
            member.id,
            member.version,
            serverPreview.assignments,
            stepUpToken,
          ),
        ),
      )
      .subscribe({
        next: (result) => {
          this.dialogBusy.set(false);
          this.roleStepUpCode = '';
          const roleAssignments = this.editRoleIds.flatMap((roleId) => {
            const role = this.roles().find((item) => item.id === roleId);
            return role
              ? [
                  {
                    role: { id: role.id, key: role.key, name: role.name },
                    scopeType: 'global' as const,
                    scopeId: '',
                  },
                ]
              : [];
          });
          this.patchStaff(member.id, {
            version: result.version,
            mfaRequired: result.mfaRequired,
            assignments: roleAssignments,
          });
          this.notice.set('როლები განახლდა და ძველი სესიები გაუქმდა.');
          this.closeDetail();
        },
        error: (error: unknown) => {
          this.dialogBusy.set(false);
          this.roleStepUpCode = '';
          this.handleMutationError(
            error,
            member.id,
            'როლები ვერ განახლდა; preview მოძველდა ან step-up ვერ დადასტურდა.',
          );
        },
      });
  }

  runAction(member: StaffListItem, action: 'activate' | 'disable' | 'reenable'): void {
    if (
      !this.canManage() ||
      this.detailState() !== 'ready' ||
      this.dialogBusy() ||
      !this.isLegalAction(member, action) ||
      (action === 'disable' && member.mfaRequired)
    ) {
      return;
    }
    this.dialogBusy.set(true);
    const reasonCode = action === 'activate' ? 'activation' : this.actionReasonCode;
    const reasonComment = action === 'activate' ? '' : this.actionReason.trim();
    this.api
      .previewStaffAction(member.id, action, member.version, reasonCode, reasonComment)
      .pipe(
        switchMap(({ requestedActionHash }) =>
          this.api.stepUp(this.stepUpCode.trim(), requestedActionHash),
        ),
        switchMap(({ stepUpToken }) =>
          this.api.staffAction(
            member.id,
            action,
            member.version,
            reasonCode,
            reasonComment,
            stepUpToken,
          ),
        ),
      )
      .subscribe({
        next: (result) => {
          this.dialogBusy.set(false);
          this.stepUpCode = '';
          this.patchStaff(member.id, {
            status: result.status,
            version: result.version,
          });
          this.notice.set('მოქმედება შესრულდა.');
          this.closeDetail();
        },
        error: (error: unknown) => {
          this.dialogBusy.set(false);
          this.stepUpCode = '';
          this.handleMutationError(
            error,
            member.id,
            'მოქმედება ვერ შესრულდა ან step-up ვერ დადასტურდა.',
          );
        },
      });
  }

  resendInvitation(member: StaffListItem): void {
    if (
      !this.canManage() ||
      !this.canResendInvitation(member) ||
      this.detailState() !== 'ready' ||
      !this.actionReady() ||
      this.dialogBusy()
    ) {
      return;
    }
    this.dialogBusy.set(true);
    const reasonCode = 'resend_requested';
    const reasonComment = this.actionReason.trim();
    this.api
      .previewInvitationResend(member.id, member.version, reasonCode, reasonComment)
      .pipe(
        switchMap(({ requestedActionHash }) =>
          this.api.stepUp(this.stepUpCode.trim(), requestedActionHash),
        ),
        switchMap(({ stepUpToken }) =>
          this.api.resendInvitation(
            member.id,
            member.version,
            reasonCode,
            reasonComment,
            stepUpToken,
            crypto.randomUUID(),
          ),
        ),
      )
      .subscribe({
        next: (result) => {
          this.dialogBusy.set(false);
          this.stepUpCode = '';
          this.patchStaff(member.id, { version: result.version });
          this.notice.set(
            `მოწვევა ხელახლა გაიგზავნა; ვადა: ${this.formatDateTime(result.invitation.expiresAt)}.`,
          );
        },
        error: (error: unknown) => {
          this.dialogBusy.set(false);
          this.stepUpCode = '';
          this.handleMutationError(error, member.id, 'მოწვევა ხელახლა ვერ გაიგზავნა.');
        },
      });
  }

  revokeTargetSession(member: StaffListItem, session: TargetStaffSessionItem): void {
    if (
      !this.canManageSessions() ||
      this.detailState() !== 'ready' ||
      session.revokedAt ||
      this.stepUpCode.trim().length !== 6 ||
      this.dialogBusy()
    ) {
      return;
    }
    this.dialogBusy.set(true);
    this.api
      .previewTargetSessionRevoke(member.id, session.id, member.version)
      .pipe(
        switchMap(({ requestedActionHash }) =>
          this.api.stepUp(this.stepUpCode.trim(), requestedActionHash),
        ),
        switchMap(({ stepUpToken }) =>
          this.api.revokeTargetSession(member.id, session.id, member.version, stepUpToken),
        ),
      )
      .subscribe({
        next: (result) => {
          this.dialogBusy.set(false);
          this.stepUpCode = '';
          this.patchStaff(member.id, { version: result.targetVersion });
          this.targetSessions.update((items) =>
            items.map((item) =>
              item.id === session.id ? { ...item, revokedAt: new Date().toISOString() } : item,
            ),
          );
          this.notice.set('სამიზნე სესია გაუქმდა.');
        },
        error: (error: unknown) => {
          this.dialogBusy.set(false);
          this.stepUpCode = '';
          this.handleMutationError(error, member.id, 'სამიზნე სესია ვერ გაუქმდა.');
        },
      });
  }

  requestRecovery(member: StaffListItem): void {
    if (
      !this.canRequestRecovery() ||
      this.detailState() !== 'ready' ||
      !this.recoveryReady() ||
      this.dialogBusy()
    ) {
      return;
    }
    this.dialogBusy.set(true);
    const reasonCode = this.recoveryReasonCode;
    const reasonComment = this.recoveryReason.trim();
    this.api
      .previewRecoveryRequest(member.id, reasonCode, reasonComment)
      .pipe(
        switchMap(({ requestedActionHash }) =>
          this.api.stepUp(this.recoveryStepUpCode.trim(), requestedActionHash),
        ),
        switchMap(({ stepUpToken }) =>
          this.api.createRecoveryRequest(member.id, reasonCode, reasonComment, stepUpToken),
        ),
      )
      .subscribe({
        next: (request) => {
          this.dialogBusy.set(false);
          this.recoveryStepUpCode = '';
          this.notice.set(
            `Recovery request ${request.id} — ${request.state}; მოქმედებს ${this.formatDate(request.expiresAt)}-მდე.`,
          );
          this.closeDetail();
        },
        error: () => {
          this.dialogBusy.set(false);
          this.recoveryStepUpCode = '';
          this.notice.set(
            'Recovery request ვერ შეიქმნა; separation, stale preview ან step-up გადაამოწმეთ.',
          );
        },
      });
  }

  approveRecovery(): void {
    const requestId = this.approvalRequestId.trim();
    const code = this.approvalStepUpCode.trim();
    if (!requestId || code.length !== 6) return;
    this.api
      .previewRecoveryApproval(requestId)
      .pipe(
        switchMap((preview) => {
          if (preview.state !== 'pending' || Date.parse(preview.expiresAt) <= Date.now()) {
            throw new Error('RECOVERY_PREVIEW_NOT_ACTIONABLE');
          }
          return this.api.stepUp(code, preview.requestedActionHash);
        }),
        switchMap(({ stepUpToken }) => this.api.approveRecoveryRequest(requestId, stepUpToken)),
      )
      .subscribe({
        next: (result) => {
          this.approvalRequestId = '';
          this.approvalStepUpCode = '';
          this.notice.set(
            `Recovery request ${result.id} შესრულდა; სამიზნე ანგარიში pending activation მდგომარეობაშია.`,
          );
          this.load();
        },
        error: () => {
          this.approvalStepUpCode = '';
          this.notice.set(
            'Recovery approval ვერ შესრულდა; requester/approver separation, expiry ან stale payload გადაამოწმეთ.',
          );
        },
      });
  }

  canResendInvitation(member: StaffListItem): boolean {
    return member.status === 'invited' || member.status === 'pending_activation';
  }

  canDisable(member: StaffListItem): boolean {
    return (
      (member.status === 'invited' ||
        member.status === 'pending_activation' ||
        member.status === 'active') &&
      !member.mfaRequired
    );
  }

  disableBlockedByPolicy(member: StaffListItem): boolean {
    return (
      (member.status === 'invited' ||
        member.status === 'pending_activation' ||
        member.status === 'active') &&
      member.mfaRequired
    );
  }

  targetSessionLabel(session: TargetStaffSessionItem): string {
    return (
      session.deviceLabel ||
      [session.browserFamily, session.osFamily].filter(Boolean).join(' · ') ||
      'უცნობი მოწყობილობა'
    );
  }

  formatDateTime(value: string): string {
    return new Intl.DateTimeFormat('ka-GE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tbilisi',
    }).format(new Date(value));
  }

  private refreshStaffDetail(staffId: string): void {
    this.detailState.set('loading');
    this.api.staffDetail(staffId).subscribe({
      next: (detail) => {
        const current = this.selected();
        if (!current || current.id !== staffId) return;
        const refreshed = this.detailToListItem(detail, current.lastActivityAt);
        this.selected.set(refreshed);
        this.editRoleIds = refreshed.assignments
          .filter((assignment) => assignment.scopeType === 'global')
          .map((assignment) => assignment.role.id);
        this.patchStaff(staffId, refreshed);
        this.detailState.set('ready');
      },
      error: () => {
        if (this.selected()?.id === staffId) this.detailState.set('error');
      },
    });
  }

  private loadTargetSessions(staffId: string): void {
    const generation = ++this.targetSessionsRequestGeneration;
    this.targetSessionsState.set('loading');
    this.targetSessions.set([]);
    this.targetSessionsNextCursor.set(null);
    this.targetSessionsLoadingMore.set(false);
    this.targetSessionsPageError.set(false);
    this.api.targetSessions(staffId).subscribe({
      next: (result) => {
        if (
          generation !== this.targetSessionsRequestGeneration ||
          this.selected()?.id !== staffId
        ) {
          return;
        }
        this.targetSessions.set(result.items);
        this.targetSessionsNextCursor.set(result.nextCursor ?? null);
        this.targetSessionsState.set('ready');
      },
      error: () => {
        if (
          generation === this.targetSessionsRequestGeneration &&
          this.selected()?.id === staffId
        ) {
          this.targetSessionsState.set('error');
        }
      },
    });
  }

  loadMoreTargetSessions(member: StaffListItem, event?: Event): void {
    const cursor = this.targetSessionsNextCursor();
    if (
      !this.canManageSessions() ||
      !cursor ||
      this.targetSessionsLoadingMore() ||
      this.targetSessionsState() !== 'ready' ||
      this.selected()?.id !== member.id
    ) {
      return;
    }
    const generation = this.targetSessionsRequestGeneration;
    const trigger = event?.currentTarget as HTMLElement | null;
    this.targetSessionsLoadingMore.set(true);
    this.targetSessionsPageError.set(false);
    this.api.targetSessions(member.id, cursor).subscribe({
      next: (page) => {
        if (
          generation !== this.targetSessionsRequestGeneration ||
          this.selected()?.id !== member.id
        ) {
          return;
        }
        this.targetSessions.update((current) => dedupeById(current, page.items));
        this.targetSessionsNextCursor.set(page.nextCursor ?? null);
        this.targetSessionsLoadingMore.set(false);
        queueMicrotask(() =>
          page.nextCursor
            ? trigger?.focus()
            : this.targetSessionsPagingStatus?.nativeElement.focus(),
        );
      },
      error: () => {
        if (
          generation !== this.targetSessionsRequestGeneration ||
          this.selected()?.id !== member.id
        ) {
          return;
        }
        this.targetSessionsLoadingMore.set(false);
        this.targetSessionsPageError.set(true);
        queueMicrotask(() => this.targetSessionsPagingStatus?.nativeElement.focus());
      },
    });
  }

  reloadTargetSessions(member: StaffListItem): void {
    if (
      !this.canManageSessions() ||
      this.targetSessionsLoadingMore() ||
      this.targetSessionsState() === 'loading' ||
      this.selected()?.id !== member.id
    ) {
      return;
    }
    this.loadTargetSessions(member.id);
  }

  private detailToListItem(
    detail: StaffDetailResponse,
    lastActivityAt: string | null | undefined,
  ): StaffListItem {
    return {
      id: detail.id,
      email: detail.email,
      displayName: detail.displayName ?? undefined,
      status: detail.status,
      mfaRequired: detail.mfaRequired,
      mfaEnrolled: detail.mfaCredentials.length > 0,
      lastActivityAt,
      version: detail.version,
      assignments: detail.roleAssignments,
    };
  }

  private patchStaff(staffId: string, patch: Partial<StaffListItem>): void {
    this.staff.update((result) =>
      result
        ? {
            ...result,
            items: result.items.map((item) => (item.id === staffId ? { ...item, ...patch } : item)),
          }
        : result,
    );
    this.selected.update((item) => (item?.id === staffId ? { ...item, ...patch } : item));
  }

  private handleMutationError(error: unknown, staffId: string, fallback: string): void {
    if (identityErrorCode(error) === 'STAFF_VERSION_CONFLICT') {
      this.notice.set(
        'ჩანაწერი სხვაგან შეიცვალა. აქტუალური ვერსია ხელახლა ჩაიტვირთა; გადაამოწმეთ და გაიმეორეთ.',
      );
      this.refreshStaffDetail(staffId);
      if (this.canManageSessions()) this.loadTargetSessions(staffId);
      return;
    }
    this.notice.set(fallback);
  }

  private isLegalAction(
    member: StaffListItem,
    action: 'activate' | 'disable' | 'reenable',
  ): boolean {
    return {
      activate: member.status === 'pending_activation',
      disable:
        member.status === 'invited' ||
        member.status === 'pending_activation' ||
        member.status === 'active',
      reenable: member.status === 'disabled',
    }[action];
  }

  onDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeActiveDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = this.createOpen()
      ? this.createDialog?.nativeElement
      : this.detailDialog?.nativeElement;
    if (!dialog) return;
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  closeCreate(): void {
    if (this.dialogBusy()) return;
    this.createOpen.set(false);
    this.createStepUpCode = '';
    this.restoreDialogTrigger();
  }

  closeDetail(): void {
    if (this.dialogBusy()) return;
    this.selected.set(null);
    this.actionReason = '';
    this.stepUpCode = '';
    this.recoveryReason = '';
    this.recoveryReasonCode = 'lost_authenticator';
    this.recoveryStepUpCode = '';
    this.roleStepUpCode = '';
    this.editRoleIds = [];
    this.detailState.set('idle');
    this.targetSessionsState.set('idle');
    this.targetSessions.set([]);
    this.targetSessionsRequestGeneration++;
    this.targetSessionsNextCursor.set(null);
    this.targetSessionsLoadingMore.set(false);
    this.targetSessionsPageError.set(false);
    this.restoreDialogTrigger();
  }

  private closeActiveDialog(): void {
    if (this.dialogBusy()) return;
    if (this.createOpen()) this.closeCreate();
    else if (this.selected()) this.closeDetail();
  }

  private restoreDialogTrigger(): void {
    const trigger = this.dialogTrigger;
    this.dialogTrigger = null;
    queueMicrotask(() => trigger?.focus());
  }
  hasScopedAssignments(member: StaffListItem): boolean {
    return member.assignments.some((assignment) => assignment.scopeType !== 'global');
  }
  statusLabel(status: StaffStatus): string {
    return {
      invited: 'მოწვეული',
      pending_activation: 'აქტივაციის მოლოდინი',
      active: 'აქტიური',
      disabled: 'გამორთული',
    }[status];
  }
  assignmentSummary(member: StaffListItem): string {
    return (
      member.assignments
        .map(
          (item) =>
            `${item.role.name} · ${item.scopeType}${item.scopeId ? ':' + item.scopeId : ''}`,
        )
        .join(', ') || '—'
    );
  }
  formatDate(value: string): string {
    return new Intl.DateTimeFormat('ka-GE', {
      dateStyle: 'medium',
      timeZone: 'Asia/Tbilisi',
    }).format(new Date(value));
  }
}

function toggleId(ids: string[], id: string, checked: boolean): string[] {
  return checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id);
}

function dedupeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
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

function identityErrorCode(error: unknown): string | undefined {
  return error instanceof HttpErrorResponse && typeof error.error?.code === 'string'
    ? error.error.code
    : undefined;
}
