import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  OrderWorkflow,
  WorkflowConfig,
  StockHistory,
  ItemMovementCommand,
  RefundCommand,
  StockCountCommand,
  OperationsPage,
  OperationsSummary,
  OperationsView,
  VehicleAssignment,
} from '@tyre/shared';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class OperationsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.identityApiBaseUrl}/operations`;
  config() {
    return this.http.get<WorkflowConfig>(`${this.base}/config`);
  }
  workflow(id: string) {
    return this.http.get<OrderWorkflow>(`${this.base}/orders/${encodeURIComponent(id)}/workflow`);
  }
  customerHistory(id: string, page = 1) {
    return this.http.get<OperationsPage>(
      `${this.base}/customers/${encodeURIComponent(id)}/history`,
      { params: { page, pageSize: 25 } },
    );
  }
  stockHistory(id: string, page = 1) {
    return this.http.get<StockHistory[]>(
      `${this.base}/inventory/${encodeURIComponent(id)}/history`,
      { params: { page, pageSize: 25 } },
    );
  }
  move(id: string, kind: 'issue' | 'return', body: ItemMovementCommand) {
    return this.http.post(`${this.base}/orders/${encodeURIComponent(id)}/${kind}`, body);
  }
  allocate(id: string, requestId: string) {
    return this.http.post(`${this.base}/orders/${encodeURIComponent(id)}/allocate`, { requestId });
  }
  refund(id: string, body: RefundCommand) {
    return this.http.post(`${this.base}/orders/${encodeURIComponent(id)}/refunds`, body);
  }
  count(id: string, body: StockCountCommand) {
    return this.http.post(`${this.base}/inventory/${encodeURIComponent(id)}/count`, body);
  }
  summary() {
    return this.http.get<OperationsSummary>(`${this.base}/summary`);
  }
  list(view: OperationsView, page: number, q: string, status: string) {
    const params = new HttpParams()
      .set('page', page)
      .set('pageSize', 25)
      .set('q', q)
      .set('status', status);
    return this.http.get<OperationsPage>(`${this.base}/${view}`, { params });
  }
  assign(id: string, body: VehicleAssignment) {
    return this.http.patch<{ classification: string; updatedAt: string }>(
      `${this.base}/vehicles/${encodeURIComponent(id)}`,
      body,
    );
  }
}
