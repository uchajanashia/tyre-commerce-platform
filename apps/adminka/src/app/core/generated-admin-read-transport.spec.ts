import { firstValueFrom } from 'rxjs';

import { ApiContractDecodeError } from '@tyre/admin-api-client';
import { AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1, JOB_CONTRACT_FIXTURE_V1 } from '@tyre/shared';

import { GeneratedAdminReadTransport } from './generated-admin-read-transport';

describe('GeneratedAdminReadTransport compatibility', () => {
  it('maps Audit list to the stable generated operation with exact query and auth semantics', async () => {
    const fetchMock = responseFetch(AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.listPage);
    const transport = new GeneratedAdminReadTransport(fetchMock);

    await firstValueFrom(
      transport.listAuditEvents(
        {
          source: 'admin_api',
          outcome: 'denied',
          sortField: 'occurredAt',
          sortDirection: 'desc',
          cursor: 'opaque cursor',
        },
        'memory-token',
      ),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expectRequest(fetchMock, {
      url: '/admin/v1/audit-events?source=admin_api&outcome=denied&sortField=occurredAt&sortDirection=desc&cursor=opaque+cursor',
      authorization: 'Bearer memory-token',
    });
  });

  it('maps Audit detail to the stable generated operation and encodes the path once', async () => {
    const fetchMock = responseFetch(AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.detail);
    const transport = new GeneratedAdminReadTransport(fetchMock);

    await firstValueFrom(transport.getAuditEvent('event/wrong scope', null));

    expectRequest(fetchMock, {
      url: '/admin/v1/audit-events/event%2Fwrong%20scope',
      authorization: null,
    });
  });

  it('maps Jobs list to the stable generated operation without local wire serialization', async () => {
    const fetchMock = responseFetch(JOB_CONTRACT_FIXTURE_V1.listPage);
    const transport = new GeneratedAdminReadTransport(fetchMock);

    await firstValueFrom(
      transport.listJobs(
        {
          state: 'dead_lettered',
          pageSize: 25,
          sortField: 'priority',
          sortDirection: 'asc',
          cursor: 'jobs-cursor',
        },
        'memory-token',
      ),
    );

    expectRequest(fetchMock, {
      url: '/admin/v1/jobs?state=dead_lettered&pageSize=25&sortField=priority&sortDirection=asc&cursor=jobs-cursor',
      authorization: 'Bearer memory-token',
    });
  });

  it('maps Jobs detail to the stable generated operation and preserves same-origin cookies', async () => {
    const fetchMock = responseFetch(JOB_CONTRACT_FIXTURE_V1.detail);
    const transport = new GeneratedAdminReadTransport(fetchMock);

    await firstValueFrom(transport.getJob('job/with scope', 'memory-token'));

    expectRequest(fetchMock, {
      url: '/admin/v1/jobs/job%2Fwith%20scope',
      authorization: 'Bearer memory-token',
    });
  });

  it('aborts the generated fetch when a latest-only reader unsubscribes', () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }) as unknown as typeof fetch;
    const transport = new GeneratedAdminReadTransport(fetchMock);

    const subscription = transport.getAuditEvent('event-1', 'memory-token').subscribe();
    expect(capturedSignal?.aborted).toBe(false);
    subscription.unsubscribe();

    expect(capturedSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects an Audit GET body returned with a non-contract success status', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.listPage), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            'X-Server-Correlation-Id': 'transport-correlation',
          },
        }),
      ),
    ) as unknown as typeof fetch;
    const transport = new GeneratedAdminReadTransport(fetchMock);

    const error = await firstValueFrom(transport.listAuditEvents({}, 'memory-token')).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ApiContractDecodeError);
    expect(error).toEqual(
      expect.objectContaining({
        operationId: 'audit-reader.list',
        pointer: '/',
        reason: 'success-status',
      }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

function responseFetch(body: unknown): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Server-Correlation-Id': 'transport-correlation',
        },
      }),
    ),
  ) as unknown as typeof fetch;
}

function expectRequest(
  fetchMock: typeof fetch,
  expected: { readonly url: string; readonly authorization: string | null },
): void {
  const [url, init] = vi.mocked(fetchMock).mock.calls[0] ?? [];
  expect(url).toBe(expected.url);
  expect(init?.method).toBe('GET');
  expect(init?.credentials).toBe('same-origin');
  expect(init?.body).toBeUndefined();
  expect(new Headers(init?.headers).get('Authorization')).toBe(expected.authorization);
  expect(new Headers(init?.headers).get('Accept')).toBe('application/json');
  expect(init?.signal).toBeInstanceOf(AbortSignal);
}
