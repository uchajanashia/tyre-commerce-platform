import { CurrencyPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, distinctUntilChanged, forkJoin, map, of, startWith, switchMap } from 'rxjs';

import { Tire } from '@core/models';
import {
  CartQuote,
  CartQuoteItem,
  CartQuoteService,
} from '@core/services/cart-quote.service';
import { CartLine, CartService, cartLineKey } from '@core/services/cart.service';
import { FitmentDataService } from '@core/services/fitment-data.service';
import { GarageService } from '@core/services/garage.service';
import { TireSizePipe } from '@shared/pipes/tire-size.pipe';
import { CartLineQuoteState, resolveCartLineQuoteState } from './cart-quote.presenter';

interface CartViewLine {
  line: CartLine;
  key: string;
  tire?: Tire;
  quote?: CartQuoteItem;
  brandName: string;
  state: CartLineQuoteState;
  vehicleMismatch: boolean;
}

interface CartHydration {
  loaded: boolean;
  error: boolean;
  tires: Map<string, Tire>;
}

type QuoteHydration =
  | { kind: 'loading' }
  | { kind: 'ready'; quote: CartQuote }
  | { kind: 'error' };

type CheckoutConfigState =
  | { kind: 'loading' }
  | { kind: 'ready'; enabled: boolean };

