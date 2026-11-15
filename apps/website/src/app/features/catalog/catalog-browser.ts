import { CurrencyPipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationExtras, Router, RouterLink } from '@angular/router';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import {
  Brand,
  Season,
  Tire,
  TYRE_CATEGORIES,
  TYRE_CATEGORY_BY_KEY,
  TyreCategory,
  TyreCategoryDef,
} from '@core/models';
import { LanguageService } from '@core/i18n/language.service';
import { ClimateService } from '@core/services/climate.service';
import {
  CatalogClass,
  FitmentDataService,
  SizeFacets,
  TirePage,
  TirePageQuery,
} from '@core/services/fitment-data.service';
import { MotionService } from '@core/services/motion.service';
import { EuLabel } from '@shared/components/eu-label/eu-label';
import { Pagination } from '@shared/components/pagination/pagination';
import { SeasonSymbol } from '@shared/components/season-symbol/season-symbol';
import { LoadIndexPipe } from '@shared/pipes/load-index.pipe';
import { SpeedRatingPipe } from '@shared/pipes/speed-rating.pipe';
import { TireSizePipe } from '@shared/pipes/tire-size.pipe';

import { RadialFilterOption, RadialFilterSelect } from './radial-filter-select';

type SortKey = 'price-asc' | 'price-desc';
type SizeMode = 'metric' | 'inch';
type FilterChipKey = 'class' | 'type' | 'season' | 'rim' | 'width' | 'profile' | 'size' | 'brand';
interface ServerState {
  loading: boolean;
  page: TirePage | null;
  error: boolean;
}
interface ActiveFilterChip {
  key: FilterChipKey;
  label: string;
}

/** Products per page (server-side via the API). */
const PAGE_SIZE = 30;

