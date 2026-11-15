import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { StockWorkflowService } from "./stock-workflow.service";
import { CustomerHistoryService } from "./customer-history.service";
import { RefundWorkflowService } from "./refund-workflow.service";
import { WorkflowWorker } from "./workflow-worker.service";
import { CheckoutService } from "../checkout/checkout.service";
import { BogReceipt } from "../checkout/bog.provider";
import { workflowTransaction } from "./workflow-policy";
import { OperationsQuery } from "./operations.query";

test(
  "PostgreSQL: checkout, concurrent reservations, issue/return, refund recovery, customer history and runtime ACL",
  { skip: !process.env.WORKFLOW_TEST_DATABASE_URL },
  async () => {
    const url = new URL(process.env.WORKFLOW_TEST_DATABASE_URL!);
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.pathname.endsWith("_test")
    )
      throw new Error("A dedicated local *_test database is required");
    process.env.OPERATIONS_WORKFLOWS_ENABLED = "true";
    process.env.BOG_REFUNDS_ENABLED = "true";
    process.env.BOG_PAYMENTS_ENABLED = "true";
    process.env.CHECKOUT_ENABLED = "true";
    process.env.ORDER_CUSTOMER_DATA_KEY = Buffer.alloc(32, 71).toString(
      "base64url",
    );
    const db = new PrismaService({ datasourceUrl: url.toString() });
    const runtimeUrl = new URL(url);
    runtimeUrl.username = "tyre_api_runtime";
    runtimeUrl.password = "";
    const runtime = new PrismaService({ datasourceUrl: runtimeUrl.toString() });
    const audit = new AuditService();
    const stock = new StockWorkflowService(runtime, audit);
    const customers = new CustomerHistoryService(runtime, audit);
    const context = {
      actorId: randomUUID(),
      actorEmail: "operator@example.invalid",
      correlationId: randomUUID(),
    };
    const receipts = new Map<string, BogReceipt>();
    const bankCalls: { id: string; amount: number }[] = [];
    let timeout = false;
    const bank = {
      create: async (_id: string, external: string, total: number) => {
        const reference = randomUUID();
        receipts.set(reference, {
          order_id: reference,
          external_order_id: external,
          order_status: { key: "completed" },
          purchase_units: {
            currency_code: "GEL",
            request_amount: total,
            transfer_amount: total,
            refund_amount: 0,
          },
          actions: [],
        });
        return { reference, redirect: "https://payment.bog.ge/test" };
      },
      receipt: async (reference: string) =>
        structuredClone(receipts.get(reference)!),
      refund: async (reference: string, id: string, amount: number) => {
        bankCalls.push({ id, amount });
        if (timeout) {
          timeout = false;
          throw new Error("network outcome unknown");
        }
        return id;
      },
    };
    const checkout = new CheckoutService(
      runtime,
      bank as never,
      stock,
      customers,
    );
    const refunds = new RefundWorkflowService(
      runtime,
      bank as never,
      stock,
      audit,
    );
    const worker = new WorkflowWorker(
      runtime,
      stock,
      customers,
      refunds,
      bank as never,
      checkout,
    );
    const suffix = randomUUID();
    const brandId = `test-${suffix}`;
    try {
      await runtime.assertRuntimeBoundary();
      await db.brand.create({ data: { id: brandId, name: brandId } });
      const model = await db.tireModel.create({
        data: { brandId, name: "Test model", slug: suffix },
      });
      const product = async (qty: number | null) => {
        const id = randomUUID();
        return db.product.create({
          data: {
            id,
            code: id,
            slug: id,
            brandId,
            tireModelId: model.id,
            patternKey: "test",
            name: "Test tyre",
            productType: "tire",
            vehicleClass: "passenger",
            size: "205/55R16",
            width: 205,
            profile: 55,
            rimDiameter: 16,
            radius: "R-16",
            construction: "radial",
            commercial: false,
            application: "test",
            unit: "piece",
            retailPrice: 100,
            wholesalePrice: 80,
            stockQty: qty,
          },
        });
      };
      const p = await product(4);
      const dto = (id: string, key = randomUUID()) =>
        ({
          idempotencyKey: key,
          items: [{ productId: id, quantity: 4 }],
          firstName: "Test",
          lastName: "Customer",
          email: "test@example.invalid",
          phone: "+995555123456",
          deliveryMethod: "pickup",
        }) as any;
      const same = dto(p.id);
      const race = await Promise.allSettled([
        checkout.create(same),
        checkout.create(dto(p.id)),
      ]);
      assert.equal(
        race.filter((r) => r.status === "fulfilled").length,
        1,
        "only one basket may reserve the last four tyres",
      );
      assert.equal(
        (await db.product.findUniqueOrThrow({ where: { id: p.id } }))
          .reservedQty,
        4,
      );
      const order = await db.order.findFirstOrThrow({
        where: { items: { some: { productId: p.id } } },
        include: { items: true, paymentAttempts: true },
      });
      const receipt = receipts.get(
        order.paymentAttempts[0].providerReference!,
      )!;
      await checkout.apply(receipt);
      await checkout.apply(receipt);
      assert.equal(
        (await db.order.findUniqueOrThrow({ where: { id: order.id } }))
          .fulfillmentStatus,
        "ready",
      );
      const issueId = randomUUID();
      const lines = [{ orderItemId: order.items[0].id, quantity: 2 }];
      await Promise.all([
        stock.move(order.id, issueId, lines, "issue", context),
        stock.move(order.id, issueId, lines, "issue", context),
      ]);
      let balance = await db.product.findUniqueOrThrow({ where: { id: p.id } });
      assert.equal(balance.stockQty, 2);
      assert.equal(balance.reservedQty, 2);
      await assert.rejects(() =>
        stock.move(
          order.id,
          issueId,
          [{ ...lines[0], quantity: 1 }],
          "issue",
          context,
        ),
      );
      await assert.rejects(() =>
        stock.count(
          p.id,
          1,
          balance.updatedAt.toISOString(),
          randomUUID(),
          "count",
          context,
        ),
      );
      const returnId = randomUUID();
      await Promise.all([
        stock.move(
          order.id,
          returnId,
          [{ ...lines[0], quantity: 1 }],
          "return",
          context,
        ),
        stock.move(
          order.id,
          returnId,
          [{ ...lines[0], quantity: 1 }],
          "return",
          context,
        ),
      ]);
      assert.equal(
        (await db.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty,
        3,
      );
      await assert.rejects(() =>
        stock.move(
          order.id,
          randomUUID(),
          [{ ...lines[0], quantity: 2 }],
          "return",
          context,
        ),
      );
      await stock.move(
        order.id,
        randomUUID(),
        [{ ...lines[0], quantity: 1 }],
        "issue",
        context,
      );
      assert.equal(
        (await db.order.findUniqueOrThrow({ where: { id: order.id } }))
          .fulfillmentStatus,
        "partially_returned",
        "a subsequent issue preserves the recorded physical return",
      );
      const refundId = randomUUID();
      await Promise.all([
        refunds.request(order.id, refundId, 10000, "Test refund", context),
        refunds.request(order.id, refundId, 10000, "Test refund", context),
      ]);
      await assert.rejects(() =>
        refunds.request(
          order.id,
          randomUUID(),
          10000,
          "Second request",
          context,
        ),
      );
      await assert.rejects(() =>
        stock.move(order.id, randomUUID(), lines, "issue", context),
      );
      timeout = true;
      await refunds.processOne();
      assert.equal(
        (await db.refundRequest.findUniqueOrThrow({ where: { id: refundId } }))
          .state,
        "needs_review",
      );
      await db.refundRequest.update({
        where: { id: refundId },
        data: { nextAttemptAt: new Date(0) },
      });
      await refunds.processOne();
      assert.deepEqual(
        bankCalls.map((c) => c.id),
        [refundId, refundId],
        "unknown outcome retries the same bank idempotency key",
      );
      assert.equal(
        (await db.refundRequest.findUniqueOrThrow({ where: { id: refundId } }))
          .state,
        "processing",
        "accepted is not completed",
      );
      receipt.actions = [
        {
          action_id: refundId,
          action: "partial_refund",
          status: "completed",
          amount: "100.00",
        },
      ];
      receipt.purchase_units.refund_amount = "100.00";
      await workflowTransaction(runtime, (tx) =>
        refunds.reconcile(tx, order.id, receipt),
      );
      assert.equal(
        (await db.order.findUniqueOrThrow({ where: { id: order.id } }))
          .refundedMinor,
        10000n,
      );
      assert.equal(
        (await db.product.findUniqueOrThrow({ where: { id: p.id } })).stockQty,
        2,
        "money return never restocks goods",
      );
      await assert.rejects(() =>
        refunds.request(order.id, randomUUID(), 30001, "Too much", context),
      );
      // External bank-office refund consumes the same balance and releases only unissued stock.
      receipt.purchase_units.refund_amount = 400;
      receipt.order_status.key = "refunded";
      await checkout.apply(receipt);
      balance = await db.product.findUniqueOrThrow({ where: { id: p.id } });
      assert.equal(balance.stockQty, 2);
      assert.equal(balance.reservedQty, 0);
      await assert.rejects(() =>
        stock.move(order.id, randomUUID(), lines, "issue", context),
      );
      // Expiry releases once. A late paid event cannot oversell the new buyer's stock.
      const p2 = await product(4);
      await checkout.create(dto(p2.id));
      const expired = await db.order.findFirstOrThrow({
        where: { items: { some: { productId: p2.id } } },
        include: { paymentAttempts: true },
      });
      await db.order.update({
        where: { id: expired.id },
        data: { reservationExpiresAt: new Date(0) },
      });
      process.env.BOG_PAYMENTS_ENABLED = "false";
      await worker.tick();
      await worker.tick();
      process.env.BOG_PAYMENTS_ENABLED = "true";
      assert.equal(
        (await db.product.findUniqueOrThrow({ where: { id: p2.id } }))
          .reservedQty,
        0,
      );
      await checkout.create(dto(p2.id));
      await checkout.apply(
        receipts.get(expired.paymentAttempts[0].providerReference!)!,
      );
      assert.equal(
        (await db.order.findUniqueOrThrow({ where: { id: expired.id } }))
          .fulfillmentStatus,
        "stock_exception",
      );
      assert.equal(
        (await db.product.findUniqueOrThrow({ where: { id: p2.id } }))
          .reservedQty,
        4,
      );
      const unknown = await product(null);
      await assert.rejects(() => checkout.create(dto(unknown.id)));
      await stock.count(
        unknown.id,
        8,
        unknown.updatedAt.toISOString(),
        randomUUID(),
        "Opening count",
        context,
      );
      await assert.rejects(() =>
        stock.count(
          unknown.id,
          9,
          unknown.updatedAt.toISOString(),
          randomUUID(),
          "Stale count",
          context,
        ),
      );
      await db.order.update({
        where: { id: order.id },
        data: { customerId: null, operationsNextCheckAt: null },
      });
      await customers.backfill();
      assert.ok(
        (await db.order.findUniqueOrThrow({ where: { id: order.id } }))
          .customerId,
      );
      const profiles = await customers.list(new OperationsQuery(), context);
      const profile = profiles.items.find((i) => i.title === "Test Customer")!;
      assert.ok(profile);
      const history = await customers.history(
        profile.id,
        new OperationsQuery(),
        context,
      );
      assert.ok(history.total >= 3);
      assert.equal(
        await db.commerceCustomer.count(),
        1,
        "same normalized contact pair shares one history",
      );
      await assert.rejects(
        () => runtime.stockMovement.updateMany({ data: { reason: "tamper" } }),
        "runtime cannot rewrite stock journal",
      );
      const auditRows = await db.auditEvent.findMany({
        where: { action: "customer.history.read" },
      });
      assert.ok(auditRows.length);
      assert.ok(!JSON.stringify(auditRows).includes("test@example.invalid"));
    } finally {
      await runtime.$disconnect();
      await db.$disconnect();
    }
  },
);
