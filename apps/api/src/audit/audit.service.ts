import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { sanitizeAuditValue } from './audit-sanitizer';

export const AUDIT_ACTION_ALLOWLIST = new Set([
  'customer.order_contacts.read', 'customer.history.read',
  'inventory.allocate', 'inventory.issue', 'inventory.return', 'inventory.count',
  'payment.refund.request', 'payment.refund.reconcile',
  'catalog.brand.create', 'catalog.brand.rename', 'catalog.brand.delete',
  'catalog.photo.upload', 'catalog.photo.reorder', 'catalog.photo.delete',
  'catalog.tire_model.create', 'catalog.tire_model.rename', 'catalog.tire_model.delete',
  'catalog.product.create', 'catalog.product.update', 'catalog.product.delete',
  'security.sessions.revoke_all', 'security.totp_key.compromised', 'security.totp_key_rotation.progress',
  'security.jwt_key.compromised', 'security.envelope_key.compromised', 'security.digest_key.compromised',
  'security.artifact_reissue.batch', 'security.identity_canonicalization.completed',
  'auth.login.succeeded', 'auth.login.failed', 'auth.login.rate_limited',
  'auth.mfa.challenge.failed', 'auth.mfa.challenge.succeeded', 'auth.mfa.enrolled', 'auth.mfa.enrollment.prepared',
  'auth.mfa.recovery_code.used', 'auth.cutover.enforced', 'auth.key.rotated', 'auth.key.revoked',
  'auth.session.created', 'auth.session.rotated', 'auth.session.revoked', 'auth.session.revoke_all',
  'auth.refresh.expired', 'auth.refresh.idempotent_replay', 'auth.refresh.receipt_failed', 'auth.refresh.reuse_detected',
  'auth.password_reset.requested', 'auth.password_reset.completed',
  'staff.created', 'staff.activated', 'staff.disabled', 'staff.reenabled', 'staff.assignment.changed',
  'staff.invite.issued', 'staff.invite.resent', 'staff.invite.failed', 'staff.invite.consumed',
  'staff.password_reset.issued', 'staff.recovery.issued', 'staff.recovery.consumed', 'staff.session.revoked',
  'staff.recovery.requested', 'staff.recovery.approved', 'staff.recovery.rejected', 'staff.recovery.executed',
  'approval.policy.proposed', 'approval.policy.reviewed', 'approval.policy.approved',
  'approval.policy.rejected', 'approval.policy.activated', 'approval.policy.retired',
  'approval.request.created', 'approval.request.approved', 'approval.request.rejected',
  'approval.request.cancelled', 'approval.request.expired', 'approval.request.stale',
  'approval.decision.recorded', 'approval.execution.authorized',
]);

export interface AuditWrite {
  actorId?: string;
  actorEmail?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  correlationId: string;
  ipAddress?: string;
  userAgent?: string;
  clientRequestId?: string;
  metadata?: unknown;
}

@Injectable()
export class AuditService {
  /** Use inside the same interactive transaction as the privileged mutation. */
  recordWithClient(client: Pick<Prisma.TransactionClient, 'auditEvent'>, event: AuditWrite) {
    if (!AUDIT_ACTION_ALLOWLIST.has(event.action)) {
      throw new Error(`Audit action is not allowlisted: ${event.action}`);
    }
    return client.auditEvent.create({
      data: {
        actorId: event.actorId,
        actorEmail: event.actorEmail,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        before: event.before === undefined ? undefined : sanitizeAuditValue(event.before) as Prisma.InputJsonValue,
        after: event.after === undefined ? undefined : sanitizeAuditValue(event.after) as Prisma.InputJsonValue,
        correlationId: event.correlationId,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        metadata: event.metadata === undefined && !event.clientRequestId
          ? undefined
          : sanitizeAuditValue({
              ...(event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
                ? event.metadata as Record<string, unknown>
                : event.metadata === undefined ? {} : { value: event.metadata }),
              ...(event.clientRequestId ? { clientRequestId: event.clientRequestId } : {}),
            }) as Prisma.InputJsonValue,
      },
    });
  }
}
