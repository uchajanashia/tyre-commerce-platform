import { DatePipe, DecimalPipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, forkJoin, of, switchMap } from 'rxjs';
import { VEHICLE_CLASSIFICATIONS } from '@tyre/shared/vehicle-classification';
import type {
  WorkflowConfig,
  OperationsPage,
  OperationsRow,
  OperationsSummary,
  OperationsView,
} from '@tyre/shared';
import { AuthService } from '../../core/auth.service';
import { OperationsApiService } from '../../core/operations-api.service';

import { WorkflowDetailComponent } from './workflow-detail';

type View = OperationsView | 'overview';
export const VIEW_INFO: Record<
  View,
  { title: string; note: string; search: string; states: string[] }
> = {
  overview: { title: 'მიმოხილვა', note: 'მთავარი საქმეები, ერთ სივრცეში.', search: '', states: [] },
  orders: {
    title: 'შეკვეთები',
    note: 'შეკვეთის შემადგენლობა და გადახდის მდგომარეობა.',
    search: 'შეკვეთის ნომერი…',
    states: [
      'awaiting_payment',
      'paid',
      'ready',
      'stock_exception',
      'refund_pending',
      'issued',
      'failed',
      'cancelled',
      'expired',
      'draft',
    ],
  },
  payments: {
    title: 'გადახდები',
    note: 'საბანკო გადახდის მცდელობები.',
    search: 'შეკვეთის ან ბანკის ნომერი…',
    states: ['pending', 'succeeded', 'failed', 'created', 'cancelled', 'expired'],
  },
  customers: {
    title: 'მომხმარებლები',
    note: 'კონტაქტი და შეკვეთების ერთიანი ისტორია.',
    search: 'სრული ელფოსტა ან ტელეფონი…',
    states: [],
  },
  inventory: {
    title: 'მარაგი',
    note: 'მთავარი საწყობი — ნაშთი, ჯავშნები და მოძრაობა.',
    search: 'SKU, დასახელება ან ზომა…',
    states: ['unknown', 'in_stock', 'out_of_stock', 'unpublished'],
  },
  vehicles: {
    title: 'ავტომობილები',
    note: 'შეცვალეთ პროდუქტის გვერდზე ნაჩვენები მანქანა.',
    search: 'SKU, დასახელება ან ზომა…',
    states: [],
  },
};
const LABELS: Record<string, string> = {
  ready: 'გასაცემია',
  stock_exception: 'მარაგი შესამოწმებელია',
  refund_pending: 'თანხის დაბრუნება მოწმდება',
  issued: 'გაცემულია',
  partially_issued: 'ნაწილობრივ გაცემულია',
  reserved: 'დაჯავშნილია',
  unallocated: 'დასაჯავშნია',
  released: 'ჯავშანი მოხსნილია',
  returned: 'დაბრუნებულია',
  partially_returned: 'ნაწილობრივ დაბრუნებულია',
  awaiting_payment: 'გადახდის მოლოდინში',
  paid: 'გადახდილია',
  failed: 'ვერ შესრულდა',
  cancelled: 'გაუქმებულია',
  expired: 'ვადა გასულია',
  draft: 'მონახაზი',
  pending: 'მუშავდება',
  succeeded: 'წარმატებულია',
  created: 'დაწყებულია',
  unknown: 'რაოდენობა უცნობია',
  in_stock: 'მარაგშია',
  out_of_stock: 'ამოწურულია',
  unpublished: 'დამალულია',
  contact: 'კონტაქტი',
  unavailable: 'მიუწვდომელია',
};
const VEHICLE_NAMES = [
  'ქალაქის მანქანა',
  'Prius',
  'კომპაქტური',
  'კომპაქტური სედანი',
  'სპორტული სედანი',
  'საოჯახო სედანი',
  'ბიზნეს სედანი',
  'ლუქს სედანი',
  'სპორტული კუპე',
  'სპორტული მანქანა',
  'პატარა კროსოვერი',
  'კომპაქტური კროსოვერი',
  'კროსოვერი',
  'პრემიუმ კროსოვერი',
  'კუპე SUV',
  'პრემიუმ SUV',
  'დიდი პრემიუმ SUV',
  'პრემიუმ კუპე SUV',
  'ლუქს SUV',
  'Range Rover',
  'ლუქს უგზოობის მანქანა',
  'უგზოობის მანქანა',
  'პიკაპი',
  'მინივენი',
  'Wrangler',
  'პატარა ფურგონი',
  'პრემიუმ ვენი',
  'ელექტრო კომპაქტური',
  'სატვირთო ფურგონი',
  'SUV / 4×4',
  'სატვირთო',
  'თვითმცლელი',
  'ექსკავატორი',
  'ბორბლიანი დამტვირთველი',
  'კომპაქტური დამტვირთველი',
  'ჩანგლიანი დამტვირთველი',
];

