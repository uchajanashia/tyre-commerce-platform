import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, map, of, startWith, switchMap } from 'rxjs';

import {
  Advisory,
  CompatibilityResult,
  FitmentCheck,
  Tire,
  TireSize,
  VehicleTireFitment,
  VehicleTrim,
  speedRatingDelta,
} from '../models';
import { FitmentDataService } from './fitment-data.service';
import { GarageService } from './garage.service';

export type FitmentResourceState<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; value: T }
  | { kind: 'error' };

function toResourceState<T>(source: Observable<T>): Observable<FitmentResourceState<T>> {
  return source.pipe(
    map((value): FitmentResourceState<T> => ({ kind: 'ready', value })),
    catchError(() => of<FitmentResourceState<T>>({ kind: 'error' })),
    startWith<FitmentResourceState<T>>({ kind: 'loading' }),
  );
}

/**
 * Tire-fitment engine (spec 04): pure exported functions + a thin signal-based
 * service wrapper. The functions are side-effect free and fully unit-tested;
 * components never compute compatibility themselves (spec 03).
 */

/** Overall-diameter is a hard fail beyond ±this % of the OEM tire. */
export const OVERALL_DIAMETER_FIT_PCT = 3;
/** Within the fit band but beyond ±this % → warning + aggressive-sizing advisory. */
export const OVERALL_DIAMETER_WARN_PCT = 2;

/** Floating-point slack so exact ±2/±3% boundaries land on the inclusive side. */
const EPS = 1e-9;

export type Axle = 'front' | 'rear';

export interface FitmentOptions {
  /** the rim diameter the car is configured with; defaults to the lowest OEM */
  rimDiameterInch?: number;
  /** which axle to validate against (staggered cars); defaults to 'front' */
  axle?: Axle;
}

/** Sidewall height (mm) = section width × aspect / 100. Missing structured size
 *  (non-metric truck/disk) → 0, which makes such a tire fail the overall-diameter
 *  rule and therefore never be reported as a fit. */
export function sidewallMm(s: TireSize): number {
  return ((s.widthMm ?? 0) * (s.aspect ?? 0)) / 100;
}

/** Overall diameter (mm) = rim(mm) + 2 × sidewall. */
export function overallDiameterMm(s: TireSize): number {
  return s.rimDiameterInch * 25.4 + 2 * sidewallMm(s);
}

/**
 * The OEM tire sidewall (mm) the stage anchors are calibrated against — the
 * front OEM tire at the car's largest OEM rim. Drives tireRingScale's
 * oemSidewallMm so mounting the OEM tire reproduces the anchor's oemSidewallPx.
 */
export function oemReferenceSidewallMm(fitment: VehicleTireFitment): number {
  const maxRim = Math.max(...fitment.rimDiametersInch);
  const entry = fitment.oemBySize.find((o) => o.rimDiameterInch === maxRim) ?? fitment.oemBySize[0];
  return entry ? sidewallMm(entry.front) : 0;
}

function sizeEquals(a: TireSize, b: TireSize): boolean {
  return (
    a.widthMm === b.widthMm && a.aspect === b.aspect && a.rimDiameterInch === b.rimDiameterInch
  );
}

/** Pure band classifier for a signed overall-diameter delta % (spec 04 rule 2). */
export function classifyOverallDiameter(deltaPct: number): { status: FitmentCheck['status'] } {
  const abs = Math.abs(deltaPct);
  if (abs > OVERALL_DIAMETER_FIT_PCT + EPS) {
    return { status: 'fail' };
  }
  if (abs > OVERALL_DIAMETER_WARN_PCT + EPS) {
    return { status: 'warning' };
  }
  return { status: 'pass' };
}

/**
 * Evaluate one tire against one axle of a car. Rules run in spec order; ALL hard
 * rules (rim diameter, overall diameter, load index, and >1-grade non-winter
 * speed deficit) must avoid 'fail' for `fits: true`. `reasons` always carries
 * one entry per rule (drives the checklist UI).
 */
