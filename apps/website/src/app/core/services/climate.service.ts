import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, Signal, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, of, startWith } from 'rxjs';

import { Season } from '../models';
import { StorageService } from './storage.service';

// Unified storage prefix (spec: reconcile auren.* / wheelz.* / tyre.ge.*).
const NAV_SEASON_KEY = 'tyre.ge.season.nav'; // the nav chooser's explicit pick
const EFFECTIVE_SEASON_KEY = 'tyre.ge.season'; // the current effective theme (first-paint continuity)
const LEGACY_SEASON_KEY = 'auren.climate.season'; // migrated on first run
const ALL_CLASSES = ['climate-summer', 'climate-winter', 'climate-all-season'];

/**
 * Animation profile derived from the season. Effects/animations subscribe to
 * THIS, never to `season()` directly, so future seasonal motion can branch on a
 * richer profile without touching every caller (spec: one authoritative signal).
 */
export type AnimationProfile = 'radiant' | 'frost' | 'temperate';

const SEASON_TO_PROFILE: Record<Season, AnimationProfile> = {
  summer: 'radiant',
  winter: 'frost',
  'all-season': 'temperate',
};

/**
 * The single source of truth for the season MOOD axis (spec: reconciliation).
 * Season is a mood (color + animation), NEVER a filter. Name kept as
 * `ClimateService` for import stability; think of it as the SeasonService.
 *
 * Two inputs may set it, last-write-wins, both persisted:
 *   (a) the nav season chooser  → `setSeason()`  (explicit, 3 values)
 *   (b) the catalog's FIRST-selected category → `setCategoryTheme()` via the
 *       category→theme mapping. While ≥1 category is selected it overrides the
 *       nav pick; clearing it falls back to the last nav choice (stored value).
 *
 * `null` season = the neutral studio base before anything is chosen (preserved
 * from the original design — themeClass '' and the header's "ყველა").
 */
@Injectable({ providedIn: 'root' })
export class ClimateService {
  private readonly storage = inject(StorageService);
  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** The nav chooser's explicit pick (persisted); the fallback when no category drives the theme. */
  private readonly navSeason = signal<Season | null>(this.readInitialNavSeason());
  /** Transient override from the catalog's first-selected category (source of truth: the URL). */
  private readonly categoryTheme = signal<Season | null>(null);
  /** Five-second homepage illumination; never persisted as the catalog selection. */
  private readonly previewTheme = signal<Season | null>(null);
  private previewTimer?: ReturnType<typeof setTimeout>;

  private readonly routeUrl = toSignal(
    this.router.events?.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ) ?? of(this.router.url || '/'),
    { initialValue: this.router.url },
  );

  /** Last committed choice, used when opening the catalog. */
  readonly selectedSeason = this.navSeason.asReadonly();
  readonly previewSeason = this.previewTheme.asReadonly();
  readonly previewing = computed(() => this.previewTheme() !== null);

  /**
   * The homepage is neutral except during a short preview. Catalog and other
   * commerce routes retain the committed/category theme until it changes.
   */
  readonly season: Signal<Season | null> = computed(() => {
    const preview = this.previewTheme();
    if (preview) {
      return preview;
    }
    const path = this.routeUrl().split(/[?#]/, 1)[0] || '/';
    return path === '/' ? null : (this.categoryTheme() ?? this.navSeason());
  });
  readonly hasSeason = computed(() => this.season() !== null);

  /** Derived motion profile — animations subscribe here, not to `season()`. */
  readonly animationProfile = computed<AnimationProfile>(() => {
    const s = this.season();
    return s ? SEASON_TO_PROFILE[s] : 'temperate';
  });

  /** The theme class for the active climate, or '' in the neutral base. */
  readonly themeClass: Signal<string> = computed(() => {
    const s = this.season();
    return s ? `climate-${s}` : '';
  });

  constructor() {
    // Migrate legacy season key to the unified prefix (one-time, browser-only).
    this.storage.migrate(LEGACY_SEASON_KEY, NAV_SEASON_KEY);

    // Apply the climate class on <html> so every surface inherits the retint,
    // and persist the effective season for correct first paint on reload.
    effect(() => {
      const season = this.season();
      if (season) {
        this.storage.set(EFFECTIVE_SEASON_KEY, season);
      } else {
        this.storage.remove(EFFECTIVE_SEASON_KEY);
      }
      if (!this.isBrowser) {
        return;
      }
      const root = this.doc.documentElement;
      root.classList.remove(...ALL_CLASSES);
      const cls = this.themeClass();
      if (cls) {
        root.classList.add(cls);
      }
    });
  }

  /** Input (a): the nav season chooser. Explicit pick wins immediately (clears any
   *  category override) and persists as the fallback. */
  setSeason(season: Season): void {
    this.navSeason.set(season);
    this.categoryTheme.set(null);
    this.storage.set(NAV_SEASON_KEY, season);
  }

  /** Temporary homepage mood. The committed catalog choice is untouched. */
  preview(season: Season, durationMs = 5000): void {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
    }
    this.previewTheme.set(season);
    this.previewTimer = setTimeout(() => {
      this.previewTheme.set(null);
      this.previewTimer = undefined;
    }, durationMs);
  }

  /** Input (b): the catalog's first-selected category → theme (spec Part B). Pass
   *  `null` when no category is selected to fall back to the last nav choice. */
  setCategoryTheme(theme: Season | null): void {
    this.categoryTheme.set(theme);
  }

  clear(): void {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = undefined;
    }
    this.previewTheme.set(null);
    this.navSeason.set(null);
    this.categoryTheme.set(null);
    this.storage.remove(NAV_SEASON_KEY);
    this.storage.remove(EFFECTIVE_SEASON_KEY);
  }

  /** Prefer the nav pick; fall back to the last effective season (either input). */
  private readInitialNavSeason(): Season | null {
    return (
      this.storage.get<Season>(NAV_SEASON_KEY) ?? this.storage.get<Season>(EFFECTIVE_SEASON_KEY)
    );
  }
}
