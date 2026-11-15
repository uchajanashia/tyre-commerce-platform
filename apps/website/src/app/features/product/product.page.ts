import { CurrencyPipe, isPlatformBrowser } from '@angular/common';
import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  NgZone,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  catchError,
  combineLatest,
  filter,
  forkJoin,
  map,
  of,
  startWith,
  switchMap,
  take,
} from 'rxjs';

import {
  CompatibilityResult,
  Season,
  Tire,
  TYRE_CATEGORY_BY_KEY,
  TyreCategory,
  TyreCategoryDef,
} from '@core/models';
import { LanguageService } from '@core/i18n/language.service';
import { CartService } from '@core/services/cart.service';
import { FitmentDataService } from '@core/services/fitment-data.service';
import { evaluateTireForCar, FitmentEngineService } from '@core/services/fitment-engine.service';
import { GarageService } from '@core/services/garage.service';
import { SeoService } from '@core/services/seo.service';
import { EuLabel } from '@shared/components/eu-label/eu-label';
import { SeasonSymbol } from '@shared/components/season-symbol/season-symbol';
import { LoadIndexPipe } from '@shared/pipes/load-index.pipe';
import { SpeedRatingPipe } from '@shared/pipes/speed-rating.pipe';
import { TireSizePipe } from '@shared/pipes/tire-size.pipe';
import { HeroScene } from './components/hero-scene/hero-scene';

const SEASON_LABELS: Record<Season, string> = {
  summer: $localize`ზაფხული`,
  winter: $localize`ზამთარი`,
  'all-season': $localize`ყველა სეზონი`,
};

const EN_SEASON_LABELS: Record<Season, string> = {
  summer: 'Summer',
  winter: 'Winter',
  'all-season': 'All-season',
};

const EN_CATEGORY_LABELS: Record<TyreCategory, string> = {
  summer: 'Summer',
  all_season: 'All-season',
  winter_at: 'Winter A/T',
  ms: 'M+S',
  ht: 'Road H/T',
  at: 'All-terrain A/T',
  mt: 'Off-road M/T',
};

const EN_COUNTRY_LABELS: Readonly<Record<string, string>> = {
  თურქეთი: 'Turkey',
};

/** How many tires the compact "similar" rail shows. */
const SIMILAR_COUNT = 12;
/** How many same-radius tires to pull before sorting by width/profile
 *  closeness client-side — the radius-only filter can match far more than
 *  SIMILAR_COUNT, so this needs headroom to find the truly closest ones. */
const SIMILAR_PAGE_SIZE = 100;
/** Nearby-size window: +/-10 mm width and +/-10 percentage points profile. */
const SIMILAR_SIZE_TOLERANCE = 10;

/** Sort key for the similar rail: same rim diameter always (server-filtered);
 *  width dominates, profile breaks ties. */
function sizeDistance(a: Tire, ref: Tire): number {
  return (
    Math.abs((a.size.widthMm ?? 0) - (ref.size.widthMm ?? 0)) * 10 +
    Math.abs((a.size.aspect ?? 0) - (ref.size.aspect ?? 0))
  );
}

function isNearbySize(candidate: Tire, ref: Tire): boolean {
  if (candidate.size.rimDiameterInch !== ref.size.rimDiameterInch) {
    return false;
  }

  const refWidth = ref.size.widthMm;
  const refAspect = ref.size.aspect;
  if (refWidth === undefined || refAspect === undefined) {
    return true;
  }

  const width = candidate.size.widthMm;
  const aspect = candidate.size.aspect;
  return (
    width !== undefined &&
    aspect !== undefined &&
    Math.abs(width - refWidth) <= SIMILAR_SIZE_TOLERANCE &&
    Math.abs(aspect - refAspect) <= SIMILAR_SIZE_TOLERANCE
  );
}

type ProductState =
  | { kind: 'loading' }
  | { kind: 'found'; value: Tire }
  | { kind: 'missing' }
  | { kind: 'error' };

/**
 * Tire detail page (spec Part D). Structure:
 *  - ONE screen, two columns on desktop: LEFT the vehicle-led HeroScene with
 *    the product gallery below it; RIGHT the purchase hierarchy, truthful
 *    selected-vehicle fitment result, EU label and technical specifications.
 *    Mobile keeps the same visual-first hierarchy.
 *  - BOTTOM: a compact same-radius "similar tires" scroll-snap rail styled like
 *    the configurator's TireRail — small link cards, no filter block (the full
 *    filterable catalog lives on /catalog). Clicking a card swaps `:id` → the
 *    hero re-mounts.
 *
 * The car NEVER filters the similar rail (locked decision); it only themes the hero.
 */
