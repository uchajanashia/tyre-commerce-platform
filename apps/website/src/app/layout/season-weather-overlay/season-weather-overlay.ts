import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  PLATFORM_ID,
  afterNextRender,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';

import { ClimateService } from '@core/services/climate.service';
import { MotionPreferenceService } from '@core/services/motion-preference.service';

/** Routes that went light in spec 06 (Light Seasonal Commerce). Mounted once
 *  at the app shell (like app-climate-backdrop) rather than per-page — a
 *  page-local mount hit an Angular hydration edge case on the product route
 *  (any element placed as an early sibling of an @if/@else chain there was
 *  silently dropped after the client takeover, even a plain hardcoded div
 *  with no Angular binding at all — reproducible, but the shell-level mount
 *  sidesteps it entirely, the same way the dark backdrop already does). */
const LIGHT_ROUTE_PREFIXES = ['/catalog', '/tire/', '/cart', '/season', '/checkout', '/order/'];

/**
 * Foreground weather for LIGHT Seasonal Commerce pages (spec 06). `app-climate-
 * backdrop` still owns the atmosphere behind dark cinematic moments (hero,
 * vehicle scene) — but it sits at z-index 0, fully hidden underneath a light
 * page's own opaque canvas, so its light-on-dark particle colors (near-white
 * snow, pale rain) never reach a white/ivory/ice/sage background at all.
 *
 * This is a SEPARATE, self-contained overlay a light page drops into its own
 * (position: relative) root: dark-on-light particles drawn IN FRONT of the
 * page (pointer-events: none, modest density/opacity) so the season stays
 * physically present even once the canvas underneath it turned light.
 *
 * - summer: an actual drawn sun (disc + soft rays) in the corner, plus a few
 *   warm embers drifting past it;
 * - winter: six-armed snowflakes (not dots), ice blue;
 * - all-season: rain streaks plus expanding "raindrop on glass" ripple rings.
 *
 * `position: fixed` to the VIEWPORT (not the host page's full scrollable
 * height, which for a long catalog page can be several screens tall) — so the
 * sun stays put in a corner and particles recycle within what's actually on
 * screen, however far the page scrolls. Being an ordinary child of the page
 * component still means it mounts/unmounts with that page (no global
 * route-awareness needed), it just visually escapes to the viewport via
 * `position: fixed` the same way `app-climate-backdrop` does.
 *
 * No season selected → renders nothing. Honors reduced motion (static, no
 * canvas engine), is SSR-safe, and pauses when the tab is hidden.
 */
type Scene = 'frost' | 'radiant' | 'temperate' | null;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  depth: number;
  phase: number;
  kind: 'snow' | 'rain' | 'ember';
}

interface Ripple {
  x: number;
  y: number;
  age: number;
  life: number;
}

const DENSITY: Record<Exclude<Scene, null>, { area: number; cap: number }> = {
  frost: { area: 14000, cap: 90 },
  radiant: { area: 26000, cap: 40 },
  temperate: { area: 15000, cap: 90 },
};

/** Season key → the scene this overlay draws (mirrors ClimateService.animationProfile,
 *  minus the neutral "studio" profile — no weather when no season is chosen). */
const SCENE_BY_SEASON: Record<'summer' | 'winter' | 'all-season', Scene> = {
  summer: 'radiant',
  winter: 'frost',
  'all-season': 'temperate',
};

