import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors, HttpErrorResponse } from '@angular/common/http';
import { provideRouter, withHashLocation } from '@angular/router';
import { throwError } from 'rxjs';
export const appConfig:ApplicationConfig={providers:[
  provideBrowserGlobalErrorListeners(),
  provideRouter([{path:'',loadComponent:()=>import('./features/demo/admin-demo.page').then(m=>m.AdminDemoPage)},{path:'**',redirectTo:''}],withHashLocation()),
  provideHttpClient(withInterceptors([()=>throwError(()=>new HttpErrorResponse({status:501,error:{message:'Offline simulation; no live API.'}}))]))
]};
