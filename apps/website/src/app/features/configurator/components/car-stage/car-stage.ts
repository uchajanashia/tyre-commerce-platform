import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  PLATFORM_ID,
  Signal,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { Tire, VehicleVisual } from '@core/models';
import { sidewallMm } from '@core/services/fitment-engine.service';
import { MotionService } from '@core/services/motion.service';
import {
  STAGE_HEIGHT_PX,
  STAGE_WIDTH_PX,
  anchorRectPct,
  tireRingScale,
} from '@core/services/tire-ring-scale';
import { HeroScene } from '@features/product/components/hero-scene/hero-scene';

/**
 * The 2D compositing stage (spec 05). The car keeps its rims; each tire is a
 * separate **sidewall ring** layer composited over the rim, its outer radius
 * (ring thickness) driven by the tire's aspect ratio via tireRingScale(). All
 * positions are percentage ratios of the 2400×1260 stage space — pixel-correct
 * from 320 px to 4K with zero JS on resize.
 *
 * Tire swap = animation A1 (spec 07): each axle has TWO image buffers; the
 * incoming sidewall is fetched and decoded BEFORE anything moves (no flash),
 * then the sidewall height morphs (box scale) while lettering crossfades and the
 * body settles ~4 px. ≤ 600 ms, interruptible: rapid taps kill the running
 * timeline and queue-jump. Reduced motion → 150 ms crossfade, no settle.
 *
 * If the side-profile render is missing (spec 03) — true for every API-sourced
 * trim today, see vehicle-api.mapper.ts's GENERIC_VISUAL — the stage doesn't
 * try to re-derive the vehicle-scene anchor math itself (that was tried and
 * came out wrong: the scene art has its own wheel-well geometry, unrelated to
 * this trim's real-photo anchors). It just mounts the product detail page's
 * own `<app-hero-scene>` component for the mounted tire, unmodified — same
 * SUV/sedan/etc art, same wheel-well placement, same continuous wheel spin.
 *
 * NOTE (R1): the cinematic climate layers (sky/ground/particles/grade) and the
 * tread/sidewall detail inset are R3; this is the functional tire stage.
 */
