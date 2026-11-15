import { randomUUID } from 'node:crypto';

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import problemRegistryJson from './api-problem-registry.generated.json';
import { OPERATIONS_PROBLEM_ENTRIES } from '../operations/operations-problem-registry';

export const SERVER_CORRELATION_HEADER = 'X-Server-Correlation-Id';

const CORRELATION = Symbol('tyre.serverCorrelationId');
const CODE = /^[A-Z][A-Z0-9_]{1,127}$/;

type CorrelatedRequest = Request & { [CORRELATION]?: string };
const OPERATION = Symbol('tyre.operationId');
type OperationRequest = CorrelatedRequest & { [OPERATION]?: string };

interface ProblemRegistryEntry {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly codes: readonly string[];
  readonly defaultCode: string | null;
  readonly requiredHeaders: readonly string[];
}
interface ProblemRegistry { readonly version: 1; readonly specDigest: string; readonly entries: readonly ProblemRegistryEntry[] }
const PROBLEM_REGISTRY = problemRegistryJson as ProblemRegistry;
const PROBLEM_ENTRIES = [...PROBLEM_REGISTRY.entries, ...OPERATIONS_PROBLEM_ENTRIES];

/**
 * Creates the correlation value before guards/interceptors execute. An inbound
 * value is deliberately ignored: correlation identity is server-owned.
 */
@Injectable()
export class ServerCorrelationMiddleware implements NestMiddleware {
  use(request: CorrelatedRequest, response: Response, next: NextFunction): void {
    ensureServerCorrelation(request, response);
    next();
  }
}

export function earlyServerCorrelation(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  ensureServerCorrelation(request as CorrelatedRequest, response);
  next();
}

function ensureServerCorrelation(request: CorrelatedRequest, response: Response): string {
  const serverCorrelationId = request[CORRELATION] ?? randomUUID();
  request[CORRELATION] = serverCorrelationId;
  response.setHeader(SERVER_CORRELATION_HEADER, serverCorrelationId);
  return serverCorrelationId;
}

/** Captures trusted Nest controller/handler metadata before any route guard. */
@Injectable()
export class OperationContextGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<OperationRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const route = request.route as { path?: unknown } | undefined;
    const path = typeof route?.path === 'string' ? route.path : '';
    const candidates = PROBLEM_ENTRIES.filter(
      (entry) => entry.method === request.method.toUpperCase() && entry.path === path,
    );
    const operationIds = new Set(candidates.map(({ operationId }) => operationId));
    if (operationIds.size === 1) request[OPERATION] = [...operationIds][0];
    const success = candidates.find(({ codes }) => codes.length === 0);
    if (success?.requiredHeaders.includes('Cache-Control')) response.setHeader('Cache-Control', 'no-store');
    return true;
  }
}

/** A deliberately small, closed RFC 9457 response representation. */
export interface ApiProblemBody {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly serverCorrelationId: string;
}

@Catch()
export class ApiProblemBoundaryFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<OperationRequest>();
    const response = http.getResponse<Response>();
    const serverCorrelationId = request[CORRELATION] ?? randomUUID();
    const requestedStatus = safeStatus(exception);
    const operationId = request[OPERATION];
    const entry = registryEntry(operationId, requestedStatus) ?? registryEntry(operationId, 500) ?? frameworkEntry(requestedStatus);
    const status = entry?.status ?? 500;
    const candidate = safeCandidateCode(exception);
    const code = entry?.codes.includes(candidate)
      ? candidate
      : entry?.defaultCode ?? 'INTERNAL_ERROR';

    // Force a single server value even when an upstream layer attempted to
    // append or reflect a caller-supplied correlation header.
    response.setHeader(SERVER_CORRELATION_HEADER, serverCorrelationId);
    if (entry?.requiredHeaders.includes('Cache-Control')) response.setHeader('Cache-Control', 'no-store');
    else response.removeHeader('Cache-Control');
    response
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: safeTitle(status),
        status,
        code,
        serverCorrelationId,
      } satisfies ApiProblemBody);
  }
}

function safeStatus(exception: unknown): number {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return Number.isInteger(status) ? status : 500;
  }
  if (exception && typeof exception === 'object') {
    const candidate = exception as { type?: unknown; status?: unknown; statusCode?: unknown };
    const declared = candidate.statusCode ?? candidate.status;
    if (candidate.type === 'entity.too.large' && declared === 413) return 413;
    if (candidate.type === 'entity.parse.failed' && declared === 400) return 400;
    if (candidate.type === 'encoding.unsupported' && declared === 415) return 415;
  }
  return 500;
}

function safeCandidateCode(exception: unknown): string {
  if (!(exception instanceof HttpException)) return '';
  const value = exception.getResponse();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const code = (value as Record<string, unknown>).code;
  return typeof code === 'string' && CODE.test(code) ? code : '';
}

function safeTitle(status: number): string {
  const title = HttpStatus[status];
  return typeof title === 'string' ? title.replaceAll('_', ' ') : 'Internal Server Error';
}

/**
 * Reviewed preservation of existing explicit runtime codes. The normalizer
 * never accepts a code merely because it matches a regex: both route family
 * and status must admit it. Unknown values collapse to the status default.
 */
function registryEntry(operationId: string | undefined, status: number): ProblemRegistryEntry | undefined {
  if (!operationId) return undefined;
  return PROBLEM_ENTRIES.find(
    (entry) => entry.operationId === operationId && entry.status === status,
  );
}

function frameworkEntry(requestedStatus: number): ProblemRegistryEntry {
  const accepted: Readonly<Record<number, string>> = {
    400: 'INVALID_REQUEST',
    404: 'NOT_FOUND',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_ERROR',
  };
  const status = accepted[requestedStatus] ? requestedStatus : 500;
  const code = accepted[status] ?? 'INTERNAL_ERROR';
  return {
    operationId: '__framework__', method: '*', path: '*', status,
    codes: [code], defaultCode: code,
    requiredHeaders: [SERVER_CORRELATION_HEADER, 'Cache-Control'],
  };
}
