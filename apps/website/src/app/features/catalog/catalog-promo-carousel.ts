import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { LanguageService } from '@core/i18n/language.service';
import { MotionPreferenceService } from '@core/services/motion-preference.service';

interface LocalizedText {
  readonly ka: string;
  readonly en: string;
}

interface CatalogPromoSlide {
  readonly tone: 'city' | 'terrain' | 'truck';
  readonly eyebrow: LocalizedText;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly cta: LocalizedText;
  readonly brand: string;
  readonly model: string;
  readonly image: string;
  readonly imageAlt: LocalizedText;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly queryParams: Readonly<Record<string, string>>;
  readonly navigationLabel: LocalizedText;
}

const AUTOPLAY_DELAY_MS = 6_500;

const CATALOG_PROMOS: readonly CatalogPromoSlide[] = [
  {
    tone: 'city',
    eyebrow: { ka: 'ყოველდღიური მოძრაობისთვის', en: 'For everyday driving' },
    title: { ka: 'ქალაქისთვის მზად.', en: 'Ready for the city.' },
    description: {
      ka: 'Waterfall Eco Dynamic — ზაფხულის არჩევანი ყოველდღიური გზებისთვის.',
      en: 'Waterfall Eco Dynamic — a summer choice for everyday roads.',
    },
    cta: { ka: 'ზაფხულის ნახვა', en: 'View summer tyres' },
    brand: 'WATERFALL',
    model: 'ECO DYNAMIC',
    image: '/assets/promos/waterfall-eco-dynamic.webp',
    imageAlt: { ka: 'Waterfall Eco Dynamic საბურავი', en: 'Waterfall Eco Dynamic tyre' },
    imageWidth: 524,
    imageHeight: 768,
    queryParams: { class: 'passenger', season: 'summer' },
    navigationLabel: {
      ka: 'Waterfall Eco Dynamic ბანერის ჩვენება',
      en: 'Show Waterfall Eco Dynamic banner',
    },
  },
  {
    tone: 'terrain',
    eyebrow: { ka: 'შერეული მარშრუტებისთვის', en: 'For mixed routes' },
    title: { ka: 'ასფალტიდან გრუნტამდე.', en: 'From asphalt to trails.' },
    description: {
      ka: 'Arivo Terramax A/T — გამოკვეთილი პროტექტორი განსხვავებული გზებისთვის.',
      en: 'Arivo Terramax A/T — a defined tread for changing road surfaces.',
    },
    cta: { ka: 'A/T-ის ნახვა', en: 'View A/T tyres' },
    brand: 'ARIVO',
    model: 'TERRAMAX A/T',
    image: '/assets/promos/arivo-terramax-at.webp',
    imageAlt: { ka: 'Arivo Terramax A/T საბურავი', en: 'Arivo Terramax A/T tyre' },
    imageWidth: 539,
    imageHeight: 768,
    queryParams: { class: 'passenger', type: 'at' },
    navigationLabel: {
      ka: 'Arivo Terramax A/T ბანერის ჩვენება',
      en: 'Show Arivo Terramax A/T banner',
    },
  },
  {
    tone: 'truck',
    eyebrow: { ka: 'მეტი დატვირთვისთვის', en: 'For heavier loads' },
    title: { ka: 'როცა გზა სამუშაოა.', en: 'When the road is the job.' },
    description: {
      ka: 'VGLORY WVKM3 — მოდელი სატვირთო ტრანსპორტის კატალოგიდან.',
      en: 'VGLORY WVKM3 — from our commercial transport catalog.',
    },
    cta: { ka: 'სატვირთოების ნახვა', en: 'View truck tyres' },
    brand: 'VGLORY',
    model: 'WVKM3',
    image: '/assets/promos/vglory-wvkm3.webp',
    imageAlt: { ka: 'VGLORY WVKM3 სატვირთო საბურავი', en: 'VGLORY WVKM3 truck tyre' },
    imageWidth: 527,
    imageHeight: 768,
    queryParams: { class: 'truck' },
    navigationLabel: { ka: 'VGLORY WVKM3 ბანერის ჩვენება', en: 'Show VGLORY WVKM3 banner' },
  },
] as const;