/** Individual-tire cart. Persisted state never acts as an authoritative price source. */
@Component({
  selector: 'app-cart-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, CurrencyPipe, TireSizePipe],
  template: `
    <section class="page">
      <h1 i18n>კალათა</h1>
      @if (cart.isEmpty()) {
        <p class="page__hint" i18n>კალათა ცარიელია — დაიწყე კატალოგიდან.</p>
        <a routerLink="/catalog" class="page__link" i18n>კატალოგის ნახვა</a>
      } @else {
        <div class="cart">
          <ul class="cart__lines">
            @for (vl of lines(); track vl.key) {
              <li class="line" [attr.aria-busy]="vl.state === 'loading'">
                @if (vl.tire; as tire) {
                  <a
                    class="line__media"
                    [routerLink]="['/tire', tire.id]"
                    [attr.aria-label]="vl.brandName + ' ' + tire.model"
                  >
                    <img [src]="tire.media.catalogUrl" alt="" loading="lazy" />
                  </a>
                  <div class="line__body">
                    <a class="line__title" [routerLink]="['/tire', tire.id]">
                      {{ vl.brandName }} {{ tire.model }}
                    </a>
                    <p class="line__meta num">{{ tire.size | tireSize }}</p>
                  </div>
                } @else {
                  <div class="line__media line__media--empty" aria-hidden="true"></div>
                  <div class="line__body">
                    @if (vl.quote?.name; as name) {
                      <a class="line__title" [routerLink]="['/tire', vl.line.tireId]">
                        {{ name }}
                      </a>
                      @if (vl.quote?.code; as code) {
                        <p class="line__meta num">{{ code }}</p>
                      }
                    } @else if (!hydration().loaded) {
                      <p class="line__title" i18n>პროდუქტის მონაცემები იტვირთება…</p>
                    } @else if (hydration().error && vl.state !== 'not_found') {
                      <p class="line__title" i18n>პროდუქტის დეტალები დროებით მიუწვდომელია</p>
                    } @else {
                      <p class="line__title num">{{ vl.line.tireId }}</p>
                    }
                  </div>
                }

                <div class="line__status" role="status" aria-live="polite" aria-atomic="true">
                  @if (vl.quote; as quote) {
                    @if (quote.unitPrice !== null && quote.currency) {
                      <p class="line__unit-price">
                        <span class="num">{{
                          quote.unitPrice | currency: quote.currency : 'symbol' : '1.0-0'
                        }}</span>
                        <ng-container i18n> / ცალი</ng-container>
                      </p>
                    }
                  }
                  @switch (vl.state) {
                    @case ('loading') {
                      <p class="line__stock line__stock--pending" i18n>
                        ფასი და ხელმისაწვდომობა მოწმდება…
                      </p>
                    }
                    @case ('available') {
                      <p class="line__stock" i18n>მარაგშია</p>
                    }
                    @case ('out_of_stock') {
                      <p class="line__stock line__stock--unavailable" i18n>მარაგში არ არის</p>
                    }
                    @case ('insufficient_quantity') {
                      <p class="line__warn" i18n>
                        არჩეული რაოდენობა ამჟამად არ არის მარაგში. აირჩიეთ ნაკლები რაოდენობა.
                      </p>
                    }
                    @case ('not_found') {
                      <p class="line__warn" i18n>
                        საბურავი ვეღარ მოიძებნა კატალოგში და ჯამში არ ითვლება.
                      </p>
                    }
                    @case ('error') {
                      <p class="line__warn" role="alert" i18n>
                        ფასი და ხელმისაწვდომობა ვერ განახლდა.
                      </p>
                      <button type="button" class="line__retry" (click)="retryQuote()" i18n>
                        ხელახლა ცდა
                      </button>
                    }
                  }
                  @if (vl.vehicleMismatch) {
                    <p class="line__warn" i18n>
                      ⚠ დამატებულია სხვა მანქანისთვის — გადაამოწმე ზომა
                    </p>
                  }
                </div>

                <div class="line__controls">
                  <div
                    class="line__qty"
                    role="group"
                    i18n-aria-label
                    aria-label="საბურავების რაოდენობა"
                  >
                    <button
                      type="button"
                      class="line__step"
                      [disabled]="vl.line.quantity === 1"
                      (click)="cart.setQuantity(vl.key, vl.line.quantity - 1)"
                      i18n-aria-label
                      aria-label="რაოდენობის შემცირება"
                    >
                      −
                    </button>
                    <output class="line__count num" aria-live="polite">{{ vl.line.quantity }}</output>
                    <button
                      type="button"
                      class="line__step"
                      [disabled]="vl.line.quantity === 4"
                      (click)="cart.setQuantity(vl.key, vl.line.quantity + 1)"
                      i18n-aria-label
                      aria-label="რაოდენობის გაზრდა"
                    >
                      +
                    </button>
                  </div>
                  <p class="line__price num">
                    @if (vl.quote; as quote) {
                      @if (quote.lineTotal !== null && quote.currency) {
                        {{ quote.lineTotal | currency: quote.currency : 'symbol' : '1.0-0' }}
                      } @else {
                        —
                      }
                    } @else {
                      —
                    }
                  </p>
                  <button type="button" class="line__remove" (click)="cart.remove(vl.key)" i18n>
                    წაშლა
                  </button>
                </div>
              </li>
            }
          </ul>

          <aside class="summary">
            <h2 class="summary__title" i18n>ჯამი</h2>
            <dl class="summary__rows" aria-live="polite" aria-atomic="true">
              <div class="summary__row">
                <dt i18n>საბურავები</dt>
                <dd class="num">{{ cart.itemCount() }}</dd>
              </div>
              <div class="summary__row summary__row--total">
                <dt i18n>სულ</dt>
                <dd class="num">
                  @if (currentQuote(); as quote) {
                    @if (quote.currency) {
                      {{ quote.total | currency: quote.currency : 'symbol' : '1.0-0' }}
                    } @else {
                      —
                    }
                  } @else if (quoteHydration().kind === 'loading') {
                    <ng-container i18n>მოწმდება…</ng-container>
                  } @else {
                    <ng-container i18n>ვერ განახლდა</ng-container>
                  }
                </dd>
              </div>
            </dl>
            <p class="summary__note" i18n>
              ფასი და ხელმისაწვდომობა კატალოგიდან ახლდება. საბოლოო თანხას გადახდისას სერვერი
              გადაამოწმებს.
            </p>
            @if (checkoutAvailable()) {
              <a routerLink="/checkout" class="summary__cta summary__cta--active"
                >შეკვეთის გაფორმება</a
              >
            } @else if (checkoutLoading()) {
              <button type="button" class="summary__cta summary__cta--loading" disabled i18n>
                შეკვეთა მოწმდება…
              </button>
              <p class="summary__disabled-note" role="status" i18n>
                ვამოწმებთ ფასს, მარაგსა და ონლაინ გადახდის ხელმისაწვდომობას.
              </p>
            } @else if (checkoutEnabled()) {
              <button type="button" class="summary__cta" disabled i18n>
                შეკვეთის გაგრძელება შეუძლებელია
              </button>
              <p class="summary__disabled-note" i18n>
                გადაამოწმეთ პროდუქტის ხელმისაწვდომობა ან სცადეთ ხელახლა.
              </p>
            } @else {
              <button type="button" class="summary__cta" disabled i18n>
                ონლაინ შეკვეთა დროებით მიუწვდომელია
              </button>
              <p class="summary__disabled-note" i18n>
                კალათაში შერჩეული პროდუქტები შენახული დარჩება. დახმარებისთვის დაგვიკავშირდით.
              </p>
            }
            <a routerLink="/catalog" class="page__link" i18n>← შოპინგის გაგრძელება</a>
          </aside>
        </div>
      }
    </section>
  `,
  styles: `
    // Light Seasonal Commerce (06): light layout, white line items, tinted summary.
    :host {
      display: block;
      min-height: calc(100vh - var(--header-height));
      background: var(--season-canvas);
      color: var(--text-primary);
    }

    .page {
      max-width: var(--container-max);
      margin: 0 auto;
      padding: var(--space-8) var(--space-5);
      display: grid;
      gap: var(--space-5);
      align-items: start;
    }

    .page__hint,
    .summary__note,
    .summary__disabled-note {
      color: var(--text-secondary);
    }

    .page__link {
      color: color-mix(in srgb, var(--accent) 70%, var(--text-primary));
    }

    .cart {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: var(--space-6);
      align-items: start;
    }

    .cart__lines {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: var(--space-4);
    }

    .line {
      display: grid;
      grid-template-columns: 96px minmax(0, 1fr) auto;
      gap: var(--space-4);
      align-items: center;
      padding: var(--space-4);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
    }

    .line__media {
      display: block;
      grid-column: 1;
      grid-row: 1 / span 2;
      min-height: 72px;
      border-radius: var(--radius-sm);
      background: #fff;
      overflow: hidden;
    }

    .line__media img {
      display: block;
      width: 100%;
      aspect-ratio: 1;
      object-fit: contain;
    }

    .line__media--empty {
      background: var(--season-surface-soft);
    }

    .line__body {
      grid-column: 2;
      grid-row: 1;
      display: grid;
      gap: var(--space-1);
      min-width: 0;
    }

    .line__title {
      color: var(--text-primary);
      font-weight: var(--weight-medium);
      text-decoration: none;
    }

    a.line__title:hover {
      color: color-mix(in srgb, var(--accent) 70%, var(--text-primary));
    }

    .line__meta,
    .line__unit-price,
    .summary__disabled-note {
      color: var(--text-secondary);
      font-size: var(--text-sm);
    }

    .line__stock {
      color: var(--success);
      font-size: var(--text-sm);
    }

    .line__status {
      grid-column: 2;
      grid-row: 2;
      display: grid;
      gap: var(--space-1);
      min-width: 0;
    }

    .line__stock--pending {
      color: var(--text-secondary);
    }

    .line__stock--unavailable,
    .line__warn {
      color: var(--danger);
      font-size: var(--text-sm);
    }

    .line__controls {
      grid-column: 3;
      grid-row: 1 / span 2;
      display: flex;
      flex-direction: column;
      align-items: end;
      gap: var(--space-2);
    }

    .line__qty {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-full);
      padding: 2px;
    }

    .line__step {
      inline-size: var(--touch-target);
      block-size: var(--touch-target);
      border: 0;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--text-primary);
      font-size: var(--text-md);
      cursor: pointer;
    }

    .line__step:hover:not(:disabled) {
      background: var(--season-surface-soft);
    }

    .line__step:disabled {
      color: var(--text-secondary);
      cursor: default;
      opacity: 0.45;
    }

    .line__count {
      min-inline-size: 2ch;
      text-align: center;
    }

    .line__price {
      font-weight: var(--weight-medium);
    }

    .line__remove {
      display: inline-flex;
      min-height: var(--touch-target);
      align-items: center;
      border: 0;
      background: transparent;
      color: var(--text-secondary);
      font-size: var(--text-sm);
      cursor: pointer;
    }

    .line__remove:hover {
      color: var(--danger);
    }

    .line__retry {
      justify-self: start;
      min-height: var(--touch-target);
      border: 0;
      background: transparent;
      color: color-mix(in srgb, var(--accent) 70%, var(--text-primary));
      text-decoration: underline;
      cursor: pointer;
    }

    /* "Tinted summary" (06): a soft seasonal wash, distinct from the plain
       white line items above it. */
    .summary {
      position: sticky;
      top: var(--space-6);
      display: grid;
      gap: var(--space-4);
      padding: var(--space-5);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--season-surface-soft);
    }

    .summary__title {
      font-size: var(--text-lg);
    }

    .summary__rows {
      margin: 0;
      display: grid;
      gap: var(--space-2);
    }

    .summary__row {
      display: flex;
      justify-content: space-between;
      color: var(--text-secondary);
    }

    .summary__row dd {
      margin: 0;
    }

    .summary__row--total {
      color: var(--text-primary);
      font-size: var(--text-lg);
      font-weight: var(--weight-medium);
    }

    .summary__note,
    .summary__disabled-note {
      font-size: var(--text-xs);
    }

    /* Disabled pre-bank checkout: deliberately grey, never the brand action
       color, so it never reads as an active buy button (06 P0). */
    .summary__cta {
      display: inline-grid;
      place-items: center;
      min-height: var(--touch-target);
      padding: var(--space-3) var(--space-5);
      border: 0;
      border-radius: var(--radius-full);
      background: var(--border);
      color: var(--text-secondary);
      font-weight: var(--weight-medium);
      cursor: not-allowed;
      opacity: 0.85;
    }

    .summary__cta--active {
      background: var(--accent);
      color: var(--accent-contrast, #fff);
      cursor: pointer;
      opacity: 1;
      text-decoration: none;
    }

    .summary__cta--active:hover {
      filter: brightness(0.94);
    }

    .summary__cta--loading {
      cursor: wait;
    }

    @media (max-width: 860px) {
      .cart {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 560px) {
      .line {
        grid-template-columns: 72px minmax(0, 1fr);
      }

      .line__media,
      .line__body,
      .line__status,
      .line__controls {
        grid-row: auto;
      }

      .line__media {
        grid-column: 1;
      }

      .line__body {
        grid-column: 2;
      }

      .line__status,
      .line__controls {
        grid-column: 1 / -1;
      }

      .line__controls {
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
      }
    }
  `,
})
export class CartPage {
  protected readonly cart = inject(CartService);
  private readonly checkoutConfig = toSignal(
    inject(HttpClient)
      .get<{ enabled: boolean }>(`${environment.apiBaseUrl}/checkout/config`)
      .pipe(
        map(({ enabled }): CheckoutConfigState => ({ kind: 'ready', enabled })),
        catchError(() => of<CheckoutConfigState>({ kind: 'ready', enabled: false })),
        startWith<CheckoutConfigState>({ kind: 'loading' }),
      ),
    { initialValue: { kind: 'loading' } as CheckoutConfigState },
  );
  protected readonly checkoutLoading = computed(
    () => this.checkoutConfig().kind === 'loading' || this.quoteHydration().kind === 'loading',
  );
  protected readonly checkoutEnabled = computed(() => {
    const config = this.checkoutConfig();
    return config.kind === 'ready' && config.enabled;
  });
  protected readonly checkoutAvailable = computed(() =>
    this.checkoutEnabled() &&
    this.cart.items().length > 0 &&
    this.currentQuote()?.allAvailable === true &&
    (this.currentQuote()?.total ?? 0) > 0,
  );
  private readonly data = inject(FitmentDataService);
  private readonly quotes = inject(CartQuoteService);
  private readonly garage = inject(GarageService);
  private readonly quoteRevision = signal(0);

