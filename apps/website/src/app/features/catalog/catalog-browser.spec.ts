import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  ParamMap,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';

import { Brand, Tire } from '@core/models';
import { LanguageService } from '@core/i18n/language.service';
import { FitmentDataService, SizeFacets, TirePage } from '@core/services/fitment-data.service';
import { ClimateService } from '@core/services/climate.service';
import { MotionService } from '@core/services/motion.service';

import { CatalogBrowser } from './catalog-browser';

const brands: Brand[] = [{ id: 'arivo', name: 'ARIVO', country: 'China', logoUrl: '' }];
const facets: SizeFacets = {
  widths: [205, 275],
  profiles: [55],
  diameters: [16, 20],
  inchSizes: [],
};
const product: Tire = {
  id: 'tire-1',
  productType: 'tire',
  catalogClass: 'passenger',
  sizeSystem: 'metric',
  brandId: 'arivo',
  model: 'TERRAMAX A/T',
  season: 'all-season',
  category: 'at',
  size: { raw: '275/55R20', widthMm: 275, aspect: 55, rimDiameterInch: 20 },
  loadIndex: 117,
  speedRating: 'T',
  priceGel: 389,
  inStock: 1,
  attributes: { runFlat: false },
  media: { catalogUrl: '', sidewallUrl: '', gallery: [] },
  tags: [],
};

interface SetupResult {
  fixture: ComponentFixture<CatalogBrowser>;
  params: BehaviorSubject<ParamMap>;
  getTiresPage: ReturnType<typeof vi.fn>;
  router: Router;
}

async function setupCatalog(
  initialParams: Record<string, string> = {},
  page$: Observable<TirePage> = of({ items: [product], total: 1, page: 1, pageSize: 30 }),
): Promise<SetupResult> {
  const initialMap = convertToParamMap(initialParams);
  const params = new BehaviorSubject<ParamMap>(initialMap);
  const getTiresPage = vi.fn(() => page$);

  await TestBed.configureTestingModule({
    imports: [CatalogBrowser],
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { queryParamMap: params, snapshot: { queryParamMap: initialMap } },
      },
      {
        provide: FitmentDataService,
        useValue: {
          getBrands: () => of(brands),
          getSizeFacets: () => of(facets),
          getTiresPage,
        },
      },
      { provide: ClimateService, useValue: { setCategoryTheme: vi.fn() } },
      {
        provide: MotionService,
        useValue: { scrollToY: vi.fn() },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CatalogBrowser);
  const router = TestBed.inject(Router);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, params, getTiresPage, router };
}

