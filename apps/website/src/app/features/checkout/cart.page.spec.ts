import { signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { Tire } from '@core/models';
import {
  CartQuote,
  CartQuoteRequestItem,
  CartQuoteService,
} from '@core/services/cart-quote.service';
import { CartService } from '@core/services/cart.service';
import { FitmentDataService } from '@core/services/fitment-data.service';
import { GarageService } from '@core/services/garage.service';
import { StorageService } from '@core/services/storage.service';
import { CartPage } from './cart.page';

class MemoryStorage {
  private readonly values = new Map<string, unknown>();
  get<T>(key: string): T | null {
    return (this.values.get(key) as T | undefined) ?? null;
  }
  set(key: string, value: unknown): void {
    this.values.set(key, structuredClone(value));
  }
  remove(key: string): void {
    this.values.delete(key);
  }
  migrate(oldKey: string, newKey: string): void {
    if (!this.values.has(newKey) && this.values.has(oldKey)) {
      this.values.set(newKey, this.values.get(oldKey));
    }
    this.values.delete(oldKey);
  }
}

const tire: Tire = {
  id: 'tire-1',
  brandId: 'roadx',
  model: 'RXMOTION',
  season: 'summer',
  size: { widthMm: 205, aspect: 55, rimDiameterInch: 16, raw: '205/55R16' },
  // Deliberately stale: the component must show the quote's 275, not 999.
  priceGel: 999,
  inStock: 1,
  attributes: { runFlat: false },
  media: { catalogUrl: '/tire.webp', sidewallUrl: '/tire.webp', gallery: [] },
  tags: [],
};

function availableQuote(items: readonly CartQuoteRequestItem[]): CartQuote {
  const quantity = items[0]!.quantity;
  return {
    items: [
      {
        productId: 'tire-1',
        code: '000001',
        name: 'ROADX RXMOTION',
        quantity,
        available: true,
        issue: null,
        unitPrice: 275,
        lineTotal: 275 * quantity,
        currency: 'GEL',
      },
    ],
    total: 275 * quantity,
    currency: 'GEL',
    allAvailable: true,
  };
}

describe('CartPage authoritative quote hydration', () => {
  it('requotes a quantity change and never uses the stale product price', async () => {
    const quote = vi.fn((items: readonly CartQuoteRequestItem[]) => of(availableQuote(items)));
    await TestBed.configureTestingModule({
      imports: [CartPage],
      providers: [
        {provide:HttpClient,useValue:{get:() => of({enabled:false})}},
        provideRouter([]),
        CartService,
        { provide: StorageService, useClass: MemoryStorage },
        {
          provide: FitmentDataService,
          useValue: {
            getBrands: () => of([{ id: 'roadx', name: 'ROADX', country: '', logoUrl: '' }]),
            getTire: () => of(tire),
          },
        },
        { provide: GarageService, useValue: { selectedVehicle: signal(null) } },
        { provide: CartQuoteService, useValue: { quote } },
      ],
    }).compileComponents();

    const cart = TestBed.inject(CartService);
    cart.add({ tireId: 'tire-1', vehicleTrimId: null });
    const fixture = TestBed.createComponent(CartPage);
    fixture.detectChanges();

    await vi.waitFor(() =>
      expect(quote).toHaveBeenCalledWith([{ productId: 'tire-1', quantity: 1 }]),
    );
    fixture.detectChanges();
    let text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('275');
    expect(text).not.toContain('999');
    expect(text).toContain('მარაგშია');

    const increase = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[aria-label="რაოდენობის გაზრდა"]',
    );
    increase?.click();
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(quote).toHaveBeenLastCalledWith([{ productId: 'tire-1', quantity: 2 }]),
    );
    fixture.detectChanges();
    text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('550');
  });

  it('shows the checkout action as active only for an enabled, available quote', async () => {
    await TestBed.configureTestingModule({
      imports: [CartPage],
      providers: [
        { provide: HttpClient, useValue: { get: () => of({ enabled: true }) } },
        provideRouter([]),
        CartService,
        { provide: StorageService, useClass: MemoryStorage },
        {
          provide: FitmentDataService,
          useValue: {
            getBrands: () => of([{ id: 'roadx', name: 'ROADX', country: '', logoUrl: '' }]),
            getTire: () => of(tire),
          },
        },
        { provide: GarageService, useValue: { selectedVehicle: signal(null) } },
        {
          provide: CartQuoteService,
          useValue: {
            quote: (items: readonly CartQuoteRequestItem[]) => of(availableQuote(items)),
          },
        },
      ],
    }).compileComponents();

    TestBed.inject(CartService).add({ tireId: 'tire-1', vehicleTrimId: null });
    const fixture = TestBed.createComponent(CartPage);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      const checkout = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
        'a[href="/checkout"]',
      );
      expect(checkout?.classList.contains('summary__cta--active')).toBe(true);
    });
  });
});
