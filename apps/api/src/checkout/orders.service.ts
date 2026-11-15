import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import {
  CartQuoteLine,
  QuoteProduct,
  buildCartQuote,
  validateCartLines,
} from './cart-quote.service';
import { assertOrderTransition } from './order-state';

const ORDER_WITH_ITEMS = {
  items: true,
  paymentAttempts: true,
} satisfies Prisma.OrderInclude;

type OrderAggregate = Prisma.OrderGetPayload<{ include: typeof ORDER_WITH_ITEMS }>;

const ORDER_PRODUCT_SELECT = {
  id: true,
  productType: true,
  code: true,
  name: true,
  retailPrice: true,
  currency: true,
  stockQty: true,
  reservedQty: true,
  stockStatus: true,
  isPublished: true,
} as const;

export interface CreateDraftOrderCommand {
  idempotencyKey: string;
  items: CartQuoteLine[];
}

function requestHash(lines: readonly CartQuoteLine[]): string {
  const canonical = [...lines]
    .map((line) => ({ productId: line.productId, quantity: line.quantity }))
    .sort((left, right) => left.productId.localeCompare(right.productId));
  return createHash('sha256').update(JSON.stringify({ version: 1, items: canonical })).digest('hex');
}

function validateIdempotencyKey(key: string): void {
  if (key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new BadRequestException('Invalid idempotency key');
  }
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Internal foundation only: there is deliberately no public controller for
   * this method while CHECKOUT_ENABLED=false.
   */
  async createDraft(command: CreateDraftOrderCommand): Promise<OrderAggregate> {
    validateIdempotencyKey(command.idempotencyKey);
    validateCartLines(command.items);
    const hash = requestHash(command.items);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.order.findUnique({
            where: { idempotencyKey: command.idempotencyKey },
            include: ORDER_WITH_ITEMS,
          });
          if (existing) return this.assertSameRequest(existing, hash);

          const products = await tx.product.findMany({
            where: { id: { in: command.items.map((item) => item.productId) } },
            select: ORDER_PRODUCT_SELECT,
          });
          const quote = buildCartQuote(command.items, products as QuoteProduct[]);
          if (!quote.allAvailable || !quote.currency) {
            throw new BadRequestException(
              'One or more selected products or quantities are currently unavailable',
            );
          }

          return tx.order.create({
            data: {
              publicToken: randomBytes(32).toString('base64url'),
              idempotencyKey: command.idempotencyKey,
              requestHash: hash,
              status: 'draft',
              currency: quote.currency,
              subtotal: quote.total,
              total: quote.total,
              items: {
                create: quote.items.map((item) => ({
                  productId: item.productId,
                  productCode: item.code!,
                  productName: item.name!,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice!,
                  lineTotal: item.lineTotal!,
                })),
              },
            },
            include: ORDER_WITH_ITEMS,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const existing = await this.prisma.order.findUnique({
          where: { idempotencyKey: command.idempotencyKey },
          include: ORDER_WITH_ITEMS,
        });
        if (existing) return this.assertSameRequest(existing, hash);
      }
      throw error;
    }
  }

  async transition(orderId: string, next: OrderStatus): Promise<OrderAggregate> {
    if (process.env.OPERATIONS_WORKFLOWS_ENABLED === "true") throw new ConflictException("Use the verified checkout workflow");
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({
        where: { id: orderId },
        include: ORDER_WITH_ITEMS,
      });
      if (!current) throw new NotFoundException(`Order "${orderId}" not found`);
      assertOrderTransition(current.status, next);
      return tx.order.update({
        where: { id: orderId },
        data: { status: next, paidAt: next === 'paid' ? new Date() : undefined },
        include: ORDER_WITH_ITEMS,
      });
    });
  }

  private assertSameRequest(order: OrderAggregate, expectedHash: string): OrderAggregate {
    if (order.requestHash !== expectedHash) {
      throw new ConflictException('Idempotency key was already used for a different order');
    }
    return order;
  }

  private isUniqueConflict(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && error.code === 'P2002';
  }
}
