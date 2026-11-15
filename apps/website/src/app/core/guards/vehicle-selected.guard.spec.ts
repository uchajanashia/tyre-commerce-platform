import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';

import { GarageService } from '../services/garage.service';
import { vehicleSelectedGuard } from './vehicle-selected.guard';

describe('vehicleSelectedGuard', () => {
  function runGuard(): boolean | UrlTree {
    return TestBed.runInInjectionContext(() =>
      vehicleSelectedGuard(
        {
          queryParamMap: { get: () => null },
        } as unknown as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot,
      ),
    ) as boolean | UrlTree;
  }

  it('allows SSR so the browser can restore a persisted vehicle after hydration', () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: GarageService, useValue: { hasVehicle: () => false } },
      ],
    });

    expect(runGuard()).toBe(true);
  });

  it('still redirects an empty browser garage', () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: GarageService, useValue: { hasVehicle: () => false } },
      ],
    });
    const router = TestBed.inject(Router);

    expect(router.serializeUrl(runGuard() as UrlTree)).toBe('/garage');
  });
});
