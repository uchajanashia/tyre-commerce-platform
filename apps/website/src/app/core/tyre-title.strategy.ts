import { Injectable, inject } from '@angular/core';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { SeoService } from './services/seo.service';

/** Per-route titles suffixed with the brand (spec 06/08). */
@Injectable({ providedIn: 'root' })
export class TyreTitleStrategy extends TitleStrategy {
  private readonly seo = inject(SeoService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const routeTitle = this.buildTitle(snapshot);
    const title = routeTitle || 'tyre.ge';
    this.seo.setRouteDefaults(title, snapshot.url);
  }
}
