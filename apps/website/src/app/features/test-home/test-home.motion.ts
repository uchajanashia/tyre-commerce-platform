import type { DestroyRef } from '@angular/core';
import type { MotionService } from '@core/services/motion.service';

/** The AutoForge reference's staggered entrances, with native scrolling preserved. */
export function startTestHomeMotion(
  host: HTMLElement,
  motion: MotionService,
  destroyRef: DestroyRef,
): void {
  if (
    typeof window === 'undefined' ||
    typeof IntersectionObserver === 'undefined' ||
    motion.reduced()
  )
    return;

  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const select = (selector: string): HTMLElement[] =>
    Array.from(host.querySelectorAll<HTMLElement>(selector));
  const heroCopy = select('[data-hero-reveal]');
  const heroCar = select('[data-hero-car]');
  const heroBadge = select('[data-hero-badge]');
  const introMark = select('[data-intro-mark]');
  const introOverlay = select('[data-intro-overlay]');
  const introLogo = select('[data-intro-logo]');
  const reveals = select('[data-reveal]');
  const tireFeature = select('[data-tire-feature]');
  const depthLayers = select('[data-parallax]');
  const animated = [
    ...heroCopy,
    ...heroCar,
    ...heroBadge,
    ...introMark,
    ...introOverlay,
    ...introLogo,
    ...reveals,
    ...tireFeature,
  ];
  const timelines: ReturnType<MotionService['timeline']>[] = [];
  let active = true;
  let frame = 0;

  // CSS hover transitions must not lag behind each frame of a GSAP entrance.
  motion.set([...heroCopy, ...heroCar, ...heroBadge, ...introMark], { transition: 'none' });

  const intro = motion.timeline({ defaults: { ease: 'power3.out' } }, destroyRef);
  timelines.push(intro);
  const heroDelay = introOverlay.length && introLogo.length ? 0.6 : 0;
  if (introOverlay.length && introLogo.length) {
    motion.set(introOverlay, { display: 'grid', opacity: 1 });
    intro.fromTo(
      introLogo,
      { scale: 0.08, rotation: -60, opacity: 0 },
      { scale: 1.65, rotation: 20, opacity: 1, duration: 0.8, ease: 'power3.inOut' },
      0,
    );
    intro.to(introOverlay, { opacity: 0, duration: 0.36 }, 0.74);
    intro.set(introOverlay, { clearProps: 'display,opacity' }, 1.1);
    intro.set(introLogo, { clearProps: 'transform,opacity' }, 1.1);
  }
  if (introMark.length) {
    intro.fromTo(
      introMark,
      { opacity: 0, scale: 0.65, rotation: -95 },
      {
        opacity: 1,
        scale: 1,
        rotation: 0,
        duration: 0.85,
        clearProps: 'transform,opacity,transition',
      },
      heroDelay,
    );
  }
  if (heroCar.length) {
    intro.fromTo(
      heroCar,
      { opacity: 0, x: 90, scale: 0.94 },
      { opacity: 1, x: 0, scale: 1, duration: 1.2, clearProps: 'transform,opacity,transition' },
      0.16 + heroDelay,
    );
  }
  if (heroCopy.length) {
    intro.fromTo(
      heroCopy,
      { opacity: 0, y: 24 },
      {
        opacity: 1,
        y: 0,
        duration: 0.8,
        stagger: 0.14,
        clearProps: 'transform,opacity,transition',
      },
      0.28 + heroDelay,
    );
  }
  if (heroBadge.length) {
    intro.fromTo(
      heroBadge,
      { opacity: 0, y: 16, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.6, clearProps: 'transform,opacity,transition' },
      0.95 + heroDelay,
    );
  }

  // No hidden CSS state: the document stays fully readable without this enhancement.
  const observer = new IntersectionObserver(
    (entries) => {
      if (!active) return;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        observer.unobserve(element);
        const isTire = element.hasAttribute('data-tire-feature');
        const explicitDelay = element.getAttribute('data-reveal-delay');
        const isGroupItem = element.matches(
          '.category-card, .product-card, .grip-callout, .footer-top, .footer-bottom',
        );
        const siblings = isGroupItem
          ? Array.from(element.parentElement?.querySelectorAll(':scope > [data-reveal]') ?? [])
          : [];
        const stagger = Math.max(0, siblings.indexOf(element)) * 0.12;
        const delayValue = explicitDelay === null ? stagger : Number(explicitDelay);
        const delay = Number.isFinite(delayValue) ? Math.min(0.6, Math.max(0, delayValue)) : 0;
        const reveal = motion.timeline({}, destroyRef);
        timelines.push(reveal);
        reveal.to(element, {
          opacity: 1,
          y: 0,
          scale: 1,
          rotation: 0,
          duration: isTire ? 1.05 : 0.72,
          delay,
          ease: 'power3.out',
          clearProps: 'transform,opacity,transition',
        });
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -32px 0px' },
  );

  const observed = new WeakSet<HTMLElement>();
  const observeReveals = (): void => {
    if (!active) return;
    for (const element of select('[data-reveal], [data-tire-feature]')) {
      if (observed.has(element)) continue;
      observed.add(element);
      if (!animated.includes(element)) animated.push(element);
      const isTire = element.hasAttribute('data-tire-feature');
      motion.set(element, {
        opacity: 0,
        y: 30,
        transition: 'none',
        ...(isTire ? { scale: 0.86, rotation: -8 } : {}),
      });
      observer.observe(element);
    }
  };
  observeReveals();
  // Server-priced cards arrive after the initial document; register their entrances too.
  const contentObserver = new MutationObserver(observeReveals);
  contentObserver.observe(host, { childList: true, subtree: true });

  const updateDepth = (): void => {
    frame = 0;
    if (!active || window.innerWidth < 760) {
      for (const layer of depthLayers) layer.style.removeProperty('translate');
      return;
    }
    const viewport = window.innerHeight;
    for (const layer of depthLayers) {
      const rect = layer.getBoundingClientRect();
      if (rect.bottom < -100 || rect.top > viewport + 100) continue;
      const strength = Number(layer.getAttribute('data-parallax')) || 20;
      const progress = Math.max(
        -1,
        Math.min(1, (viewport / 2 - rect.top - rect.height / 2) / viewport),
      );
      layer.style.translate = `0 ${(-progress * strength).toFixed(2)}px`;
    }
  };
  const requestDepth = (): void => {
    if (active && !frame) frame = window.requestAnimationFrame(updateDepth);
  };
  window.addEventListener('scroll', requestDepth, { passive: true });
  window.addEventListener('resize', requestDepth, { passive: true });
  requestDepth();

  const stop = (): void => {
    if (!active) return;
    active = false;
    observer.disconnect();
    contentObserver.disconnect();
    for (const timeline of timelines) timeline.kill();
    if (frame) window.cancelAnimationFrame(frame);
    window.removeEventListener('scroll', requestDepth);
    window.removeEventListener('resize', requestDepth);
    reducedQuery.removeEventListener('change', onPreferenceChange);
    motion.set(animated, { clearProps: 'transform,opacity,visibility,transition' });
    motion.set(introOverlay, { clearProps: 'display' });
    for (const layer of depthLayers) layer.style.removeProperty('translate');
  };
  const onPreferenceChange = (event: MediaQueryListEvent): void => {
    if (event.matches) stop();
  };
  reducedQuery.addEventListener('change', onPreferenceChange);
  destroyRef.onDestroy(stop);
}