@Component({
  selector: 'adm-operations-page',
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink, WorkflowDetailComponent],
  templateUrl: './operations.page.html',
  styleUrl: './operations.page.scss',
})
export class OperationsPageComponent {
  readonly api = inject(OperationsApiService);
  readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly config = signal<WorkflowConfig | null>(null);
  readonly view = signal<View>('overview');
  readonly preview = signal(false);
  readonly info = computed(() =>
    this.view() === 'customers' && !this.config()?.enabled
      ? { ...VIEW_INFO.customers, note: 'კონტაქტები შეკვეთებიდან.', search: 'შეკვეთის ნომერი…' }
      : VIEW_INFO[this.view()],
  );
  readonly result = signal<OperationsPage | null>(null);
  readonly summary = signal<OperationsSummary | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly selected = signal<OperationsRow | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal('');
  readonly notice = signal('');
  readonly request = signal({ page: 1, q: '', status: 'all', revision: 0 });
  readonly filtered = computed(() => !!this.request().q || this.request().status !== 'all');
  readonly quickStates = computed(() =>
    this.view() === 'orders'
      ? ['all', 'awaiting_payment', 'ready', 'issued']
      : this.view() === 'inventory'
        ? ['all', 'unknown', 'in_stock', 'out_of_stock']
        : [],
  );
  search = '';
  status = 'all';
  classification = '';
  readonly vehicleOptions = VEHICLE_CLASSIFICATIONS.map((id, index) => ({
    id,
    name: VEHICLE_NAMES[index] ?? id,
  }));
  readonly rangeStart = computed(() =>
    this.result()?.total ? (this.request().page - 1) * 25 + 1 : 0,
  );
  readonly rangeEnd = computed(() => Math.min(this.request().page * 25, this.result()?.total ?? 0));
  @ViewChild('detailDialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  @ViewChild(WorkflowDetailComponent) workflow?: WorkflowDetailComponent;
  private opener?: HTMLElement;

  constructor() {
    this.api
      .config()
      .pipe(takeUntilDestroyed())
      .subscribe({ next: (value) => this.config.set(value), error: () => this.config.set(null) });
    this.route.data.pipe(takeUntilDestroyed()).subscribe((data) => {
      const candidate = data['view'] as View;
      this.preview.set(data['preview'] === true);
      this.view.set(candidate && candidate in VIEW_INFO ? candidate : 'overview');
      this.search = '';
      this.status = 'all';
      this.request.update((r) => ({ page: 1, q: '', status: 'all', revision: r.revision + 1 }));
      this.close();
    });
    toObservable(computed(() => ({ ...this.request(), view: this.view() })))
      .pipe(
        switchMap((request) => {
          this.loading.set(true);
          this.error.set(false);
          this.result.set(null);
          this.summary.set(null);
          if (request.view === 'overview')
            return forkJoin({
              summary: this.api.summary(),
              page: this.auth.hasPermission('orders.read')
                ? this.api.list('orders', 1, '', 'all')
                : of(null),
            }).pipe(catchError(() => of(null)));
          return this.api.list(request.view, request.page, request.q, request.status).pipe(
            switchMap((page) => of({ page, summary: null })),
            catchError(() => of(null)),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((response) => {
        this.loading.set(false);
        if (!response) {
          this.error.set(true);
          return;
        }
        this.result.set(response.page);
        const selected = this.selected();
        const updated = response.page?.items.find((item) => item.id === selected?.id);
        if (updated) this.selected.set(updated);
        this.summary.set(response.summary);
      });
  }
  applyFilters() {
    this.request.update((r) => ({
      page: 1,
      q: this.search.trim(),
      status: this.status,
      revision: r.revision + 1,
    }));
  }
  setStatus(status: string) {
    this.status = status;
    this.applyFilters();
  }
  clearFilters() {
    this.search = '';
    this.status = 'all';
    this.applyFilters();
  }
  detailValue(row: OperationsRow, label: string): string {
    return row.details.find((detail) => detail.label === label)?.value ?? '—';
  }
  detailBusy(): boolean {
    return this.saving() || !!this.workflow?.busy();
  }
  cancelDetail(event: Event) {
    event.preventDefault();
    this.close();
  }
  refresh() {
    this.request.update((r) => ({ ...r, revision: r.revision + 1 }));
  }
  movePage(delta: number) {
    this.request.update((r) => ({ ...r, page: Math.max(1, r.page + delta) }));
  }
  label(status: string) {
    return LABELS[status] ?? status;
  }
  link(path: string) {
    return `${this.preview() ? '/preview' : ''}/${path}`;
  }
  vehicleName(id: string | undefined) {
    return this.vehicleOptions.find((o) => o.id === id)?.name ?? 'ავტომატური';
  }
  image(id: string | undefined) {
    if (!id) return '';
    return `/vehicle-visuals/${id}.webp`;
  }
  imageFailed(event: Event) {
    (event.target as HTMLImageElement).style.opacity = '0';
  }
  open(row: OperationsRow, event: Event) {
    this.opener = event.currentTarget as HTMLElement;
    this.selected.set(row);
    this.classification = row.classification ?? '';
    this.saveError.set('');
    this.notice.set('');
    this.dialog.nativeElement.showModal();
  }
  close() {
    if (this.detailBusy()) return;
    if (this.dialog?.nativeElement.open) this.dialog.nativeElement.close();
    this.selected.set(null);
    this.opener?.focus();
  }
  saveVehicle() {
    const row = this.selected();
    if (!row || this.saving() || !this.auth.hasPermission('catalog.write')) return;
    this.saving.set(true);
    this.saveError.set('');
    this.api
      .assign(row.id, { classification: this.classification, expectedUpdatedAt: row.updatedAt })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (value) => {
          this.saving.set(false);
          this.selected.set({
            ...row,
            classification: value.classification,
            updatedAt: value.updatedAt,
          });
          this.notice.set('ცვლილება შენახულია');
          this.refresh();
        },
        error: (err) => {
          this.saving.set(false);
          this.saveError.set(
            err?.status === 409
              ? 'პროდუქტი უკვე შეიცვალა. დახურეთ დეტალი და განაახლეთ სია.'
              : 'შენახვა ვერ მოხერხდა. სცადეთ ხელახლა.',
          );
        },
      });
  }
}
