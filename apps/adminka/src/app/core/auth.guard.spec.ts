import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { firstValueFrom, of } from 'rxjs';

import { authGuard, governanceFeatureGuard, permissionGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { GOVERNANCE_FEATURE_CONFIG } from './governance-flags';

describe('identity route guards', () => {
  let authenticated = false;
  let permissions: string[] = [];
  let exactPermissions: string[] = [];

  beforeEach(() => {
    authenticated = false;
    permissions = [];
    exactPermissions = [];
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            ensureAuthenticated: () => of(authenticated),
            hasPermission: (permission: string) => permissions.includes(permission),
            hasExactPermission: (permission: string) => exactPermissions.includes(permission),
          },
        },
        {
          provide: GOVERNANCE_FEATURE_CONFIG,
          useValue: {
            apiBaseUrl: '/admin/v1',
            approvalsEnabled: false,
            auditReaderEnabled: false,
            jobsReaderEnabled: false,
          },
        },
      ],
    });
  });

  it('waits for cookie-session restoration before allowing navigation', async () => {
    authenticated = true;
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url: '/security' } as RouterStateSnapshot),
    );
    await expect(firstValueFrom(result as never)).resolves.toBe(true);
  });

  it('preserves the intended URL when restoration fails', async () => {
    const router = TestBed.inject(Router);
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url: '/security' } as RouterStateSnapshot),
    );
    const tree = (await firstValueFrom(result as never)) as UrlTree;
    expect(router.serializeUrl(tree)).toBe('/login?returnUrl=%2Fsecurity');
  });

  it('denies staff workspace without staff.read', () => {
    const router = TestBed.inject(Router);
    const route = { data: { permission: 'staff.read' } } as unknown as ActivatedRouteSnapshot;
    const denied = TestBed.runInInjectionContext(() =>
      permissionGuard(route, {} as RouterStateSnapshot),
    ) as UrlTree;
    expect(router.serializeUrl(denied)).toBe('/');
    permissions = ['staff.read'];
    expect(
      TestBed.runInInjectionContext(() => permissionGuard(route, {} as RouterStateSnapshot)),
    ).toBe(true);
  });

  it('requires a literal audit.read grant when the route opts into exact permission checks', () => {
    const router = TestBed.inject(Router);
    permissions = ['audit.read'];
    const route = {
      data: { permission: 'audit.read', exactPermission: true },
    } as unknown as ActivatedRouteSnapshot;
    const denied = TestBed.runInInjectionContext(() =>
      permissionGuard(route, {} as RouterStateSnapshot),
    ) as UrlTree;
    expect(router.serializeUrl(denied)).toBe('/');
    exactPermissions = ['audit.read'];
    expect(
      TestBed.runInInjectionContext(() => permissionGuard(route, {} as RouterStateSnapshot)),
    ).toBe(true);
  });

  it('denies wildcard-only access to an exact jobs.read route', () => {
    const router = TestBed.inject(Router);
    permissions = ['jobs.read'];
    const route = {
      data: { permission: 'jobs.read', exactPermission: true },
    } as unknown as ActivatedRouteSnapshot;
    const denied = TestBed.runInInjectionContext(() =>
      permissionGuard(route, {} as RouterStateSnapshot),
    ) as UrlTree;
    expect(router.serializeUrl(denied)).toBe('/');
    exactPermissions = ['jobs.read'];
    expect(
      TestBed.runInInjectionContext(() => permissionGuard(route, {} as RouterStateSnapshot)),
    ).toBe(true);
  });

  it('fails closed on direct governance URLs while rollout flags are false', () => {
    const router = TestBed.inject(Router);
    for (const governanceFeature of ['approvals', 'audit', 'jobs']) {
      const route = { data: { governanceFeature } } as unknown as ActivatedRouteSnapshot;
      const result = TestBed.runInInjectionContext(() =>
        governanceFeatureGuard(route, {} as RouterStateSnapshot),
      ) as UrlTree;
      expect(router.serializeUrl(result)).toBe('/');
    }
  });
});
