import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { AdminBrand, CreateBrandRequest, UpdateBrandRequest } from '@tyre/shared';

import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class BrandAdminService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/admin/brands`;

  list(): Observable<AdminBrand[]> {
    return this.http.get<AdminBrand[]>(this.base);
  }

  create(name: string): Observable<AdminBrand> {
    const body: CreateBrandRequest = { name };
    return this.http.post<AdminBrand>(this.base, body);
  }

  rename(id: string, name: string): Observable<AdminBrand> {
    const body: UpdateBrandRequest = { name };
    return this.http.patch<AdminBrand>(`${this.base}/${id}`, body);
  }

  remove(id: string): Observable<{ deleted: true }> {
    return this.http.delete<{ deleted: true }>(`${this.base}/${id}`);
  }
}
