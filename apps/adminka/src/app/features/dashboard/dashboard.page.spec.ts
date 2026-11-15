import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AdminBrand, AdminInfo, AdminTireModelList } from '@tyre/shared';

import { environment } from '../../../environments/environment';
import { DashboardPage } from './dashboard.page';

describe('DashboardPage', () => {
  let fixture: ComponentFixture<DashboardPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardPage);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('renders only catalog counts supplied by existing APIs', () => {
    const admin: AdminInfo = {
      id: 'admin-1',
      email: 'ops@tyre.ge',
      role: 'admin',
      enabled: true,
      permissions: ['*'],
      permissionGrants: [{ permission: '*', scopeType: 'global', scopeId: '' }],
    };
    const brands: AdminBrand[] = [
      {
        id: 'roadx',
        name: 'RoadX',
        defaultCountry: null,
        productCount: 606,
        tireModelCount: 32,
      },
      {
        id: 'bridgestone',
        name: 'Bridgestone',
        defaultCountry: 'Japan',
        productCount: 14,
        tireModelCount: 3,
      },
    ];
    const noPhotoModels: AdminTireModelList = {
      total: 7,
      page: 1,
      pageSize: 1,
      items: [],
    };

    http.expectOne(`${environment.apiBaseUrl}/admin/me`).flush(admin);
    http.expectOne(`${environment.apiBaseUrl}/admin/brands`).flush(brands);
    http
      .expectOne(
        (request) =>
          request.url === `${environment.apiBaseUrl}/admin/tire-models` &&
          request.params.get('photos') === 'without' &&
          request.params.get('pageSize') === '1',
      )
      .flush(noPhotoModels);
    fixture.detectChanges();

    expect(fixture.componentInstance.catalog()).toEqual({
      brands: 2,
      models: 35,
      products: 620,
      modelsWithoutPhotos: 7,
    });
    expect(fixture.nativeElement.textContent).toContain('ops@tyre.ge');
    expect(fixture.nativeElement.textContent).toContain('620');
    expect(fixture.nativeElement.textContent).toContain('35');
    expect(fixture.nativeElement.textContent).toContain('7');
  });

  it('shows explicit partial failure states instead of false zeroes', () => {
    http
      .expectOne(`${environment.apiBaseUrl}/admin/me`)
      .flush({}, { status: 503, statusText: 'Unavailable' });
    http
      .expectOne((request) => request.url === `${environment.apiBaseUrl}/admin/tire-models`)
      .flush({ total: 0, page: 1, pageSize: 1, items: [] });
    http
      .expectOne(`${environment.apiBaseUrl}/admin/brands`)
      .flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('სესიის სტატუსი ვერ გადამოწმდა');
    expect(text).toContain('კატალოგი ვერ ჩაიტვირთა');
    expect(fixture.componentInstance.catalog()).toBeNull();
  });
});
