const SEASON_SCROLL_DURATION_MS = 1050;
const MOBILE_HEADER_HEIGHT_PX = 68;

/** A deliberate, time-controlled scroll used by the seasonal navigation. */
export function smoothScrollToElement(
  ownerDocument: Document,
  target: HTMLElement,
  durationMs = SEASON_SCROLL_DURATION_MS,
): void {
  const view = ownerDocument.defaultView;
  if (!view) {
    return;
  }

  const offset = view.matchMedia('(max-width: 1023px)').matches ? MOBILE_HEADER_HEIGHT_PX : 0;
  const start = view.scrollY;
  const destination = Math.max(0, start + target.getBoundingClientRect().top - offset);
  const distance = destination - start;

  if (Math.abs(distance) < 2 || view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    view.scrollTo(0, destination);
    return;
  }

  const startedAt = view.performance.now();
  const frame = (now: number): void => {
    const progress = Math.min((now - startedAt) / durationMs, 1);
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    view.scrollTo(0, start + distance * eased);

    if (progress < 1) {
      view.requestAnimationFrame(frame);
    }
  };

  view.requestAnimationFrame(frame);
}
