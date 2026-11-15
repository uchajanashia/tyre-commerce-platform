import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

/**
 * Approx. horizontal space one printed label needs (px), including breathing room.
 * Labels are up to ~4 chars ("8.25") at 11px. Lower this to print MORE labels,
 * raise it to print fewer (thin harder). This is the single knob for label density.
 */
const MIN_LABEL_PX = 34;

/**
 * Full-width discrete slider (the catalog's width/profile control). One track with
 * a tick at every discrete stop; the thumb snaps to stops only (never in-between).
 * Stop 0 (far left) = "ყველა" / no filter.
 *
 * Labels: every tick is labelled when they fit; when they'd collide (narrow width /
 * many steps) labels thin out to every Nth (N chosen responsively from the measured
 * track width) while ALL tick marks stay — and a value bubble above the thumb always
 * shows the exact current value, so the precise number is never hidden.
 *
 * Presentational only: the parent owns the value + URL persistence. Emits the chosen
 * value (`null` = the "ყველა" stop) via `valueChange`.
 */
@Component({
  selector: 'app-ticks-slider',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ts">
      <div
        class="ts__track"
        #track
        role="slider"
        tabindex="0"
        [attr.aria-label]="ariaLabel()"
        aria-valuemin="0"
        [attr.aria-valuemax]="stops() - 1"
        [attr.aria-valuenow]="index()"
        [attr.aria-valuetext]="displayLabel()"
        (pointerdown)="onDown($event)"
        (keydown)="onKey($event)"
      >
        <div class="ts__rail"></div>
        <div class="ts__fill" [style.width.%]="thumbPct()"></div>

        @for (t of tickStops(); track t.i) {
          <span class="ts__tick" [class.is-past]="t.i <= index()" [style.left.%]="t.pct"></span>
        }

        <div class="ts__thumb" [class.is-drag]="dragging()" [style.left.%]="thumbPct()">
          @if (showBubble()) {
            <span class="ts__bubble num">{{ displayLabel() }}</span>
          }
        </div>
      </div>

      <div class="ts__labels">
        @for (t of tickStops(); track t.i) {
          @if (showLabel(t.i)) {
            <span
              class="ts__label"
              [class.is-selected]="t.i === index()"
              [class.is-first]="t.i === 0"
              [class.is-last]="t.i === stops() - 1"
              [style.left.%]="t.pct"
              >{{ t.label }}</span
            >
          }
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
    }

    .ts {
      position: relative;
      width: 100%;
      padding-top: 28px; /* headroom for the value bubble */
    }

    .ts__track {
      position: relative;
      width: 100%;
      height: var(--ctl-h, 40px);
      display: flex;
      align-items: center;
      cursor: pointer;
      touch-action: none; /* the drag owns the gesture, never page scroll */
    }

    .ts__track:focus-visible {
      outline: none;
    }

    .ts__rail,
    .ts__fill {
      position: absolute;
      left: 0;
      height: 2px;
      border-radius: 2px;
    }

    .ts__rail {
      right: 0;
      background: var(--line);
    }

    .ts__fill {
      background: color-mix(in srgb, var(--accent) 60%, transparent);
    }

    .ts__tick {
      position: absolute;
      top: 50%;
      width: 2px;
      height: 8px;
      transform: translate(-50%, -50%);
      background: #ffffff26;
      border-radius: 1px;
    }

    .ts__tick.is-past {
      background: color-mix(in srgb, var(--accent) 55%, transparent);
    }

    .ts__thumb {
      position: absolute;
      top: 50%;
      width: 16px;
      height: 16px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      background: var(--ink-0);
      transition:
        background var(--dur-fast) var(--ease-out),
        box-shadow var(--dur-fast) var(--ease-out);
    }

    .ts__thumb.is-drag {
      background: var(--accent);
    }

    .ts__track:focus-visible .ts__thumb {
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 40%, transparent);
    }

    .ts__bubble {
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      padding: 2px var(--space-2);
      border-radius: var(--radius-full);
      background: var(--bg-2);
      border: 1px solid var(--line);
      color: var(--ink-0);
      font-size: var(--text-xs);
      white-space: nowrap;
    }

    .ts__labels {
      position: relative;
      height: 15px;
      margin-top: 6px;
    }

    /* Dimmer but readable (11px floor). Edge labels align inward so they don't clip. */
    .ts__label {
      position: absolute;
      transform: translateX(-50%);
      color: var(--ink-1);
      font-size: 11px;
      line-height: 1;
      white-space: nowrap;
    }

    .ts__label.is-first {
      transform: none;
    }

    .ts__label.is-last {
      transform: translateX(-100%);
    }

    .ts__label.is-selected {
      color: var(--ink-0);
      font-weight: var(--weight-medium);
    }
  `,
})
export class TicksSlider {
  readonly options = input<number[]>([]);
  readonly value = input<number | null>(null);
  readonly allLabel = input($localize`ყველა`);
  readonly ariaLabel = input('');
  readonly valueChange = output<number | null>();

  private readonly trackEl = viewChild.required<ElementRef<HTMLElement>>('track');
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly dragging = signal(false);
  /** Measured track width (px), kept live by a ResizeObserver; 0 until measured. */
  private readonly trackWidth = signal(0);

  /** total stops = "ყველა" (index 0) + one per option. */
  protected readonly stops = computed(() => this.options().length + 1);

  protected readonly index = computed(() => {
    const v = this.value();
    if (v === null) {
      return 0;
    }
    const i = this.options().indexOf(v);
    return i < 0 ? 0 : i + 1;
  });

  protected readonly thumbPct = computed(() => (this.index() / (this.stops() - 1)) * 100);
  protected readonly displayLabel = computed(() =>
    this.value() === null ? this.allLabel() : String(this.value()),
  );

  protected readonly tickStops = computed(() => {
    const opts = this.options();
    const last = this.stops() - 1;
    return Array.from({ length: this.stops() }, (_, i) => ({
      i,
      pct: (i / last) * 100,
      label: i === 0 ? this.allLabel() : String(opts[i - 1]),
    }));
  });

  /**
   * Print every Nth label. N grows as the track narrows / steps multiply, so labels
   * never collide. `0` width (pre-measure / SSR) → N=1 (show all), corrected on paint.
   */
  protected readonly labelStep = computed(() => {
    const w = this.trackWidth();
    if (w <= 0) {
      return 1;
    }
    const maxLabels = Math.max(2, Math.floor(w / MIN_LABEL_PX));
    return Math.max(1, Math.ceil(this.stops() / maxLabels));
  });

  /** Bubble is always on when labels are thinned (so the exact value stays visible). */
  protected readonly showBubble = computed(() => this.labelStep() > 1 || this.dragging());

  constructor() {
    // Keep trackWidth in sync with the real element width (browser only).
    effect((onCleanup) => {
      const el = this.trackEl().nativeElement;
      if (!this.isBrowser || typeof ResizeObserver === 'undefined') {
        return;
      }
      const ro = new ResizeObserver((entries) => {
        this.trackWidth.set(entries[0]?.contentRect.width ?? 0);
      });
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    });
  }

  /** Show a tick's label when it's the first, the last, or an Nth (thinning) tick. */
  protected showLabel(i: number): boolean {
    return i === 0 || i === this.stops() - 1 || i % this.labelStep() === 0;
  }

  private setFromClientX(clientX: number): void {
    const rect = this.trackEl().nativeElement.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const idx = Math.round(frac * (this.stops() - 1)); // snap to nearest stop
    const next = idx === 0 ? null : (this.options()[idx - 1] ?? null);
    if (next !== this.value()) {
      this.valueChange.emit(next);
    }
  }

  protected onDown(event: PointerEvent): void {
    event.preventDefault();
    this.trackEl().nativeElement.focus();
    this.dragging.set(true);
    this.setFromClientX(event.clientX);
    const move = (e: PointerEvent) => this.setFromClientX(e.clientX);
    const up = () => {
      this.dragging.set(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  protected onKey(event: KeyboardEvent): void {
    let idx = this.index();
    const max = this.stops() - 1;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        idx = Math.min(idx + 1, max);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        idx = Math.max(idx - 1, 0);
        break;
      case 'Home':
        idx = 0;
        break;
      case 'End':
        idx = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.valueChange.emit(idx === 0 ? null : (this.options()[idx - 1] ?? null));
  }
}
