import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LanguageService } from '@core/i18n/language.service';
import { GarageService } from '@core/services/garage.service';

import { CatalogBrowser } from './catalog-browser';
import { CatalogPage } from './catalog.page';
import { CatalogPromoCarousel } from './catalog-promo-carousel';

@Component({ selector: 'app-catalog-browser', template: '' })
class CatalogBrowserStub {}

@Component({ selector: 'app-catalog-promo-carousel', template: '' })
class CatalogPromoCarouselStub {}

describe('CatalogPage layout', () => {
  let fixture: ComponentFixture<CatalogPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogPage],
      providers: [
        provideRouter([]),
        {
          provide: GarageService,
          useValue: { selectedVehicle: signal(null) },
        },
      ],
    })
      .overrideComponent(CatalogPage, {
        remove: { imports: [CatalogBrowser, CatalogPromoCarousel] },
        add: { imports: [CatalogBrowserStub, CatalogPromoCarouselStub] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(CatalogPage);
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('places the promo slider above the vehicle entry and catalog filters', () => {
    const catalog = (fixture.nativeElement as HTMLElement).querySelector('.catalog')!;
    const children = Array.from(catalog.children);

    expect(children.indexOf(catalog.querySelector('app-catalog-promo-carousel')!)).toBeLessThan(
      children.indexOf(catalog.querySelector('.catalog__paths')!),
    );
    expect(children.indexOf(catalog.querySelector('.catalog__paths')!)).toBeLessThan(
      children.indexOf(catalog.querySelector('app-catalog-browser')!),
    );
  });

  it('keeps the vehicle entry and removes the redundant size-selection entry', () => {
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('ავტომობილით არჩევა');
    expect(host.textContent).not.toContain('ზომით არჩევა');
    expect(host.querySelectorAll('.catalog__path')).toHaveLength(1);
  });

  it('switches the heading and vehicle entry to English live', () => {
    const language = TestBed.inject(LanguageService);
    language.setLanguage('en');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.catalog__title')?.textContent).toContain('Catalog');
    expect(host.querySelector('.catalog__path')?.textContent).toContain('Shop by vehicle');
    language.setLanguage('ka');
  });
});
