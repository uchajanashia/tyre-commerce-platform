import { convertToParamMap, ActivatedRoute, Router } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { Make, VehicleModel, VehicleTrim } from '@core/models';
import { FitmentDataService } from '@core/services/fitment-data.service';
import { GarageService } from '@core/services/garage.service';
import { MotionService } from '@core/services/motion.service';

import { GaragePage } from './garage.page';

describe('GaragePage fitment request states', () => {
  let fixture: ComponentFixture<GaragePage>;
  const empty = () => of([]);
  const getMakes = vi
    .fn()
    .mockReturnValueOnce(throwError(() => new Error('fitment unavailable')))
    .mockReturnValueOnce(of([]));

  beforeEach(async () => {
    const params = convertToParamMap({});
    await TestBed.configureTestingModule({
      imports: [GaragePage],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(params), snapshot: { queryParamMap: params } },
        },
        { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn() } },
        {
          provide: FitmentDataService,
          useValue: {
            getMakes,
            getModels: empty,
            getYears: empty,
            getTrims: empty,
          },
        },
        {
          provide: GarageService,
          useValue: { recentVehicles: () => [], selectVehicle: vi.fn() },
        },
        {
          provide: MotionService,
          useValue: {
            reduced: () => true,
            set: vi.fn(),
            to: vi.fn(),
            dur: { base: 0 },
            ease: { out: 'none' },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GaragePage);
  });

  afterEach(() => getMakes.mockReset());

  it('shows an outage as an alert and retries it instead of presenting an empty result', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const alert = element.querySelector<HTMLElement>('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(element.textContent).not.toContain('ვერაფერი მოიძებნა');

    alert!.querySelector<HTMLButtonElement>('button')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getMakes).toHaveBeenCalledTimes(2);
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.textContent).toContain('მარკების სია ცარიელია');
  });
});

describe('GaragePage refresh dependency order', () => {
  it('waits for each parent selection dataset before requesting its child', async () => {
    const params = convertToParamMap({
      make: 'bmw',
      model: 'bmw__3-series',
      year: '2024',
    });
    const makes$ = new Subject<Make[]>();
    const models$ = new Subject<VehicleModel[]>();
    const years$ = new Subject<number[]>();
    const trims$ = new Subject<VehicleTrim[]>();
    const getModels = vi.fn(() => models$);
    const getYears = vi.fn(() => years$);
    const getTrims = vi.fn(() => trims$);

    await TestBed.configureTestingModule({
      imports: [GaragePage],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(params), snapshot: { queryParamMap: params } },
        },
        { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn() } },
        {
          provide: FitmentDataService,
          useValue: {
            getMakes: () => makes$,
            getModels,
            getYears,
            getTrims,
          },
        },
        {
          provide: GarageService,
          useValue: { recentVehicles: () => [], selectVehicle: vi.fn() },
        },
        {
          provide: MotionService,
          useValue: {
            reduced: () => true,
            set: vi.fn(),
            to: vi.fn(),
            dur: { base: 0 },
            ease: { out: 'none' },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(GaragePage);
    fixture.detectChanges();
    expect(getModels).not.toHaveBeenCalled();
    expect(getYears).not.toHaveBeenCalled();
    expect(getTrims).not.toHaveBeenCalled();

    makes$.next([{ id: 'bmw', name: 'BMW', logoUrl: '/assets/makes/bmw.webp' }]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(getModels).toHaveBeenCalledTimes(1);
    expect(getYears).not.toHaveBeenCalled();

    models$.next([{ id: 'bmw__3-series', makeId: 'bmw', name: '3 Series' }]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(getYears).toHaveBeenCalledTimes(1);
    expect(getTrims).not.toHaveBeenCalled();

    years$.next([2024]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(getTrims).toHaveBeenCalledTimes(1);
  });
});

describe('GaragePage stale model recovery', () => {
  it('returns a refreshed obsolete model URL to the model picker', async () => {
    const params = convertToParamMap({
      make: 'bmw',
      model: 'bmw__1-series',
      year: '2024',
    });
    const navigate = vi.fn().mockResolvedValue(true);
    const getYears = vi.fn(() => of([2024]));

    await TestBed.configureTestingModule({
      imports: [GaragePage],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(params), snapshot: { queryParamMap: params } },
        },
        { provide: Router, useValue: { navigate, navigateByUrl: vi.fn() } },
        {
          provide: FitmentDataService,
          useValue: {
            getMakes: () => of([{ id: 'bmw', name: 'BMW', logoUrl: '/assets/makes/bmw.webp' }]),
            getModels: () => of([{ id: 'bmw__5-series', makeId: 'bmw', name: '5 Series' }]),
            getYears,
            getTrims: () => of([]),
          },
        },
        {
          provide: GarageService,
          useValue: { recentVehicles: () => [], selectVehicle: vi.fn() },
        },
        {
          provide: MotionService,
          useValue: {
            reduced: () => true,
            set: vi.fn(),
            to: vi.fn(),
            dur: { base: 0 },
            ease: { out: 'none' },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(GaragePage);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getYears).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { model: null, year: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );
  });
});
