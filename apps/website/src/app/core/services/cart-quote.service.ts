import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

export type CartQuoteIssue = 'not_found' | 'out_of_stock' | 'insufficient_quantity';

export interface CartQuoteRequestItem {
  productId: string;
  quantity: number;
}

/** Public quote contract deliberately has no stock count or internal status. */
export interface CartQuoteItem {
  productId: string;
  code: string | null;
  name: string | null;
  quantity: number;
  available: boolean;
  issue: CartQuoteIssue | null;
  unitPrice: number | null;
  lineTotal: number | null;
  currency: string | null;
}

export interface CartQuote {
  items: CartQuoteItem[];
  total: number;
  currency: string | null;
  allAvailable: boolean;
}

@Injectable({ providedIn: 'root' })
export class CartQuoteService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  quote(items: readonly CartQuoteRequestItem[]): Observable<CartQuote> {
    return this.http.post<CartQuote>(`${this.base}/cart/quote`, { items });
  }
}