@Component({
  selector: 'app-product-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    CurrencyPipe,
    TireSizePipe,
    LoadIndexPipe,
    SpeedRatingPipe,
    EuLabel,
    SeasonSymbol,
    HeroScene,
  ],
  templateUrl: './product.page.html',
  styleUrl: './product.page.scss',
})
export class ProductPage {
  private readonly data = inject(FitmentDataService);
  private readonly engine = inject(FitmentEngineService);
  private readonly garage = inject(GarageService);
  private readonly cart = inject(CartService);
  private readonly seo = inject(SeoService);
  private readonly language = inject(LanguageService);
  private readonly appRef = inject(ApplicationRef);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Similar products are below the fold. Keeping this false through SSR and
   * hydration prevents their multi-page HTTP fan-out from delaying the main
   * product paint or Angular's initial stability signal. */
  private readonly similarReady = signal(false);

  /** route param via withComponentInputBinding */
  readonly id = input.required<string>();

  protected readonly productState = toSignal(
    toObservable(this.id).pipe(
      switchMap((id) =>
        this.data.getTire(id).pipe(
          map(
            (tire): ProductState => (tire ? { kind: 'found', value: tire } : { kind: 'missing' }),
          ),
          catchError(() => of<ProductState>({ kind: 'error' })),
          startWith<ProductState>({ kind: 'loading' }),
        ),
      ),
    ),
    { initialValue: { kind: 'loading' } as ProductState },
  );

  protected readonly tire = computed(() => {
    const state = this.productState();
    return state.kind === 'found' ? state.value : undefined;
  });

  protected readonly brands = toSignal(this.data.getBrands(), { initialValue: [] });
  private readonly brandNames = computed(() => new Map(this.brands().map((b) => [b.id, b.name])));
  protected readonly brandName = computed(() => {
    const t = this.tire();
    if (!t) {
      return '';
    }
    return this.brandNames().get(t.brandId) ?? t.brandId;
  });

  protected readonly selectedVehicleLabel = computed(
    () => this.garage.selectedVehicle()?.label ?? '',
  );

  /** A positive claim is rendered only after both the persisted vehicle ref
   * and its authoritative trim have resolved and the engine returns `fits`. */
  protected readonly compatibility = computed<CompatibilityResult | null>(() => {
    const tire = this.tire();
    const trimState = this.engine.selectedTrimState();
    if (!tire || this.isDisk(tire) || trimState.kind !== 'ready' || !trimState.value) {
      return null;
    }
    return evaluateTireForCar(trimState.value.fitment, tire);
  });

  protected readonly fitmentLoading = computed(
    () =>
      this.garage.selectedVehicle() !== null && this.engine.selectedTrimState().kind === 'loading',
  );

  private readonly brandCountries = computed(
    () => new Map(this.brands().map((b) => [b.id, b.country])),
  );
  /** Manufacturer country, from the brand record — undefined until brands load. */
  protected readonly brandCountry = computed(() => {
    const t = this.tire();
    const country = t ? this.brandCountries().get(t.brandId) : undefined;
    if (!country || this.language.language() !== 'en') {
      return country;
    }
    return EN_COUNTRY_LABELS[country] ?? country;
  });

  /** Post-add confirmation link; cleared when the route swaps to another tire. */
  protected readonly justAdded = signal(false);
  /** Direct purchase starts at one tire; four remains an explicit quick choice. */
  protected readonly selectedQuantity = signal(1);

  constructor() {
    if (this.isBrowser) {
      this.appRef.isStable
        .pipe(filter(Boolean), take(1), takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          // isStable emits outside Angular. Queue the non-critical rail only
          // after hydration has settled, then re-enter once for the signal.
          this.zone.runOutsideAngular(() => {
            queueMicrotask(() => this.zone.run(() => this.similarReady.set(true)));
          });
        });
    }

