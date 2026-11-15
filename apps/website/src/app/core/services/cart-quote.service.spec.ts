import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { CartQuote, CartQuoteService } from './cart-quote.service';

describe('CartQuoteService', () => {
  it('posts identity and quantity and consumes only the stable public response', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), CartQuoteService],
    });
    const service = TestBed.inject(CartQuoteService);
    const http = TestBed.inject(HttpTestingController);
    const response: CartQuote = {
      items: [
        {
          productId: 'tire-1',
          code: '000001',
          name: 'ROADX RXMOTION',
          quantity: 3,
          available: true,
          issue: null,
          unitPrice: 275,
          lineTotal: 825,
          currency: 'GEL',
        },
      ],
      total: 825,
      currency: 'GEL',
      allAvailable: true,
    };

    let quote: CartQuote | undefined;
    service.quote([{ productId: 'tire-1', quantity: 3 }]).subscribe((value) => (quote = value));
    const request = http.expectOne(`${environment.apiBaseUrl}/cart/quote`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ items: [{ productId: 'tire-1', quantity: 3 }] });
    request.flush(response);

    expect(quote).toEqual(response);
    expect(quote?.items[0]).not.toHaveProperty('stockQty');
    expect(quote?.items[0]).not.toHaveProperty('stockStatus');
    http.verify();
  });
});
