import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, ConflictException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { QuoteProduct } from './cart-quote.service';
import { OrdersService } from './orders.service';

function product(overrides: Partial<QuoteProduct> = {}): QuoteProduct {
  return {
    id: 'tire-1',
    productType: 'tire',
    code: '000001',
    name: 'Road tire',
    retailPrice: 275,
    currency: 'GEL',
    stockQty: 4,
    stockStatus: 'in_stock',
    isPublished: true,
    ...overrides,
  };
}

function fakePrisma(products: QuoteProduct[]) {
  let stored: any = null;
  let createCount = 0;
  const order = {
    findUnique: async ({ where }: any) =>
      stored?.idempotencyKey === where.idempotencyKey || stored?.id === where.id ? stored : null,
    create: async ({ data }: any) => {
      createCount += 1;
      const now = new Date();
      stored = {
        id: 'order-1',
        ...data,
        paidAt: null,
        createdAt: now,
        updatedAt: now,
        items: data.items.create,
        paymentAttempts: [],
      };
      return stored;
    },
    update: async ({ data }: any) => {
      stored = { ...stored, ...data, updatedAt: new Date() };
      return stored;
    },
  };
  const tx = {
    product: { findMany: async () => products },
    order,
  };
  const prisma = {
    order,
    $transaction: async (work: (client: typeof tx) => unknown) => work(tx),
  } as unknown as PrismaService;
  return { prisma, getStored: () => stored, getCreateCount: () => createCount };
}

test('creates an opaque draft from server price and a validated stock snapshot', async () => {
  const fake = fakePrisma([product()]);
  const service = new OrdersService(fake.prisma);
  const order = await service.createDraft({
    idempotencyKey: 'cart-request-001',
    items: [{ productId: 'tire-1', quantity: 3 }],
  });

  assert.equal(order.status, 'draft');
  assert.equal(order.total, 825);
  assert.equal(order.items[0]?.unitPrice, 275);
  assert.equal(order.items[0]?.quantity, 3);
  assert.match(order.publicToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(fake.getCreateCount(), 1);
});

test('same idempotency key and payload returns one order, not a duplicate', async () => {
  const fake = fakePrisma([product()]);
  const service = new OrdersService(fake.prisma);
  const command = {
    idempotencyKey: 'cart-request-002',
    items: [{ productId: 'tire-1', quantity: 1 }],
  };

  const first = await service.createDraft(command);
  const second = await service.createDraft(command);
  assert.equal(second.id, first.id);
  assert.equal(fake.getCreateCount(), 1);
});

test('same idempotency key with a different payload is rejected', async () => {
  const fake = fakePrisma([product()]);
  const service = new OrdersService(fake.prisma);
  await service.createDraft({
    idempotencyKey: 'cart-request-003',
    items: [{ productId: 'tire-1', quantity: 1 }],
  });

  await assert.rejects(
    service.createDraft({
      idempotencyKey: 'cart-request-003',
      items: [{ productId: 'tire-1', quantity: 2 }],
    }),
    ConflictException,
  );
});

test('insufficient exact inventory rejects the draft without revealing its count', async () => {
  const fake = fakePrisma([product({ stockQty: 2 })]);
  const service = new OrdersService(fake.prisma);

  await assert.rejects(
    service.createDraft({
      idempotencyKey: 'cart-request-004',
      items: [{ productId: 'tire-1', quantity: 3 }],
    }),
    (error: unknown) =>
      error instanceof BadRequestException &&
      error.message === 'One or more selected products or quantities are currently unavailable',
  );
  assert.equal(fake.getCreateCount(), 0);
});