/** Parse a query-param string to a finite number, or undefined when empty/garbage. */
function paramToNum(raw: string): number | undefined {
  if (!raw) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Scroll-to-top offset clearing the sticky header (--header-height 64 + a gap). */
const SCROLL_OFFSET_PX = 80;

const SEASON_KEYS = new Set<Season>(['summer', 'winter', 'all-season']);

/** Legacy category URLs that predate the independent `?season=` state. */
const SEASON_CATEGORY_KEYS = new Set<TyreCategory>(['summer', 'winter_at', 'ms']);

const LEGACY_CATEGORY_TO_SEASON = new Map<TyreCategory, Season>([
  ['summer', 'summer'],
  ['winter_at', 'winter'],
  ['ms', 'all-season'],
]);

interface CatalogSeasonOption extends TyreCategoryDef {
  readonly seasonKey: Season;
}

const SEASON_CATEGORIES: readonly CatalogSeasonOption[] = [
  {
    ...TYRE_CATEGORY_BY_KEY.get('summer')!,
    seasonKey: 'summer',
    label: $localize`ზაფხული`,
    badgeLabel: $localize`ზაფხული`,
  },
  {
    ...TYRE_CATEGORY_BY_KEY.get('winter_at')!,
    seasonKey: 'winter',
    label: $localize`ზამთარი`,
    badgeLabel: $localize`ზამთარი`,
  },
  {
    ...TYRE_CATEGORY_BY_KEY.get('ms')!,
    seasonKey: 'all-season',
    label: 'M+S',
    badgeLabel: 'M+S',
  },
];

const TYPE_CATEGORIES = TYRE_CATEGORIES.filter(
  (category) => !SEASON_CATEGORY_KEYS.has(category.key),
);

/** category key → the MOOD theme it drives when first-selected (spec Part B). */
const CATEGORY_THEME = new Map<TyreCategory, Season>(TYRE_CATEGORIES.map((c) => [c.key, c.theme]));

const CATALOG_CLASS_OPTIONS: readonly { key: CatalogClass; label: string; note: string }[] = [
  { key: 'passenger', label: $localize`მსუბუქი`, note: $localize`სამგზავრო და LT` },
  { key: 'truck', label: $localize`სატვირთო`, note: $localize`ტრასა და კარიერი` },
  { key: 'special', label: $localize`სპეცტექნიკა`, note: $localize`ტრაქტორი / სპეცტექნიკა` },
  { key: 'disk', label: $localize`დისკები`, note: $localize`სატვირთო დისკები` },
] as const;

const CATALOG_CLASS_KEYS = new Set<CatalogClass>(CATALOG_CLASS_OPTIONS.map((option) => option.key));

/**
 * Reusable catalog browser: the filter block + product grid + pagination. Used by
 * BOTH the catalog page and the tire detail page (spec Part D — "reuse, don't
 * fork"). Filters live in the URL query params (shareable, SSR-renderable) so
 * both hosts share one filter state.
 *
 * Locked decision: car/garage NEVER filters the catalog. This is ALWAYS the full
 * server-paginated catalog (30/page); the car only affects the configurator.
 *
 * Category filter (spec Part B): single-select via `?type=`. The selected
 * category drives the global mood theme via ClimateService.setCategoryTheme();
 * clearing it falls back to the nav choice.
 */
@Component({
  selector: 'app-catalog-browser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-catalog-class]': 'catalogClass()',
  },
  styleUrls: ['./catalog-select-concepts.scss', './catalog-browser.scss'],
  imports: [
    RouterLink,
    CurrencyPipe,
    TireSizePipe,
    SpeedRatingPipe,
    LoadIndexPipe,
    EuLabel,
    Pagination,
    SeasonSymbol,
    RadialFilterSelect,
  ],
  templateUrl: './catalog-browser.html',
})
export class CatalogBrowser {
  private readonly data = inject(FitmentDataService);
  private readonly document = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly climate = inject(ClimateService);
  private readonly language = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly motion = inject(MotionService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly seasonCategories = SEASON_CATEGORIES;
  protected readonly typeCategories = TYPE_CATEGORIES;
  protected readonly classOptions = CATALOG_CLASS_OPTIONS;
  // Eight placeholders communicate loading without creating a multi-screen mobile document.
  protected readonly skeletons = Array.from({ length: 8 });

  private readonly results = viewChild<ElementRef<HTMLElement>>('results');

  protected readonly brands = toSignal(this.data.getBrands(), { initialValue: [] as Brand[] });

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly advancedOpen = signal(this.hasInitialAdvancedSelection());

  /** Category filter (?type=) — single-select. Legacy comma URLs use the first value. */
  protected readonly typeList = computed<TyreCategory[]>(() => {
    const first = (this.params().get('type') ?? '').split(',')[0]?.trim() as TyreCategory;
    return first && TYRE_CATEGORY_BY_KEY.has(first) ? [first] : [];
  });
  protected readonly seasonParam = computed<Season | null>(() => {
    const raw = this.params().get('season') as Season | null;
    return raw && SEASON_KEYS.has(raw) ? raw : null;
  });
  /** Explicit season wins; old `?type=summer|winter_at|ms` links remain readable. */
  protected readonly effectiveSeasonParam = computed<Season | null>(() => {
    const explicit = this.seasonParam();
    if (explicit) return explicit;
    const legacyType = this.typeList()[0];
    return legacyType ? (LEGACY_CATEGORY_TO_SEASON.get(legacyType) ?? null) : null;
  });
  private readonly filterCategories = computed<TyreCategory[]>(() => {
    const explicit = this.typeList()[0];
    return explicit && !SEASON_CATEGORY_KEYS.has(explicit) ? [explicit] : [];
  });
  protected readonly sizeParam = computed(() => this.params().get('rim') ?? '');
  protected readonly widthParam = computed(() => this.params().get('width') ?? '');
  protected readonly profileParam = computed(() => this.params().get('profile') ?? '');
  protected readonly exactSizeParam = computed(() => this.params().get('size') ?? '');
  protected readonly brandParam = computed(() => this.params().get('brand') ?? '');
  protected readonly sortParam = computed(() => (this.params().get('sort') ?? '') as SortKey | '');
  protected readonly catalogClass = computed<CatalogClass>(() => {
    const raw = this.params().get('class') as CatalogClass | null;
    return raw && CATALOG_CLASS_KEYS.has(raw) ? raw : 'passenger';
  });

  private readonly sizeFacetRequest = computed(() => ({
    catalogClass: this.catalogClass(),
    category:
      this.catalogClass() === 'disk'
        ? undefined
        : this.filterCategories().length
          ? this.filterCategories()
          : undefined,
    brand: this.brandParam() || undefined,
    width: paramToNum(this.widthParam()),
    profile: paramToNum(this.profileParam()),
    diameter: paramToNum(this.sizeParam()),
  }));

  protected readonly sizes = toSignal(
    toObservable(this.sizeFacetRequest).pipe(switchMap((query) => this.data.getSizeFacets(query))),
    { initialValue: { widths: [], profiles: [], diameters: [], inchSizes: [] } as SizeFacets },
  );
  protected readonly hasMetricSizes = computed(() => this.sizes().widths.length > 0);
  protected readonly hasInchSizes = computed(() => this.sizes().inchSizes.length > 0);
  protected readonly activeSizeMode = computed<SizeMode>(() => {
    const requested = this.params().get('sizeMode');
    if (requested === 'inch' || requested === 'metric') return requested;
    return this.hasMetricSizes() ? 'metric' : 'inch';
  });

  protected readonly pageNum = computed(() => {
    const raw = Number(this.params().get('page'));
    return Number.isInteger(raw) && raw >= 1 ? raw : 1;
  });

  // ── Server-paginated catalog (always; car never filters — locked decision) ──
  private readonly serverReq = computed<TirePageQuery>(() => {
    const cats = this.filterCategories();
    const brand = this.brandParam();
    const sort = this.sortParam();
    return {
      page: this.pageNum(),
      pageSize: PAGE_SIZE,
      catalogClass: this.catalogClass(),
      season: this.catalogClass() === 'disk' ? undefined : this.effectiveSeasonParam() || undefined,
      category: this.catalogClass() === 'disk' ? undefined : cats.length ? cats : undefined,
      brand: brand || undefined,
      width: paramToNum(this.widthParam()),
      profile: paramToNum(this.profileParam()),
      diameter: paramToNum(this.sizeParam()),
      size: this.exactSizeParam() || undefined,
      sort: sort || undefined,
    };
  });

  private readonly serverState = toSignal(
    toObservable(this.serverReq).pipe(
      switchMap((req) =>
        this.data.getTiresPage(req).pipe(
          map((page): ServerState => ({ loading: false, page, error: false })),
          startWith<ServerState>({ loading: true, page: null, error: false }),
          catchError(() =>
            of<ServerState>({
              loading: false,
              page: { items: [], total: 0, page: req.page, pageSize: PAGE_SIZE },
              error: true,
            }),
          ),
        ),
      ),
    ),
    { initialValue: { loading: false, page: null, error: false } as ServerState },
  );

  protected readonly loading = computed(() => this.serverState().loading);
  protected readonly error = computed(() => this.serverState().error);
  protected readonly total = computed(() => this.serverState().page?.total ?? 0);
  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly pageItems = computed<Tire[]>(() => this.serverState().page?.items ?? []);

  protected readonly rangeStart = computed(() =>
    this.total() === 0 ? 0 : (this.pageNum() - 1) * PAGE_SIZE + 1,
  );
  protected readonly rangeEnd = computed(() => Math.min(this.pageNum() * PAGE_SIZE, this.total()));

  /** Size options are live facets for the selected product class and filters. */
  protected readonly sizeOptions = computed(() =>
    this.keepSelectedFacet(this.sizes().diameters, this.sizeParam()),
  );
  protected readonly rimRadialOptions = computed<RadialFilterOption[]>(() => [
    { value: '', label: this.copy('ყველა დიამეტრი', 'All diameters') },
    ...this.sizeOptions().map((value) => ({ value: String(value), label: `R${value}` })),
  ]);
  protected readonly widthRadialOptions = computed<RadialFilterOption[]>(() => [
    { value: '', label: this.copy('ყველა სიგანე', 'All widths') },
    ...this.keepSelectedFacet(this.sizes().widths, this.widthParam()).map((value) => ({
      value: String(value),
      label: String(value),
    })),
  ]);
  protected readonly profileRadialOptions = computed<RadialFilterOption[]>(() => [
    { value: '', label: this.copy('ყველა პროფილი', 'All profiles') },
    ...this.keepSelectedFacet(this.sizes().profiles, this.profileParam()).map((value) => ({
      value: String(value),
      label: String(value),
    })),
  ]);
  protected readonly inchRadialOptions = computed<RadialFilterOption[]>(() => [
    { value: '', label: this.copy('ყველა ინჩური ზომა', 'All inch sizes') },
    ...this.sizes().inchSizes.map((value) => ({ value, label: value })),
  ]);
  protected readonly brandRadialOptions = computed<RadialFilterOption[]>(() => [
    { value: '', label: this.copy('ყველა ბრენდი', 'All brands') },
    ...this.brands().map((brand) => ({ value: brand.id, label: brand.name })),
  ]);

  protected readonly hasActiveFilters = computed(
    () =>
      !!(
        this.typeList().length ||
        this.effectiveSeasonParam() ||
        this.sizeParam() ||
        this.brandParam() ||
        this.widthParam() ||
        this.profileParam() ||
        this.exactSizeParam()
      ),
  );

  private readonly brandNames = computed(() => new Map(this.brands().map((b) => [b.id, b.name])));

  protected readonly activeFilterChips = computed<ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = [];
    const catalogClass = this.catalogClass();
    if (catalogClass !== 'passenger') {
      chips.push({
        key: 'class',
        label: this.classLabel(catalogClass),
      });
    }
    const type = this.filterCategories()[0];
    if (type) {
      chips.push({ key: 'type', label: this.typeLabel(type) });
    }
    const season = this.effectiveSeasonParam();
    if (season) chips.push({ key: 'season', label: this.seasonChoiceLabel(season) });
    if (this.sizeParam()) chips.push({ key: 'rim', label: `R${this.sizeParam()}` });
    if (this.widthParam())
      chips.push({ key: 'width', label: `${this.copy('სიგანე', 'Width')} ${this.widthParam()}` });
    if (this.profileParam())
      chips.push({
        key: 'profile',
        label: `${this.copy('პროფილი', 'Profile')} ${this.profileParam()}`,
      });
    if (this.exactSizeParam()) chips.push({ key: 'size', label: this.exactSizeParam() });
    if (this.brandParam()) {
      chips.push({
        key: 'brand',
        label: this.brandNames().get(this.brandParam()) ?? this.brandParam(),
      });
    }
    return chips;
  });

  constructor() {
    // A detailed type wins; otherwise a broad /season choice drives both the
    // catalog scope and its local grade. Leaving the catalog releases the
    // transient override so client navigation and a full reload behave alike.
    effect(() => {
      const first = this.filterCategories()[0];
      this.climate.setCategoryTheme(
        first ? (CATEGORY_THEME.get(first) ?? null) : this.effectiveSeasonParam(),
      );
    });

    this.destroyRef.onDestroy(() => this.climate.setCategoryTheme(null));
  }

  protected onCatalogImageError(event: Event): void {
    const image = event.currentTarget as HTMLImageElement;
    const media = image.closest('.card__media');
    media?.classList.add('is-error');
    media?.querySelector('.card__media-fallback')?.removeAttribute('aria-hidden');
  }

  protected brandName(brandId: string): string {
    return this.brandNames().get(brandId) ?? brandId;
  }

  protected copy(ka: string, en: string): string {
    return this.language.language() === 'en' ? en : ka;
  }

  protected classLabel(catalogClass: CatalogClass): string {
    const labels: Record<CatalogClass, readonly [string, string]> = {
      passenger: ['მსუბუქი', 'Passenger'],
      truck: ['სატვირთო', 'Truck'],
      special: ['სპეცტექნიკა', 'Special equipment'],
      disk: ['დისკები', 'Wheels'],
    };
    return this.copy(...labels[catalogClass]);
  }

  protected classNote(catalogClass: CatalogClass): string {
    const notes: Record<CatalogClass, readonly [string, string]> = {
      passenger: ['სამგზავრო და LT', 'Passenger and LT'],
      truck: ['ტრასა და კარიერი', 'Road and quarry'],
      special: ['ტრაქტორი / სპეცტექნიკა', 'Tractor / special equipment'],
      disk: ['სატვირთო დისკები', 'Truck wheels'],
    };
    return this.copy(...notes[catalogClass]);
  }

  protected seasonChoiceLabel(season: Season): string {
    const labels: Record<Season, readonly [string, string]> = {
      summer: ['ზაფხული', 'Summer'],
      winter: ['ზამთარი', 'Winter'],
      'all-season': ['M+S', 'M+S'],
    };
    return this.copy(...labels[season]);
  }

  protected seasonSubtitle(season: Season): string {
    const labels: Record<Season, readonly [string, string]> = {
      summer: ['თბილი ამინდი, მშრალი და სველი ასფალტი', 'Warm weather, dry and wet roads'],
      winter: ['ცივი ამინდი და თოვლი', 'Cold weather and snow'],
      'all-season': ['ტალახისა და თოვლის მარკირება', 'Mud and snow marking'],
    };
    return this.copy(...labels[season]);
  }

  protected typeLabel(type: TyreCategory): string {
    const labels: Record<TyreCategory, readonly [string, string]> = {
      summer: ['ზაფხულის', 'Summer'],
      all_season: ['ყველა სეზონის', 'All-season'],
      winter_at: ['ზამთრის A/T', 'Winter A/T'],
      ms: ['M+S', 'M+S'],
      ht: ['საგზაო H/T', 'Road H/T'],
      at: ['უნივერსალური A/T', 'All-terrain A/T'],
      mt: ['უგზოობის M/T', 'Off-road M/T'],
    };
    return this.copy(...labels[type]);
  }

  protected typeSubtitle(type: TyreCategory): string {
    const subtitles: Record<TyreCategory, readonly [string, string]> = {
      summer: ['თბილი ამინდი', 'Warm weather'],
      all_season: ['მთელი წელი, ზომიერი კლიმატი', 'Year-round, moderate climate'],
      winter_at: ['ცივი ამინდი და თოვლი — ჯიპისთვის', 'Cold weather and snow — for SUVs'],
      ms: ['ზამთრის ნიშნით, მსუბუქ თოვლში', 'Mud and snow marking'],
      ht: ['ასფალტისთვის — რბილი და ჩუმი', 'For paved roads — smooth and quiet'],
      at: ['ქალაქიც და მსუბუქი უგზოობაც', 'City roads and light off-road'],
      mt: ['ტალახი და მძიმე რელიეფი', 'Mud and demanding terrain'],
    };
    return this.copy(...subtitles[type]);
  }

  protected normalizedSeasonLabel(season: Season): string {
    const labels: Record<Season, readonly [string, string]> = {
      summer: ['ზაფხული', 'Summer'],
      winter: ['ზამთარი', 'Winter'],
      'all-season': ['ყველა სეზონი', 'All-season'],
    };
    return this.copy(...labels[season]);
  }

  protected productTypeLabel(tire: Tire): string {
    return tire.category ? this.typeLabel(tire.category) : this.normalizedSeasonLabel(tire.season);
  }

  protected filteredEmptyMessage(): string {
    return this.catalogClass() === 'disk'
      ? this.copy('ფილტრს არცერთი დისკი არ შეესაბამება.', 'No wheels match these filters.')
      : this.copy('ფილტრს არცერთი საბურავი არ შეესაბამება.', 'No tyres match these filters.');
  }

  protected catalogEmptyMessage(): string {
    return this.catalogClass() === 'disk'
      ? this.copy('დისკები ამჟამად კატალოგში არ არის.', 'No wheels are currently available.')
      : this.copy('საბურავები ამჟამად კატალოგში არ არის.', 'No tyres are currently available.');
  }

  /** Category def for the card badge/frame; null on mock fixtures (no category). */
  protected categoryOf(tire: Tire): TyreCategoryDef | null {
    return tire.category ? (TYRE_CATEGORY_BY_KEY.get(tire.category) ?? null) : null;
  }

  protected isCategoryActive(key: TyreCategory): boolean {
    return this.typeList().includes(key);
  }

  protected isSeasonActive(season: Season): boolean {
    return this.effectiveSeasonParam() === season;
  }

  protected toggleSeason(season: Season): void {
    const next = this.isSeasonActive(season) ? null : season;
    const currentType = this.typeList()[0];
    void this.navigatePreservingScroll({
      relativeTo: this.route,
      queryParams: {
        type: currentType && SEASON_CATEGORY_KEYS.has(currentType) ? null : currentType || null,
        season: next,
        rim: null,
        width: null,
        profile: null,
        size: null,
        sizeMode: null,
        page: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  protected toggleAdvanced(): void {
    this.advancedOpen.update((open) => !open);
  }

  private hasInitialAdvancedSelection(): boolean {
    const type = (this.route.snapshot.queryParamMap.get('type') ?? '')
      .split(',')[0]
      ?.trim() as TyreCategory;
    return (
      !!this.route.snapshot.queryParamMap.get('brand') ||
      TYPE_CATEGORIES.some((category) => category.key === type)
    );
  }

  private keepSelectedFacet(values: readonly number[], rawSelected: string): number[] {
    const selected = paramToNum(rawSelected);
    if (selected === undefined || values.includes(selected)) return [...values];
    return [...values, selected].sort((a, b) => a - b);
  }

  protected onPageChange(page: number): void {
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { page: page <= 1 ? null : page },
        queryParamsHandling: 'merge',
      })
      .then((navigated) => {
        const el = this.results()?.nativeElement;
        if (!navigated || !el || !this.isBrowser) return;
        const view = this.document.defaultView;
        const top = el.getBoundingClientRect().top + (view?.scrollY ?? 0) - SCROLL_OFFSET_PX;
        this.motion.scrollToY(top, { duration: 1 });
      });
  }

  protected selectCatalogClass(catalogClass: CatalogClass): void {
    void this.navigatePreservingScroll({
      relativeTo: this.route,
      queryParams: {
        class: catalogClass,
        type: null,
        season: catalogClass === 'disk' ? null : this.effectiveSeasonParam(),
        rim: null,
        width: null,
        profile: null,
        size: null,
        sizeMode: null,
        brand: null,
        page: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  /** Single-select category toggle: replace the previous value or clear it; reset page. */
  protected toggleCategory(key: TyreCategory): void {
    const next = this.typeList()[0] === key ? null : key;
    void this.navigatePreservingScroll({
      relativeTo: this.route,
      queryParams: {
        type: next,
        season: this.effectiveSeasonParam(),
        rim: null,
        width: null,
        profile: null,
        size: null,
        sizeMode: null,
        page: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  /** Simple-select filters (rim / width / profile / brand): reset to page 1. */
  protected onParamSelect(key: 'rim' | 'width' | 'profile' | 'brand', event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const clearSize =
      key === 'brand'
        ? { rim: null, width: null, profile: null, size: null, sizeMode: null }
        : { size: null, sizeMode: 'metric' };
    void this.navigatePreservingScroll({
      relativeTo: this.route,
      queryParams: { ...clearSize, [key]: value || null, page: null },
      queryParamsHandling: 'merge',
    });
  }

  protected onRadialParamSelect(key: 'rim' | 'width' | 'profile' | 'brand', value: string): void {
    const clearSize =
      key === 'brand'
        ? { rim: null, width: null, profile: null, size: null, sizeMode: null }
        : { size: null, sizeMode: 'metric' };
    void this.navigatePreservingScroll({
      relativeTo: this.route,
      queryParams: { ...clearSize, [key]: value || null, page: null },
      queryParamsHandling: 'merge',
    }).then((navigated) => {
      if (!navigated) return;
      setTimeout(() => {
        this.document
          .querySelector<HTMLElement>(
            `app-radial-filter-select[data-filter-key="${key}"] .filter-trigger`,
          )
          ?.focus({ preventScroll: true });
      }, 0);
    });
  }

  protected selectSizeMode(mode: SizeMode): void {
    void this.navigatePreservingScroll({
      relativeTo: this.route,
      queryParams: {
        sizeMode: mode,
        rim: null,
        width: null,
        profile: null,
        size: null,
        page: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  protected onExactSizeSelect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    void this.navigatePreservingScroll({
      relativeTo: this.route,
      queryParams: {
        size: value || null,
        sizeMode: 'inch',
        rim: null,
        width: null,
        profile: null,
        page: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  protected onRadialExactSizeSelect(value: string): void {
    void this.navigatePreservingScroll({
      relativeTo: this.route,
      queryParams: {
        size: value || null,
        sizeMode: 'inch',
        rim: null,
        width: null,
        profile: null,
        page: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  protected onSortChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    void this.navigatePreservingScroll({
      relativeTo: this.route,
      queryParams: { sort: value || null, page: null },
      queryParamsHandling: 'merge',
    });
  }

  protected clearFilterChip(key: FilterChipKey): void {
    if (key === 'class') {
      this.selectCatalogClass('passenger');
      return;
    }
    if (key === 'season') {
      const legacyType = this.typeList()[0];
      void this.navigatePreservingScroll({
        relativeTo: this.route,
        queryParams: {
          season: null,
          type: legacyType && SEASON_CATEGORY_KEYS.has(legacyType) ? null : legacyType || null,
          page: null,
        },
        queryParamsHandling: 'merge',
      });
      return;
    }
    void this.navigatePreservingScroll({
      relativeTo: this.route,
      queryParams: { [key]: null, page: null },
      queryParamsHandling: 'merge',
    });
  }

  protected resetFilters(): void {
    void this.navigatePreservingScroll({
      relativeTo: this.route,
      queryParams: {
        type: null,
        season: null,
        rim: null,
        brand: null,
        width: null,
        profile: null,
        size: null,
        sizeMode: null,
        page: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  /** Keep filter changes in place while Angular updates the URL and product list. */
  private navigatePreservingScroll(extras: NavigationExtras): Promise<boolean> {
    const view = this.document.defaultView;
    const left = view?.scrollX ?? 0;
    const top = view?.scrollY ?? 0;

    return this.router.navigate([], extras).then((navigated) => {
      if (!navigated || !view) return navigated;

      const restore = () => view.scrollTo(left, top);
      // Router scroll restoration runs after NavigationEnd. Two frames ensure
      // the captured viewport wins without producing a visible intermediate jump.
      view.requestAnimationFrame(() => view.requestAnimationFrame(restore));
      return navigated;
    });
  }
}
