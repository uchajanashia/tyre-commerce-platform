import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import type { ArgumentsHost, ExecutionContext } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import {
  ApiProblemBoundaryFilter,
  OperationContextGuard,
  SERVER_CORRELATION_HEADER,
  ServerCorrelationMiddleware,
} from './api-problem-boundary';

interface CapturedResponse {
  readonly headers: Map<string, string>;
  statusCode?: number;
  mediaType?: string;
  body?: unknown;
}

test('internal operations preserve auth, conflict and disabled statuses without leaking messages', () => {
  for (const status of [401, 403, 409, 503]) {
    const request = requestFor('POST', '/admin/v1/operations/orders/:id/issue');
    const captured = responseCapture();
    new OperationContextGuard().canActivate(executionContext(request, captured.response));
    new ApiProblemBoundaryFilter().catch(new HttpException('private database detail', status),
      argumentsHost(request, captured.response));
    assert.equal(captured.state.statusCode, status);
    assert.equal(JSON.stringify(captured.state.body).includes('private'), false);
    assert.equal(captured.state.headers.get('cache-control'), 'no-store');
  }
});

test('server correlation ignores spoofed input and problem header exactly equals the body', () => {
  const request = requestFor('GET', '/admin/v1/audit-events', {
    'x-server-correlation-id': 'caller-spoof',
  });
  const captured = responseCapture();
  new ServerCorrelationMiddleware().use(request, captured.response, (() => undefined) as NextFunction);
  new OperationContextGuard().canActivate(executionContext(request, captured.response));
  new ApiProblemBoundaryFilter().catch(
    new ServiceUnavailableException({ code: 'AUDIT_READER_DISABLED', raw: 'must-not-leak' }),
    argumentsHost(request, captured.response),
  );

  const body = captured.state.body as Record<string, unknown>;
  const correlation = captured.state.headers.get(SERVER_CORRELATION_HEADER.toLowerCase());
  assert.match(correlation ?? '', /^[0-9a-f-]{36}$/);
  assert.notEqual(correlation, 'caller-spoof');
  assert.equal(body.serverCorrelationId, correlation);
  assert.deepEqual(Object.keys(body).sort(), ['code', 'serverCorrelationId', 'status', 'title', 'type']);
  assert.equal(body.code, 'AUDIT_READER_DISABLED');
  assert.equal(captured.state.mediaType, 'application/problem+json');
  assert.equal(captured.state.headers.get('cache-control'), 'no-store');
});

test('cross-operation code swap and undeclared status normalize to exact registry defaults', () => {
  const request = requestFor('GET', '/admin/v1/audit-events');
  const captured = responseCapture();
  new ServerCorrelationMiddleware().use(request, captured.response, (() => undefined) as NextFunction);
  new OperationContextGuard().canActivate(executionContext(request, captured.response));
  const filter = new ApiProblemBoundaryFilter();

  filter.catch(
    new ServiceUnavailableException({ code: 'JOBS_READER_DISABLED' }),
    argumentsHost(request, captured.response),
  );
  assert.equal((captured.state.body as Record<string, unknown>).code, 'SERVICE_UNAVAILABLE');

  filter.catch(new HttpException({ code: 'TEAPOT', stack: 'secret' }, 418), argumentsHost(request, captured.response));
  const body = captured.state.body as Record<string, unknown>;
  assert.equal(captured.state.statusCode, 500);
  assert.equal(body.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(body).includes('secret'), false);
  assert.equal(JSON.stringify(body).includes('TEAPOT'), false);
});

test('unrouted framework failures preserve reviewed parser/not-found statuses without raw leakage', () => {
  for (const [status, expected] of [[400, 'INVALID_REQUEST'], [404, 'NOT_FOUND'], [413, 'PAYLOAD_TOO_LARGE'], [415, 'UNSUPPORTED_MEDIA_TYPE']] as const) {
    const request = requestFor('POST', '');
    const captured = responseCapture();
    new ServerCorrelationMiddleware().use(request, captured.response, (() => undefined) as NextFunction);
    new ApiProblemBoundaryFilter().catch(
      new HttpException({ message: ['raw parser value'], error: 'stack/provider detail' }, status),
      argumentsHost(request, captured.response),
    );
    const body = captured.state.body as Record<string, unknown>;
    assert.equal(captured.state.statusCode, status);
    assert.equal(body.code, expected);
    assert.equal(JSON.stringify(body).includes('raw parser'), false);
    assert.equal(captured.state.headers.get('cache-control'), 'no-store');
    assert.equal(body.serverCorrelationId, captured.state.headers.get('x-server-correlation-id'));
  }
});

function requestFor(method: string, path: string, headers: Record<string, string> = {}): Request {
  return { method, path, headers, route: { path } } as unknown as Request;
}

function responseCapture(): { response: Response; state: CapturedResponse } {
  const state: CapturedResponse = { headers: new Map<string, string>() };
  const response = {
    setHeader(name: string, value: string) { state.headers.set(name.toLowerCase(), String(value)); return this; },
    removeHeader(name: string) { state.headers.delete(name.toLowerCase()); return this; },
    status(value: number) { state.statusCode = value; return this; },
    type(value: string) { state.mediaType = value; return this; },
    json(value: unknown) { state.body = value; return this; },
  } as unknown as Response;
  return { response, state };
}

function executionContext(request: Request, response: Response): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response, getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

function argumentsHost(request: Request, response: Response): ArgumentsHost {
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response, getNext: () => undefined }),
  } as unknown as ArgumentsHost;
}
