import { registerLocaleData } from '@angular/common';
import localeKa from '@angular/common/locales/ka';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withHashLocation, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { FitmentDataService } from '@core/services/fitment-data.service';
import { DemoCatalog } from './demo/catalog.demo';
import { demoHttp } from './demo/demo-http';
registerLocaleData(localeKa);
export const appConfig:ApplicationConfig={providers:[
  provideBrowserGlobalErrorListeners(),
  provideRouter(routes,withHashLocation(),withComponentInputBinding(),withInMemoryScrolling({scrollPositionRestoration:'enabled'})),
  provideHttpClient(withInterceptors([demoHttp])),
  {provide:FitmentDataService,useClass:DemoCatalog},
  {provide:LOCALE_ID,useValue:'ka'}
]};
