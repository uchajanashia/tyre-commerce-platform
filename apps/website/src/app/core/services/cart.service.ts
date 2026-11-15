import { Injectable, computed, inject, signal } from '@angular/core';

import { StorageService } from './storage.service';

/** A cart line persists identity and intent only. Product details and price are
 * re-hydrated from the API whenever the cart opens. */
export interface CartLine {
  tireId: string;
  /** Number of individual tires, never a hidden set count. */
  quantity: number;
  /** Garage trim at add-time, used only for the fitment-context warning. */
  vehicleTrimId: string | null;
}

export interface CartAddInput {
  tireId: string;
  /** Defaults to one for direct product purchases; configurator may explicitly add four. */
  quantity?: number;
  vehicleTrimId: string | null;
}

interface LegacyCartLine {
  tireId?: unknown;
  rearTireId?: unknown;
  setQty?: unknown;
  vehicleTrimId?: unknown;
}

export const MIN_CART_QUANTITY = 1;
export const MAX_CART_QUANTITY = 4;

/** Line identity: the same product selected for the same garage context merges. */
export function cartLineKey(line: Pick<CartLine, 'tireId' | 'vehicleTrimId'>): string {
  return `${line.tireId}|${line.vehicleTrimId ?? ''}`;
}

export function clampCartQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) {
    return MIN_CART_QUANTITY;
  }
  return Math.min(MAX_CART_QUANTITY, Math.max(MIN_CART_QUANTITY, Math.trunc(quantity)));
}

/**
 * Normalizes both the current schema and the old set-based schema.
 *
 * Legacy standard lines represented 4 tires per set. Legacy staggered lines
 * represented 2 front + 2 rear tires and are split into independent product
 * lines. Prices are deliberately discarded: the API is authoritative.
 */
export function normalizeStoredCart(value: unknown): CartLine[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: CartLine[] = [];
  const push = (candidate: CartLine): void => {
    const key = cartLineKey(candidate);
    const existing = normalized.findIndex((line) => cartLineKey(line) === key);
    if (existing >= 0) {
      const current = normalized[existing]!;
      normalized[existing] = {
        ...current,
        quantity: clampCartQuantity(current.quantity + candidate.quantity),
      };
      return;
    }
    normalized.push({ ...candidate, quantity: clampCartQuantity(candidate.quantity) });
  };

  for (const raw of value as LegacyCartLine[]) {
    if (!raw || typeof raw !== 'object' || typeof raw.tireId !== 'string' || !raw.tireId.trim()) {
      continue;
    }
    const vehicleTrimId = typeof raw.vehicleTrimId === 'string' ? raw.vehicleTrimId : null;
    const currentQuantity = (raw as { quantity?: unknown }).quantity;
    if (typeof currentQuantity === 'number') {
      push({ tireId: raw.tireId, quantity: currentQuantity, vehicleTrimId });
      continue;
    }

    const legacySets = typeof raw.setQty === 'number' ? Math.max(1, Math.trunc(raw.setQty)) : 1;
    if (typeof raw.rearTireId === 'string' && raw.rearTireId.trim()) {
      push({ tireId: raw.tireId, quantity: legacySets * 2, vehicleTrimId });
      push({ tireId: raw.rearTireId, quantity: legacySets * 2, vehicleTrimId });
    } else {
      push({ tireId: raw.tireId, quantity: legacySets * 4, vehicleTrimId });
    }
  }
  return normalized;
}

const CART_KEY = 'tyre.ge.cart';
const LEGACY_CART_KEY = 'wheelz.cart';

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly storage = inject(StorageService);

  private readonly itemsState = signal<CartLine[]>(this.readInitialCart());

  readonly items = this.itemsState.asReadonly();
  readonly isEmpty = computed(() => this.itemsState().length === 0);
  readonly itemCount = computed(() =>
    this.itemsState().reduce((sum, line) => sum + line.quantity, 0),
  );

  /** Add individual tires. Repeated additions merge and never exceed four per line. */
  add(input: CartAddInput): void {
    const quantity = clampCartQuantity(input.quantity ?? MIN_CART_QUANTITY);
    const candidate: CartLine = { ...input, quantity };
    const items = this.itemsState();
    const key = cartLineKey(candidate);
    const existing = items.findIndex((line) => cartLineKey(line) === key);
    const next =
      existing >= 0
        ? items.map((line, index) =>
            index === existing
              ? { ...line, quantity: clampCartQuantity(line.quantity + quantity) }
              : line,
          )
        : [...items, candidate];
    this.commit(next);
  }

  /** Set an individual-tire quantity. Zero removes; positive values clamp to 1–4. */
  setQuantity(key: string, quantity: number): void {
    const next =
      quantity <= 0
        ? this.itemsState().filter((line) => cartLineKey(line) !== key)
        : this.itemsState().map((line) =>
            cartLineKey(line) === key ? { ...line, quantity: clampCartQuantity(quantity) } : line,
          );
    this.commit(next);
  }

  remove(key: string): void {
    this.commit(this.itemsState().filter((line) => cartLineKey(line) !== key));
  }

  clear(): void {
    this.commit([]);
  }

  private readInitialCart(): CartLine[] {
    this.storage.migrate(LEGACY_CART_KEY, CART_KEY);
    const normalized = normalizeStoredCart(this.storage.get<unknown>(CART_KEY));
    // Persist once so legacy price snapshots/set fields are removed immediately.
    this.storage.set(CART_KEY, normalized);
    return normalized;
  }

  private commit(next: CartLine[]): void {
    this.itemsState.set(next);
    this.storage.set(CART_KEY, next);
  }
}