@Component({
  selector: 'app-catalog-promo-carousel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section
      class="promo"
      [attr.aria-roledescription]="copy('კარუსელი', 'carousel')"
      [attr.aria-label]="copy('შერჩეული საბურავები', 'Featured tyres')"
      tabindex="0"
      (mouseenter)="setInteractionPaused(true)"
      (mouseleave)="setInteractionPaused(false)"
      (focusin)="setInteractionPaused(true)"
      (focusout)="onFocusOut($event)"
      (keydown)="onKeydown($event)"
    >
      <div
        class="promo__viewport"
        [attr.aria-live]="interactionPaused() || autoplayPaused() ? 'polite' : 'off'"
        (pointerdown)="onPointerDown($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerCancel()"
      >
        @for (slide of slides; track slide.image; let i = $index) {
          <article
            class="promo__slide promo__slide--{{ slide.tone }}"
            [class.is-active]="i === activeIndex()"
            [attr.aria-hidden]="i === activeIndex() ? null : 'true'"
            [attr.inert]="i === activeIndex() ? null : ''"
            role="group"
            [attr.aria-roledescription]="copy('სლაიდი', 'slide')"
            [attr.aria-label]="i + 1 + ' / ' + slides.length"
          >
            <div class="promo__copy">
              <p class="promo__eyebrow">{{ text(slide.eyebrow) }}</p>
              <h2>{{ text(slide.title) }}</h2>
              <p class="promo__description">{{ text(slide.description) }}</p>
              <a
                class="promo__cta"
                routerLink="/catalog"
                [queryParams]="slide.queryParams"
                [attr.tabindex]="i === activeIndex() ? null : -1"
              >
                <span>{{ text(slide.cta) }}</span>
                <span aria-hidden="true">↗</span>
              </a>
            </div>

            <div class="promo__visual">
              <span class="promo__model" aria-hidden="true">
                <strong>{{ slide.brand }}</strong>
                <span>{{ slide.model }}</span>
              </span>
              <span class="promo__halo" aria-hidden="true"></span>
              <img
                [src]="slide.image"
                [alt]="text(slide.imageAlt)"
                [width]="slide.imageWidth"
                [height]="slide.imageHeight"
                [attr.loading]="i === 0 ? 'eager' : 'lazy'"
                [attr.fetchpriority]="i === 0 ? 'high' : null"
                draggable="false"
              />
            </div>
          </article>
        }
      </div>

      <div class="promo__controls">
        <button
          type="button"
          class="promo__arrow"
          (click)="previous()"
          [attr.aria-label]="copy('წინა ბანერი', 'Previous banner')"
        >
          <span aria-hidden="true">←</span>
        </button>

        <div class="promo__dots" [attr.aria-label]="copy('ბანერის არჩევა', 'Choose a banner')">
          @for (slide of slides; track slide.image; let i = $index) {
            <button
              type="button"
              [class.is-active]="i === activeIndex()"
              [attr.aria-label]="text(slide.navigationLabel)"
              [attr.aria-current]="i === activeIndex() ? 'true' : null"
              (click)="select(i)"
            ></button>
          }
        </div>

        <button
          type="button"
          class="promo__arrow"
          (click)="next()"
          [attr.aria-label]="copy('შემდეგი ბანერი', 'Next banner')"
        >
          <span aria-hidden="true">→</span>
        </button>

        <button
          type="button"
          class="promo__autoplay"
          [attr.aria-label]="autoplayButtonLabel()"
          [attr.aria-pressed]="autoplayPaused()"
          (click)="toggleAutoplay()"
        >
          @if (autoplayPaused()) {
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 8 5-8 5V5Z" /></svg>
          } @else {
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10M13 5v10" /></svg>
          }
        </button>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .promo {
      --promo-accent: var(--brand-action);
      position: relative;
      min-height: 210px;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--surface);
      isolation: isolate;
      touch-action: pan-y;
    }

    .promo::before {
      position: absolute;
      z-index: 3;
      inset: 0 auto 0 0;
      width: 4px;
      background: var(--promo-accent);
      content: '';
    }

    .promo__viewport {
      position: absolute;
      inset: 0;
    }

    .promo__slide {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-columns: minmax(0, 1.12fr) minmax(300px, 0.88fr);
      overflow: hidden;
      background:
        linear-gradient(90deg, #fff 0%, #fff 51%, #ffffffd9 64%, #ffffff24 100%),
        radial-gradient(circle at 82% 44%, #c83d2412 0 16%, transparent 52%);
      opacity: 0;
      pointer-events: none;
      transform: translateX(18px);
      visibility: hidden;
      transition:
        opacity 420ms var(--ease-out),
        transform 560ms var(--ease-out),
        visibility 420ms;
    }

    .promo__slide::after {
      position: absolute;
      inset: auto -2% -52% auto;
      width: min(49vw, 720px);
      aspect-ratio: 1;
      border: 1px solid color-mix(in srgb, var(--text-primary) 9%, transparent);
      border-radius: 50%;
      content: '';
    }

    .promo__slide.is-active {
      z-index: 1;
      opacity: 1;
      pointer-events: auto;
      transform: translateX(0);
      visibility: visible;
    }

    .promo__copy {
      position: relative;
      z-index: 3;
      display: flex;
      max-width: 650px;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      padding: 22px clamp(26px, 3.5vw, 48px);
      opacity: 0;
      transform: translateY(16px);
      transition:
        opacity 380ms var(--ease-out) 80ms,
        transform 520ms var(--ease-out) 80ms;
    }

    .is-active .promo__copy {
      opacity: 1;
      transform: translateY(0);
    }

    .promo__eyebrow {
      margin: 0 0 var(--space-2);
      color: var(--promo-accent);
      font-size: 0.64rem;
      font-weight: 600;
      letter-spacing: 0.15em;
      text-transform: uppercase;
    }

    h2 {
      max-width: 11ch;
      margin: 0;
      font-size: clamp(1.65rem, 2.45vw, 2.35rem);
      font-weight: 600;
      line-height: 1.01;
      letter-spacing: -0.055em;
    }

    .promo__description {
      max-width: 47ch;
      margin: var(--space-2) 0 var(--space-3);
      color: var(--text-secondary);
      font-size: var(--text-sm);
      line-height: 1.55;
    }

    .promo__cta {
      display: inline-flex;
      min-height: 40px;
      align-items: center;
      gap: var(--space-4);
      padding: 0 var(--space-5);
      border-radius: var(--radius-sm);
      background: var(--brand-action);
      color: var(--brand-action-ink);
      font-size: var(--text-sm);
      font-weight: 600;
      transition:
        background var(--dur-fast) var(--ease-out),
        transform var(--dur-fast) var(--ease-out);
    }

    .promo__cta:hover,
    .promo__cta:focus-visible {
      background: var(--brand-action-hover);
      transform: translateY(-2px);
    }

    .promo__visual {
      position: relative;
      z-index: 2;
      min-width: 0;
      height: 100%;
    }

    .promo__halo {
      position: absolute;
      top: 50%;
      left: 42%;
      width: min(29vw, 405px);
      aspect-ratio: 1;
      border-radius: 50%;
      background: color-mix(in srgb, var(--promo-accent) 7%, #f3f5f6);
      transform: translate(-50%, -50%);
    }

    .promo__visual img {
      position: absolute;
      z-index: 2;
      top: 50%;
      left: 40%;
      width: min(82%, 350px);
      height: 124%;
      object-fit: contain;
      opacity: 0;
      filter: drop-shadow(0 18px 20px #17202a20);
      transform: translate3d(40px, -50%, 0) scale(0.92) rotate(2deg);
      transition:
        opacity 420ms var(--ease-out) 80ms,
        transform 680ms var(--ease-out) 60ms;
      user-select: none;
    }

    .promo__slide--city.is-active .promo__visual img {
      opacity: 1;
      transform: translate3d(-50%, -50%, 0) scale(0.94) rotate(-4deg);
    }

    .promo__slide--terrain.is-active .promo__visual img {
      opacity: 1;
      transform: translate3d(-50%, -50%, 0) scale(0.95) rotate(3deg);
    }

    .promo__slide--truck.is-active .promo__visual img {
      width: min(105%, 590px);
      opacity: 1;
      transform: translate3d(-51%, -50%, 0) scale(0.97);
    }

    .promo__model {
      position: absolute;
      z-index: 3;
      top: 16px;
      right: clamp(24px, 3vw, 42px);
      display: grid;
      justify-items: end;
      color: var(--text-secondary);
      font-size: 0.58rem;
      letter-spacing: 0.14em;
      line-height: 1.5;
    }

    .promo__model strong {
      color: var(--text-primary);
      font-size: 0.72rem;
      font-weight: 600;
    }

    .promo__controls {
      position: absolute;
      z-index: 5;
      right: clamp(22px, 3vw, 42px);
      bottom: 12px;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: 4px;
      border: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
      border-radius: var(--radius-full);
      background: color-mix(in srgb, var(--surface) 88%, transparent);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    .promo__arrow,
    .promo__autoplay {
      display: grid;
      width: 36px;
      height: 36px;
      place-items: center;
      border-radius: 50%;
      color: var(--text-primary);
      transition:
        background var(--dur-fast) var(--ease-out),
        color var(--dur-fast) var(--ease-out);
    }

    .promo__arrow:hover,
    .promo__arrow:focus-visible,
    .promo__autoplay:hover,
    .promo__autoplay:focus-visible {
      background: var(--text-primary);
      color: var(--surface);
    }

    .promo__autoplay {
      border-left: 1px solid var(--border);
      border-radius: 0 var(--radius-full) var(--radius-full) 0;
    }

    .promo__autoplay svg {
      width: 17px;
      height: 17px;
      fill: currentColor;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-width: 1.8;
    }

    .promo__dots {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .promo__dots button {
      position: relative;
      width: 24px;
      height: 36px;
      background: transparent;
      transition: width var(--dur-base) var(--ease-out);
    }

    .promo__dots button::after {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 7px;
      height: 7px;
      border-radius: var(--radius-full);
      background: color-mix(in srgb, var(--text-primary) 22%, transparent);
      content: '';
      transform: translate(-50%, -50%);
      transition:
        width var(--dur-base) var(--ease-out),
        background var(--dur-base) var(--ease-out);
    }

    .promo__dots button.is-active {
      width: 36px;
      background: transparent;
    }

    .promo__dots button.is-active::after {
      width: 24px;
      background: var(--promo-accent);
    }

    @media (max-width: 860px) {
      .promo__slide {
        grid-template-columns: minmax(0, 1.16fr) minmax(300px, 0.84fr);
      }

      .promo__copy {
        padding-left: 32px;
      }
    }

    @media (max-width: 640px) {
      .promo {
        min-height: 184px;
      }

      .promo__slide {
        display: block;
        background:
          linear-gradient(90deg, #fff 0%, #fff 54%, #ffffffe6 68%, #ffffff5e 100%),
          radial-gradient(circle at 86% 44%, #c83d2412 0 17%, transparent 52%);
      }

      .promo__slide::after {
        inset: auto -34% -36% auto;
        width: 330px;
      }

      .promo__copy {
        z-index: 4;
        width: 76%;
        height: 100%;
        justify-content: flex-start;
        padding: 18px 0 48px 18px;
        background: linear-gradient(90deg, #fff 0%, #fff 72%, #ffffffed 86%, transparent 100%);
      }

      .promo__eyebrow {
        display: none;
      }

      h2 {
        max-width: 8.5ch;
        font-size: clamp(1.28rem, 6vw, 1.62rem);
      }

      .promo__description {
        display: none;
      }

      .promo__cta {
        min-height: 38px;
        flex: 0 0 auto;
        margin-top: 12px;
        padding-inline: 12px;
        font-size: 0.72rem;
      }

      .promo__visual {
        position: absolute;
        inset: 0 0 0 auto;
        width: 49%;
      }

      .promo__halo {
        left: 68%;
        width: 190px;
      }

      .promo__visual img {
        left: 72%;
        width: 136px;
        height: 124%;
        max-width: none;
      }

      .promo__slide--terrain.is-active .promo__visual img {
        width: 144px;
      }

      .promo__slide--truck.is-active .promo__visual img {
        left: 76%;
        width: 168px;
      }

      .promo__model,
      .promo__arrow {
        display: none;
      }

      .promo__controls {
        right: 8px;
        bottom: 7px;
        padding: 2px;
      }

      .promo__autoplay {
        display: grid;
        width: 32px;
        height: 32px;
      }
    }

    @media (max-width: 380px) {
      .promo__copy {
        width: 74%;
        padding-left: 20px;
      }

      .promo__visual {
        width: 46%;
      }

      .promo__visual img {
        left: 78%;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .promo__slide,
      .promo__copy,
      .promo__visual img {
        transform: none;
      }
    }
  `,
})
export class CatalogPromoCarousel {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly motionPreference = inject(MotionPreferenceService);
  private readonly language = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly slides = CATALOG_PROMOS;
  protected readonly activeIndex = signal(0);
  protected readonly interactionPaused = signal(false);
  protected readonly autoplayPaused = signal(false);
  protected readonly autoplayButtonLabel = computed(() =>
    this.autoplayPaused()
      ? this.copy('ბანერების ავტომატური გადართვის გაგრძელება', 'Resume automatic banner rotation')
      : this.copy('ბანერების ავტომატური გადართვის შეჩერება', 'Pause automatic banner rotation'),
  );

  private autoplayTimer?: ReturnType<typeof setTimeout>;
  private pointerStartX?: number;

  constructor() {
    effect(() => {
      this.activeIndex();
      this.interactionPaused();
      this.autoplayPaused();
      this.motionPreference.reduced();
      this.scheduleAutoplay();
    });

    if (this.isBrowser) {
      this.document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    this.destroyRef.onDestroy(() => {
      clearTimeout(this.autoplayTimer);
      this.document.removeEventListener('visibilitychange', this.onVisibilityChange);
    });
  }

  protected copy(ka: string, en: string): string {
    return this.language.language() === 'en' ? en : ka;
  }

  protected text(value: LocalizedText): string {
    return value[this.language.language()];
  }

  protected previous(): void {
    this.activeIndex.update((index) => (index - 1 + this.slides.length) % this.slides.length);
  }

  protected next(): void {
    this.activeIndex.update((index) => (index + 1) % this.slides.length);
  }

  protected select(index: number): void {
    this.activeIndex.set(index);
  }

  protected toggleAutoplay(): void {
    const shouldPause = !this.autoplayPaused();
    this.autoplayPaused.set(shouldPause);
    if (!shouldPause) {
      // An explicit play action takes precedence over the temporary focus/hover pause.
      this.interactionPaused.set(false);
    }
  }

  protected setInteractionPaused(value: boolean): void {
    this.interactionPaused.set(value);
  }

  protected onFocusOut(event: FocusEvent): void {
    const region = event.currentTarget as HTMLElement;
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !region.contains(nextTarget)) {
      this.interactionPaused.set(false);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.previous();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.next();
    }
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      return;
    }
    this.pointerStartX = event.clientX;
    this.interactionPaused.set(true);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (event.pointerType === 'mouse' || this.pointerStartX === undefined) {
      return;
    }

    const distance = event.clientX - this.pointerStartX;
    if (Math.abs(distance) > 42) {
      event.preventDefault();
      if (distance > 0) {
        this.previous();
      } else {
        this.next();
      }
    }
    this.pointerStartX = undefined;
    this.interactionPaused.set(false);
  }

  protected onPointerCancel(): void {
    this.pointerStartX = undefined;
    this.interactionPaused.set(false);
  }

  private scheduleAutoplay(): void {
    clearTimeout(this.autoplayTimer);
    if (
      !this.isBrowser ||
      this.document.hidden ||
      this.interactionPaused() ||
      this.autoplayPaused() ||
      this.motionPreference.reduced()
    ) {
      return;
    }
    this.autoplayTimer = setTimeout(() => this.next(), AUTOPLAY_DELAY_MS);
  }

  private readonly onVisibilityChange = (): void => {
    this.scheduleAutoplay();
  };
}
