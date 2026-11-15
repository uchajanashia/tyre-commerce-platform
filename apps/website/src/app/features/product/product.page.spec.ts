import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { Tire, VehicleTrim } from '@core/models';
import { LanguageService } from '@core/i18n/language.service';
import { CartService } from '@core/services/cart.service';
import { FitmentDataService } from '@core/services/fitment-data.service';
import { FitmentEngineService, FitmentResourceState } from '@core/services/fitment-engine.service';
import { GarageService, GarageVehicleRef } from '@core/services/garage.service';
import { SeoService } from '@core/services/seo.service';

import { ProductPage } from './product.page';

const product = (overrides: Partial<Tire> = {}): Tire => ({
  id: 'tire-1',
  productType: 'tire',
  catalogClass: 'passenger',
  brandId: 'advance',
  model: 'Sport X',
  season: 'summer',
  category: 'summer',
  size: { widthMm: 225, aspect: 45, rimDiameterInch: 18, raw: '225/45R18' },
  loadIndex: 95,
  speedRating: 'V',
  priceGel: 250,
  inStock: 1,
  attributes: { runFlat: false },
  media: {
    catalogUrl: '/media/front.webp',
    sidewallUrl: '/media/side.webp',
    gallery: ['/media/front.webp', '/media/side.webp'],
  },
  tags: [],
  ...overrides,
});

const trim: VehicleTrim = {
  id: 'bmw__3-series__2024__320i',
  modelId: 'bmw__3-series',
  name: '320i',
  fitment: {
    rimDiametersInch: [18],
    oemBySize: [
      {
        rimDiameterInch: 18,
        front: { widthMm: 225, aspect: 45, rimDiameterInch: 18, raw: '225/45R18' },
      },
    ],
    staggered: false,
    minLoadIndex: 94,
    oemSpeedRating: 'H',
  },
  visual: {
    sideProfileUrl: '/cars/unavailable.png',
    stageWidthPx: 2400,
    groundY: 1200,
    frontWheel: { cx: 1800, cy: 980, rimRadiusPx: 150, oemSidewallPx: 70 },
    rearWheel: { cx: 600, cy: 980, rimRadiusPx: 150, oemSidewallPx: 70 },
  },
};

const vehicle: GarageVehicleRef = {
  makeId: 'bmw',
  modelId: 'bmw__3-series',
  trimId: trim.id,
  label: 'BMW 3 Series 320i',
};