describe('CatalogBrowser query contract', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('maps preserved URL values to the existing server request contract', async () => {
    const { fixture, getTiresPage } = await setupCatalog({
      class: 'passenger',
      type: 'at',
      rim: '20',
      width: '275',
      profile: '55',
      brand: 'arivo',
      sort: 'price-desc',
      page: '2',
    });

    expect(getTiresPage).toHaveBeenCalledWith({
      page: 2,
      pageSize: 30,
      catalogClass: 'passenger',
      season: undefined,
      category: ['at'],
      brand: 'arivo',
      width: 275,
      profile: 55,
      diameter: 20,
      size: undefined,
      sort: 'price-desc',
    });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('R20');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('ARIVO');
  });

  it('reacts to back/forward-style ParamMap emissions without local state drift', async () => {
    const { fixture, params } = await setupCatalog({ rim: '20' });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.filter-trigger')?.getAttribute('aria-label')).toContain('R20');

    params.next(convertToParamMap({ rim: '16' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('.filter-trigger')?.getAttribute('aria-label')).toContain('R16');
  });

  it('keeps an explicit metric value visible while filtered facets refresh', async () => {
    const { fixture } = await setupCatalog({ sizeMode: 'metric', rim: '19' });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('app-radial-filter-select[data-filter-key="rim"]')).not.toBeNull();
    expect(host.querySelector('.filter-trigger')?.getAttribute('aria-label')).toContain('R19');
  });

  it('writes filter changes through Router navigation and resets paging', async () => {
    const { fixture, router } = await setupCatalog({ page: '3' });
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="false"]')!.click();

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ class: 'truck', page: null }),
        queryParamsHandling: 'merge',
      }),
    );
  });

  it('shows exactly three seasons and keeps terrain types in a separate disclosure', async () => {
    const { fixture } = await setupCatalog();
    const host = fixture.nativeElement as HTMLElement;
    const seasonLabels = Array.from(
      host.querySelectorAll<HTMLElement>('[data-filter-group="season"] .browser__chip-label'),
      (element) => element.textContent?.trim(),
    );

    expect(seasonLabels).toEqual(['ზაფხული', 'ზამთარი', 'M+S']);
    expect(host.querySelector('[data-filter-group="type"]')).toBeNull();
    expect(host.querySelector('.browser__field--brand')).toBeNull();

    host.querySelector<HTMLButtonElement>('.browser__advanced-toggle')!.click();
    fixture.detectChanges();

    const typeLabels = Array.from(
      host.querySelectorAll<HTMLElement>('[data-filter-group="type"] .browser__chip-label'),
      (element) => element.textContent?.trim(),
    );
    expect(typeLabels).toEqual(['ყველა სეზონის', 'საგზაო H/T', 'უნივერსალური A/T', 'უგზოობის M/T']);
    expect(host.querySelector('.browser__field--brand')).not.toBeNull();
  });

  it('maps the three season controls to independent season query values', async () => {
    const { fixture, router } = await setupCatalog({ page: '3' });
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '[data-filter-group="season"] [role="radio"]',
    );

    buttons[1]!.click();

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ type: null, season: 'winter', page: null }),
        queryParamsHandling: 'merge',
      }),
    );
  });

  it('keeps season and terrain type independently active and AND-combines them in the server query', async () => {
    const { fixture, params, getTiresPage, router } = await setupCatalog();
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const host = fixture.nativeElement as HTMLElement;

    host
      .querySelectorAll<HTMLButtonElement>('[data-filter-group="season"] [role="radio"]')[0]!
      .click();
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ season: 'summer', type: null }),
      }),
    );

    params.next(convertToParamMap({ season: 'summer' }));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('.browser__advanced-toggle')!.click();
    fixture.detectChanges();
    const atButton = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[data-filter-group="type"] [role="radio"]'),
    ).find((button) => button.textContent?.includes('A/T'))!;
    atButton.click();

    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ season: 'summer', type: 'at' }),
      }),
    );

    params.next(convertToParamMap({ season: 'summer', type: 'at' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      host.querySelector('[data-filter-group="season"] [aria-checked="true"]')?.textContent,
    ).toContain('ზაფხული');
    expect(
      host.querySelector('[data-filter-group="type"] [aria-checked="true"]')?.textContent,
    ).toContain('A/T');
    expect(getTiresPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ season: 'summer', category: ['at'] }),
    );
  });

  it('keeps additional parameters open across query and history-style updates', async () => {
    const { fixture, params } = await setupCatalog();
    const host = fixture.nativeElement as HTMLElement;
    const toggle = host.querySelector<HTMLButtonElement>('.browser__advanced-toggle')!;

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    params.next(convertToParamMap({ type: 'at', brand: 'arivo', rim: '20' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('#catalog-advanced-filters')).not.toBeNull();
    expect(
      host.querySelector('[data-filter-group="type"] [aria-checked="true"]')?.textContent,
    ).toContain('A/T');
    expect(host.querySelector<HTMLSelectElement>('.browser__field--brand select')?.value).toBe(
      'arivo',
    );
  });

  it('restores the additional parameters disclosure for a deep-linked type', async () => {
    const { fixture } = await setupCatalog({ type: 'mt' });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.browser__advanced-toggle')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(
      host.querySelector('[data-filter-group="type"] [aria-checked="true"]')?.textContent,
    ).toContain('M/T');
  });

  it('switches customer-facing catalog copy to English live', async () => {
    const { fixture } = await setupCatalog();
    const language = TestBed.inject(LanguageService);
    const host = fixture.nativeElement as HTMLElement;

    language.setLanguage('en');
    fixture.detectChanges();

    expect(host.textContent).toContain('Season');
    expect(host.textContent).toContain('Additional parameters');
    expect(host.textContent).toContain('Sort');
    language.setLanguage('ka');
  });
});

describe('CatalogBrowser request states', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders a compact loading skeleton set', async () => {
    const pending = new Subject<TirePage>();
    const { fixture } = await setupCatalog({}, pending);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.browser__results')?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelectorAll('.card--skeleton')).toHaveLength(8);
  });

  it('distinguishes a thrown request error from a valid empty result', async () => {
    const { fixture } = await setupCatalog(
      {},
      throwError(() => new Error('unavailable')),
    );
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).toContain('კატალოგის ჩატვირთვა ვერ მოხერხდა');
  });

  it('uses truthful empty and populated card content', async () => {
    const empty = await setupCatalog({}, of({ items: [], total: 0, page: 1, pageSize: 30 }));
    expect((empty.fixture.nativeElement as HTMLElement).textContent).toContain(
      'საბურავები ამჟამად კატალოგში არ არის',
    );
    empty.fixture.destroy();
    TestBed.resetTestingModule();

    const populated = await setupCatalog();
    const host = populated.fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.card')).toHaveLength(1);
    expect(host.textContent).toContain('პროდუქტის ფოტო ჯერ არ არის');
    expect(host.textContent).toContain('389');
    expect(host.textContent).toContain('275/55 R20');
    expect(host.textContent).toContain('მარაგშია');
  });
});
