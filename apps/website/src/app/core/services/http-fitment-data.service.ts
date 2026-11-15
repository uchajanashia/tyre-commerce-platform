import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Brand, Make, Season, Tire, VehicleModel, VehicleTrim } from '../models';
import { ApiBrand, ApiProduct, ApiProductList, mapBrand, mapProduct } from './fitment-api.mapper';
import {
  FitmentDataService,
  SizeFacetQuery,
  SizeFacets,
  TirePage,
  TirePageQuery,
} from './fitment-data.service';
import {
  ApiFitmentLookupResult,
  ApiFitmentMake,
  ApiFitmentModel,
  hasMakeLogo,
  mapLookupResult,
  mapMake,
  mapModel,
  parseModelId,
  parseTrimId,
} from './vehicle-api.mapper';

const SEASON_TO_GROUP: Record<Season, string> = {
  summer: 'summer',
  winter: 'winter',
  'all-season': 'all_season',
};

/** "R-12" → 12, "R-22.5" → 22.5, "R-16C" → 16. */
function radiusLabelToRim(label: string): number {
  return parseFloat(label.replace(/[^0-9.]/g, ''));
}

/**
 * The HTTP implementation of the FitmentDataService seam (spec 02). Catalog data
 * (tires, brands, single product) and vehicle/fitment data (makes/models/years/
 * trims, used by the garage + configurator) both come from the real read API;
 * the contract (Observable returns, spec-04 domain shapes) is unchanged, so
 * pages/components need zero edits.
 *
 * Resilience: API/network errors and empty results are caught and logged, and
 * the methods return empty/undefined so SSR and the UI never crash.
 */