export function checkCompatibility(
  fitment: VehicleTireFitment,
  tire: Tire,
  opts: FitmentOptions = {},
): CompatibilityResult {
  const rim = opts.rimDiameterInch ?? Math.min(...fitment.rimDiametersInch);
  const axle = opts.axle ?? 'front';
  const oemEntry = fitment.oemBySize.find((o) => o.rimDiameterInch === rim);
  const oemSize = oemEntry
    ? axle === 'rear' && oemEntry.rear
      ? oemEntry.rear
      : oemEntry.front
    : undefined;

  const reasons: FitmentCheck[] = [];
  const advisories: Advisory[] = [];

  // Rule 1 — rim diameter (hard). The primary gate.
  const rimOk = tire.size.rimDiameterInch === rim;
  reasons.push({
    rule: 'rim-diameter',
    status: rimOk ? 'pass' : 'fail',
    detail: rimOk
      ? `${rim}″ — matches your rim`
      : `${tire.size.rimDiameterInch}″ tire does not fit a ${rim}″ rim`,
  });

  // Rule 2 — overall diameter (hard, ±3%; warning beyond ±2%).
  let deltaPct = 0;
  let odStatus: FitmentCheck['status'] = 'fail';
  if (oemSize) {
    const oemOd = overallDiameterMm(oemSize);
    deltaPct = ((overallDiameterMm(tire.size) - oemOd) / oemOd) * 100;
    odStatus = classifyOverallDiameter(deltaPct).status;
  }
  reasons.push({
    rule: 'overall-diameter',
    status: odStatus,
    detail: oemSize
      ? `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% vs OEM diameter`
      : 'no OEM reference for this rim',
  });
  if (odStatus === 'warning') {
    advisories.push({
      kind: 'aggressive-sizing',
      text: `Overall diameter ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% vs OEM — speedometer reads slightly off.`,
    });
  }

  // Rule 3 — load index (hard, never softened). Unknown index (real catalog) → 0 → fail.
  const tireLoad = tire.loadIndex ?? 0;
  const loadOk = tireLoad >= fitment.minLoadIndex;
  reasons.push({
    rule: 'load-index',
    status: loadOk ? 'pass' : 'fail',
    detail: loadOk
      ? `index ${tireLoad} ≥ required ${fitment.minLoadIndex}`
      : `index ${tireLoad} below required ${fitment.minLoadIndex}`,
  });

  // Rule 4 — speed rating (nuanced). Unknown rating (real catalog) → treated as below.
  const tireSr = tire.speedRating;
  const srDelta = tireSr
    ? speedRatingDelta(tireSr, fitment.oemSpeedRating)
    : Number.NEGATIVE_INFINITY;
  let srStatus: FitmentCheck['status'];
  if (srDelta >= 0) {
    srStatus = 'pass';
  } else if (tire.season === 'winter') {
    srStatus = 'pass';
    advisories.push({
      kind: 'winter-speed-rating',
      text: `${tireSr ?? '—'} is below the OEM ${fitment.oemSpeedRating} rating — normal and legal for a winter tire.`,
    });
  } else if (srDelta === -1) {
    srStatus = 'warning';
  } else {
    srStatus = 'fail';
  }
  reasons.push({
    rule: 'speed-rating',
    status: srStatus,
    detail: `${tireSr ?? '—'} vs OEM ${fitment.oemSpeedRating}`,
  });

  // Rule 5 — season is the user's chosen axis, never a compatibility failure.

  const fits = reasons.every((c) => c.status !== 'fail');
  const isExactOem = fitment.oemBySize.some(
    (o) =>
      sizeEquals(o.front, tire.size) || (o.rear !== undefined && sizeEquals(o.rear, tire.size)),
  );

  return {
    fits,
    level: !fits ? 'no-fit' : isExactOem ? 'oem' : 'alternative',
    reasons,
    advisories,
    overallDiameterDeltaPct: deltaPct,
  };
}

/** A tire annotated with its compatibility result + the axle it serves. */
export interface FittedTire {
  tire: Tire;
  compatibility: CompatibilityResult;
  axle: Axle;
}

/**
 * Compatible tires for a car (spec 04): a tire is listed only if its rim is one
 * of the car's OEM rims AND it passes the hard rules. For staggered cars each
 * tire is assigned to the axle whose OEM section width it is closest to, then
 * validated against that axle. `no-fit` tires are NEVER returned.
 */
export function compatibleTiresForCar(fitment: VehicleTireFitment, tires: Tire[]): FittedTire[] {
  const fitted: FittedTire[] = [];
  for (const tire of tires) {
    const rim = tire.size.rimDiameterInch;
    if (!fitment.rimDiametersInch.includes(rim)) {
      continue; // wrong rim diameter — never listed
    }
    const oemEntry = fitment.oemBySize.find((o) => o.rimDiameterInch === rim);
    let axle: Axle = 'front';
    if (fitment.staggered && oemEntry?.rear) {
      const toFront = Math.abs((tire.size.widthMm ?? 0) - (oemEntry.front.widthMm ?? 0));
      const toRear = Math.abs((tire.size.widthMm ?? 0) - (oemEntry.rear.widthMm ?? 0));
      axle = toFront <= toRear ? 'front' : 'rear';
    }
    const compatibility = checkCompatibility(fitment, tire, { rimDiameterInch: rim, axle });
    if (compatibility.fits) {
      fitted.push({ tire, compatibility, axle });
    }
  }
  return fitted;
}

/**
 * Evaluate any tire for a car (fit OR no-fit) — for the product compatibility
 * block. Picks the rim (the tire's own rim if OEM, else the lowest OEM gate) and,
 * for staggered cars, the axle whose OEM width the tire is closest to.
 */
export function evaluateTireForCar(fitment: VehicleTireFitment, tire: Tire): CompatibilityResult {
  const rim = fitment.rimDiametersInch.includes(tire.size.rimDiameterInch)
    ? tire.size.rimDiameterInch
    : Math.min(...fitment.rimDiametersInch);
  const oemEntry = fitment.oemBySize.find((o) => o.rimDiameterInch === rim);
  let axle: Axle = 'front';
  if (fitment.staggered && oemEntry?.rear) {
    const toFront = Math.abs((tire.size.widthMm ?? 0) - (oemEntry.front.widthMm ?? 0));
    const toRear = Math.abs((tire.size.widthMm ?? 0) - (oemEntry.rear.widthMm ?? 0));
    axle = toFront <= toRear ? 'front' : 'rear';
  }
  return checkCompatibility(fitment, tire, { rimDiameterInch: rim, axle });
}

