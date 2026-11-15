import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, Signal, inject, signal } from '@angular/core';

/**
 * Lightweight global source of truth for `prefers-reduced-motion`.
 *
 * This intentionally has no animation-library dependency, so the eager layout
 * can honor the preference without pulling GSAP into the initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class MotionPreferenceService {
  private readonly reducedState = signal(false);
  readonly reduced: Signal<boolean> = this.reducedState.asReadonly();

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID)) || typeof window.matchMedia !== 'function') {
      return;
    }

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (event: MediaQueryListEvent | MediaQueryList): void =>
      this.reducedState.set(event.matches);

    update(query);
    query.addEventListener('change', update);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', update));
  }
}
