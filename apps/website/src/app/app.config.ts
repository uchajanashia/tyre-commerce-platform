import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withFetch } from '@angular/common/http';
import localeKa from '@angular/common/locales/ka';
import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';

import { routes } from './app.routes';
import { FitmentDataService } from '@core/services/fitment-data.service';
import { HttpFitmentDataService } from '@core/services/http-fitment-data.service';
import { TyreTitleStrategy } from '@core/tyre-title.strategy';

registerLocaleData(localeKa);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
    ),
    provideClientHydration(withEventReplay()),
    // SSR-safe HttpClient (fetch backend) for the real API.
    provideHttpClient(withFetch()),
    {
      provide: FitmentDataService,
      useClass: HttpFitmentDataService,
    },
    { provide: TitleStrategy, useClass: TyreTitleStrategy },
    { provide: LOCALE_ID, useValue: 'ka' },
  ],
};
