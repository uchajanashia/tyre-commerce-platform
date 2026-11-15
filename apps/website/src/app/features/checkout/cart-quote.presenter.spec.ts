import { CartQuoteItem } from '@core/services/cart-quote.service';
import { resolveCartLineQuoteState } from './cart-quote.presenter';

function item(issue: CartQuoteItem['issue']): CartQuoteItem {
  return {
    productId: 'tire-1',
    code: '000001',
    name: 'ROADX RXMOTION',
    quantity: 2,
    available: issue === null,
    issue,
    unitPrice: 275,
    lineTotal: issue === null ? 550 : null,
    currency: 'GEL',
  };
}

describe('cart quote presentation states', () => {
  it('keeps loading and API errors separate from inventory outcomes', () => {
    expect(resolveCartLineQuoteState('loading')).toBe('loading');
    expect(resolveCartLineQuoteState('error')).toBe('error');
    expect(resolveCartLineQuoteState('ready')).toBe('error');
  });

  it.each([
    [null, 'available'],
    ['out_of_stock', 'out_of_stock'],
    ['insufficient_quantity', 'insufficient_quantity'],
    ['not_found', 'not_found'],
  ] as const)('maps issue %s to %s', (issue, expected) => {
    expect(resolveCartLineQuoteState('ready', item(issue))).toBe(expected);
  });
});
