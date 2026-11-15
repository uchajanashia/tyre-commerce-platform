import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  PLATFORM_ID,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, catchError, map, of, startWith, switchMap } from 'rxjs';

import { LanguageService } from '@core/i18n/language.service';
import { Make, Season, TireSize, VehicleModel, VehicleTrim } from '@core/models';
import { ClimateService } from '@core/services/climate.service';
import { FitmentDataService } from '@core/services/fitment-data.service';
import { GarageService, GarageVehicleRef } from '@core/services/garage.service';
import { MotionService } from '@core/services/motion.service';
import { SEASON_CHOICES, SeasonChoice } from '@features/season/season-options';
import { TireSizePipe } from '@shared/pipes/tire-size.pipe';

type GarageStep = 'make' | 'model' | 'year' | 'trim' | 'season';
type GarageDataState<T> = { kind: 'loading' } | { kind: 'ready'; value: T } | { kind: 'error' };

function toGarageDataState<T>(source: Observable<T>): Observable<GarageDataState<T>> {
  return source.pipe(
    map((value): GarageDataState<T> => ({ kind: 'ready', value })),
    catchError(() => of<GarageDataState<T>>({ kind: 'error' })),
    startWith<GarageDataState<T>>({ kind: 'loading' }),
  );
}

/**
 * Garage — vehicle selection step flow (spec 06): Make → Model → Year → Trim → Season with the
 * state reflected in query params (`/garage?make=bmw&model=...`) so browser
 * back-navigation walks the steps. Search-as-you-type live-filters the grid of
 * the CURRENT step (make names on the make step, model names on the model
 * step) — a pure client-side filter of data already loaded for that step, not
 * a fetch, so it's instant and never touches the network. Trim select →
 * an in-place season decision → configurator. GSAP step transitions
 * (A5) layer on in Phase 4 — flow works without animation.
 */
