import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { AdminInfo } from '@tyre/shared';

import { environment } from '../../../environments/environment';
import { BrandAdminService } from '../../core/brand-admin.service';
import { TireAdminService } from '../../core/tire-admin.service';

type LoadState = 'loading' | 'ready' | 'error';

interface CatalogSnapshot {
  brands: number;
  models: number;
  products: number;
  modelsWithoutPhotos: number;
}

/** Action-first command center. Every number shown here comes from an existing admin endpoint. */
@Component({
  selector: 'adm-dashboard-page',
  imports: [RouterLink],
  template: `
    <div class="dashboard-page">
      <header class="workspace-heading">
        <div>
          <p class="workspace-heading__eyebrow">სამუშაო დაფა</p>
          <h1>დღევანდელი ოპერაციები</h1>
          <p class="workspace-heading__summary">
            აქ გამოჩნდება მხოლოდ ის მონაცემი, რომელსაც მოქმედი სისტემური წყარო აქვს.
          </p>
        </div>
        <button type="button" class="refresh-button" (click)="reload()" [disabled]="isRefreshing()">
          <span aria-hidden="true">↻</span>
          {{ isRefreshing() ? 'განახლება…' : 'განახლება' }}
        </button>
      </header>

      <section class="system-strip" aria-labelledby="system-status-title">
        <div>
          <span
            class="system-strip__signal"
            [class.system-strip__signal--ready]="meState() === 'ready'"
            [class.system-strip__signal--error]="meState() === 'error'"
          ></span>
          <div>
            <h2 id="system-status-title">ადმინისტრატორის API</h2>
            @if (meState() === 'loading') {
              <p>სესიის გადამოწმება…</p>
            } @else if (meState() === 'ready') {
              <p>სესია გადამოწმებულია · {{ me()?.email }}</p>
            } @else {
              <p>სესიის სტატუსი ვერ გადამოწმდა</p>
            }
          </div>
        </div>
        <span class="system-strip__meta">{{ me()?.role ?? '—' }}</span>
      </section>

      <div class="dashboard-grid">
        <section class="ops-section" aria-labelledby="actions-title">
          <div class="section-heading">
            <div>
              <p class="section-heading__kicker">მოქმედებას მოითხოვს</p>
              <h2 id="actions-title">ოპერაციული რიგები</h2>
            </div>
            <span class="foundation-tag">Foundation</span>
          </div>

          <p class="section-note">
            ტრანზაქციული მოდულები ჯერ არ არის დაკავშირებული. ცრუ ნულების ნაცვლად ქვემოთ ჩანს
            თითოეული საჭირო მონაცემთა წყაროს მდგომარეობა.
          </p>

          <div class="ops-queue" role="list" aria-label="დაგეგმილი ოპერაციული რიგები">
            @for (queue of pendingQueues; track queue.name) {
              <div class="ops-queue__row" role="listitem">
                <span class="ops-queue__marker" aria-hidden="true"></span>
                <span class="ops-queue__name">
                  <strong>{{ queue.name }}</strong>
                  <small>{{ queue.scope }}</small>
                </span>
                <span class="ops-queue__source">{{ queue.source }}</span>
                <button type="button" disabled aria-label="{{ queue.name }} — ჯერ მიუწვდომელია">
                  მიუწვდომელია
                </button>
              </div>
            }
          </div>
        </section>

        <aside class="catalog-panel" aria-labelledby="catalog-title">
          <div class="section-heading">
            <div>
              <p class="section-heading__kicker">არსებული მონაცემები</p>
              <h2 id="catalog-title">კატალოგის მდგომარეობა</h2>
            </div>
            @if (lastRefresh()) {
              <time [attr.datetime]="lastRefresh()?.toISOString()">{{
                formattedRefreshTime()
              }}</time>
            }
          </div>

          @if (catalogState() === 'loading') {
            <div class="catalog-loading" aria-label="კატალოგის მონაცემები იტვირთება">
              <span></span><span></span><span></span><span></span>
            </div>
          } @else if (catalogState() === 'error') {
            <div class="inline-error" role="alert">
              <strong>კატალოგი ვერ ჩაიტვირთა</strong>
              <p>არსებული API ამ მოთხოვნაზე არ პასუხობს.</p>
              <button type="button" (click)="loadCatalog()">თავიდან ცდა</button>
            </div>
          } @else if (catalog(); as data) {
            <dl class="catalog-metrics">
              <div>
                <dt>პროდუქტი / SKU</dt>
                <dd>{{ data.products }}</dd>
              </div>
              <div>
                <dt>საბურავის მოდელი</dt>
                <dd>{{ data.models }}</dd>
              </div>
              <div>
                <dt>ბრენდი</dt>
                <dd>{{ data.brands }}</dd>
              </div>
              <div [class.catalog-metrics__attention]="data.modelsWithoutPhotos > 0">
                <dt>ფოტოს გარეშე</dt>
                <dd>{{ data.modelsWithoutPhotos }}</dd>
              </div>
            </dl>

            <div class="catalog-actions">
              <a routerLink="/tires">კატალოგის გახსნა <span aria-hidden="true">→</span></a>
              <a routerLink="/tires" [queryParams]="{ photos: 'without' }">
                ფოტოების რიგი <span aria-hidden="true">→</span>
              </a>
            </div>
          }

          <div class="inventory-disclaimer">
            <span aria-hidden="true">i</span>
            <p>
              <strong>ზუსტი მარაგი ჯერ არ იზომება.</strong>
              პროდუქტის მიმდინარე stock სტატუსი inventory ledger-ს არ ანაცვლებს.
            </p>
          </div>
        </aside>
      </div>

      <section class="kpi-foundation" aria-labelledby="kpi-title">
        <div class="section-heading">
          <div>
            <p class="section-heading__kicker">ანგარიშგების საფუძველი</p>
            <h2 id="kpi-title">ბიზნეს KPI-ები</h2>
          </div>
          <span>Asia/Tbilisi · GEL</span>
        </div>
        <div class="kpi-foundation__row">
          @for (metric of unavailableMetrics; track metric) {
            <div>
              <span>{{ metric }}</span>
              <strong aria-label="მონაცემი მიუწვდომელია">—</strong>
              <small>მონაცემთა წყარო არ არის დაკავშირებული</small>
            </div>
          }
        </div>
      </section>
    </div>
  `,
})
export class DashboardPage {
  private readonly http = inject(HttpClient);
  private readonly brandApi = inject(BrandAdminService);
  private readonly tireApi = inject(TireAdminService);
  private readonly destroyRef = inject(DestroyRef);

