import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, inject, signal } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterOutlet,
} from '@angular/router';

import { ClimateService } from '@core/services/climate.service';
import { MotionPreferenceService } from '@core/services/motion-preference.service';
import { ClimateBackdrop } from './layout/climate-backdrop/climate-backdrop';
import { Footer } from './layout/footer/footer';
import { Header } from './layout/header/header';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Header, Footer, ClimateBackdrop],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly motionPreference = inject(MotionPreferenceService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly routeTransitionActive = signal(false);
  protected readonly testHomeActive = signal(false);
  protected readonly homeActive = signal(false);
  // Eagerly instantiate so the climate theme class is applied on <html> at bootstrap.
  private readonly climate = inject(ClimateService);

  constructor() {
    // A9 (spec 07): router-level 200 ms fade-through-dark via a plain overlay
    // div — no Angular animations API. Reduced motion → no transition at all.
    const router = inject(Router);
    let currentPath = this.routePath(router.url);
    this.testHomeActive.set(currentPath === '/testhome');
    this.homeActive.set(currentPath === '/');
    router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        // Catalog filters and legal-page anchors only change query/fragment state.
        // Treating those as page changes caused a full-screen flash that looked
        // like a refresh, so the overlay is reserved for an actual route change.
        this.routeTransitionActive.set(
          this.isBrowser &&
            !this.motionPreference.reduced() &&
            this.routePath(event.url) !== currentPath,
        );
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        if (event instanceof NavigationEnd) {
          currentPath = this.routePath(event.urlAfterRedirects);
          this.testHomeActive.set(currentPath === '/testhome');
          this.homeActive.set(currentPath === '/');
        }
        this.routeTransitionActive.set(false);
      }
    });
  }

  private routePath(url: string): string {
    return url.split(/[?#]/, 1)[0] || '/';
  }
}
