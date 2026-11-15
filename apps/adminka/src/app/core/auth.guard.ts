import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';

import { AuthService } from './auth.service';
import {
  GOVERNANCE_FEATURE_CONFIG,
  GovernanceFeature,
  isGovernanceFeatureEnabled,
} from './governance-flags';

/** Restores a refresh-cookie session once, then preserves the intended URL on failure. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth
    .ensureAuthenticated()
    .pipe(
      map((authenticated) =>
        authenticated
          ? true
          : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }),
      ),
    );
};

export const permissionGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const permission = route.data['permission'] as string;
  const granted = route.data['exactPermission']
    ? auth.hasExactPermission(permission)
    : auth.hasPermission(permission);
  return granted ? true : router.createUrlTree(['/']);
};

/** Build-time rollout gate. A direct URL cannot bypass a disabled governance surface. */
export const governanceFeatureGuard: CanActivateFn = (route) => {
  const config = inject(GOVERNANCE_FEATURE_CONFIG);
  const router = inject(Router);
  const feature = route.data['governanceFeature'] as GovernanceFeature;
  return isGovernanceFeatureEnabled(config, feature) ? true : router.createUrlTree(['/']);
};
