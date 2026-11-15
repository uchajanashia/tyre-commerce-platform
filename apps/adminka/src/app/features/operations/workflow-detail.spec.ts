import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { WorkflowDetailComponent } from './workflow-detail';
import { OperationsApiService } from '../../core/operations-api.service';
import { AuthService } from '../../core/auth.service';
import type { OrderWorkflow } from '@tyre/shared';

describe('Internal order actions', () => {
  const order: OrderWorkflow = {
    id: 'order',
    paymentStatus: 'paid',
    fulfillmentStatus: 'ready',
    totalMinor: 40000,
    refundedMinor: 0,
    refundableMinor: 40000,
    expiresAt: null,
    items: [{ id: 'line', code: 'sku', name: 'Tyre', quantity: 4, issued: 0, returned: 0 }],
    refunds: [],
  };
  const api = { workflow: vi.fn(), refund: vi.fn(), move: vi.fn(), stockHistory: vi.fn() };
  const admin = signal({ role: 'admin' });
  const auth = { admin, hasPermission: () => true };
  beforeEach(async () => {
    vi.resetAllMocks();
    admin.set({ role: 'admin' });
    api.workflow.mockReturnValue(of(structuredClone(order)));
    api.refund.mockReturnValue(of({ state: 'queued' }));
    api.stockHistory.mockReturnValue(of([]));
    await TestBed.configureTestingModule({
      imports: [WorkflowDetailComponent],
      providers: [
        { provide: OperationsApiService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();
  });
  function fixture() {
    const f = TestBed.createComponent(WorkflowDetailComponent);
    f.componentRef.setInput('row', { id: 'order', quantity: 4, updatedAt: '2026-10-14T10:00:00Z' });
    f.componentRef.setInput('view', 'orders');
    f.componentRef.setInput('config', {
      enabled: true,
      refundsEnabled: true,
      warehouse: 'მთავარი საწყობი',
    });
    f.detectChanges();
    return f;
  }
  it('hides refunds from staff even when the permission exists', () => {
    admin.set({ role: 'staff' });
    const f = fixture();
    expect(f.componentInstance.canRefund()).toBe(false);
    expect(f.nativeElement.textContent).not.toContain('თანხის დაბრუნება');
    f.destroy();
  });
  it('blocks issuing while a bank refund has an unknown result', () => {
    api.workflow.mockReturnValue(
      of({
        ...order,
        refunds: [
          {
            id: 'r',
            amountMinor: 10000,
            state: 'needs_review',
            reason: 'Test',
            createdAt: '2026-10-14',
          },
        ],
      }),
    );
    const f = fixture();
    expect(f.componentInstance.canIssue()).toBe(false);
    expect(f.componentInstance.canRefund()).toBe(false);
    f.componentInstance.order.set({
      ...order,
      fulfillmentStatus: 'stock_exception',
      refunds: [
        { id: 'r', amountMinor: 10000, state: 'failed', reason: 'Test', createdAt: '2026-10-14' },
      ],
    });
    expect(f.componentInstance.canAllocate()).toBe(true);
    f.destroy();
  });
  it('reuses a request id after a lost response and sends exact tetri', () => {
    api.refund.mockReturnValue(throwError(() => ({ status: 503 })));
    const f = fixture();
    const c = f.componentInstance;
    c.choose('refund');
    c.amount = '12.34';
    c.reason = 'Test refund';
    c.submit();
    c.submit();
    const bodies = api.refund.mock.calls.map((call) => call[1]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].amountMinor).toBe(1234);
    expect(bodies[0].requestId).toBe(bodies[1].requestId);
    expect(c.notice()).toBe('');
    f.destroy();
  });
  it('does not submit an empty selection or an amount with fractions of a tetri', () => {
    const f = fixture();
    const c = f.componentInstance;
    c.choose('issue');
    c.submit();
    expect(api.move).not.toHaveBeenCalled();
    c.choose('refund');
    c.amount = '12.345';
    c.reason = 'Test';
    c.submit();
    expect(api.refund).not.toHaveBeenCalled();
    f.destroy();
  });
  it('ignores old customer-order details after navigating back', () => {
    const pending = new Subject<OrderWorkflow>();
    api.workflow.mockReturnValue(pending);
    const f = fixture();
    f.componentRef.setInput('view', 'inventory');
    f.detectChanges();
    pending.next(order);
    expect(f.componentInstance.order()).toBeNull();
    f.destroy();
  });

  it('places a stock-count form before the movement history', () => {
    const f = fixture();
    f.componentRef.setInput('view', 'inventory');
    f.detectChanges();
    f.componentInstance.choose('count');
    f.detectChanges();
    const form = f.nativeElement.querySelector('.workflow-form');
    const heading = Array.from(f.nativeElement.querySelectorAll('h3')).find((node: any) =>
      node.textContent.includes('მარაგის მოძრაობა'),
    ) as HTMLElement;
    expect(form.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    f.destroy();
  });

  it('does not present a failed stock-history read as an empty history', () => {
    api.stockHistory.mockReturnValue(throwError(() => new Error('offline')));
    const f = fixture();
    f.componentRef.setInput('view', 'inventory');
    f.detectChanges();
    expect(f.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'დეტალები ვერ ჩაიტვირთა',
    );
    expect(f.nativeElement.textContent).not.toContain('მოძრაობა არ არის.');
    f.destroy();
  });
});
