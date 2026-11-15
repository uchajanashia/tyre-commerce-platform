import {
  Component,
  DestroyRef,
  OnChanges,
  SimpleChanges,
  Input,
  Output,
  EventEmitter,
  inject,
  signal,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import type {
  OperationsRow,
  OperationsPage,
  OrderWorkflow,
  WorkflowConfig,
  StockHistory,
} from '@tyre/shared';
import { OperationsApiService } from '../../core/operations-api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'adm-workflow-detail',
  imports: [DatePipe, DecimalPipe, FormsModule],
  templateUrl: './workflow-detail.html',
})
export class WorkflowDetailComponent implements OnChanges {
  @Input({ required: true }) row!: OperationsRow;
  @Input({ required: true }) view!: string;
  @Input({ required: true }) config!: WorkflowConfig;
  @Output() changed = new EventEmitter<void>();
  readonly api = inject(OperationsApiService);
  readonly auth = inject(AuthService);
  private readonly destroy = inject(DestroyRef);
  readonly order = signal<OrderWorkflow | null>(null);
  readonly history = signal<OperationsPage | null>(null);
  readonly movements = signal<StockHistory[]>([]);
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly mode = signal<'issue' | 'return' | 'refund' | 'count' | null>(null);
  quantities: Record<string, number> = {};
  amount: string = '';
  reason = '';
  count: number | null = null;
  page = 1;
  private version = 0;
  private command?: { payload: string; id: string };
  @ViewChild('actionForm') set actionForm(value: ElementRef<HTMLElement> | undefined) {
    if (!value) return;
    queueMicrotask(() => {
      if (value.nativeElement.isConnected) value.nativeElement.querySelector('input')?.focus();
    });
  }
  readonly labels: Record<string, string> = {
    unallocated: 'დასაჯავშნია',
    reserved: 'დაჯავშნილია',
    ready: 'გასაცემია',
    stock_exception: 'მარაგი შესამოწმებელია',
    issued: 'გაცემულია',
    partially_issued: 'ნაწილობრივ გაცემულია',
    returned: 'დაბრუნებულია',
    partially_returned: 'ნაწილობრივ დაბრუნებულია',
    released: 'ჯავშანი მოხსნილია',
    queued: 'რიგშია',
    processing: 'მუშავდება',
    needs_review: 'ბანკთან მოწმდება',
    succeeded: 'დაბრუნებულია',
    failed: 'ვერ შესრულდა',
    reserve: 'ჯავშანი',
    release: 'ჯავშნის მოხსნა',
    issue: 'გაცემა',
    return: 'საწყობში დაბრუნება',
    count: 'ნაშთის შესწორება',
    opening: 'საწყისი ნაშთი',
    paid: 'გადახდილია',
    awaiting_payment: 'გადახდის მოლოდინში',
    expired: 'ვადა გასულია',
  };
  orderTitle(id: string) {
    return this.history()?.items.find((item) => item.id === id)?.title ?? 'შეკვეთა';
  }
  label(value: string) {
    return this.labels[value] ?? value;
  }
  ngOnChanges(changes: SimpleChanges) {
    if (changes['row']?.previousValue?.id === this.row.id && !changes['view']) return;
    this.page = 1;
    this.mode.set(null);
    this.notice.set('');
    this.order.set(null);
    this.history.set(null);
    this.movements.set([]);
    this.load();
  }
  private read<T>(request: Observable<T>, apply: (v: T) => void) {
    const version = ++this.version;
    this.loading.set(true);
    this.error.set('');
    request.pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: (v) => {
        if (version !== this.version) return;
        apply(v);
        this.loading.set(false);
      },
      error: () => {
        if (version !== this.version) return;
        this.loading.set(false);
        this.error.set('დეტალები ვერ ჩაიტვირთა. სცადეთ ხელახლა.');
      },
    });
  }
  load() {
    if (this.view === 'orders' || this.view === 'overview') this.loadOrder(this.row.id);
    else if (this.view === 'customers' && this.auth.hasPermission('orders.read'))
      this.read(this.api.customerHistory(this.row.id, this.page), (v) => this.history.set(v));
    else if (this.view === 'inventory')
      this.read(this.api.stockHistory(this.row.id, this.page), (v) => this.movements.set(v));
  }
  loadOrder(id: string) {
    this.mode.set(null);
    this.read(this.api.workflow(id), (v) => this.order.set(v));
  }
  back() {
    this.order.set(null);
    this.load();
  }
  movePage(delta: number) {
    this.page = Math.max(1, this.page + delta);
    this.load();
  }
  canAllocate() {
    const o = this.order();
    return (
      !!o &&
      o.paymentStatus === 'paid' &&
      ['unallocated', 'stock_exception'].includes(o.fulfillmentStatus) &&
      !o.refundedMinor &&
      o.refunds.every((r) => r.state === 'failed')
    );
  }
  canIssue() {
    const o = this.order();
    return (
      !!o &&
      o.paymentStatus === 'paid' &&
      ['ready', 'partially_issued', 'partially_returned'].includes(o.fulfillmentStatus) &&
      o.refundedMinor < o.totalMinor &&
      !o.refunds.some((r) => !['succeeded', 'failed'].includes(r.state)) &&
      o.items.some((i) => i.issued < i.quantity)
    );
  }
  canReturn() {
    return this.order()?.items.some((i) => i.issued > i.returned) ?? false;
  }
  canRefund() {
    const o = this.order();
    return (
      this.config.refundsEnabled &&
      this.auth.admin()?.role === 'admin' &&
      this.auth.hasPermission('payments.refund') &&
      o?.paymentStatus === 'paid' &&
      o.refundableMinor > 0 &&
      !o.refunds.some((r) => !['succeeded', 'failed'].includes(r.state))
    );
  }
  choose(mode: 'issue' | 'return' | 'refund' | 'count') {
    this.mode.set(mode);
    this.error.set('');
    this.notice.set('');
    this.reason = '';
    this.amount = '';
    this.count = this.row.quantity;
    this.quantities = Object.fromEntries((this.order()?.items ?? []).map((i) => [i.id, 0]));
  }
  private mutate(payload: unknown, call: (id: string) => Observable<unknown>, message: string) {
    if (this.busy()) return;
    const key = JSON.stringify(payload);
    if (this.command?.payload !== key) this.command = { payload: key, id: crypto.randomUUID() };
    this.busy.set(true);
    this.error.set('');
    call(this.command.id)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: () => {
          this.command = undefined;
          this.busy.set(false);
          this.mode.set(null);
          this.notice.set(message);
          const orderId = this.order()?.id;
          if (orderId) this.loadOrder(orderId);
          else this.load();
          this.changed.emit();
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(
            err?.status === 409
              ? 'მდგომარეობა შეიცვალა. განაახლეთ დეტალი და შეამოწმეთ რაოდენობა.'
              : 'შედეგი ვერ დადასტურდა. იგივე მოქმედების ხელახალი ცდა უსაფრთხოა.',
          );
        },
      });
  }
  allocate() {
    const id = this.order()!.id;
    this.mutate(['allocate', id], (key) => this.api.allocate(id, key), 'მარაგი დაჯავშნილია');
  }
  submit() {
    const mode = this.mode();
    const o = this.order();
    if (mode === 'issue' || mode === 'return') {
      if (!o) return;
      const items = o.items
        .map((i) => ({ orderItemId: i.id, quantity: Number(this.quantities[i.id] ?? 0) }))
        .filter((i) => i.quantity !== 0);
      if (!items.length || items.some((i) => !Number.isSafeInteger(i.quantity) || i.quantity < 1)) {
        this.error.set('აირჩიეთ რაოდენობა.');
        return;
      }
      this.mutate(
        [mode, o.id, items],
        (key) => this.api.move(o.id, mode, { requestId: key, items }),
        mode === 'issue' ? 'გაცემა აღრიცხულია' : 'საქონელი დაბრუნებულია',
      );
    } else if (mode === 'refund') {
      if (!o || !/^\d+(\.\d{1,2})?$/.test(this.amount) || this.reason.trim().length < 3) {
        this.error.set('მიუთითეთ თანხა და მიზეზი.');
        return;
      }
      const amountMinor = Math.round(Number(this.amount) * 100);
      if (amountMinor < 1 || amountMinor > o.refundableMinor) {
        this.error.set('შეამოწმეთ დასაბრუნებელი თანხა.');
        return;
      }
      const reason = this.reason.trim();
      this.mutate(
        [mode, o.id, amountMinor, reason],
        (key) => this.api.refund(o.id, { requestId: key, amountMinor, reason }),
        'მოთხოვნა მიღებულია — მიმდინარეობს ბანკთან შემოწმება',
      );
    } else if (mode === 'count') {
      const quantity = this.count;
      const reason = this.reason.trim();
      if (
        quantity === null ||
        !Number.isSafeInteger(quantity) ||
        quantity < 0 ||
        reason.length < 3
      ) {
        this.error.set('მიუთითეთ ნაშთი და მიზეზი.');
        return;
      }
      this.mutate(
        [mode, this.row.id, quantity, this.row.updatedAt, reason],
        (key) =>
          this.api.count(this.row.id, {
            requestId: key,
            quantity,
            reason,
            expectedUpdatedAt: this.row.updatedAt,
          }),
        'ნაშთი განახლებულია',
      );
    }
  }
}