@Component({
  selector: 'app-car-stage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HeroScene],
  template: `
    @if (carFailed()) {
      @if (tire(); as t) {
        <app-hero-scene [tire]="t" />
      }
    } @else {
      <div class="stage" [style.aspect-ratio]="aspect">
        <div class="stage__shadow" aria-hidden="true"></div>

        <div class="stage__body" #body>
          <img
            class="stage__car"
            [src]="visual().sideProfileUrl"
            [alt]="vehicleLabel()"
            loading="eager"
            draggable="false"
            (error)="carFailed.set(true)"
          />
        </div>

        <div class="stage__tires">
          @if (rear0(); as r) {
            <img #r0 class="stage__tire" [class.is-active]="active() === 0" [src]="buf0()!.media.sidewallUrl"
              [style.left.%]="r.leftPct" [style.top.%]="r.topPct" [style.width.%]="r.widthPct" [style.height.%]="r.heightPct"
              alt="" draggable="false" />
          }
          @if (rear1(); as r) {
            <img #r1 class="stage__tire" [class.is-active]="active() === 1" [src]="buf1()!.media.sidewallUrl"
              [style.left.%]="r.leftPct" [style.top.%]="r.topPct" [style.width.%]="r.widthPct" [style.height.%]="r.heightPct"
              alt="" draggable="false" />
          }
          @if (front0(); as r) {
            <img #f0 class="stage__tire" [class.is-active]="active() === 0" [src]="buf0()!.media.sidewallUrl"
              [style.left.%]="r.leftPct" [style.top.%]="r.topPct" [style.width.%]="r.widthPct" [style.height.%]="r.heightPct"
              alt="" draggable="false" />
          }
          @if (front1(); as r) {
            <img #f1 class="stage__tire" [class.is-active]="active() === 1" [src]="buf1()!.media.sidewallUrl"
              [style.left.%]="r.leftPct" [style.top.%]="r.topPct" [style.width.%]="r.widthPct" [style.height.%]="r.heightPct"
              alt="" draggable="false" />
          }
        </div>

        @if (visual().rearWheel.occlusionMaskUrl; as mask) {
          <img class="stage__occlusion" [src]="mask" alt="" draggable="false" />
        }
        @if (visual().frontWheel.occlusionMaskUrl; as mask) {
          <img class="stage__occlusion" [src]="mask" alt="" draggable="false" />
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .stage {
      position: relative;
      width: 100%;
      z-index: var(--z-stage);
    }

    .stage__shadow {
      position: absolute;
      left: 6%;
      right: 6%;
      bottom: 0;
      height: 9%;
      background: radial-gradient(ellipse 50% 50% at 50% 50%, #000000a8, transparent 72%);
    }

    .stage__body {
      position: absolute;
      inset: 0;
    }

    .stage__car {
      display: block;
      width: 100%;
      height: 100%;
      user-select: none;
    }

    .stage__tires {
      position: absolute;
      inset: 0;
    }

    .stage__tire {
      position: absolute;
      opacity: 0;
      user-select: none;
      /* transform/opacity only are animated (spec 07 perf rules) */
    }

    .stage__tire.is-active {
      opacity: 1;
    }

    .stage__occlusion {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
  `,
})
export class CarStage {
  /** Asset contract from the selected trim (spec 05). */
  readonly visual = input.required<VehicleVisual>();
  /** Mounted tire; null shows the car with bare rims. */
  readonly tire = input<Tire | null>(null);
  /** OEM tire sidewall (mm) the anchors were calibrated with (oemReferenceSidewallMm). */
  readonly oemSidewallMm = input.required<number>();
  readonly vehicleLabel = input('');

