import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';

import { Season, Tire, TYRE_CATEGORY_BY_KEY, TyreCategory, TyreCategoryDef } from '@core/models';
import { LanguageService } from '@core/i18n/language.service';
import {
  anchorMatchesRole,
  fallbackWindowStyle,
  resolveVehicleScene,
  scenePercent,
} from '@core/services/vehicle-scene-resolver';
import { VEHICLE_SCENE_CANVAS } from '@core/content/vehicle-scenes.data';
import { getPassengerVehicleAnchors } from '@core/content/passenger-vehicle-images';
import {
  classifyVehicle,
  getVehicleImageFallbackChain,
  hasDirectPassengerVehicleAsset,
  isPassengerVehicleClassification,
  VehicleClassificationResult,
} from '@core/services/vehicle-classification';
import { PhotoLightbox } from '@shared/components/photo-lightbox/photo-lightbox';
import { SeasonSymbol } from '@shared/components/season-symbol/season-symbol';

/** Tires without a marketing category (mock fixtures) still need an ambient
 *  color: base season → the nearest of the 7 category defs. Drives the AMBIENT
 *  only — the badge stays hidden unless a real category is passed in, so we
 *  never show a category label the data doesn't actually claim. */
const AMBIENT_BY_SEASON: Record<Season, TyreCategory> = {
  summer: 'summer',
  winter: 'winter_at',
  'all-season': 'all_season',
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

/**
 * Tire-detail hero (the visual column of the detail page). Two stacked panels,
 * with the vehicle scene dominant and first, then the real product gallery:
 *
 *  - `.hero__scene` — the PRIMARY visual: one of the 9 production vehicle
 *    scenes (or the neutral wheel studio for disks) from /vehicle-assets,
 *    chosen per product via `resolveVehicleScene` — a VISUAL application
 *    class only, never a fitment claim (spec 07-product-media-vehicles.md).
 *  - `.hero__photo` — a smaller supporting panel below it: the model's real
 *    studio shot on a white bed (studio shots are white/transparent — a dark
 *    tire on a dark card would vanish), with a thumbnail rail when there's
 *    more than one photo. Click any photo → PhotoLightbox at that index.
 *
 * Compositing contract for the scene (every anchor renders EXACTLY one of
 * the two wheel layers below — never both, which used to double-render a
 * generic wheel behind/around the product photo at the same spot, a "tire on
 * tire" glitch — all sharing the fixed-aspect-ratio canvas in
 * `VEHICLE_SCENE_CANVAS`, see vehicle-assets/manifest.json), bottom → top:
 *  1. `shadowUrl` — static contact shadow;
 *  2. per anchor: this model's own tire/disc photo (SPINNING — the one real,
 *     active tire) where its axle role matches (`anchorMatchesRole`); every
 *     other anchor gets a STATIC circular crop of `fallbackUrl` at that same
 *     anchor's position (`fallbackWindowStyle`) — the generic stand-in, never
 *     the full fallback canvas;
 *  3. `bodyUrl` — the vehicle silhouette; its wheel-arch openings are real
 *     alpha holes, so whatever was drawn in step 2 shows through;
 *  4. `occlusionUrl` — fender/arch pixels that must sit in front of the wheel.
 *
 * All motion is pure CSS keyframes (zero JS timers) and fully disabled under
 * prefers-reduced-motion.
 */
@Component({
  selector: 'app-hero-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PhotoLightbox, SeasonSymbol],
  host: { '[style.--cat]': 'ambientColor()' },
  templateUrl: './hero-scene.html',
  styleUrl: './hero-scene.scss',
})
export class HeroScene {
  private readonly language = inject(LanguageService);

  readonly tire = input.required<Tire>();
  /** Category def for the badge + exact ambient color; null (mock fixtures
   *  without a category) → season-derived ambient color, badge hidden. */
  readonly category = input<TyreCategoryDef | null>(null);

  protected readonly isDisk = computed(
    () => this.tire().productType === 'disk' || this.tire().catalogClass === 'disk',
  );

  protected readonly sceneLabel = computed(() =>
    this.isDisk()
      ? this.copy(
          'დისკის ვიზუალური მაგალითი — თავსებადობას არ ადასტურებს',
          'Wheel visualization — does not confirm compatibility',
        )
      : this.copy(
          'ვიზუალური მაგალითი — ავტომობილთან თავსებადობას არ ადასტურებს',
          'Vehicle visualization — does not confirm compatibility',
        ),
  );

  protected readonly canvasWidth = VEHICLE_SCENE_CANVAS.width;
  protected readonly canvasHeight = VEHICLE_SCENE_CANVAS.height;
  protected readonly pct = scenePercent;
  protected readonly sceneSizes =
    '(min-width: 1440px) 840px, (min-width: 1024px) 58vw, calc(100vw - 32px)';

  /** Which of the 9 vehicle scenes (or the neutral wheel studio) this product
   *  renders against — a visual application class only, never a fitment claim. */
  private readonly resolved = computed(() => resolveVehicleScene(this.tire()));
  protected readonly scene = computed(() => this.resolved().scene);

  /** A saved passenger visual uses the direct body image even on another tire
   * category. Other scenes remain in the scene renderer; disks stay neutral. */
  private readonly classifiedPassengerVehicle = computed<VehicleClassificationResult | null>(() => {
    const tire = this.tire();
    if (tire.catalogClass === 'disk') {
      return null;
    }
    if (tire.catalogClass && tire.catalogClass !== 'passenger' &&
        !isPassengerVehicleClassification(tire.vehicleClassification)) {
      return null;
    }
    const radius =
      /R-?\d+(?:\.\d+)?C?/i.exec(tire.size.raw ?? '')?.[0] ?? tire.size.rimDiameterInch;
    return classifyVehicle({
      width: tire.size.widthMm,
      profile: tire.size.aspect,
      radius,
      classification: tire.vehicleClassification,
    });
  });

  protected readonly passengerVehicle = computed(() => {
    const result = this.classifiedPassengerVehicle();
    return result && hasDirectPassengerVehicleAsset(result.primary) ? result : null;
  });

  protected readonly passengerImage = computed(() => {
    const result = this.passengerVehicle();
    return result
      ? [{ classification: result.primary, url: getVehicleImageFallbackChain(result.primary)[0]! }]
      : [];
  });

  protected onVehicleImageError(
    event: Event,
    classification: VehicleClassificationResult['primary'],
  ): void {
    const image = event.currentTarget as HTMLImageElement;
    const chain = getVehicleImageFallbackChain(classification);
    const current = Number(image.dataset['fallbackIndex'] ?? '0');
    const next = current + 1;
    if (next < chain.length) {
      image.dataset['fallbackIndex'] = String(next);
      // A stale responsive candidate takes precedence over `src` and can keep
      // retrying the failed asset after the fallback URL is assigned.
      image.removeAttribute('srcset');
      image.removeAttribute('sizes');
      image.src = chain[next]!;
      console.warn(`[vehicle-image] fallback ${next} for ${classification}: ${image.src}`);
      return;
    }
    image.removeAttribute('src');
    image.hidden = true;
    console.error(`[vehicle-image] final neutral placeholder failed for ${classification}`);
  }

  protected readonly passengerWheelSlots = computed(() => {
    const result = this.passengerVehicle();
    if (!result) {
      return [];
    }
    if (!hasDirectPassengerVehicleAsset(result.primary)) {
      return [];
    }
    const photo = this.photo();
    return getPassengerVehicleAnchors(result.primary).map((anchor) => ({ anchor, photo }));
  });

  /** Scene-backed classifications and all legacy catalog classes retain the
   * layered renderer. Passenger image classes use the direct body assets. */
  protected readonly showLegacyScene = computed(() => {
    const catalogClass = this.tire().catalogClass;
    return (
      catalogClass === 'truck' ||
      catalogClass === 'special' ||
      catalogClass === 'disk' ||
      (catalogClass === 'passenger' &&
        this.classifiedPassengerVehicle() !== null &&
        this.passengerVehicle() === null)
    );
  });

  /** The real above-fold scene owns image priority. The gallery only becomes
   * the LCP candidate when no vehicle renderer is available. */
  protected readonly hasVehicleScene = computed(
    () => this.passengerVehicle() !== null || this.showLegacyScene(),
  );

  /** One slot per anchor: EITHER this model's own (spinning) photo, when its
   *  axle role matches, OR a static per-anchor crop of the scene's generic
   *  fallback wheel — never both layered on the same spot (that used to
   *  double-render a generic wheel visible behind/around the product photo). */
  protected readonly wheelSlots = computed(() => {
    const { axleRole } = this.resolved();
    const scene = this.scene();
    const p = this.photo();
    return scene.anchors.map((anchor) => ({
      anchor,
      photo: p && anchorMatchesRole(anchor, axleRole) ? p : null,
      fallbackStyle: fallbackWindowStyle(anchor, this.canvasWidth, this.canvasHeight),
    }));
  });

  protected readonly ambientColor = computed(
    () =>
      (this.category() ?? TYRE_CATEGORY_BY_KEY.get(AMBIENT_BY_SEASON[this.tire().season])!)
        .categoryColor,
  );

  /** The model's SIDE photo: media.sidewallUrl is mapped from ordered
   *  photos[] ([1] = side, else [0]); empty photos[] → null → drawn rim. */
  protected readonly photo = computed(() => {
    const media = this.tire().media;
    return media.sidewallUrl || media.catalogUrl || null;
  });

  /** ALL model photos for the primary panel + lightbox, API order preserved;
   *  gallery when the mapper filled it, else whatever distinct URLs the media
   *  object carries. Empty → no photo panel at all (scene strip only). */
  protected readonly galleryPhotos = computed(() => {
    const media = this.tire().media;
    const list = media.gallery.length > 0 ? media.gallery : [media.catalogUrl, media.sidewallUrl];
    return [...new Set(list.filter((url) => url !== ''))];
  });

  /** Which photo the primary panel + lightbox are showing. */
  protected readonly activeIndex = signal(0);

  protected readonly lightboxOpen = signal(false);

  protected openPhoto(index: number): void {
    this.activeIndex.set(index);
    this.lightboxOpen.set(true);
  }

  protected photoLabel(index: number): string {
    return this.copy(
      `პროდუქტის ფოტო ${index + 1} — გადიდება`,
      `Product photo ${index + 1} — enlarge`,
    );
  }

  protected categoryLabel(category: TyreCategoryDef): string {
    return this.language.language() === 'en'
      ? EN_CATEGORY_LABELS[category.key]
      : category.badgeLabel;
  }

  protected responsiveSceneSrcset(url: string): string {
    const compactUrl = url.replace(/\.webp$/, '-1280.webp');
    return `${compactUrl} 1280w, ${url} 2400w`;
  }

  private copy(ka: string, en: string): string {
    return this.language.language() === 'en' ? en : ka;
  }

  constructor() {
    // A new tire (similar-tires rail swap) always restarts at its first photo.
    effect(() => {
      this.tire();
      this.activeIndex.set(0);
      this.lightboxOpen.set(false);
    });
  }
}
