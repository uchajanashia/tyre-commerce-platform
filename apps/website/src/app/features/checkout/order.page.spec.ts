import { RESPONSE_INIT } from '@angular/core';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';

import { CartService } from '@core/services/cart.service';
import { OrderPage } from './order.page';

describe('OrderPage pre-bank safety', () => {
  afterEach(() => {
    sessionStorage.removeItem('tyre.checkout.pending');
    sessionStorage.removeItem('tyre.checkout.retry');
  });

  for (const scenario of ['failed', 'awaiting_payment', 'unavailable', 'different-order']) {
    it(`handles retry state safely when the order is ${scenario}`, async () => {
      const token = 'a'.repeat(43);
      const pending = scenario === 'different-order' ? 'b'.repeat(43) : token;
      const retry = crypto.randomUUID();
      const clear = vi.fn();
      sessionStorage.setItem('tyre.checkout.pending', pending);
      sessionStorage.setItem('tyre.checkout.retry', retry);
      await TestBed.configureTestingModule({
        imports: [OrderPage],
        providers: [
          provideRouter([]),
          {
            provide: HttpClient,
            useValue: {
              get: () =>
                scenario === 'unavailable'
                  ? throwError(() => new Error('Network unavailable'))
                  : of({
                      status: scenario === 'awaiting_payment' ? scenario : 'failed',
                      total: 275,
                      currency: 'GEL',
                      orderNumber: 'TYR-TEST',
                      receiptStatus: 'not_ready',
                      pdfReady: false,
                    }),
            },
          },
          {
            provide: ActivatedRoute,
            useValue: {
              snapshot: {
                queryParamMap: { get: (name: string) => (name === 'order' ? token : null) },
                paramMap: { get: () => null },
              },
            },
          },
          { provide: CartService, useValue: { clear } },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(OrderPage);
      await (fixture.componentInstance as unknown as { check(): Promise<void> }).check();
      expect(clear).not.toHaveBeenCalled();
      expect(sessionStorage.getItem('tyre.checkout.retry')).toBe(
        scenario === 'failed' ? null : retry,
      );
      expect(sessionStorage.getItem('tyre.checkout.pending')).toBe(
        scenario === 'failed' ? null : pending,
      );
      fixture.destroy();
    });
  }

  it('never presents an arbitrary URL as a successful order', async () => {
    const response: ResponseInit = { status: 200 };
    await TestBed.configureTestingModule({
      imports: [OrderPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: RESPONSE_INIT, useValue: response },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrderPage);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('გადახდის სტატუსი');
    expect(text).not.toContain('გადახდა დადასტურებულია');
    expect(text).not.toContain('შეკვეთა მიღებულია');
    expect(response.status).toBe(200);
  });

  it('shows the paid receipt state and clears only its matching pending cart', async () => {
    const token = 'a'.repeat(43);
    const clear = vi.fn();
    sessionStorage.setItem('tyre.checkout.pending', token);
    sessionStorage.setItem('tyre.checkout.retry', crypto.randomUUID());

    await TestBed.configureTestingModule({
      imports: [OrderPage],
      providers: [
        provideRouter([]),
        {
          provide: HttpClient,
          useValue: {
            get: () =>
              of({
                status: 'paid',
                total: 550,
                currency: 'GEL',
                orderNumber: 'TYR-2026-ABC123',
                receiptStatus: 'delivered',
                pdfReady: false,
              }),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: { get: (name: string) => (name === 'order' ? token : null) },
              paramMap: { get: () => null },
            },
          },
        },
        { provide: CartService, useValue: { clear } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrderPage);
    await (fixture.componentInstance as unknown as { check(): Promise<void> }).check();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('TYR-2026-ABC123');
    expect(text).toContain('ქვითარი თქვენს ელფოსტაზეც გაიგზავნა');
    expect(clear).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('tyre.checkout.pending')).toBeNull();
    expect(sessionStorage.getItem('tyre.checkout.retry')).toBeNull();
    fixture.destroy();
  });

  it('does not clear a cart belonging to a different checkout', async () => {
    const token = 'b'.repeat(43);
    const clear = vi.fn();
    sessionStorage.setItem('tyre.checkout.pending', 'c'.repeat(43));

    await TestBed.configureTestingModule({
      imports: [OrderPage],
      providers: [
        provideRouter([]),
        {
          provide: HttpClient,
          useValue: {
            get: () =>
              of({
                status: 'paid',
                total: 275,
                currency: 'GEL',
                orderNumber: 'TYR-2026-DEF456',
                receiptStatus: 'pending',
                pdfReady: false,
              }),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: { get: (name: string) => (name === 'order' ? token : null) },
              paramMap: { get: () => null },
            },
          },
        },
        { provide: CartService, useValue: { clear } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrderPage);
    await (fixture.componentInstance as unknown as { check(): Promise<void> }).check();
    expect(clear).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('tyre.checkout.pending')).toBe('c'.repeat(43));
    fixture.destroy();
  });
});
