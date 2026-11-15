import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { catchError, map, of } from 'rxjs';

import { environment } from '../../../environments/environment';

/** Prevent direct checkout/order URLs from bypassing the pre-bank disabled CTA. */
export const checkoutEnabledGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(HttpClient)
    .get<{ enabled: boolean }>(`${environment.apiBaseUrl}/checkout/config`)
    .pipe(
      map((config) => (config.enabled ? true : router.createUrlTree(['/cart']))),
      catchError(() => of(router.createUrlTree(['/cart']))),
    );
};
