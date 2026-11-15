import { randomUUID } from 'node:crypto';

import type { PublicAdmin } from '../auth/auth.service';

export interface AuditContext {
  actorId: string;
  actorEmail: string;
  correlationId: string;
  ipAddress?: string;
  userAgent?: string;
  /** Untrusted caller correlation, retained separately from the server-owned id. */
  clientRequestId?: string;
}

const SERVER_OWNED_CONTEXT = Symbol('server-owned-audit-context');

/** Runtime-branded context accepted by the V2 writer. Client request IDs are
 * evidence only; the authoritative correlation is always generated here. */
export interface ServerAuditContext {
  readonly serverCorrelationId: string;
  readonly causationId?: string;
  readonly clientRequestId?: string;
  readonly [SERVER_OWNED_CONTEXT]: true;
}

export interface AdminAuditRequest {
  user: PublicAdmin;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

export function auditContextFromRequest(request: AdminAuditRequest): AuditContext {
  const requestId = request.headers['x-request-id'];
  const userAgent = request.headers['user-agent'];
  return {
    actorId: request.user.id,
    actorEmail: request.user.email,
    correlationId: randomUUID(),
    clientRequestId: (Array.isArray(requestId) ? requestId[0] : requestId)?.slice(0, 128),
    ipAddress: request.ip?.slice(0, 64),
    userAgent: (Array.isArray(userAgent) ? userAgent[0] : userAgent)?.slice(0, 512),
  };
}

export function serverAuditContextFromRequest(request: Pick<AdminAuditRequest, 'headers'>): ServerAuditContext {
  const requestId = request.headers['x-request-id'];
  const candidate = (Array.isArray(requestId) ? requestId[0] : requestId)?.slice(0, 128);
  const clientRequestId = candidate && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate) ? candidate : undefined;
  return Object.freeze({
    serverCorrelationId: randomUUID(),
    ...(clientRequestId ? { clientRequestId } : {}),
    [SERVER_OWNED_CONTEXT]: true as const,
  });
}

export function serverAuditContextForInternal(causationId?: string): ServerAuditContext {
  return Object.freeze({
    serverCorrelationId: randomUUID(),
    ...(causationId ? { causationId: causationId.slice(0, 128) } : {}),
    [SERVER_OWNED_CONTEXT]: true as const,
  });
}

export function assertServerAuditContext(context: ServerAuditContext): void {
  if (!context || context[SERVER_OWNED_CONTEXT] !== true || !Object.isFrozen(context)) {
    throw new Error('AUDIT_CORRELATION_NOT_SERVER_OWNED');
  }
}
