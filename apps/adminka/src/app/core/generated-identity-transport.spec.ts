import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { ApiContractDecodeError } from '@tyre/admin-api-client';

import { GeneratedIdentityTransport } from './generated-identity-transport';

describe('GeneratedIdentityTransport', () => {
  it('aborts an in-flight generated Identity request on unsubscribe', () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;
    const transport = new GeneratedIdentityTransport(fetchMock);

    const subscription = transport
      .request('memory-token', (client, requestSignal) =>
        client.request('identity-auth.me', { signal: requestSignal }),
      )
      .subscribe();
    expect(signal?.aborted).toBe(false);
    subscription.unsubscribe();

    expect(signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('preserves the exact closed API problem and server correlation for existing UI handling', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: 403,
            code: 'FORBIDDEN',
            serverCorrelationId: 'correlation-1',
            type: 'about:blank',
            title: 'Forbidden',
          }),
          {
            status: 403,
            headers: {
              'Content-Type': 'application/problem+json',
              'X-Server-Correlation-Id': 'correlation-1',
            },
          },
        ),
      ),
    ) as unknown as typeof fetch;
    const transport = new GeneratedIdentityTransport(fetchMock);

    const error = await firstValueFrom(
      transport.request('memory-token', (client, signal) =>
        client.request('identity-auth.me', { signal }),
      ),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(error).toEqual(
      expect.objectContaining({
        status: 403,
        error: {
          status: 403,
          code: 'FORBIDDEN',
          serverCorrelationId: 'correlation-1',
          type: 'about:blank',
          title: 'Forbidden',
        },
      }),
    );
    expect((error as HttpErrorResponse).headers.get('X-Server-Correlation-Id')).toBe(
      'correlation-1',
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects a valid success body returned with the wrong 2xx status', async () => {
    const fetchMock = responseFetch(
      {
        requestedActionHash: 'action-hash',
        emailNormalized: 'new@tyre.ge',
        assignments: [],
        mfaRequired: true,
      },
      200,
    );
    const transport = new GeneratedIdentityTransport(fetchMock);

    const error = await firstValueFrom(
      transport.request('memory-token', (client, signal) =>
        client.request('staff-admin.preview-create', {
          headers: { Origin: 'https://admin.tyre.test' },
          body: { email: 'new@tyre.ge', mfaRequired: true, assignments: [] },
          signal,
        }),
      ),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiContractDecodeError);
    expect(error).toEqual(
      expect.objectContaining({
        operationId: 'staff-admin.preview-create',
        pointer: '/',
        reason: 'success-status',
      }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('preserves a strict disabled problem and rejects malformed error bodies', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        problemResponse(
          503,
          {
            status: 503,
            code: 'IDENTITY_V2_DISABLED',
            serverCorrelationId: 'correlation-2',
            type: 'about:blank',
            title: 'Identity disabled',
          },
          'correlation-2',
        ),
      )
      .mockResolvedValueOnce(
        problemResponse(
          403,
          { code: 'FORBIDDEN', serverCorrelationId: 'correlation-3' },
          'correlation-3',
        ),
      );
    const transport = new GeneratedIdentityTransport(fetchMock as unknown as typeof fetch);

    const disabled = await firstValueFrom(
      transport.request('memory-token', (client, signal) =>
        client.request('identity-auth.me', { signal }),
      ),
    ).catch((caught: unknown) => caught);
    expect(disabled).toEqual(
      expect.objectContaining({
        status: 503,
        error: expect.objectContaining({
          status: 503,
          code: 'IDENTITY_V2_DISABLED',
        }),
      }),
    );

    const malformed = await firstValueFrom(
      transport.request('memory-token', (client, signal) =>
        client.request('identity-auth.me', { signal }),
      ),
    ).catch((caught: unknown) => caught);
    expect(malformed).toBeInstanceOf(ApiContractDecodeError);
    expect(malformed).toEqual(expect.objectContaining({ pointer: '/status', reason: 'required' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function responseFetch(body: unknown, status: number): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'X-Server-Correlation-Id': 'transport-correlation',
        },
      }),
    ),
  ) as unknown as typeof fetch;
}

function problemResponse(status: number, body: unknown, correlation: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/problem+json',
      'X-Server-Correlation-Id': correlation,
    },
  });
}