@Component({
  selector: 'app-garage-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TireSizePipe],
  templateUrl: './garage.page.html',
  styleUrl: './garage.page.scss',
})
export class GaragePage {
  private readonly data = inject(FitmentDataService);
  private readonly language = inject(LanguageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly climate = inject(ClimateService);
  protected readonly garage = inject(GarageService);
  protected readonly seasonVehicle = signal<GarageVehicleRef | null>(null);
  protected readonly seasonChoices = SEASON_CHOICES;
  protected readonly skeletonItems = [1, 2, 3, 4, 5, 6] as const;
  protected readonly selectedSeason = signal<Season>(this.climate.season() ?? 'summer');
  protected readonly activeSeasonChoice = computed<SeasonChoice>(
    () =>
      this.seasonChoices.find((choice) => choice.id === this.selectedSeason()) ??
      this.seasonChoices[0]!,
  );

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly makeId = computed(() => this.params().get('make'));
  protected readonly modelId = computed(() => this.params().get('model'));
  protected readonly year = computed(() => {
    const y = this.params().get('year');
    const parsed = y ? Number(y) : Number.NaN;
    return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2100 ? parsed : null;
  });
  protected readonly step = computed<GarageStep>(() =>
    this.seasonVehicle()
      ? 'season'
      : this.year()
        ? 'trim'
        : this.modelId()
          ? 'year'
          : this.makeId()
            ? 'model'
            : 'make',
  );

  protected readonly currentStepSummary = computed(() => {
    switch (this.step()) {
      case 'make':
        return this.copy('ნაბიჯი 1 / 4 · მარკა', 'Step 1 / 4 · Make');
      case 'model':
        return this.copy('ნაბიჯი 2 / 4 · მოდელი', 'Step 2 / 4 · Model');
      case 'year':
        return this.copy('ნაბიჯი 3 / 4 · წელი', 'Step 3 / 4 · Year');
      case 'trim':
        return this.copy('ნაბიჯი 4 / 4 · კომპლექტაცია', 'Step 4 / 4 · Configuration');
      case 'season':
        return this.copy(
          'ავტომობილი არჩეულია · სეზონის არჩევა',
          'Vehicle selected · Choose a season',
        );
    }
  });

  private readonly makeRetryNonce = signal(0);
  private readonly modelRetryNonce = signal(0);
  private readonly yearRetryNonce = signal(0);
  private readonly trimRetryNonce = signal(0);

  protected readonly makesState = toSignal(
    toObservable(this.makeRetryNonce).pipe(
      switchMap(() => toGarageDataState(this.data.getMakes())),
    ),
    { initialValue: { kind: 'loading' } as GarageDataState<Make[]> },
  );
  protected readonly makes = computed(() => {
    const state = this.makesState();
    return state.kind === 'ready' ? state.value : [];
  });

  private readonly modelRequest = computed(() => ({
    makeId: this.makeId(),
    retry: this.modelRetryNonce(),
    parent: this.makesState(),
  }));
  protected readonly modelsState = toSignal(
    toObservable(this.modelRequest).pipe(
      switchMap(({ makeId, parent }) => {
        if (!makeId) return of<GarageDataState<VehicleModel[]>>({ kind: 'ready', value: [] });
        if (parent.kind === 'loading')
          return of<GarageDataState<VehicleModel[]>>({ kind: 'loading' });
        if (parent.kind === 'error') return of<GarageDataState<VehicleModel[]>>({ kind: 'error' });
        if (!parent.value.some((make) => make.id === makeId)) {
          return of<GarageDataState<VehicleModel[]>>({ kind: 'ready', value: [] });
        }
        return toGarageDataState(this.data.getModels(makeId));
      }),
    ),
    { initialValue: { kind: 'loading' } as GarageDataState<VehicleModel[]> },
  );
  protected readonly models = computed(() => {
    const state = this.modelsState();
    return state.kind === 'ready' ? state.value : [];
  });

  /** Years available for the selected model — the wizard step between model
   *  and trim, since real vehicle trims are scoped to a year. */
  private readonly yearRequest = computed(() => ({
    makeId: this.makeId(),
    modelId: this.modelId(),
    retry: this.yearRetryNonce(),
    parent: this.modelsState(),
  }));
  protected readonly yearsState = toSignal(
    toObservable(this.yearRequest).pipe(
      switchMap(({ makeId, modelId, parent }) => {
        if (!makeId || !modelId) return of<GarageDataState<number[]>>({ kind: 'ready', value: [] });
        if (parent.kind === 'loading') return of<GarageDataState<number[]>>({ kind: 'loading' });
        if (parent.kind === 'error') return of<GarageDataState<number[]>>({ kind: 'error' });
        if (!parent.value.some((model) => model.id === modelId && model.makeId === makeId)) {
          return of<GarageDataState<number[]>>({ kind: 'ready', value: [] });
        }
        return toGarageDataState(this.data.getYears(makeId, modelId));
      }),
    ),
    { initialValue: { kind: 'loading' } as GarageDataState<number[]> },
  );
  protected readonly years = computed(() => {
    const state = this.yearsState();
    return state.kind === 'ready' ? state.value : [];
  });

  private readonly trimRequest = computed(() => ({
    makeId: this.makeId(),
    modelId: this.modelId(),
    year: this.year(),
    retry: this.trimRetryNonce(),
    parent: this.yearsState(),
  }));
  protected readonly trimsState = toSignal(
    toObservable(this.trimRequest).pipe(
      switchMap(({ makeId, modelId, year, parent }) => {
        if (!year || !makeId || !modelId) {
          return of<GarageDataState<VehicleTrim[]>>({ kind: 'ready', value: [] });
        }
        if (parent.kind === 'loading')
          return of<GarageDataState<VehicleTrim[]>>({ kind: 'loading' });
        if (parent.kind === 'error') return of<GarageDataState<VehicleTrim[]>>({ kind: 'error' });
        if (!parent.value.includes(year)) {
          return of<GarageDataState<VehicleTrim[]>>({ kind: 'ready', value: [] });
        }
        return toGarageDataState(this.data.getTrims(makeId, modelId, year));
      }),
    ),
    { initialValue: { kind: 'loading' } as GarageDataState<VehicleTrim[]> },
  );
  protected readonly trims = computed(() => {
    const state = this.trimsState();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly stepLoading = computed(() => this.currentStepState().kind === 'loading');
  protected readonly stepLoadError = computed(() => this.currentStepState().kind === 'error');

  protected readonly query = signal('');
  protected readonly makeSearchPlaceholder = computed(() =>
    this.copy('მოძებნე მარკა…', 'Search makes…'),
  );
  protected readonly modelSearchPlaceholder = computed(() =>
    this.copy('მოძებნე მოდელი…', 'Search models…'),
  );

  /** Live client-side filter of the makes already loaded for this step — no
   *  fetch, so every keystroke is instant and never touches the network. */
  protected readonly filteredMakes = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) {
      return this.makes();
    }
    return this.makes().filter((m) => m.name.toLowerCase().includes(q));
  });

