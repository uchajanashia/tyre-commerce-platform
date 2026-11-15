import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, type Routes } from '@angular/router';
import { of, throwError } from 'rxjs';
import type {
  OrderWorkflow,
  ItemMovementCommand,
  RefundCommand,
  StockCountCommand,
  StockHistory,
  OperationsRow,
  OperationsView,
  VehicleAssignment,
} from '@tyre/shared';
import { OperationsApiService } from '../../core/operations-api.service';
import { AuthService } from '../../core/auth.service';
import { OperationsPageComponent } from './operations.page';

/** Synthetic, isolated preview: no credentials, network writes, or production records. */
const now = '2026-10-14T10:30:00.000Z';
const orders: OperationsRow[] = [
  {
    id: 'demo-1048',
    title: 'TYR · 1048',
    subtitle: '002077 · 002078',
    status: 'paid',
    amount: 380,
    quantity: 4,
    updatedAt: now,
    details: [
      { label: 'მიღება', value: 'ადგილზე გატანა' },
      { label: '002077', value: 'ROADX RXMOTION H11 · 4 × 95 ₾' },
    ],
  },
  {
    id: 'demo-1047',
    title: 'TYR · 1047',
    subtitle: '002132',
    status: 'awaiting_payment',
    amount: 640,
    quantity: 4,
    updatedAt: now,
    details: [{ label: 'მიღება', value: 'მიწოდება' }],
  },
  {
    id: 'demo-1046',
    title: 'TYR · 1046',
    subtitle: '003012',
    status: 'paid',
    amount: 420,
    quantity: 4,
    updatedAt: now,
    details: [],
  },
  {
    id: 'demo-1045',
    title: 'TYR · 1045',
    subtitle: '002716',
    status: 'paid',
    amount: 950,
    quantity: 2,
    updatedAt: now,
    details: [],
  },
  {
    id: 'demo-1044',
    title: 'TYR · 1044',
    subtitle: '004605',
    status: 'failed',
    amount: 190,
    quantity: 2,
    updatedAt: now,
    details: [],
  },
];
const stock: OperationsRow[] = [
  {
    id: 'demo-002077',
    title: 'ROADX RXMOTION H11',
    subtitle: '002077 · 175/70 R13',
    status: 'in_stock',
    quantity: 24,
    amount: 95,
    classification: 'vehicle-city-car',
    updatedAt: now,
    details: [{ label: 'ზომა', value: '175/70 R13' }],
  },
  {
    id: 'demo-002132',
    title: 'ARIVO TERRAMAX A/T',
    subtitle: '002132 · 265/65 R17',
    status: 'unknown',
    quantity: null,
    amount: 245,
    classification: 'vehicle-offroad',
    updatedAt: now,
    details: [],
  },
  {
    id: 'demo-003012',
    title: 'WATERFALL ECO DYNAMIC',
    subtitle: '003012 · 205/55 R16',
    status: 'in_stock',
    quantity: 12,
    amount: 105,
    classification: 'vehicle-family-sedan',
    updatedAt: now,
    details: [],
  },
  {
    id: 'demo-002716',
    title: 'ROADX RH621',
    subtitle: '002716 · 315/80 R22.5',
    status: 'in_stock',
    quantity: 8,
    amount: 475,
    classification: 'vehicle-highway-truck',
    updatedAt: now,
    details: [],
  },
];
class PreviewApi {
  readonly workflows = new Map<string, OrderWorkflow>(
    orders.map((row) => [
      row.id,
      {
        id: row.id,
        paymentStatus: row.status,
        fulfillmentStatus: row.status === 'paid' ? 'ready' : 'reserved',
        totalMinor: (row.amount ?? 0) * 100,
        refundedMinor: 0,
        refundableMinor: (row.amount ?? 0) * 100,
        expiresAt: row.status === 'awaiting_payment' ? '2026-10-14T10:45:00Z' : null,
        items: [
          {
            id: row.id + '-item',
            name: row.id === 'demo-1048' ? 'ROADX RXMOTION H11' : 'საბურავი',
            code: row.subtitle.split(' · ')[0],
            quantity: row.quantity ?? 4,
            issued: 0,
            returned: 0,
          },
        ],
        refunds: [],
      },
    ]),
  );
  readonly journal: StockHistory[] = [];
  config() {
    return of({ enabled: true, refundsEnabled: true, warehouse: 'მთავარი საწყობი' });
  }
  workflow(id: string) {
    return of(structuredClone(this.workflows.get(id)!));
  }
  customerHistory(_id: string, page = 1) {
    return of({
      items: orders
        .filter((o) => o.status === 'paid')
        .map((o) => ({ ...o, subtitle: this.workflows.get(o.id)!.fulfillmentStatus })),
      total: 3,
      page,
      pageSize: 25,
    });
  }
  stockHistory(_id: string, _page = 1) {
    return of([...this.journal]);
  }
  allocate(id: string, _requestId: string) {
    this.workflows.get(id)!.fulfillmentStatus = 'ready';
    return of({ ok: true });
  }
  move(id: string, kind: 'issue' | 'return', body: ItemMovementCommand) {
    const order = this.workflows.get(id)!;
    for (const line of body.items) {
      const item = order.items.find((i) => i.id === line.orderItemId)!;
      if (
        line.quantity >
        (kind === 'issue' ? item.quantity - item.issued : item.issued - item.returned)
      )
        return throwError(() => ({ status: 409 }));
    }
    for (const line of body.items) {
      const item = order.items.find((i) => i.id === line.orderItemId)!;
      if (kind === 'issue') item.issued += line.quantity;
      else item.returned += line.quantity;
    }
    order.fulfillmentStatus =
      kind === 'issue'
        ? order.items.every((i) => i.issued === i.quantity)
          ? 'issued'
          : 'partially_issued'
        : order.items.every((i) => i.returned === i.quantity)
          ? 'returned'
          : 'partially_returned';
    return of({ ok: true });
  }
  refund(id: string, body: RefundCommand) {
    const order = this.workflows.get(id)!;
    order.refunds.push({
      id: body.requestId,
      amountMinor: body.amountMinor,
      reason: body.reason,
      state: 'processing',
      createdAt: new Date().toISOString(),
    });
    order.refundableMinor -= body.amountMinor;
    return of({ id: body.requestId, state: 'queued' });
  }
  count(id: string, body: StockCountCommand) {
    const row = this.stock.find((i) => i.id === id)!;
    if (row.updatedAt !== body.expectedUpdatedAt) return throwError(() => ({ status: 409 }));
    const delta = body.quantity - (row.quantity ?? 0);
    row.quantity = body.quantity;
    row.updatedAt = new Date().toISOString();
    row.status = body.quantity ? 'in_stock' : 'out_of_stock';
    this.journal.unshift({
      id: body.requestId,
      kind: 'count',
      onHandDelta: delta,
      reservedDelta: 0,
      onHandAfter: body.quantity,
      reservedAfter: 0,
      createdAt: row.updatedAt,
    });
    return of({ ok: true });
  }

