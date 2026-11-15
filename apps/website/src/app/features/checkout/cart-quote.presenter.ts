import { CartQuoteItem } from '@core/services/cart-quote.service';

export type CartLineQuoteState =
  | 'loading'
  | 'available'
  | 'out_of_stock'
  | 'insufficient_quantity'
  | 'not_found'
  | 'error';

/** Keeps transport failure separate from every authoritative inventory outcome. */
export function resolveCartLineQuoteState(
  hydration: 'loading' | 'ready' | 'error',
  item?: CartQuoteItem,
): CartLineQuoteState {
  if (hydration === 'loading') return 'loading';
  if (hydration === 'error' || !item) return 'error';
  return item.issue ?? 'available';
}