  private readonly brands = toSignal(this.data.getBrands(), { initialValue: [] });

  /** A stable id list means quantity changes do not trigger API refetches. */
  private readonly detailIdsKey = computed(() =>
    [...new Set(this.cart.items().map((line) => line.tireId))].sort().join(','),
  );

  protected readonly hydration = toSignal(
    toObservable(this.detailIdsKey).pipe(
      switchMap((key) => {
        const ids = key ? key.split(',') : [];
        if (ids.length === 0) {
          return of({ loaded: true, error: false, tires: new Map<string, Tire>() } satisfies CartHydration);
        }
        return forkJoin(ids.map((id) => this.data.getTire(id))).pipe(
          map(
            (tires) =>
              ({
                loaded: true,
                error: false,
                tires: new Map(
                  tires.filter((tire): tire is Tire => !!tire).map((tire) => [tire.id, tire]),
                ),
              }) satisfies CartHydration,
          ),
          catchError(() =>
            of({ loaded: true, error: true, tires: new Map<string, Tire>() } satisfies CartHydration),
          ),
          startWith({ loaded: false, error: false, tires: new Map<string, Tire>() } satisfies CartHydration),
        );
      }),
    ),
    {
      initialValue: {
        loaded: false,
        error: false,
        tires: new Map<string, Tire>(),
      } satisfies CartHydration,
    },
  );