describe('ProductPage purchase and fitment truth', () => {
  let fixture: ComponentFixture<ProductPage>;
  let currentProduct: Tire;
  let selectedVehicle: WritableSignal<GarageVehicleRef | null>;
  let selectedTrim: WritableSignal<VehicleTrim | null>;
  let selectedTrimState: WritableSignal<FitmentResourceState<VehicleTrim | null>>;
  let selectedLanguage: WritableSignal<'ka' | 'en'>;
  let add: ReturnType<typeof vi.fn>;
  let getTiresPage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    currentProduct = product();
    selectedVehicle = signal<GarageVehicleRef | null>(vehicle);
    selectedTrim = signal<VehicleTrim | null>(trim);
    selectedTrimState = signal<FitmentResourceState<VehicleTrim | null>>({
      kind: 'ready',
      value: trim,
    });
    selectedLanguage = signal<'ka' | 'en'>('ka');
    add = vi.fn();
    getTiresPage = vi.fn(() => of({ items: [], total: 0, page: 1, pageSize: 100 }));

    await TestBed.configureTestingModule({
      imports: [ProductPage],
      providers: [
        provideRouter([]),
        {
          provide: FitmentDataService,
          useValue: {
            getTire: () => of(currentProduct),
            getBrands: () => of([{ id: 'advance', name: 'ADVANCE', country: 'თურქეთი' }]),
            getTiresPage,
          },
        },
        {
          provide: FitmentEngineService,
          useValue: { selectedTrim, selectedTrimState },
        },
        {
          provide: GarageService,
          useValue: { selectedVehicle },
        },
        {
          provide: CartService,
          useValue: { add },
        },
        {
          provide: SeoService,
          useValue: {
            setNotFound: vi.fn(),
            setUnavailable: vi.fn(),
            setPage: vi.fn(),
          },
        },
        {
          provide: LanguageService,
          useValue: {
            language: selectedLanguage,
            setLanguage: (language: 'ka' | 'en') => selectedLanguage.set(language),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductPage);
    fixture.componentRef.setInput('id', currentProduct.id);
  });

  async function render(): Promise<HTMLElement> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('restores the vehicle-first product layout and keeps a clear catalog back action', async () => {
    const element = await render();

    const back = element.querySelector<HTMLAnchorElement>('.detail__back');
    expect(back?.getAttribute('href')).toBe('/catalog');
    expect(back?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(back?.textContent).toContain('კატალოგში დაბრუნება');

    const layoutChildren = Array.from(element.querySelector('.detail__layout')!.children);
    expect(layoutChildren[0]?.classList.contains('detail__hero')).toBe(true);
    expect(layoutChildren[1]?.classList.contains('product')).toBe(true);

    const heroChildren = Array.from(element.querySelector('.hero')!.children);
    expect(heroChildren[0]?.classList.contains('hero__scene-wrap')).toBe(true);
    expect(heroChildren[1]?.classList.contains('hero__photo')).toBe(true);
    expect(element.querySelector('.hero__scene-note')?.textContent).toContain(
      'თავსებადობას არ ადასტურებს',
    );

    // A positive claim remains possible only through the authoritative trim result.
    expect(element.textContent).toContain('ერგება თქვენს მანქანას');
    expect(element.textContent).toContain(vehicle.label);

    const galleryImages = Array.from(
      element.querySelectorAll<HTMLImageElement>('.hero__image img'),
    );
    expect(galleryImages).toHaveLength(2);
    expect(galleryImages[0]!.getAttribute('loading')).toBe('lazy');
    expect(galleryImages[0]!.getAttribute('fetchpriority')).toBe('low');
    expect(galleryImages[1]!.getAttribute('loading')).toBe('lazy');
    expect(galleryImages[1]!.getAttribute('fetchpriority')).toBe('low');
    expect(galleryImages.every((image) => image.getAttribute('decoding') === 'async')).toBe(true);

    const vehicleScene = element.querySelector<HTMLImageElement>('.scene__vehicle');
    expect(vehicleScene?.getAttribute('loading')).toBe('eager');
    expect(vehicleScene?.getAttribute('fetchpriority')).toBe('high');
    expect(vehicleScene?.getAttribute('width')).toBe('2400');
    expect(vehicleScene?.getAttribute('height')).toBe('1350');
    expect(vehicleScene?.getAttribute('src')).toMatch(/^\/new_image\/vehicle-[\w-]+\.webp$/);
    expect(vehicleScene?.hasAttribute('srcset')).toBe(false);
    expect(vehicleScene?.hasAttribute('sizes')).toBe(false);
    expect(vehicleScene?.getAttribute('decoding')).toBe('async');

    vehicleScene?.setAttribute('srcset', '/new_image/missing-1280.webp 1280w');
    vehicleScene?.setAttribute('sizes', '58vw');
    vehicleScene?.dispatchEvent(new Event('error'));
    expect(vehicleScene?.hasAttribute('srcset')).toBe(false);
    expect(vehicleScene?.hasAttribute('sizes')).toBe(false);
    expect(vehicleScene?.getAttribute('src')).toContain('/new_image/vehicle-family-sedan.webp');

    const wheelLayers = Array.from(
      element.querySelectorAll<HTMLImageElement>('.scene__wheel-photo'),
    );
    expect(wheelLayers.length).toBeGreaterThan(0);
    expect(
      wheelLayers.every(
        (image) =>
          image.getAttribute('loading') === 'eager' &&
          image.getAttribute('width') === '320' &&
          image.getAttribute('height') === '320',
      ),
    ).toBe(true);
  });

  it('uses the compatibility CTA when no selected vehicle exists', async () => {
    selectedVehicle.set(null);
    selectedTrim.set(null);
    selectedTrimState.set({ kind: 'ready', value: null });
    const element = await render();

    expect(element.textContent).not.toContain('ერგება თქვენს მანქანას');
    expect(element.textContent).toContain('შეამოწმე თავსებადობა ავტომობილთან');
  });

  it('keeps disk language and recommendations neutral even with a selected tire trim', async () => {
    currentProduct = product({
      id: 'disk-1',
      productType: 'disk',
      catalogClass: 'disk',
      model: 'Alloy 18',
    });
    fixture.componentRef.setInput('id', currentProduct.id);
    const element = await render();

    expect(element.textContent).not.toContain('ერგება თქვენს მანქანას');
    expect(element.textContent).toContain('დისკის თავსებადობა დასადასტურებელია');
    expect(element.textContent).toContain('ერთი დისკი');
    const criticalLayers = Array.from(
      element.querySelectorAll<HTMLImageElement>('.hero__scene > img.scene__layer'),
    );
    expect(criticalLayers).toHaveLength(3);
    expect(
      criticalLayers.every(
        (image) =>
          image.getAttribute('loading') === 'eager' &&
          image.getAttribute('fetchpriority') === 'high' &&
          image.getAttribute('width') === '2400' &&
          image.getAttribute('height') === '1350',
      ),
    ).toBe(true);
    expect(
      criticalLayers.every((image) => image.getAttribute('srcset')?.includes('-1280.webp 1280w')),
    ).toBe(true);
    expect(getTiresPage).toHaveBeenCalledWith(
      expect.objectContaining({ catalogClass: 'disk', diameter: 18 }),
    );
  });

  it('keeps quantity within 1–4 and adds the explicit selection to the cart', async () => {
    const element = await render();
    const increase = element.querySelector<HTMLButtonElement>(
      'button[aria-label="რაოდენობის გაზრდა"]',
    )!;
    increase.click();
    increase.click();
    increase.click();
    increase.click();
    fixture.detectChanges();

    expect(element.querySelector('output')?.textContent?.trim()).toBe('4');
    element.querySelector<HTMLButtonElement>('.product__cta')!.click();
    expect(add).toHaveBeenCalledWith({
      tireId: currentProduct.id,
      quantity: 4,
      vehicleTrimId: trim.id,
    });
  });

  it('switches the complete product journey copy to English live', async () => {
    selectedLanguage.set('en');
    const element = await render();

    expect(element.querySelector('.detail__back')?.textContent).toContain('Back to catalog');
    expect(element.textContent).toContain('Quantity');
    expect(element.textContent).toContain('Add to cart');
    expect(element.textContent).toContain('Fits your vehicle');
    expect(element.textContent).toContain('Load index');
    expect(element.textContent).toContain('Summer');
    expect(element.textContent).toContain('Turkey');
    expect(element.textContent).not.toContain('თურქეთი');
    expect(element.querySelector('.hero__scene-note')?.textContent).toContain(
      'does not confirm compatibility',
    );
    expect(
      element.querySelector<HTMLButtonElement>('.hero__image')?.getAttribute('aria-label'),
    ).toBe('Product photo 1 — enlarge');
  });
});