export interface StaggeredSet {
  front: Tire;
  rear: Tire;
}

/**
 * Staggered cars (spec 04): a tire model fits only if offered in BOTH the front
 * and rear OEM sizes — the cart set is then 2 front + 2 rear. Resolves to one
 * set per (brand, model) that satisfies both axles at the chosen rim.
 */
export function resolveStaggeredSets(
  fitment: VehicleTireFitment,
  tires: Tire[],
  opts: { rimDiameterInch?: number } = {},
): StaggeredSet[] {
  if (!fitment.staggered) {
    return [];
  }
  const rim = opts.rimDiameterInch ?? Math.max(...fitment.rimDiametersInch);
  const byModel = new Map<string, { front?: FittedTire; rear?: FittedTire }>();
  for (const f of compatibleTiresForCar(fitment, tires)) {
    if (f.tire.size.rimDiameterInch !== rim) {
      continue;
    }
    const key = `${f.tire.brandId}|${f.tire.model}`;
    const group = byModel.get(key) ?? {};
    const current = group[f.axle];
    // Prefer the OEM-exact size for each axle so the resolved set is deterministic.
    if (!current || (f.compatibility.level === 'oem' && current.compatibility.level !== 'oem')) {
      group[f.axle] = f;
    }
    byModel.set(key, group);
  }
  const sets: StaggeredSet[] = [];
  for (const group of byModel.values()) {
    if (group.front && group.rear) {
      sets.push({ front: group.front.tire, rear: group.rear.tire });
    }
  }
  return sets;
}

/**
 * The spine of the app (spec 03): GarageService.selectedVehicle →
 * compatibleTires computed. Catalog, configurator, and product pages consume
 * these signals; nothing re-queries or re-computes. Season filtering layers on
 * top of this list in R2 (via ClimateService); the engine list is season-blind.
 */
@Injectable({ providedIn: 'root' })
export class FitmentEngineService {
  private readonly data = inject(FitmentDataService);
  private readonly garage = inject(GarageService);
  private readonly trimRetryNonce = signal(0);
  private readonly catalogRetryNonce = signal(0);

  /** Full trim (with VehicleTireFitment) hydrated from the stored garage reference. */
  private readonly selectedTrimRequest = computed(() => ({
    ref: this.garage.selectedVehicle(),
    retry: this.trimRetryNonce(),
  }));
  readonly selectedTrimState: Signal<FitmentResourceState<VehicleTrim | null>> = toSignal(
    toObservable(this.selectedTrimRequest).pipe(
      switchMap(({ ref }) =>
        ref
          ? toResourceState(this.data.getTrim(ref.trimId).pipe(map((trim) => trim ?? null)))
          : of<FitmentResourceState<VehicleTrim | null>>({ kind: 'ready', value: null }),
      ),
    ),
    { initialValue: { kind: 'loading' } },
  );
  readonly selectedTrim: Signal<VehicleTrim | null> = computed(() => {
    const state = this.selectedTrimState();
    return state.kind === 'ready' ? state.value : null;
  });

  /**
   * Lazy: the full tire set is only needed to compute compatibility for a
   * selected car. With no trim selected we load nothing — so the catalog's
   * default (carless) browse pages from the API instead of pulling all tires.
   */
  private readonly tireCatalogRequest = computed(() => ({
    trim: this.selectedTrim(),
    retry: this.catalogRetryNonce(),
  }));
  readonly tireCatalogState: Signal<FitmentResourceState<Tire[]>> = toSignal(
    toObservable(this.tireCatalogRequest).pipe(
      switchMap(({ trim }) =>
        trim
          ? toResourceState(this.data.getTires())
          : of<FitmentResourceState<Tire[]>>({ kind: 'ready', value: [] }),
      ),
    ),
    { initialValue: { kind: 'loading' } },
  );
  private readonly allTires = computed(() => {
    const state = this.tireCatalogState();
    return state.kind === 'ready' ? state.value : [];
  });

  /**
   * Compatible tires for the selected vehicle, annotated with their full
   * CompatibilityResult. `null` when no vehicle is selected (catalog then shows
   * the full unfiltered list). `no-fit` tires are NEVER included (spec 04).
   */
  readonly compatibleTires = computed<FittedTire[] | null>(() => {
    const trim = this.selectedTrim();
    if (!trim) {
      return null;
    }
    return compatibleTiresForCar(trim.fitment, this.allTires());
  });

  retry(): void {
    this.trimRetryNonce.update((value) => value + 1);
    this.catalogRetryNonce.update((value) => value + 1);
  }

  /** Pure check exposed for one-off use (product page compatibility block). */
  check(fitment: VehicleTireFitment, tire: Tire, opts?: FitmentOptions): CompatibilityResult {
    return checkCompatibility(fitment, tire, opts);
  }
}
