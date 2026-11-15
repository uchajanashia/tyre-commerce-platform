import { inject, isDevMode } from '@angular/core';
import { Router, Routes } from '@angular/router';

import { cartNotEmptyGuard } from '@core/guards/cart-not-empty.guard';
import { checkoutEnabledGuard } from '@core/guards/checkout-enabled.guard';
import { vehicleSelectedGuard } from '@core/guards/vehicle-selected.guard';

/** All feature routes lazy-loaded (spec 03/06). Titles via TyreTitleStrategy. */
export const routes: Routes = [
  ...(isDevMode()
    ? [
        {
          path: 'testhome',
          loadComponent: () =>
            import('@features/test-home/test-home.page').then((m) => m.TestHomePage),
          title: 'tyre.ge — Test Home',
        },
      ]
    : []),
  {
    path: '',
    loadComponent: () => import('@features/home/home.page').then((m) => m.HomePage),
    title: $localize`მთავარი`,
  },
  {
    path: 'garage',
    loadComponent: () => import('@features/garage/garage.page').then((m) => m.GaragePage),
    title: $localize`გარაჟი`,
  },
  {
    path: 'season',
    redirectTo: () => inject(Router).createUrlTree(['/'], { fragment: 'season' }),
    pathMatch: 'full',
  },
  {
    path: 'configurator',
    loadComponent: () =>
      import('@features/configurator/configurator.page').then((m) => m.ConfiguratorPage),
    canActivate: [vehicleSelectedGuard],
    title: $localize`კონფიგურატორი`,
  },
  {
    path: 'catalog',
    loadComponent: () => import('@features/catalog/catalog.page').then((m) => m.CatalogPage),
    title: $localize`კატალოგი`,
  },
  {
    path: 'tire/:id',
    loadComponent: () => import('@features/product/product.page').then((m) => m.ProductPage),
    title: $localize`საბურავი`,
  },
  {
    path: 'cart',
    loadComponent: () => import('@features/checkout/cart.page').then((m) => m.CartPage),
    title: $localize`კალათა`,
  },
  {
    path: 'checkout',
    loadComponent: () => import('@features/checkout/checkout.page').then((m) => m.CheckoutPage),
    canActivate: [checkoutEnabledGuard, cartNotEmptyGuard],
    title: $localize`შეკვეთის გაფორმება`,
  },
  {
    path: 'order/:id',
    loadComponent: () => import('@features/checkout/order.page').then((m) => m.OrderPage),
    title: $localize`შეკვეთა`,
  },
  {
    path: 'brands/:id',
    loadComponent: () => import('@features/brands/brand.page').then((m) => m.BrandPage),
    title: $localize`ბრენდი`,
  },
  {
    path: 'privacy',
    loadComponent: () => import('@features/legal/privacy.page').then((m) => m.PrivacyPage),
    title: $localize`კონფიდენციალურობა`,
  },
  {
    path: 'about',
    loadComponent: () => import('@features/about/about.page').then((m) => m.AboutPage),
    title: $localize`ჩვენ შესახებ`,
  },
  {
    path: 'delivery-returns',
    loadComponent: () =>
      import('@features/legal/delivery-returns.page').then((m) => m.DeliveryReturnsPage),
    title: $localize`მიწოდება და დაბრუნება`,
  },
  {
    path: 'terms',
    loadComponent: () => import('@features/legal/terms.page').then((m) => m.TermsPage),
    title: $localize`წესები და პირობები`,
  },
  {
    path: '**',
    loadComponent: () => import('@features/not-found/not-found.page').then((m) => m.NotFoundPage),
    title: $localize`გვერდი ვერ მოიძებნა`,
  },
];
