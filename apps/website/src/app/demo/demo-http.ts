import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import tires from '@data/tires.json';

/** Offline demo transport. Never forwards requests to a provider or live API. */
export const demoHttp: HttpInterceptorFn = (request) => {
  if (request.url.endsWith('/checkout/config')) return of(new HttpResponse({body:{enabled:false}}));
  if (request.url.endsWith('/cart/quote') && request.method === 'POST') {
    const body = request.body as {items?:{productId:string;quantity:number}[]};
    const items = (body.items ?? []).map(line => {
      const product = tires.find(tire => tire.id === line.productId);
      const quantity = Math.min(4,Math.max(1,Math.trunc(line.quantity)));
      const available = !!product && product.inStock >= quantity;
      return {productId:line.productId,code:null,name:product?.model ?? null,quantity,available,
        issue:!product?'not_found':available?null:'insufficient_quantity',
        unitPrice:product?.priceGel ?? null,lineTotal:product ? product.priceGel * quantity : null,currency:'GEL'};
    });
    return of(new HttpResponse({body:{items,total:items.reduce((sum,item)=>sum+(item.lineTotal??0),0),currency:'GEL',allAvailable:items.every(item=>item.available)}}));
  }
  return throwError(() => new HttpErrorResponse({status:501,error:{message:'Unavailable in the offline portfolio demo.'}}));
};
