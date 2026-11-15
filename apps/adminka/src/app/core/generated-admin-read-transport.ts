import { Inject, Injectable, InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

import { AdminApiClient, RequestByOperation, ResponseByOperation } from '@tyre/admin-api-client';

export const ADMIN_API_FETCH = new InjectionToken<typeof fetch>('ADMIN_API_FETCH', {
  providedIn: 'root',
  factory: () => globalThis.fetch.bind(globalThis),
});

/**
 * Narrow generated-client boundary for the contract-parity-approved Audit and Jobs reads.
 * The generated client owns operation IDs, paths and wire serialization; this adapter owns
 * Observable cancellation and passes the existing memory-only bearer token to one request.
 */
@Injectable({ providedIn: 'root' })
export class GeneratedAdminReadTransport {
  constructor(@Inject(ADMIN_API_FETCH) private readonly fetchImplementation: typeof fetch) {}

  listAuditEvents(
    query: RequestByOperation['audit-reader.list']['query'],
    accessToken: string | null,
  ): Observable<ResponseByOperation['audit-reader.list']> {
    return this.request(accessToken, (client, signal) =>
      client.request('audit-reader.list', { query, signal }),
    );
  }

  getAuditEvent(
    id: string,
    accessToken: string | null,
  ): Observable<ResponseByOperation['audit-reader.detail']> {
    return this.request(accessToken, (client, signal) =>
      client.request('audit-reader.detail', { path: { id }, signal }),
    );
  }

  listJobs(
    query: RequestByOperation['jobs-reader.list']['query'],
    accessToken: string | null,
  ): Observable<ResponseByOperation['jobs-reader.list']> {
    return this.request(accessToken, (client, signal) =>
      client.request('jobs-reader.list', { query, signal }),
    );
  }

  getJob(
    id: string,
    accessToken: string | null,
  ): Observable<ResponseByOperation['jobs-reader.detail']> {
    return this.request(accessToken, (client, signal) =>
      client.request('jobs-reader.detail', { path: { id }, signal }),
    );
  }

  private request<T>(
    accessToken: string | null,
    execute: (client: AdminApiClient, signal: AbortSignal) => Promise<T>,
  ): Observable<T> {
    return new Observable<T>((subscriber) => {
      const controller = new AbortController();
      const client = new AdminApiClient({
        fetch: this.fetchImplementation,
        credentials: 'same-origin',
        getAccessToken: () => accessToken ?? undefined,
      });
      let settled = false;

      void execute(client, controller.signal).then(
        (response) => {
          settled = true;
          if (!subscriber.closed) {
            subscriber.next(response);
            subscriber.complete();
          }
        },
        (error: unknown) => {
          settled = true;
          if (!subscriber.closed) subscriber.error(error);
        },
      );

      return () => {
        if (!settled) controller.abort();
      };
    });
  }
}