    effect(() => {
      this.id();
      this.justAdded.set(false);
      this.selectedQuantity.set(1);
    });
    effect(() => {
      const state = this.productState();
      if (state.kind === 'missing') {
        this.seo.setNotFound(this.copy('პროდუქტი ვერ მოიძებნა', 'Product not found'));
      } else if (state.kind === 'error') {
        this.seo.setUnavailable(
          this.copy('კატალოგი დროებით მიუწვდომელია', 'Catalog is temporarily unavailable'),
        );
      } else if (state.kind === 'found') {
        const brand = this.brandNames().get(state.value.brandId) ?? state.value.brandId;
        const label = `${brand} ${state.value.model} ${state.value.size.raw}`.trim();
        this.seo.setPage({
          title: label,
          description: this.copy(
            `${label}. პროდუქტის მონაცემები tyre.ge-ზე.`,
            `${label}. Product specifications on tyre.ge.`,
          ),
          canonicalPath: `/tire/${encodeURIComponent(state.value.id)}`,
        });
      }
    });
  }

  /** Category def for the hero frame + badge; null when the tire has none (mocks). */
  protected readonly heroCategory = computed(() => {
    const key = this.tire()?.category;
    return key ? (TYRE_CATEGORY_BY_KEY.get(key) ?? null) : null;
  });

  /** Visible explanation of the exact nearby-size window used by the rail. */
  protected readonly similarRange = computed(() => {
    const size = this.tire()?.size;
    if (!size) {
      return null;
    }
    const hasMetricSize = size.widthMm !== undefined && size.aspect !== undefined;
    return {
      diameter: size.rimDiameterInch,
      widthMin: hasMetricSize ? size.widthMm! - SIMILAR_SIZE_TOLERANCE : null,
      widthMax: hasMetricSize ? size.widthMm! + SIMILAR_SIZE_TOLERANCE : null,
      aspectMin: hasMetricSize ? size.aspect! - SIMILAR_SIZE_TOLERANCE : null,
      aspectMax: hasMetricSize ? size.aspect! + SIMILAR_SIZE_TOLERANCE : null,
    };
  });

  /** Exact same rim diameter, +/-10 width and +/-10 profile. All server pages
   *  are combined before filtering so a busy radius never loses valid matches. */
  protected readonly similar = toSignal(
    combineLatest([toObservable(this.tire), toObservable(this.similarReady)]).pipe(
      switchMap(([t, ready]) => {
        if (!t || !ready) {
          return of([] as Tire[]);
        }
        const query = {
          pageSize: SIMILAR_PAGE_SIZE,
          diameter: t.size.rimDiameterInch,
          ...(t.catalogClass ? { catalogClass: t.catalogClass } : {}),
        };
        return this.data.getTiresPage({ ...query, page: 1 }).pipe(
          switchMap((first) => {
            const pageCount = Math.ceil(first.total / SIMILAR_PAGE_SIZE);
            if (pageCount <= 1) {
              return of(first.items);
            }
            return forkJoin(
              Array.from({ length: pageCount - 1 }, (_, index) =>
                this.data.getTiresPage({ ...query, page: index + 2 }),
              ),
            ).pipe(map((pages) => [first.items, ...pages.map((page) => page.items)].flat()));
          }),
          map((items) =>
            items
              .filter((x) => x.id !== t.id && isNearbySize(x, t))
              .sort((a, b) => sizeDistance(a, t) - sizeDistance(b, t))
              .slice(0, SIMILAR_COUNT),
          ),
        );
      }),
    ),
    { initialValue: [] as Tire[] },
  );

  /** Add the explicitly selected number of individual tires. */
  protected addToCart(tire: Tire): void {
    this.cart.add({
      tireId: tire.id,
      quantity: this.selectedQuantity(),
      vehicleTrimId: this.engine.selectedTrim()?.id ?? null,
    });
    this.justAdded.set(true);
  }

  protected setQuantity(quantity: number): void {
    this.selectedQuantity.set(Math.min(4, Math.max(1, Math.trunc(quantity))));
    this.justAdded.set(false);
  }

  protected similarBrandName(tire: Tire): string {
    return this.brandNames().get(tire.brandId) ?? tire.brandId;
  }

  /** Category def for a similar-rail card's season badge; null on mock fixtures. */
  protected categoryOf(tire: Tire): TyreCategoryDef | null {
    return tire.category ? (TYRE_CATEGORY_BY_KEY.get(tire.category) ?? null) : null;
  }

  protected seasonLabel(season: Season): string {
    return this.language.language() === 'en' ? EN_SEASON_LABELS[season] : SEASON_LABELS[season];
  }

  protected isDisk(tire: Tire): boolean {
    return tire.productType === 'disk' || tire.catalogClass === 'disk';
  }

  protected unitPriceLabel(tire: Tire): string {
    return this.isDisk(tire)
      ? this.copy('ერთი დისკი', 'one wheel')
      : this.copy('ერთი საბურავი', 'one tyre');
  }

  protected similarProductsLabel(tire: Tire): string {
    return this.isDisk(tire)
      ? this.copy('მსგავსი დისკები', 'Similar wheels')
      : this.copy('მსგავსი საბურავები', 'Similar tyres');
  }

  protected productTypeLabel(tire: Tire): string {
    if (this.isDisk(tire)) {
      return this.copy('დისკი', 'Wheel');
    }
    const category = this.categoryOf(tire);
    if (!category) {
      return this.seasonLabel(tire.season);
    }
    return this.language.language() === 'en'
      ? EN_CATEGORY_LABELS[category.key]
      : category.badgeLabel;
  }

  protected copy(ka: string, en: string): string {
    return this.language.language() === 'en' ? en : ka;
  }
}
