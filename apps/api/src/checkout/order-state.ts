import { ConflictException } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';

const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ['awaiting_payment', 'cancelled', 'expired'],
  awaiting_payment: ['paid', 'failed', 'cancelled', 'expired'],
  failed: ['awaiting_payment', 'cancelled', 'expired'],
  paid: [],
  cancelled: [],
  expired: [],
};

export function assertOrderTransition(current: OrderStatus, next: OrderStatus): void {
  if (current === next || !ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new ConflictException(`Order cannot transition from ${current} to ${next}`);
  }
}
