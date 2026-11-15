import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Inject, Injectable, InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

import { AdminApiClient, ApiProblemError } from '@tyre/admin-api-client';

import { ADMIN_API_FETCH } from './generated-admin-read-transport';

export const ADMIN_REQUEST_ORIGIN = new InjectionToken<string>('ADMIN_REQUEST_ORIGIN', {
  providedIn: 'root',
  factory: () => globalThis.location.origin,
});

/** Generated Identity transport with same-origin cookies and unsubscribe-driven cancellation. */
@Injectable({ providedIn: 'root' })
export class GeneratedIdentityTransport {
  constructor(@Inject(ADMIN_API_FETCH) private readonly fetchImplementation: typeof fetch) {}

  request<T>(
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
          if (!subscriber.closed) subscriber.error(identityTransportError(error));
        },
      );

      return () => {
        if (!settled) controller.abort();
      };
    });
  }
}

function identityTransportError(error: unknown): unknown {
  if (!(error instanceof ApiProblemError)) return error;
  return new HttpErrorResponse({
    status: error.httpStatus,
    statusText: error.problem.title ?? error.problem.code,
    error: error.problem,
    headers: error.serverCorrelationId
      ? new HttpHeaders({ 'X-Server-Correlation-Id': error.serverCorrelationId })
      : undefined,
  });
}
