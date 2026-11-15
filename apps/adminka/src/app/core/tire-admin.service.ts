import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import {
  AdminPhoto,
  AdminProduct,
  AdminTireModelDetail,
  AdminTireModelList,
  AdminTireModelListItem,
  CreateProductRequest,
  CreateTireModelRequest,
  ReorderPhotosRequest,
  UpdateProductRequest,
  UpdateTireModelRequest,
} from '@tyre/shared';

import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TireAdminService {
  private readonly http = inject(HttpClient);
  private readonly models = `${environment.apiBaseUrl}/admin/tire-models`;
  private readonly products = `${environment.apiBaseUrl}/admin/products`;

  list(opts: {
    page: number;
    pageSize: number;
    brand?: string;
    q?: string;
    photos?: 'with' | 'without';
  }): Observable<AdminTireModelList> {
    let params = new HttpParams().set('page', opts.page).set('pageSize', opts.pageSize);
    if (opts.brand) params = params.set('brand', opts.brand);
    if (opts.q) params = params.set('q', opts.q);
    if (opts.photos) params = params.set('photos', opts.photos);
    return this.http.get<AdminTireModelList>(this.models, { params });
  }

  detail(id: string): Observable<AdminTireModelDetail> {
    return this.http.get<AdminTireModelDetail>(`${this.models}/${id}`);
  }

  createModel(body: CreateTireModelRequest): Observable<AdminTireModelListItem> {
    return this.http.post<AdminTireModelListItem>(this.models, body);
  }

  renameModel(id: string, body: UpdateTireModelRequest): Observable<AdminTireModelListItem> {
    return this.http.patch<AdminTireModelListItem>(`${this.models}/${id}`, body);
  }

  removeModel(id: string): Observable<{ deleted: true }> {
    return this.http.delete<{ deleted: true }>(`${this.models}/${id}`);
  }

  createProduct(modelId: string, body: CreateProductRequest): Observable<AdminProduct> {
    return this.http.post<AdminProduct>(`${this.models}/${modelId}/products`, body);
  }

  updateProduct(id: string, body: UpdateProductRequest): Observable<AdminProduct> {
    return this.http.patch<AdminProduct>(`${this.products}/${id}`, body);
  }

  removeProduct(id: string): Observable<{ deleted: true }> {
    return this.http.delete<{ deleted: true }>(`${this.products}/${id}`);
  }

  uploadPhotos(modelId: string, files: File[]): Observable<AdminPhoto[]> {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    return this.http.post<AdminPhoto[]>(`${this.models}/${modelId}/photos`, form);
  }

  reorderPhotos(modelId: string, photoIds: string[]): Observable<AdminPhoto[]> {
    const body: ReorderPhotosRequest = { photoIds };
    return this.http.patch<AdminPhoto[]>(`${this.models}/${modelId}/photos/reorder`, body);
  }

  removePhoto(photoId: string): Observable<{ deleted: true }> {
    return this.http.delete<{ deleted: true }>(`${environment.apiBaseUrl}/admin/photos/${photoId}`);
  }
}
