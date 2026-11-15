import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import type { OperationsPage } from '@tyre/shared';
import { OperationsApiService } from '../../core/operations-api.service';
import { AuthService } from '../../core/auth.service';
import { OperationsPageComponent } from './operations.page';

describe('Operations workspace', () => {
  const page: OperationsPage = {
    total: 1,
    page: 1,
    pageSize: 25,
    items: [
      {
        id: 'SKU',
        title: 'Tire',
        subtitle: 'SKU · 175/70R13',
        status: 'unknown',
        amount: 95,
        quantity: null,
        updatedAt: '2026-10-14T10:00:00Z',
        details: [],
      },
    ],
  };
  const api = {
    config: () => of({ enabled: false, refundsEnabled: false, warehouse: '' }),
    summary: vi.fn(),
    list: vi.fn(),
    assign: vi.fn(),
  };
  const auth = { hasPermission: vi.fn(() => true) };
  beforeEach(async () => {
    api.summary.mockReset();
    api.list.mockReset();
    api.assign.mockReset();
    auth.hasPermission.mockReturnValue(true);
    api.list.mockReturnValue(of(page));
    api.summary.mockReturnValue(
      of({ orders: null, catalog: null, updatedAt: '2026-10-14T10:00:00Z' }),
    );
    await TestBed.configureTestingModule({
      imports: [OperationsPageComponent],
      providers: [
        provideRouter([]),
        { provide: OperationsApiService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();
  });
  it('renders unknown quantities as unknown, never a zero balance', async () => {
    const fixture = TestBed.createComponent(OperationsPageComponent);
    fixture.componentInstance.view.set('inventory');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('რაოდენობა უცნობია');
    expect(fixture.nativeElement.querySelector('.stock-values b')?.textContent.trim()).toBe('—');
    fixture.destroy();
  });
  it('shows a request failure rather than an empty successful table', async () => {
    api.list.mockReturnValue(throwError(() => new Error('offline')));
    const fixture = TestBed.createComponent(OperationsPageComponent);
    fixture.componentInstance.view.set('orders');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'მონაცემები ვერ ჩაიტვირთა',
    );
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    fixture.destroy();
  });
  it('cancels an obsolete filter request so old results cannot replace a new search', async () => {
    const old = new Subject<OperationsPage>();
    api.list.mockReturnValueOnce(old).mockReturnValueOnce(of({ ...page, items: [], total: 0 }));
    const fixture = TestBed.createComponent(OperationsPageComponent);
    fixture.componentInstance.view.set('inventory');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.search = 'other';
    fixture.componentInstance.applyFilters();
    fixture.detectChanges();
    await fixture.whenStable();
    old.next(page);
    old.complete();
    fixture.detectChanges();
    expect(fixture.componentInstance.result()?.total).toBe(0);
    fixture.destroy();
  });
  it('does not request orders when the operator lacks order access', async () => {
    auth.hasPermission.mockReturnValue(false);
    const fixture = TestBed.createComponent(OperationsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.list).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('შეკვეთებზე წვდომა არ გაქვთ');
    fixture.destroy();
  });
  it('handles a concurrent visual edit without claiming success', () => {
    api.assign.mockReturnValue(throwError(() => ({ status: 409 })));
    const fixture = TestBed.createComponent(OperationsPageComponent);
    fixture.componentInstance.selected.set(page.items[0]);
    fixture.componentInstance.classification = 'vehicle-city-car';
    fixture.componentInstance.saveVehicle();
    expect(fixture.componentInstance.saveError()).toContain('უკვე შეიცვალა');
    expect(fixture.componentInstance.notice()).toBe('');
    fixture.destroy();
  });

  it('keeps the same search input while a request is pending and resets pagination on filters', async () => {
    const pending = new Subject<OperationsPage>();
    api.list.mockReturnValue(pending);
    const fixture = TestBed.createComponent(OperationsPageComponent);
    const c = fixture.componentInstance;
    c.view.set('inventory');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[type=search]');
    expect(input).not.toBeNull();
    c.request.set({ page: 3, q: '', status: 'all', revision: 1 });
    c.search = '003024';
    c.setStatus('unknown');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[type=search]')).toBe(input);
    expect(api.list).toHaveBeenLastCalledWith('inventory', 1, '003024', 'unknown');
    c.clearFilters();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.list).toHaveBeenLastCalledWith('inventory', 1, '', 'all');
    pending.complete();
    fixture.destroy();
  });

  it('displays stock balances exactly as supplied by the server', async () => {
    api.list.mockReturnValue(
      of({
        ...page,
        items: [
          {
            ...page.items[0],
            quantity: 9,
            details: [
              { label: 'დაჯავშნილია', value: '4' },
              { label: 'თავისუფალია', value: '5' },
            ],
          },
        ],
      }),
    );
    const fixture = TestBed.createComponent(OperationsPageComponent);
    fixture.componentInstance.view.set('inventory');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      Array.from(fixture.nativeElement.querySelectorAll('.stock-values b'), (e: any) =>
        e.textContent.trim(),
      ),
    ).toEqual(['9', '4', '5']);
    fixture.destroy();
  });

  it('shows customer contact data and a history action without fabricating activity', async () => {
    api.list.mockReturnValue(
      of({
        ...page,
        items: [
          {
            ...page.items[0],
            title: 'Test Customer',
            subtitle: '2 შეკვეთა',
            details: [
              { label: 'ტელეფონი', value: '555000000' },
              { label: 'ელფოსტა', value: 'test@example.test' },
            ],
          },
        ],
      }),
    );
    const fixture = TestBed.createComponent(OperationsPageComponent);
    fixture.componentInstance.view.set('customers');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.contact-cell').textContent).toContain(
      'test@example.test',
    );
    expect(fixture.nativeElement.querySelector('.row-action').textContent).toContain('ისტორია');
    fixture.destroy();
  });

  it('keeps a pending mutation visible and permits closing once it completes', async () => {
    const fixture = TestBed.createComponent(OperationsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;
    c.dialog.nativeElement.close = vi.fn();
    c.dialog.nativeElement.setAttribute('open', '');
    c.selected.set(page.items[0]);
    c.saving.set(true);
    const event = new Event('cancel', { cancelable: true });
    c.cancelDetail(event);
    expect(event.defaultPrevented).toBe(true);
    expect(c.dialog.nativeElement.close).not.toHaveBeenCalled();
    expect(c.selected()).not.toBeNull();
    c.saving.set(false);
    c.close();
    expect(c.dialog.nativeElement.close).toHaveBeenCalledOnce();
    expect(c.selected()).toBeNull();
    fixture.destroy();
  });
});