  readonly stock = stock.map((row) => ({ ...row }));
  summary() {
    return of({
      orders: { total: 128, pending: 7, paid: 115, paidAmount: 48650 },
      catalog: { products: 606, unknownStock: 18, withoutPhotos: 6 },
      updatedAt: now,
    });
  }
  list(view: OperationsView, page: number, q: string, status: string) {
    let items =
      view === 'vehicles' || view === 'inventory'
        ? this.stock
        : view === 'customers'
          ? [
              {
                ...orders[0],
                title: 'საჩვენებელი მომხმარებელი',
                status: 'contact',
                amount: null,
                quantity: null,
                subtitle: '3 შეკვეთა',
                details: [{ label: 'ელფოსტა', value: 'preview@example.invalid' }],
              },
            ]
          : view === 'payments'
            ? orders.map((row) => ({
                ...row,
                status:
                  row.status === 'paid'
                    ? 'succeeded'
                    : row.status === 'awaiting_payment'
                      ? 'pending'
                      : row.status,
              }))
            : orders;
    if (view === 'orders')
      items = items.map((row) => ({
        ...row,
        fulfillmentStatus: this.workflows.get(row.id)?.fulfillmentStatus,
      }));
    items = items.filter(
      (row) =>
        (!q || `${row.title} ${row.subtitle}`.toLowerCase().includes(q.toLowerCase())) &&
        (status === 'all' ||
          row.status === status ||
          row.fulfillmentStatus === status ||
          (status === 'refund_pending' &&
            this.workflows
              .get(row.id)
              ?.refunds.some((r) => !['succeeded', 'failed'].includes(r.state)))),
    );
    return of({
      items: items.slice((page - 1) * 25, page * 25),
      total: items.length,
      page,
      pageSize: 25,
    });
  }
  assign(id: string, body: VehicleAssignment) {
    const row = this.stock.find((item) => item.id === id);
    if (!row || row.updatedAt !== body.expectedUpdatedAt)
      return throwError(() => ({ status: 409 }));
    row.classification = body.classification;
    row.updatedAt = new Date().toISOString();
    return of({ classification: row.classification, updatedAt: row.updatedAt });
  }
}
@Component({
  selector: 'adm-operations-preview',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `<div class="preview-shell">
    <aside>
      <a class="wordmark" routerLink="/preview">tyre<span>.ge</span></a>
      <p>სამუშაო სივრცე</p>
      <nav>
        @for (item of links; track item.path) {
          <a
            [routerLink]="'/preview' + item.path"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: true }"
            ><span aria-hidden="true">{{ item.icon }}</span
            >{{ item.label }}</a
          >
        }
      </nav>
      <div class="preview-owner">
        <span>თ</span>
        <div>tyre.ge<small>შიდა მართვის სისტემა</small></div>
      </div>
    </aside>
    <main>
      <header>
        <span>საჩვენებელი რეჟიმი · მონაცემები გამოგონილია</span
        ><a routerLink="/login">ადმინისტრაციაში შესვლა ↗</a>
      </header>
      <div class="preview-content"><router-outlet /></div>
    </main>
  </div>`,
  styles: [
    `
      :host {
        display: block;
      }
      .preview-shell {
        display: grid;
        grid-template-columns: 230px minmax(0, 1fr);
        min-height: 100svh;
        background: #fff;
        color: #18334e;
      }
      aside {
        background: #102b46;
        color: #fff;
        padding: 35px 20px;
        display: flex;
        flex-direction: column;
        height: 100svh;
        position: sticky;
        top: 0;
      }
      .wordmark {
        font-size: 29px;
        font-weight: 750;
        font-style: italic;
        letter-spacing: -1px;
        padding: 0 15px;
        color: white;
        text-decoration: none;
      }
      .wordmark span {
        color: #8cafe0;
      }
      aside > p {
        font-size: 9px;
        letter-spacing: 0.1em;
        color: #8da4bb;
        margin: 56px 15px 15px;
      }
      nav {
        display: grid;
        gap: 6px;
      }
      nav a {
        display: flex;
        align-items: center;
        gap: 14px;
        color: #bbccdd;
        text-decoration: none;
        padding: 14px 15px;
        font-size: 12px;
        border-radius: 8px;
      }
      nav a span {
        font-size: 17px;
        width: 19px;
        text-align: center;
      }
      nav a:hover {
        background: #1b3b5a;
      }
      nav .active {
        color: #fff;
        background: #244869;
        box-shadow: inset 3px 0 #83b2f1;
      }
      .preview-owner {
        margin-top: auto;
        border-top: 1px solid #29455f;
        padding: 24px 10px 0;
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 12px;
      }
      .preview-owner > span {
        border-radius: 50%;
        background: #2a4a67;
        padding: 10px;
      }
      .preview-owner small {
        display: block;
        font-size: 9px;
        color: #91a8bd;
        margin-top: 6px;
      }
      main > header {
        min-height: 65px;
        border-bottom: 1px solid #e9eef3;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 40px;
        font-size: 10px;
        color: #7c8d9e;
        gap: 12px;
      }
      header a {
        color: #496985;
        text-decoration: none;
      }
      .preview-content {
        padding: 43px 40px;
      }
      @media (max-width: 900px) {
        .preview-shell {
          grid-template-columns: 180px minmax(0, 1fr);
        }
        aside {
          padding: 28px 10px;
        }
        .preview-content {
          padding: 30px 23px;
        }
        main > header {
          padding: 14px 23px;
        }
      }
      @media (max-width: 600px) {
        .preview-shell {
          display: block;
        }
        aside {
          position: static;
          height: auto;
          padding: 18px 16px;
        }
        .wordmark {
          font-size: 24px;
        }
        aside > p,
        .preview-owner {
          display: none;
        }
        nav {
          display: flex;
          overflow-x: auto;
          margin-top: 15px;
          gap: 5px;
        }
        nav a {
          white-space: nowrap;
          padding: 10px;
          font-size: 11px;
        }
        nav a span {
          display: none;
        }
        .preview-content {
          padding: 25px 18px;
        }
        main > header {
          padding: 12px 18px;
          font-size: 9px;
          line-height: 1.7;
        }
        header a {
          white-space: nowrap;
        }
      }
    `,
  ],
})
export class OperationsPreviewComponent {
  readonly links = [
    { path: '', label: 'მიმოხილვა', icon: '◫' },
    { path: '/orders', label: 'შეკვეთები', icon: '↗' },
    { path: '/payments', label: 'გადახდები', icon: '▤' },
    { path: '/customers', label: 'მომხმარებლები', icon: '♙' },
    { path: '/inventory', label: 'მარაგი', icon: '▦' },
    { path: '/vehicles', label: 'ავტომობილები', icon: '◉' },
  ];
}
export const previewRoutes: Routes = [
  {
    path: '',
    component: OperationsPreviewComponent,
    providers: [
      { provide: OperationsApiService, useFactory: () => new PreviewApi() },
      {
        provide: AuthService,
        useValue: { hasPermission: () => true, admin: signal({ role: 'admin' }) },
      },
    ],
    children: ['overview', 'orders', 'payments', 'customers', 'inventory', 'vehicles'].map(
      (view) => ({
        path: view === 'overview' ? '' : view,
        component: OperationsPageComponent,
        data: { view, preview: true },
      }),
    ),
  },
];