  readonly me = signal<AdminInfo | null>(null);
  readonly meState = signal<LoadState>('loading');
  readonly catalog = signal<CatalogSnapshot | null>(null);
  readonly catalogState = signal<LoadState>('loading');
  readonly lastRefresh = signal<Date | null>(null);

  readonly pendingQueues = [
    { name: 'ახალი შეკვეთები', scope: 'დამუშავება და შესრულება', source: 'Order API საჭირო' },
    {
      name: 'გადახდის შემოწმება',
      scope: 'დამტკიცება და reconciliation',
      source: 'Payment API საჭირო',
    },
    {
      name: 'დაბალი მარაგი',
      scope: 'ნაშთი, reservation და reorder',
      source: 'Inventory ledger საჭირო',
    },
    { name: 'დაბრუნებები', scope: 'Return, warranty და refund', source: 'Returns API საჭირო' },
  ];

  readonly unavailableMetrics = [
    'დღიური გაყიდვები',
    'გადახდის წარმატება',
    'საშუალო შეკვეთა',
    'Gross margin',
  ];

  constructor() {
    this.reload();
  }

  isRefreshing(): boolean {
    return this.meState() === 'loading' || this.catalogState() === 'loading';
  }

  reload(): void {
    this.loadMe();
    this.loadCatalog();
  }

  loadCatalog(): void {
    this.catalogState.set('loading');
    forkJoin({
      brands: this.brandApi.list(),
      noPhotoModels: this.tireApi.list({ page: 1, pageSize: 1, photos: 'without' }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ brands, noPhotoModels }) => {
          this.catalog.set({
            brands: brands.length,
            models: brands.reduce((sum, brand) => sum + brand.tireModelCount, 0),
            products: brands.reduce((sum, brand) => sum + brand.productCount, 0),
            modelsWithoutPhotos: noPhotoModels.total,
          });
          this.lastRefresh.set(new Date());
          this.catalogState.set('ready');
        },
        error: () => {
          this.catalog.set(null);
          this.catalogState.set('error');
        },
      });
  }

  formattedRefreshTime(): string {
    const value = this.lastRefresh();
    if (!value) return '';
    return new Intl.DateTimeFormat('ka-GE', {
      timeZone: 'Asia/Tbilisi',
      hour: '2-digit',
      minute: '2-digit',
    }).format(value);
  }

  private loadMe(): void {
    this.meState.set('loading');
    this.http
      .get<AdminInfo>(`${environment.apiBaseUrl}/admin/me`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (admin) => {
          this.me.set(admin);
          this.meState.set('ready');
        },
        error: () => {
          this.me.set(null);
          this.meState.set('error');
        },
      });
  }
}