  /** Same idea, scoped to the models already loaded for the selected make. */
  protected readonly filteredModels = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) {
      return this.models();
    }
    return this.models().filter((m) => m.name.toLowerCase().includes(q));
  });

  protected copy(ka: string, en: string): string {
    return this.language.language() === 'en' ? en : ka;
  }

  protected seasonLabel(season: Season): string {
    const labels: Record<Season, readonly [string, string]> = {
      'all-season': ['ყველა სეზონი', 'All season'],
      summer: ['ზაფხული', 'Summer'],
      winter: ['ზამთარი', 'Winter'],
    };
    return this.copy(...labels[season]);
  }

  protected seasonCaption(season: Season): string {
    const captions: Record<Season, readonly [string, string]> = {
      'all-season': ['ქალაქი და ცვალებადი ამინდი', 'City and changing weather'],
      summer: ['თბილი და მშრალი გზა', 'Warm and dry roads'],
      winter: ['ცივი გზა, ტალახი და თოვლი', 'Cold roads, mud and snow'],
    };
    return this.copy(...captions[season]);
  }

  protected seasonSurface(season: Season): string {
    const surfaces: Record<Season, readonly [string, string]> = {
      'all-season': ['შერეული', 'Mixed'],
      summer: ['მშრალი / სველი', 'Dry / wet'],
      winter: ['ცივი / თოვლიანი', 'Cold / snowy'],
    };
    return this.copy(...surfaces[season]);
  }

  /** "G20 · 2019–…" — omits whatever Wheel-Size hasn't resolved yet rather than fabricating it. */
  protected modelMeta(model: VehicleModel): string {
    const parts: string[] = [];
    if (model.generation) {
      parts.push(model.generation);
    }
    if (model.yearFrom !== undefined) {
      parts.push(`${model.yearFrom}–${model.yearTo ?? '…'}`);
    }
    return parts.join(' · ');
  }

  protected readonly selectedMake = computed(
    () => this.makes().find((m) => m.id === this.makeId()) ?? null,
  );
  protected readonly selectedModel = computed(
    () => this.models().find((m) => m.id === this.modelId()) ?? null,
  );

  // --- A5 step transitions (spec 07): outgoing snapshot slides/fades out,
  // --- incoming pane slides in from the opposite side; mirrors on back-nav.
  private readonly motion = inject(MotionService);
  private readonly injector = inject(Injector);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly stepPane = viewChild<ElementRef<HTMLDivElement>>('stepPane');
  private static readonly STEP_ORDER: Record<GarageStep, number> = {
    make: 0,
    model: 1,
    year: 2,
    trim: 3,
    season: 4,
  };
  private lastStepIdx = -1;
  private paneSnapshot: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const step = this.step();
      untracked(() => this.animateStep(step));
    });

    // A bookmarked/refreshed URL can point at a model that is no longer in the
    // currently available fitment catalogue. Recover to the model picker instead
    // of leaving the wizard on an empty year step with no way forward.
    effect(() => {
      if (!this.isBrowser) {
        return;
      }

      const makeId = this.makeId();
      const modelId = this.modelId();
      const state = this.modelsState();
      if (!makeId || !modelId || state.kind !== 'ready') {
        return;
      }
      if (state.value.some((model) => model.id === modelId && model.makeId === makeId)) {
        return;
      }

      untracked(() => {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { model: null, year: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });
    });

    // Most model/year combinations have exactly one trim (modification) — skip
    // the extra tap and confirm it directly rather than showing a one-item list.
    effect(() => {
      const list = this.trims();
      const step = this.step();
      const make = this.selectedMake();
      const model = this.selectedModel();
      untracked(() => {
        if (step === 'trim' && list.length === 1 && make && model && !this.seasonVehicle()) {
          this.selectTrim(list[0]!);
        }
      });
    });
  }

  private animateStep(step: GarageStep): void {
    if (!this.isBrowser) {
      return;
    }
    afterNextRender(
      () => {
        const pane = this.stepPane()?.nativeElement;
        if (!pane) {
          return;
        }
        const idx = GaragePage.STEP_ORDER[step];
        const direction = idx >= this.lastStepIdx ? 1 : -1;
        const isFirst = this.lastStepIdx === -1;
        this.lastStepIdx = idx;
        if (isFirst || this.motion.reduced()) {
          this.snapshotPane(pane);
          return;
        }
        if (this.paneSnapshot) {
          const ghost = this.paneSnapshot;
          Object.assign(ghost.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
          pane.parentElement?.appendChild(ghost);
          this.motion.to(ghost, {
            x: -32 * direction,
            opacity: 0,
            duration: 0.2,
            ease: this.motion.ease.out,
            onComplete: () => ghost.remove(),
          });
        }
        this.motion.set(pane, { x: 32 * direction, opacity: 0 });
        this.motion.to(pane, {
          x: 0,
          opacity: 1,
          duration: this.motion.dur.base,
          ease: this.motion.ease.out,
          clearProps: 'transform,opacity',
          onComplete: () => this.snapshotPane(pane),
        });
      },
      { injector: this.injector },
    );
  }

  private snapshotPane(pane: HTMLElement): void {
    this.paneSnapshot = pane.cloneNode(true) as HTMLElement;
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected clearSearch(): void {
    this.query.set('');
  }

  protected isStepComplete(step: Exclude<GarageStep, 'season'>): boolean {
    switch (step) {
      case 'make':
        return this.makeId() !== null && this.step() !== 'make';
      case 'model':
        return this.modelId() !== null && !['make', 'model'].includes(this.step());
      case 'year':
        return this.year() !== null && ['trim', 'season'].includes(this.step());
      case 'trim':
        return this.seasonVehicle() !== null;
    }
  }

  protected retryStep(): void {
    switch (this.step()) {
      case 'make':
        this.makeRetryNonce.update((value) => value + 1);
        break;
      case 'model':
        this.makeRetryNonce.update((value) => value + 1);
        this.modelRetryNonce.update((value) => value + 1);
        break;
      case 'year':
        this.makeRetryNonce.update((value) => value + 1);
        this.modelRetryNonce.update((value) => value + 1);
        this.yearRetryNonce.update((value) => value + 1);
        break;
      case 'trim':
        this.makeRetryNonce.update((value) => value + 1);
        this.modelRetryNonce.update((value) => value + 1);
        this.yearRetryNonce.update((value) => value + 1);
        this.trimRetryNonce.update((value) => value + 1);
        break;
      case 'season':
        break;
    }
  }

  /** Keep a card usable when an asset is unavailable or fails to decode. */
  protected onMakeLogoError(event: Event): void {
    (event.currentTarget as HTMLImageElement).hidden = true;
  }

  protected openMake(make: Make): void {
    this.query.set('');
    void this.router.navigate([], { relativeTo: this.route, queryParams: { make: make.id } });
  }

  protected openModel(model: VehicleModel): void {
    this.query.set('');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { make: model.makeId, model: model.id },
    });
  }

  protected openYear(year: number): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { make: this.makeId(), model: this.modelId(), year },
    });
  }

  protected goToStep(step: GarageStep): void {
    if (step === 'season') {
      return;
    }
    this.seasonVehicle.set(null);
    this.query.set('');
    const queryParams =
      step === 'make'
        ? {}
        : step === 'model'
          ? { make: this.makeId() }
          : step === 'year'
            ? { make: this.makeId(), model: this.modelId() }
            : { make: this.makeId(), model: this.modelId(), year: this.year() };
    void this.router.navigate([], { relativeTo: this.route, queryParams });
  }

  protected selectTrim(trim: VehicleTrim): void {
    const make = this.selectedMake();
    const model = this.selectedModel();
    if (!make || !model) {
      return;
    }
    this.openSeasonStep({
      makeId: make.id,
      modelId: model.id,
      trimId: trim.id,
      label: [make.name, model.name, model.generation, trim.name].filter(Boolean).join(' '),
    });
  }

  protected selectRecent(vehicle: GarageVehicleRef): void {
    this.openSeasonStep(vehicle);
  }

  /** OEM front tire at the trim's largest rim — for the trim spec chip. */
  protected oemSize(trim: VehicleTrim): TireSize {
    const maxRim = Math.max(...trim.fitment.rimDiametersInch);
    const entry =
      trim.fitment.oemBySize.find((o) => o.rimDiameterInch === maxRim) ??
      trim.fitment.oemBySize[0]!;
    return entry.front;
  }

  protected goNow(): void {
    this.climate.setSeason(this.selectedSeason());
    void this.router.navigateByUrl('/configurator');
  }

  protected selectSeason(season: Season): void {
    this.selectedSeason.set(season);
    this.climate.setSeason(season);
  }

  /** Vehicle selection now reveals the final season step in this same flow. */
  private openSeasonStep(vehicle: GarageVehicleRef): void {
    this.garage.selectVehicle(vehicle);
    this.seasonVehicle.set(vehicle);
  }

  private currentStepState(): GarageDataState<unknown[]> {
    switch (this.step()) {
      case 'make':
        return this.makesState();
      case 'model':
        return this.modelsState();
      case 'year':
        return this.yearsState();
      case 'trim':
        return this.trimsState();
      case 'season':
        return { kind: 'ready', value: [] };
    }
  }
}