@Injectable()
export class HttpFitmentDataService extends FitmentDataService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  /** The API caps pageSize at 100; getTires() pages through to return the full catalog. */
  private static readonly PAGE_SIZE = 100;

  // ───────────────────────── Catalog: real API ─────────────────────────

  getBrands(): Observable<Brand[]> {
    return this.http.get<ApiBrand[]>(`${this.base}/brands`).pipe(
      map((list) => list.map(mapBrand)),
      catchError((err) => this.fail('GET /brands', err, [] as Brand[])),
    );
  }

  getBrand(brandId: string): Observable<Brand | undefined> {
    return this.http.get<ApiBrand>(`${this.base}/brands/${encodeURIComponent(brandId)}`).pipe(
      map(mapBrand),
      catchError((err: unknown) => this.notFoundOrRethrow<Brand>(`GET /brands/${brandId}`, err)),
    );
  }

  getTires(): Observable<Tire[]> {
    return this.fetchAllProducts().pipe(map((items) => items.map(mapProduct)));
  }

  getTire(tireId: string): Observable<Tire | undefined> {
    return this.http.get<ApiProduct>(`${this.base}/products/${encodeURIComponent(tireId)}`).pipe(
      map((p) => mapProduct(p)),
      catchError((err: unknown) => this.notFoundOrRethrow<Tire>(`GET /products/${tireId}`, err)),
    );
  }

  /** One server page (catalog pagination) — maps the catalog filters to API params. */
  getTiresPage(query: TirePageQuery): Observable<TirePage> {
    let params = new HttpParams()
      .set('page', String(query.page))
      .set('pageSize', String(query.pageSize));
    if (query.catalogClass) {
      params = params.set('catalogClass', query.catalogClass);
    }
    if (query.season) {
      params = params.set('seasonGroup', SEASON_TO_GROUP[query.season]);
    }
    if (query.category?.length) {
      params = params.set('category', query.category.join(','));
    }
    if (query.brand) {
      params = params.set('brand', query.brand);
    }
    if (query.width !== undefined) {
      params = params.set('width', String(query.width));
    }
    if (query.profile !== undefined) {
      params = params.set('profile', String(query.profile));
    }
    if (query.diameter !== undefined) {
      params = params.set('rimDiameter', String(query.diameter));
    }
    if (query.size) {
      params = params.set('size', query.size);
    }
    if (query.sort) {
      params = params.set('sort', query.sort === 'price-asc' ? 'price_asc' : 'price_desc');
    }
    return this.http.get<ApiProductList>(`${this.base}/products`, { params }).pipe(
      map((r) => ({
        items: r.items.map(mapProduct),
        total: r.total,
        page: r.page,
        pageSize: r.pageSize,
      })),
      catchError((err) =>
        this.fail('GET /products (page)', err, {
          items: [] as Tire[],
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
        }),
      ),
    );
  }

  getRadiusFacets(): Observable<number[]> {
    return this.http.get<{ radius: string[] }>(`${this.base}/filters`).pipe(
      map((f) =>
        [...new Set((f.radius ?? []).map(radiusLabelToRim))]
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b),
      ),
      catchError((err) => this.fail('GET /filters', err, [] as number[])),
    );
  }

  getSizeFacets(query: SizeFacetQuery = {}): Observable<SizeFacets> {
    let params = new HttpParams();
    if (query.catalogClass) params = params.set('catalogClass', query.catalogClass);
    if (query.category?.length) params = params.set('category', query.category.join(','));
    if (query.brand) params = params.set('brand', query.brand);
    if (query.width !== undefined) params = params.set('width', String(query.width));
    if (query.profile !== undefined) params = params.set('profile', String(query.profile));
    if (query.diameter !== undefined) params = params.set('rimDiameter', String(query.diameter));

    return this.http.get<SizeFacets>(`${this.base}/products/sizes`, { params }).pipe(
      map((f) => ({
        widths: f.widths ?? [],
        profiles: f.profiles ?? [],
        diameters: f.diameters ?? [],
        inchSizes: f.inchSizes ?? [],
      })),
      catchError((err) =>
        this.fail('GET /products/sizes', err, {
          widths: [],
          profiles: [],
          diameters: [],
          inchSizes: [],
        }),
      ),
    );
  }

  // ───────────────────────── Vehicle/fitment: real API ─────────────────────────

  getMakes(): Observable<Make[]> {
    return this.http
      .get<ApiFitmentMake[]>(`${this.base}/fitment/makes`)
      .pipe(map((list) => list.filter(hasMakeLogo).map(mapMake)));
  }

  getModels(makeId: string): Observable<VehicleModel[]> {
    return this.http
      .get<ApiFitmentModel[]>(`${this.base}/fitment/makes/${encodeURIComponent(makeId)}/models`)
      .pipe(map((list) => list.map((m) => mapModel(makeId, m))));
  }

  /** No dedicated "fetch one model" endpoint exists — reuse the (cached) models
   *  list for the model's make, keyed by the synthesized id. */
  getModel(modelId: string): Observable<VehicleModel | undefined> {
    const parsed = parseModelId(modelId);
    if (!parsed) {
      return of(undefined);
    }
    return this.getModels(parsed.makeSlug).pipe(
      map((models) => models.find((m) => m.id === modelId)),
    );
  }

  getYears(makeId: string, modelId: string): Observable<number[]> {
    const modelSlug = parseModelId(modelId)?.modelSlug ?? modelId;
    return this.http.get<number[]>(
      `${this.base}/fitment/makes/${encodeURIComponent(makeId)}/models/${encodeURIComponent(modelSlug)}/years`,
    );
  }

  getTrims(makeId: string, modelId: string, year?: number): Observable<VehicleTrim[]> {
    if (year === undefined) {
      return of([]);
    }
    const modelSlug = parseModelId(modelId)?.modelSlug ?? modelId;
    const params = new HttpParams()
      .set('make', makeId)
      .set('model', modelSlug)
      .set('year', String(year));
    return this.http.get<ApiFitmentLookupResult>(`${this.base}/fitment/lookup`, { params }).pipe(
      map((result) => mapLookupResult(result)),
      catchError((err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 404) {
          return of([] as VehicleTrim[]); // no fitment data for this make/model/year — not an outage
        }
        return throwError(() => err);
      }),
    );
  }

  getTrim(trimId: string): Observable<VehicleTrim | undefined> {
    const parsed = parseTrimId(trimId);
    if (!parsed) {
      return of(undefined);
    }
    const params = new HttpParams()
      .set('make', parsed.makeSlug)
      .set('model', parsed.modelSlug)
      .set('year', String(parsed.year))
      .set('trim', parsed.trimSlug);
    return this.http.get<ApiFitmentLookupResult>(`${this.base}/fitment/lookup`, { params }).pipe(
      map((result) => mapLookupResult(result)[0]),
      catchError((err: unknown) =>
        this.notFoundOrRethrow<VehicleTrim>(`GET /fitment/lookup (trim ${trimId})`, err),
      ),
    );
  }

  // ───────────────────────────── internals ─────────────────────────────

  /** Fetch every product by paging through the list endpoint. */
  private fetchAllProducts(): Observable<ApiProduct[]> {
    const size = HttpFitmentDataService.PAGE_SIZE;
    return this.page(1, size).pipe(
      switchMap((first) => {
        const pages = Math.max(1, Math.ceil(first.total / size));
        if (pages <= 1) {
          return of(first.items);
        }
        const rest: Observable<ApiProduct[]>[] = [];
        for (let p = 2; p <= pages; p++) {
          rest.push(this.page(p, size).pipe(map((r) => r.items)));
        }
        return forkJoin(rest).pipe(
          map((chunks) => chunks.reduce((all, chunk) => all.concat(chunk), [...first.items])),
        );
      }),
    );
  }

  private page(page: number, pageSize: number): Observable<ApiProductList> {
    return this.http.get<ApiProductList>(`${this.base}/products?page=${page}&pageSize=${pageSize}`);
  }

  private fail<T>(label: string, err: unknown, fallback: T): Observable<T> {
    console.error(`[HttpFitmentDataService] ${label} failed; returning empty.`, err);
    return of(fallback);
  }

  /** A missing entity is a truthful 404; an API outage must not masquerade as one. */
  private notFoundOrRethrow<T>(label: string, err: unknown): Observable<T | undefined> {
    if (err instanceof HttpErrorResponse && err.status === 404) {
      return of(undefined);
    }
    console.error(`[HttpFitmentDataService] ${label} failed.`, err);
    return throwError(() => err);
  }
}