@Component({
  selector: 'app-season-weather-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `<canvas #field class="weather"></canvas>`,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 5;
      display: block;
      overflow: hidden;
      pointer-events: none;
    }

    .weather {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class SeasonWeatherOverlay {
  private readonly climate = inject(ClimateService);
  private readonly motionPreference = inject(MotionPreferenceService);
  private readonly zone = inject(NgZone);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly router = inject(Router);
  private readonly field = viewChild.required<ElementRef<HTMLCanvasElement>>('field');

  private readonly onLightRoute = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => LIGHT_ROUTE_PREFIXES.some((p) => e.urlAfterRedirects.startsWith(p))),
      startWith(LIGHT_ROUTE_PREFIXES.some((p) => this.router.url.startsWith(p))),
    ),
    { initialValue: LIGHT_ROUTE_PREFIXES.some((p) => this.router.url.startsWith(p)) },
  );

  private ctx: CanvasRenderingContext2D | null = null;
  private scene: Scene = null;
  private particles: Particle[] = [];
  private ripples: Ripple[] = [];
  private rafId = 0;
  private lastT = 0;
  private elapsed = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private ready = false;

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      const season = this.climate.season();
      const scene: Scene =
        this.motionPreference.reduced() || !season || !this.onLightRoute()
          ? null
          : SCENE_BY_SEASON[season];
      if (this.isBrowser) {
        this.zone.runOutsideAngular(() => this.setScene(scene));
      }
    });

    afterNextRender(() => {
      const canvas = this.field().nativeElement;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.ready = true;
      this.zone.runOutsideAngular(() => {
        this.resize();
        window.addEventListener('resize', this.onResize, { passive: true });
        document.addEventListener('visibilitychange', this.onVisibility);
        this.setScene(this.scene, true);
      });
    });

    destroyRef.onDestroy(() => {
      this.stopLoop();
      if (this.isBrowser) {
        window.removeEventListener('resize', this.onResize);
        document.removeEventListener('visibilitychange', this.onVisibility);
      }
    });
  }

  private readonly onResize = (): void => this.resize();

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      this.stopLoop();
    } else if (this.scene) {
      this.startLoop();
    }
  };

  /** Sized to the VIEWPORT (fixed positioning), not the host page's full
   *  scrollable height. */
  private resize(): void {
    const canvas = this.field().nativeElement;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    canvas.width = Math.round(this.w * this.dpr);
    canvas.height = Math.round(this.h * this.dpr);
    this.ctx?.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private setScene(scene: Scene, keep = false): void {
    if (!keep && scene === this.scene) {
      return;
    }
    this.scene = scene;
    if (!this.ready) {
      return;
    }
    this.particles = [];
    this.ripples = [];
    if (!scene) {
      this.stopLoop();
      this.ctx?.clearRect(0, 0, this.w, this.h);
      return;
    }
    const { area, cap } = DENSITY[scene];
    const count = Math.min(cap, Math.round((this.w * this.h) / area));
    for (let i = 0; i < count; i++) {
      this.particles.push(this.spawn(scene, true));
    }
    this.startLoop();
  }

  private spawn(scene: Exclude<Scene, null>, seed = false): Particle {
    const depth = Math.random();
    const base = {
      x: Math.random() * this.w,
      y: seed ? Math.random() * this.h : -12,
      vx: 0,
      vy: 0,
      r: 1,
      a: 0.5,
      depth,
      phase: Math.random() * Math.PI * 2,
    };
    switch (scene) {
      case 'frost':
        return { ...base, kind: 'snow', r: 4 + depth * 5, vy: 14 + depth * 34, a: 0.35 + depth * 0.45 };
      case 'temperate':
        return {
          ...base,
          kind: 'rain',
          r: 0.9 + depth * 1.1,
          vx: -(40 + depth * 60),
          vy: 380 + depth * 360,
          a: 0.22 + depth * 0.3,
        };
      case 'radiant':
        return {
          ...base,
          kind: 'ember',
          y: seed ? Math.random() * this.h : this.h + 8,
          r: 1 + depth * 2.2,
          vy: -(5 + depth * 14),
          vx: 3 + depth * 6,
          a: 0.3 + depth * 0.4,
        };
    }
  }

  private startLoop(): void {
    if (this.rafId || !this.ctx) {
      return;
    }
    this.lastT = performance.now();
    const tick = (t: number): void => {
      this.rafId = requestAnimationFrame(tick);
      const dt = Math.min((t - this.lastT) / 1000, 0.05);
      this.lastT = t;
      this.step(dt);
      this.draw();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private step(dt: number): void {
    const scene = this.scene;
    if (!scene) {
      return;
    }
    this.elapsed += dt;
    const wind = Math.sin(this.elapsed * 0.13) * 10 + Math.sin(this.elapsed * 0.047) * 6;

    const next: Particle[] = [];
    for (const p of this.particles) {
      p.phase += dt;
      switch (p.kind) {
        case 'snow':
          p.x += (wind * (0.3 + p.depth) + Math.sin(p.phase * 1.6) * 12 * p.depth) * dt;
          p.y += p.vy * dt;
          break;
        case 'rain':
          p.x += (p.vx + wind * 0.5) * dt;
          p.y += p.vy * dt;
          break;
        case 'ember':
          p.x += (Math.sin(p.phase * 0.6) * 9 * p.depth + p.vx * 0.3) * dt;
          p.y += p.vy * dt;
          break;
      }
      const gone = p.y > this.h + 16 || p.y < -24 || p.x < -30 || p.x > this.w + 30;
      if (!gone) {
        next.push(p);
        continue;
      }
      if (p.kind === 'rain' && p.y > this.h * 0.55 && Math.random() < 0.4) {
        this.ripples.push({ x: p.x, y: Math.min(p.y, this.h - 2), age: 0, life: 0.9 + Math.random() * 0.5 });
      }
      next.push(this.spawn(scene));
    }
    this.particles = next;

    this.ripples = this.ripples.filter((r) => {
      r.age += dt;
      return r.age < r.life;
    });
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx || !this.scene) {
      return;
    }
    ctx.clearRect(0, 0, this.w, this.h);

    if (this.scene === 'radiant') {
      this.drawSun(ctx);
    }

    for (const p of this.particles) {
      switch (p.kind) {
        case 'snow':
          this.drawSnowflake(ctx, p);
          break;
        case 'rain':
          ctx.strokeStyle = `rgba(30, 95, 140, ${p.a})`;
          ctx.lineWidth = p.r;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
          ctx.stroke();
          break;
        case 'ember': {
          const flicker = 0.65 + Math.sin(p.phase * 2.1) * 0.35;
          ctx.fillStyle = `rgba(196, 82, 22, ${p.a * flicker})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    }

    if (this.scene === 'temperate') {
      for (const r of this.ripples) {
        const t = r.age / r.life;
        ctx.strokeStyle = `rgba(28, 112, 69, ${0.28 * (1 - t)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 4 + t * 22, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** A simple six-armed asterisk flake — reads as "snow", not "dots". */
  private drawSnowflake(ctx: CanvasRenderingContext2D, p: Particle): void {
    const tw = 1 - Math.max(0, Math.sin(p.phase * 2.2)) * 0.2 * p.depth;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.phase * 0.4);
    ctx.strokeStyle = `rgba(22, 119, 200, ${p.a * tw})`;
    ctx.lineWidth = Math.max(0.8, p.r * 0.22);
    ctx.lineCap = 'round';
    for (let arm = 0; arm < 3; arm++) {
      ctx.save();
      ctx.rotate((Math.PI / 3) * arm);
      ctx.beginPath();
      ctx.moveTo(-p.r, 0);
      ctx.lineTo(p.r, 0);
      // Short side branches, like a real flake's crystal arms.
      ctx.moveTo(p.r * 0.4, 0);
      ctx.lineTo(p.r * 0.7, p.r * 0.3);
      ctx.moveTo(p.r * 0.4, 0);
      ctx.lineTo(p.r * 0.7, -p.r * 0.3);
      ctx.moveTo(-p.r * 0.4, 0);
      ctx.lineTo(-p.r * 0.7, p.r * 0.3);
      ctx.moveTo(-p.r * 0.4, 0);
      ctx.lineTo(-p.r * 0.7, -p.r * 0.3);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /** A drawn sun disc + soft rays, fixed near the top corner of the viewport. */
  private drawSun(ctx: CanvasRenderingContext2D): void {
    const cx = this.w * 0.9;
    const cy = this.h * 0.12;
    const r = Math.min(this.w, this.h) * 0.04 + 18;

    const rayCount = 10;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.elapsed * 0.03);
    ctx.strokeStyle = 'rgba(216, 90, 11, 0.22)';
    ctx.lineWidth = Math.max(2, r * 0.05);
    ctx.lineCap = 'round';
    for (let i = 0; i < rayCount; i++) {
      const a = (Math.PI * 2 * i) / rayCount;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25);
      ctx.lineTo(Math.cos(a) * r * 1.85, Math.sin(a) * r * 1.85);
      ctx.stroke();
    }
    ctx.restore();

    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.6);
    glow.addColorStop(0, 'rgba(255, 170, 60, 0.35)');
    glow.addColorStop(1, 'rgba(255, 170, 60, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
    ctx.fill();

    const body = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.1, cx, cy, r);
    body.addColorStop(0, '#ffd27a');
    body.addColorStop(1, '#d85a0b');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
