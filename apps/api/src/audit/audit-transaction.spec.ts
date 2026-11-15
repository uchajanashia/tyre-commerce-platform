import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BrandsAdminService } from '../admin/brands/brands-admin.service';

const context = {
  actorId: 'admin-1',
  actorEmail: 'admin@example.test',
  correlationId: 'request-1',
};

describe('transactional privileged audit', () => {
  it('records exact before/after projections in the update transaction', async () => {
    const before = {
      id: 'roadx', name: 'RoadX', defaultCountry: 'CN',
      _count: { products: 2, tireModels: 1 },
    };
    const after = { ...before, name: 'RoadX Tyres' };
    const tx = {
      brand: {
        findUnique: async () => before,
        findFirst: async () => null,
        update: async () => after,
      },
      auditEvent: { create: async () => ({}) },
    };
    const writes: unknown[] = [];
    const service = new BrandsAdminService(
      { $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) } as never,
      { recordWithClient: async (client: unknown, event: unknown) => writes.push({ client, event }) } as never,
    );

    await service.rename('roadx', 'RoadX Tyres', context);
    assert.equal(writes.length, 1);
    const write = writes[0] as { client: unknown; event: { before: unknown; after: unknown; action: string } };
    assert.equal(write.client, tx);
    assert.equal(write.event.action, 'catalog.brand.rename');
    assert.deepEqual(write.event.before, {
      id: 'roadx', name: 'RoadX', defaultCountry: 'CN', productCount: 2, tireModelCount: 1,
    });
    assert.deepEqual(write.event.after, {
      id: 'roadx', name: 'RoadX Tyres', defaultCountry: 'CN', productCount: 2, tireModelCount: 1,
    });
  });

  it('keeps the delete uncommitted when the durable audit insert fails', async () => {
    const before = {
      id: 'empty', name: 'Empty', defaultCountry: null,
      _count: { products: 0, tireModels: 0 },
    };
    let deleteAttempted = false;
    let committed = false;
    const tx = {
      brand: {
        findUnique: async () => before,
        delete: async () => { deleteAttempted = true; },
      },
      auditEvent: { create: async () => ({}) },
    };
    const service = new BrandsAdminService(
      {
        $transaction: async (callback: (client: typeof tx) => unknown) => {
          const result = await callback(tx);
          committed = true;
          return result;
        },
      } as never,
      { recordWithClient: async () => { throw new Error('audit unavailable'); } } as never,
    );

    await assert.rejects(service.remove('empty', context), /audit unavailable/);
    assert.equal(deleteAttempted, true);
    assert.equal(committed, false);
  });
});