  private readonly motion = inject(MotionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly aspect = `${STAGE_WIDTH_PX} / ${STAGE_HEIGHT_PX}`;

  protected readonly carFailed = signal(false);

  /** Double buffers: each holds the tire it currently displays. */
  protected readonly buf0 = signal<Tire | null>(null);
  protected readonly buf1 = signal<Tire | null>(null);
  /** Which buffer is the resting, mounted one. */
  protected readonly active = signal<0 | 1>(0);

  private readonly bodyRef = viewChild<ElementRef<HTMLDivElement>>('body');
  private readonly r0 = viewChild<ElementRef<HTMLImageElement>>('r0');
  private readonly r1 = viewChild<ElementRef<HTMLImageElement>>('r1');
  private readonly f0 = viewChild<ElementRef<HTMLImageElement>>('f0');
  private readonly f1 = viewChild<ElementRef<HTMLImageElement>>('f1');

  /** Queue-jump token: a newer swap invalidates any in-flight one (spec 05). */
  private swapToken = 0;
  /** The tire the stage is showing OR currently animating toward. */
  private targetTireId: string | null = null;
  private runningTl: ReturnType<MotionService['timeline']> | null = null;

  protected readonly rear0 = this.bufferRect(this.buf0, 'rearWheel');
  protected readonly rear1 = this.bufferRect(this.buf1, 'rearWheel');
  protected readonly front0 = this.bufferRect(this.buf0, 'frontWheel');
  protected readonly front1 = this.bufferRect(this.buf1, 'frontWheel');

  constructor() {
    // New car → reset the broken-asset flag so the new render gets a chance.
    effect(() => {
      this.visual();
      this.carFailed.set(false);
    });

    effect(() => {
      const tire = this.tire();
      untracked(() => void this.swapTo(tire));
    });
  }

  /**
   * Each buffer is positioned for ITS tire — the ring's outer diameter (sidewall
   * height) differs per tire, so a low-profile and a high-profile tire occupy
   * visibly different boxes. Pure ratio math → pixel-correct at any width.
   */
  private bufferRect(buf: Signal<Tire | null>, axle: 'frontWheel' | 'rearWheel') {
    return computed(() => {
      const tire = buf();
      if (!tire || this.carFailed()) {
        return null;
      }
      const anchor = this.visual()[axle];
      const ring = tireRingScale(anchor, sidewallMm(tire.size), this.oemSidewallMm());
      return anchorRectPct(anchor, ring.outerDiameterPx);
    });
  }

  private async swapTo(tire: Tire | null): Promise<void> {
    const token = ++this.swapToken;
    if (!tire) {
      this.targetTireId = null;
      this.runningTl?.kill();
      this.buf0.set(null);
      this.buf1.set(null);
      return;
    }

    if (this.targetTireId === tire.id) {
      return;
    }
    this.targetTireId = tire.id;

    const activeIdx = this.active();
    const mounted = activeIdx === 0 ? this.buf0() : this.buf1();

    // Acceptance: decode BEFORE animating — never a flash of unpositioned image.
    if (this.isBrowser) {
      await this.preload(tire.media.sidewallUrl);
      if (token !== this.swapToken) {
        return; // a newer tap queue-jumped past us
      }
    }

    // First mount (or SSR): place the tire at rest, no animation.
    if (!mounted || !this.isBrowser || this.carFailed()) {
      (activeIdx === 0 ? this.buf0 : this.buf1).set(tire);
      return;
    }

    const incomingIdx: 0 | 1 = activeIdx === 0 ? 1 : 0;
    (incomingIdx === 0 ? this.buf0 : this.buf1).set(tire);
    await this.nextRender();
    if (token !== this.swapToken) {
      return;
    }

    const incoming = this.axleEls(incomingIdx);
    const outgoing = this.axleEls(activeIdx);
    const body = this.bodyRef()?.nativeElement;
    if (!body) {
      this.active.set(incomingIdx);
      return; // hero-scene mode: no ring/body morph to animate
    }

    this.runningTl?.kill(); // interruptible: kill, never stack
    const tl = this.motion.timeline(
      {
        onComplete: () => {
          this.active.set(incomingIdx);
          afterNextRender(() => this.motion.set([...incoming, ...outgoing, body], { clearProps: 'all' }), {
            injector: this.injector,
          });
        },
      },
      this.destroyRef,
    );
    this.runningTl = tl;

    if (this.motion.reduced()) {
      // Reduced motion: 150 ms crossfade, no morph, no settle.
      tl.to(outgoing, { opacity: 0, duration: this.motion.dur.fast, ease: 'none' }, 0).fromTo(
        incoming,
        { opacity: 0 },
        { opacity: 1, duration: this.motion.dur.fast, ease: 'none' },
        0,
      );
      return;
    }

    // A1 (≤ 600 ms): sidewall-height morph reads as a scale crossfade as the new
    // ring settles in; the body dips ~4 px on its suspension.
    tl.to(outgoing, { scale: 0.96, opacity: 0, duration: 0.24, ease: 'power2.in' }, 0)
      .fromTo(
        incoming,
        { scale: 1.04, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.34, ease: this.motion.ease.seat },
        0.1,
      )
      .to(body, { y: 4, duration: 0.1, ease: 'power2.out' }, 0.16)
      .to(body, { y: 0, duration: 0.32, ease: this.motion.ease.settle }, 0.26);
  }

  private axleEls(idx: 0 | 1): HTMLImageElement[] {
    const refs = idx === 0 ? [this.r0(), this.f0()] : [this.r1(), this.f1()];
    return refs.filter((r): r is ElementRef<HTMLImageElement> => !!r).map((r) => r.nativeElement);
  }

  private preload(url: string): Promise<void> {
    const img = new Image();
    img.src = url;
    return img.decode().catch(() => undefined); // broken asset → swap anyway
  }

  private nextRender(): Promise<void> {
    return new Promise((resolve) => afterNextRender(() => resolve(), { injector: this.injector }));
  }
}
