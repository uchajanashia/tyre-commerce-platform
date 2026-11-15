import { TestBed } from '@angular/core/testing';

import { CartService, MAX_CART_QUANTITY, cartLineKey, normalizeStoredCart } from './cart.service';
import { StorageService } from './storage.service';

class MemoryStorage {
  readonly values = new Map<string, unknown>();

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

describe('CartService', () => {
  let storage: MemoryStorage;
  let service: CartService;

  beforeEach(() => {
    storage = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [{ provide: StorageService, useValue: storage }],
    });
    service = TestBed.inject(CartService);
  });

  it('adds one individual tire by default and persists no price snapshot', () => {
    service.add({ tireId: 'tire-1', vehicleTrimId: null });

    expect(service.items()).toEqual([{ tireId: 'tire-1', quantity: 1, vehicleTrimId: null }]);
    expect(storage.values.get('tyre.ge.cart')).toEqual(service.items());
    expect(storage.values.get('tyre.ge.cart')).not.toHaveProperty('unitPriceGel');
  });

  it('supports only quantities 1–4 and merges repeat additions safely', () => {
    service.add({ tireId: 'tire-1', quantity: 3, vehicleTrimId: null });
    service.add({ tireId: 'tire-1', quantity: 3, vehicleTrimId: null });

    const key = cartLineKey(service.items()[0]!);
    expect(service.items()[0]?.quantity).toBe(MAX_CART_QUANTITY);

    service.setQuantity(key, 2);
    expect(service.items()[0]?.quantity).toBe(2);

    service.setQuantity(key, 99);
    expect(service.items()[0]?.quantity).toBe(MAX_CART_QUANTITY);
  });

  it('removes a line when quantity is set to zero', () => {
    service.add({ tireId: 'tire-1', vehicleTrimId: null });
    service.setQuantity(cartLineKey(service.items()[0]!), 0);
    expect(service.isEmpty()).toBe(true);
  });
});

describe('normalizeStoredCart', () => {
  it('migrates a legacy standard set to four individual tires and drops snapshots', () => {
    expect(
      normalizeStoredCart([
        {
          tireId: 'front',
          setQty: 1,
          unitPriceGel: 750,
          vehicleTrimId: 'trim-1',
        },
      ]),
    ).toEqual([{ tireId: 'front', quantity: 4, vehicleTrimId: 'trim-1' }]);
  });

  it('splits a legacy staggered set into two independent 2-tire lines', () => {
    expect(
      normalizeStoredCart([
        {
          tireId: 'front',
          rearTireId: 'rear',
          setQty: 1,
          unitPriceGel: 500,
          rearUnitPriceGel: 600,
          vehicleTrimId: null,
        },
      ]),
    ).toEqual([
      { tireId: 'front', quantity: 2, vehicleTrimId: null },
      { tireId: 'rear', quantity: 2, vehicleTrimId: null },
    ]);
  });

  it('drops malformed lines instead of poisoning the cart', () => {
    expect(normalizeStoredCart([null, {}, { tireId: '', quantity: 2 }])).toEqual([]);
  });
});
