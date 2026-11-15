import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

import brandsJson from '@data/brands.json';
import fitmentsJson from '@data/fitments.json';
import tiresJson from '@data/tires.json';
import vehiclesJson from '@data/vehicles.json';

import { Brand, Make, Tire, VehicleModel, VehicleTireFitment, VehicleTrim } from '../models';
import { FitmentDataService, SizeFacets, TirePage, TirePageQuery } from './fitment-data.service';

/**
 * Test-only JSON-fixture implementation; production never provides this class.
 * `vehicles.json` trims reference fitments.json
 * by `fitmentId`; this service joins them into the `VehicleTrim` domain shape so
 * components only ever see the spec-04 interfaces.
 */
@Injectable()
export class MockFitmentDataService extends FitmentDataService {
  private readonly makes = vehiclesJson.makes as Make[];
  private readonly models = vehiclesJson.models as VehicleModel[];
  private readonly brands = brandsJson as Brand[];
  private readonly tires = tiresJson as Tire[];

  private readonly trims: VehicleTrim[] = vehiclesJson.trims.map((trim) => {
    const fitment = (fitmentsJson as Record<string, VehicleTireFitment | undefined>)[trim.fitmentId];
    if (!fitment) {
      throw new Error(`Fixture error: trim "${trim.id}" references unknown fitment "${trim.fitmentId}"`);
    }
    return {
      id: trim.id,
      modelId: trim.modelId,
      name: trim.name,
      fitment,
      visual: trim.visual as VehicleTrim['visual'],
    };
  });

  getMakes(): Observable<Make[]> {
    return of(this.makes);
  }

  getModels(makeId: string): Observable<VehicleModel[]> {
    return of(this.models.filter((m) => m.makeId === makeId));
  }

  getModel(modelId: string): Observable<VehicleModel | undefined> {
    return of(this.models.find((m) => m.id === modelId));
  }

  /** Fixture models always carry yearFrom/yearTo, so the range is derived rather
   *  than fabricated; `_makeId` is unused (fixture ids are already model-scoped). */
  getYears(_makeId: string, modelId: string): Observable<number[]> {
    const model = this.models.find((m) => m.id === modelId);
    if (!model || model.yearFrom === undefined) {
      return of([]);
    }
    const to = model.yearTo ?? new Date().getFullYear();
    const years: number[] = [];
    for (let y = to; y >= model.yearFrom; y--) years.push(y);
    return of(years);
  }

  /** `_makeId` is unused because fixture trims aren't year-scoped. */
  getTrims(_makeId: string, modelId: string): Observable<VehicleTrim[]> {
    return of(this.trims.filter((t) => t.modelId === modelId));
  }

  getTrim(trimId: string): Observable<VehicleTrim | undefined> {
    return of(this.trims.find((t) => t.id === trimId));
  }

  getBrands(): Observable<Brand[]> {
    return of(this.brands);
  }

  getBrand(brandId: string): Observable<Brand | undefined> {
    return of(this.brands.find((brand) => brand.id === brandId));
  }

  getTires(): Observable<Tire[]> {
    return of(this.tires);
  }

  getTire(tireId: string): Observable<Tire | undefined> {
    return of(this.tires.find((t) => t.id === tireId));
  }

  /** Client-side slice that mirrors the API's filter/sort/paginate semantics. */
  getTiresPage(query: TirePageQuery): Observable<TirePage> {
    let list = this.tires;
    if (query.season) {
      list = list.filter((t) => t.season === query.season);
    }
    if (query.brand) {
      list = list.filter((t) => t.brandId === query.brand);
    }
    if (query.width !== undefined) {
      list = list.filter((t) => t.size.widthMm === query.width);
    }
    if (query.profile !== undefined) {
      list = list.filter((t) => t.size.aspect === query.profile);
    }
    if (query.diameter !== undefined) {
      list = list.filter((t) => t.size.rimDiameterInch === query.diameter);
    }
    if (query.sort) {
      const dir = query.sort === 'price-desc' ? -1 : 1;
      list = [...list].sort((a, b) => (a.priceGel - b.priceGel) * dir);
    }
    const total = list.length;
    const start = (query.page - 1) * query.pageSize;
    return of({
      items: list.slice(start, start + query.pageSize),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  getRadiusFacets(): Observable<number[]> {
    return of(
      [...new Set(this.tires.map((t) => t.size.rimDiameterInch))].sort((a, b) => a - b),
    );
  }

  getSizeFacets(): Observable<SizeFacets> {
    const distinct = (values: (number | undefined)[]): number[] =>
      [...new Set(values.filter((v): v is number => v !== undefined))].sort((a, b) => a - b);
    return of({
      widths: distinct(this.tires.map((t) => t.size.widthMm)),
      profiles: distinct(this.tires.map((t) => t.size.aspect)),
      diameters: distinct(this.tires.map((t) => t.size.rimDiameterInch)),
      inchSizes: [],
    });
  }
}
