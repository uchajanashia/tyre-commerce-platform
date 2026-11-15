import { Injectable } from '@angular/core';
import { of } from 'rxjs';
import tiresJson from '@data/tires.json';
import { Tire } from '@core/models';
import { TirePageQuery } from '@core/services/fitment-data.service';
import { MockFitmentDataService } from '@core/services/mock-fitment-data.service';

/** Synthetic catalog adapter; production continues to use HttpFitmentDataService. */
@Injectable()
export class DemoCatalog extends MockFitmentDataService {
  override getTiresPage(query:TirePageQuery) {
    let items = tiresJson as Tire[];
    if(query.catalogClass) items=items.filter(t=>(t.catalogClass??'passenger')===query.catalogClass);
    if(query.category?.length) items=items.filter(t=>query.category!.includes(t.category??(t.season==='winter'?'winter_at':t.season==='summer'?'summer':'all_season')));
    if(query.season) items=items.filter(t=>t.season===query.season);
    if(query.brand) items=items.filter(t=>t.brandId===query.brand);
    if(query.width) items=items.filter(t=>t.size.widthMm===query.width);
    if(query.profile) items=items.filter(t=>t.size.aspect===query.profile);
    if(query.diameter) items=items.filter(t=>t.size.rimDiameterInch===query.diameter);
    if(query.sort) items=[...items].sort((a,b)=>(a.priceGel-b.priceGel)*(query.sort==='price-desc'?-1:1));
    const start=(query.page-1)*query.pageSize;
    return of({items:items.slice(start,start+query.pageSize),total:items.length,page:query.page,pageSize:query.pageSize});
  }
}
