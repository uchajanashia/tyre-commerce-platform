import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { VehicleTrim } from '../models';
import { HttpFitmentDataService } from './http-fitment-data.service';

describe('HttpFitmentDataService entity status handling', () => {
  let http: HttpTestingController;
  let service: HttpFitmentDataService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), HttpFitmentDataService],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(HttpFitmentDataService);
  });

  afterEach(() => http.verify());

  it('maps an actual product 404 to missing', () => {
    let result: unknown = 'pending';
    service.getTire('missing').subscribe((value) => (result = value));
    http.expectOne(`${environment.apiBaseUrl}/products/missing`).flush(null, {
      status: 404,
      statusText: 'Not Found',
    });

    expect(result).toBeUndefined();
  });

  it('rethrows an API outage so the page can return 503', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status = 0;
    service.getBrand('roadx').subscribe({
      error: (error: { status: number }) => (status = error.status),
    });
    http.expectOne(`${environment.apiBaseUrl}/brands/roadx`).flush(null, {
      status: 503,
      statusText: 'Unavailable',
    });

    expect(status).toBe(503);
    errorSpy.mockRestore();
  });
});

describe('HttpFitmentDataService vehicle/fitment endpoints', () => {
  let http: HttpTestingController;
  let service: HttpFitmentDataService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), HttpFitmentDataService],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(HttpFitmentDataService);
  });

  afterEach(() => http.verify());

  it('maps makes and models to the domain shape', () => {
    let makes: unknown;
    service.getMakes().subscribe((v) => (makes = v));
    http.expectOne(`${environment.apiBaseUrl}/fitment/makes`).flush([{ slug: 'bmw', name: 'BMW' }]);
    expect(makes).toEqual([{ id: 'bmw', name: 'BMW', logoUrl: '/assets/makes/bmw.webp' }]);

    let models: unknown;
    service.getModels('bmw').subscribe((v) => (models = v));
    http
      .expectOne(`${environment.apiBaseUrl}/fitment/makes/bmw/models`)
      .flush([{ slug: '3-series', name: '3 Series' }]);
    expect(models).toEqual([{ id: 'bmw__3-series', makeId: 'bmw', name: '3 Series' }]);
  });

  it('keeps only vehicle makes backed by a real make image asset', () => {
    let makes: unknown;
    service.getMakes().subscribe((value) => (makes = value));
    http.expectOne(`${environment.apiBaseUrl}/fitment/makes`).flush([
      { slug: 'bmw', name: 'BMW' },
      { slug: 'aixam', name: 'Aixam' },
      { slug: 'xpeng', name: 'XPeng' },
      { slug: 'great-wall', name: 'Great Wall' },
    ]);

    expect(makes).toEqual([
      { id: 'bmw', name: 'BMW', logoUrl: '/assets/makes/bmw.webp' },
      { id: 'great-wall', name: 'Great Wall', logoUrl: '/assets/makes/gwm.webp' },
    ]);
  });

  it('rethrows a makes outage without logging or turning it into an empty result', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let result: unknown = 'pending';
    let status = 0;
    service.getMakes().subscribe({
      next: (value) => (result = value),
      error: (error: { status: number }) => (status = error.status),
    });
    http.expectOne(`${environment.apiBaseUrl}/fitment/makes`).flush(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });

    expect(result).toBe('pending');
    expect(status).toBe(500);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('resolves years and trims for the composite model id', () => {
    let years: unknown;
    service.getYears('bmw', 'bmw__3-series').subscribe((v) => (years = v));
    http
      .expectOne(`${environment.apiBaseUrl}/fitment/makes/bmw/models/3-series/years`)
      .flush([2021, 2020]);
    expect(years).toEqual([2021, 2020]);

    let trims: VehicleTrim[] | undefined;
    service.getTrims('bmw', 'bmw__3-series', 2021).subscribe((v) => (trims = v));
    const req = http.expectOne(
      (r) =>
        r.url === `${environment.apiBaseUrl}/fitment/lookup` && r.params.get('year') === '2021',
    );
    expect(req.request.params.get('make')).toBe('bmw');
    expect(req.request.params.get('model')).toBe('3-series');
    req.flush({
      make: 'bmw',
      model: '3-series',
      year: 2021,
      trims: [
        {
          trimSlug: '320i',
          trimName: '320i',
          rimDiametersInch: [17],
          oemBySize: [
            {
              rimDiameterInch: 17,
              front: { widthMm: 225, aspect: 45, rimDiameterInch: 17, raw: '225/45R17 91V' },
            },
          ],
          staggered: false,
          minLoadIndex: 91,
          oemSpeedRating: 'V',
        },
      ],
    });
    expect(trims?.[0]?.id).toBe('bmw__3-series__2021__320i');
    expect(trims?.[0]?.fitment.oemSpeedRating).toBe('V');
  });

  it('treats a 404 lookup as no trims rather than an outage', () => {
    let trims: VehicleTrim[] | undefined;
    service.getTrims('bmw', 'bmw__3-series', 1999).subscribe((v) => (trims = v));
    http
      .expectOne((r) => r.url === `${environment.apiBaseUrl}/fitment/lookup`)
      .flush(null, { status: 404, statusText: 'Not Found' });
    expect(trims).toEqual([]);
  });

  it('resolves a single trim by its synthesized id, and returns undefined for a malformed id', () => {
    let trim: VehicleTrim | undefined = undefined;
    service.getTrim('bmw__3-series__2021__320i').subscribe((v) => (trim = v));
    const req = http.expectOne((r) => r.url === `${environment.apiBaseUrl}/fitment/lookup`);
    expect(req.request.params.get('trim')).toBe('320i');
    req.flush({
      make: 'bmw',
      model: '3-series',
      year: 2021,
      trims: [
        {
          trimSlug: '320i',
          trimName: '320i',
          rimDiametersInch: [17],
          oemBySize: [
            {
              rimDiameterInch: 17,
              front: { widthMm: 225, aspect: 45, rimDiameterInch: 17, raw: '225/45R17 91V' },
            },
          ],
          staggered: false,
          minLoadIndex: 91,
          oemSpeedRating: 'V',
        },
      ],
    });
    expect(trim!.name).toBe('320i');

    let malformed: unknown = 'pending';
    service.getTrim('not-a-composite-id').subscribe((v) => (malformed = v));
    expect(malformed).toBeUndefined();
  });
});
