import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import { checkoutEnabledGuard } from './checkout-enabled.guard';

describe('checkoutEnabledGuard', () => {
  for (const enabled of [false, true])
    it(`uses server checkout switch: ${enabled}`, async () => {
      TestBed.configureTestingModule({
        providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      });
      const pending = firstValueFrom(
        TestBed.runInInjectionContext(() =>
          checkoutEnabledGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
        ) as Observable<boolean | UrlTree>,
      );
      TestBed.inject(HttpTestingController)
        .expectOne((r) => r.url.endsWith('/checkout/config'))
        .flush({ enabled });
      const result = await pending;
      if (enabled) expect(result).toBe(true);
      else expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/cart');
      TestBed.inject(HttpTestingController).verify();
    });
});
