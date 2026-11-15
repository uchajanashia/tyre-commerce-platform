import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';

/**
 * Fullscreen photo lightbox (shared): large photo centered, thumbnail strip
 * of all photos below, ←/→ keys + touch swipe to navigate, Esc / backdrop
 * click / ✕ to close. Dark glass backdrop from the site tokens.
 *
 * Reusable by design (detail hero today, catalog later): the parent owns the
 * open state and simply @if-renders this component, listening to (closed).
 * While mounted it locks page scroll and takes keyboard focus.
 */
@Component({
  selector: 'app-photo-lightbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    <div class="lb" role="dialog" aria-modal="true" i18n-aria-label aria-label="ფოტო გალერეა">
      <!-- content paints above this, so only true backdrop clicks close -->
      <button
        type="button"
        class="lb__backdrop"
        i18n-aria-label
        aria-label="დახურვა"
        (click)="closed.emit()"
      ></button>

      <button
        #closeBtn
        type="button"
        class="lb__close"
        i18n-aria-label
        aria-label="დახურვა"
        (click)="closed.emit()"
      >
        ✕
      </button>

      <div class="lb__stage" (touchstart)="onTouchStart($event)" (touchend)="onTouchEnd($event)">
        @if (many()) {
          <button
            type="button"
            class="lb__nav"
            i18n-aria-label
            aria-label="წინა ფოტო"
            (click)="prev()"
          >
            ‹
          </button>
        }
        <img class="lb__photo" [src]="photos()[index()]" alt="" draggable="false" />
        @if (many()) {
          <button
            type="button"
            class="lb__nav"
            i18n-aria-label
            aria-label="შემდეგი ფოტო"
            (click)="next()"
          >
            ›
          </button>
        }
      </div>

      @if (many()) {
        <ul class="lb__thumbs" role="list">
          @for (p of photos(); track p; let i = $index) {
            <li>
              <button
                type="button"
                class="lb__thumb"
                [class.is-active]="i === index()"
                (click)="show(i)"
              >
                <img [src]="p" alt="" loading="lazy" draggable="false" />
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .lb {
      position: fixed;
      inset: 0;
      z-index: var(--z-overlay);
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      justify-items: center;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-5);
      background: color-mix(in srgb, var(--bg-0) 88%, transparent);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
    }

    .lb__backdrop {
      position: absolute;
      inset: 0;
      background: transparent;
      border: none;
      cursor: default;
    }

    .lb__close {
      position: fixed;
      top: var(--space-4);
      right: var(--space-4);
      width: var(--touch-target);
      height: var(--touch-target);
      border: 1px solid var(--line);
      border-radius: var(--radius-full);
      background: var(--bg-1);
      color: var(--ink-0);
      font-size: var(--text-lg);
    }

    .lb__stage {
      position: relative; /* above the backdrop button */
      display: flex;
      align-items: center;
      gap: var(--space-4);
      min-height: 0;
      max-width: 100%;
    }

    /* white bed: studio shots are white/transparent — a black tire on a dark
       backdrop would vanish */
    .lb__photo {
      max-width: min(84vw, 1040px);
      max-height: calc(100dvh - 180px);
      object-fit: contain;
      border-radius: var(--radius-md);
      background: #ffffff;
    }

    .lb__nav {
      flex: 0 0 auto;
      width: var(--touch-target);
      height: var(--touch-target);
      border: 1px solid var(--line);
      border-radius: var(--radius-full);
      background: color-mix(in srgb, var(--bg-1) 80%, transparent);
      color: var(--ink-0);
      font-size: 24px;
      line-height: 1;
    }

    .lb__thumbs {
      position: relative; /* above the backdrop button */
      margin: 0;
      padding: var(--space-1);
      list-style: none;
      display: flex;
      gap: var(--space-2);
      max-width: 100%;
      overflow-x: auto;
      scrollbar-width: thin;
    }

    .lb__thumb {
      width: 64px;
      height: 64px;
      padding: 2px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: #ffffff;
      opacity: 0.55;
      transition: opacity var(--dur-fast) var(--ease-out);

      &:hover {
        opacity: 0.85;
      }
    }

    .lb__thumb.is-active {
      opacity: 1;
      border-color: var(--accent);
    }

    .lb__thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: inherit;
    }

    /* narrow screens navigate by swipe; the arrows just steal photo width */
    @media (max-width: 560px) {
      .lb__nav {
        display: none;
      }
    }
  `,
})
export class PhotoLightbox {
  readonly photos = input.required<string[]>();
  readonly startIndex = input(0);
  readonly closed = output<void>();

  /** Follows startIndex until the user navigates; always clamped in-range. */
  protected readonly index = linkedSignal(() => {
    const count = this.photos().length;
    return count > 0 ? Math.min(Math.max(this.startIndex(), 0), count - 1) : 0;
  });

  protected readonly many = computed(() => this.photos().length > 1);

  private readonly closeBtn = viewChild.required<ElementRef<HTMLButtonElement>>('closeBtn');
  private touchX: number | null = null;

  constructor() {
    // Modal hygiene: lock page scroll while mounted, focus the dialog.
    const doc = inject(DOCUMENT);
    const prevOverflow = doc.body.style.overflow;
    doc.body.style.overflow = 'hidden';
    inject(DestroyRef).onDestroy(() => {
      doc.body.style.overflow = prevOverflow;
    });
    afterNextRender(() => this.closeBtn().nativeElement.focus());
  }

  protected show(i: number): void {
    this.index.set(i);
  }

  protected next(): void {
    this.index.set((this.index() + 1) % this.photos().length);
  }

  protected prev(): void {
    const count = this.photos().length;
    this.index.set((this.index() - 1 + count) % count);
  }

  protected onKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        this.closed.emit();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.next();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.prev();
        break;
    }
  }

  protected onTouchStart(event: TouchEvent): void {
    this.touchX = event.changedTouches[0]?.clientX ?? null;
  }

  protected onTouchEnd(event: TouchEvent): void {
    const start = this.touchX;
    this.touchX = null;
    const end = event.changedTouches[0]?.clientX;
    if (start == null || end == null) {
      return;
    }
    const dx = end - start;
    if (Math.abs(dx) < 40) {
      return;
    }
    if (dx < 0) {
      this.next();
    } else {
      this.prev();
    }
  }
}