  /** Quantity is part of the key: every edit cancels stale work and requotes. */
  private readonly quoteRequestKey = computed(() =>
    JSON.stringify({
      revision: this.quoteRevision(),
      items: this.cart.items().map((line) => ({
        productId: line.tireId,
        quantity: line.quantity,
      })),
    }),
  );

  protected readonly quoteHydration = toSignal(
    toObservable(this.quoteRequestKey).pipe(
      distinctUntilChanged(),
      switchMap((key) => {
        const { items } = JSON.parse(key) as {
          revision: number;
          items: { productId: string; quantity: number }[];
        };
        if (items.length === 0) {
          return of<QuoteHydration>({
            kind: 'ready',
            quote: { items: [], total: 0, currency: null, allAvailable: true },
          });
        }
        return this.quotes.quote(items).pipe(
          map((quote): QuoteHydration => ({ kind: 'ready', quote })),
          catchError(() => of<QuoteHydration>({ kind: 'error' })),
          startWith<QuoteHydration>({ kind: 'loading' }),
        );
      }),
    ),
    { initialValue: { kind: 'loading' } as QuoteHydration },
  );

  protected readonly lines = computed<CartViewLine[]>(() => {
    const tires = this.hydration().tires;
    const brands = this.brands();
    const quoteState = this.quoteHydration();
    const quoted =
      quoteState.kind === 'ready'
        ? new Map(quoteState.quote.items.map((item) => [item.productId, item]))
        : new Map<string, CartQuoteItem>();
    const currentTrimId = this.garage.selectedVehicle()?.trimId ?? null;
    return this.cart.items().map((line) => {
      const tire = tires.get(line.tireId);
      const quote = quoted.get(line.tireId);
      const state = resolveCartLineQuoteState(quoteState.kind, quote);
      return {
        line,
        key: cartLineKey(line),
        tire,
        quote,
        brandName: tire
          ? (brands.find((brand) => brand.id === tire.brandId)?.name ?? tire.brandId)
          : '',
        state,
        vehicleMismatch:
          currentTrimId !== null &&
          line.vehicleTrimId !== null &&
          line.vehicleTrimId !== currentTrimId,
      };
    });
  });

  protected readonly currentQuote = computed(() => {
    const state = this.quoteHydration();
    return state.kind === 'ready' ? state.quote : null;
  });

  protected retryQuote(): void {
    this.quoteRevision.update((revision) => revision + 1);
  }
}
