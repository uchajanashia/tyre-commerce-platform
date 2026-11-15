import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  customerDigest,
  sealCustomer,
  openCustomer,
  sealReceipt,
  openReceipt,
} from "./checkout-customer";
import { CreateCheckoutDto } from "./dto/create-checkout.dto";
import { BogProvider } from "./bog.provider";
import { CheckoutService } from "./checkout.service";
import { PrismaService } from "../prisma/prisma.service";
import { readReceiptAck } from "./receipt-dispatcher";

const customer = {
  firstName: "სატესტო",
  lastName: "მყიდველი",
  email: "buyer@example.com",
  phone: "555000000",
  personalNumber: "00000000000",
  address: "სატესტო მისამართი",
};
const dto = {
  ...customer,
  deliveryMethod: "delivery",
  idempotencyKey: "cc8f8b70-8741-4cda-a471-e55951e92f11",
  items: [{ productId: "catalog-product-a", quantity: 2 }],
} as CreateCheckoutDto;

test("checkout encryption and payment acceptance invariants", async (t) => {
  const saved = { ...process.env };
  process.env.ORDER_CUSTOMER_DATA_KEY = randomBytes(32).toString("base64url");
  process.env.CHECKOUT_ENABLED = "true";
  process.env.BOG_PAYMENTS_ENABLED = "true";
  try {
    await t.test(
      "customer encryption is randomized, authenticated and order-bound",
      () => {
        const a = sealCustomer(customer, "order-a");
        const b = sealCustomer(customer, "order-a");
        assert.notEqual(a, b);
        assert.deepEqual(openCustomer(a, "order-a"), customer);
        assert.ok(!a.includes(customer.phone));
        assert.throws(() => openCustomer(a, "order-b"));
        const parts = a.split(".");
        parts[3] = Buffer.from("tamper").toString("base64url");
        assert.throws(() => openCustomer(parts.join("."), "order-a"));
        assert.notEqual(
          customerDigest(customer),
          customerDigest({ ...customer, phone: "555000001" }),
        );
      },
    );
    await t.test("receipt encryption has separate purpose binding", () => {
      const pdf = Buffer.from("%PDF-1.7\nfixture");
      const sealed = sealReceipt(pdf, "a");
      assert.deepEqual(openReceipt(sealed, "a"), pdf);
      assert.throws(() => openReceipt(sealed, "b"));
      assert.throws(() => openCustomer(sealed, "a"));
    });
    await t.test(
      "delivery requires an address while personal ID stays optional",
      () => {
        assert.equal(
          validateSync(plainToInstance(CreateCheckoutDto, dto)).length,
          0,
        );
        assert.ok(
          validateSync(
            plainToInstance(CreateCheckoutDto, {
              ...dto,
              address: undefined,
              personalNumber: undefined,
            }),
          ).length >= 1,
        );
        assert.equal(
          validateSync(
            plainToInstance(CreateCheckoutDto, {
              ...dto,
              personalNumber: undefined,
            }),
          ).length,
          0,
        );
        assert.ok(
          validateSync(
            plainToInstance(CreateCheckoutDto, {
              ...dto,
              personalNumber: "123",
            }),
          ).length >= 1,
        );
        assert.equal(
          validateSync(
            plainToInstance(CreateCheckoutDto, {
              ...dto,
              deliveryMethod: "pickup",
              address: undefined,
              personalNumber: undefined,
            }),
          ).length,
          0,
        );
      },
    );
    await t.test("untrusted bank callbacks are rejected", () => {
      assert.throws(() =>
        new BogProvider().callback(Buffer.from("{}"), "invalid"),
      );
    });
    await t.test(
      "PDF response must match event, be bounded and contain a PDF",
      async () => {
        const pdf = Buffer.from("%PDF-1.7\nfixture");
        const ack = await readReceiptAck(
          Response.json({
            eventId: "a",
            delivered: false,
            pdfBase64: pdf.toString("base64"),
          }),
          "a",
        );
        assert.deepEqual(ack.pdf, pdf);
        assert.equal(ack.delivered, false);
        await assert.rejects(
          readReceiptAck(
            Response.json({
              eventId: "b",
              delivered: true,
              pdfBase64: pdf.toString("base64"),
            }),
            "a",
          ),
        );
        await assert.rejects(
          readReceiptAck(
            Response.json({
              eventId: "a",
              pdfBase64: Buffer.from("<html>").toString("base64"),
            }),
            "a",
          ),
        );
        await assert.rejects(
          readReceiptAck(new Response("x".repeat(3_000_001)), "a"),
        );
      },
    );
    await t.test(
      "retry after bank timeout reuses persisted UUID and catalogue order",
      async () => {
        let stored: any;
        const attempts: string[] = [];
        const tx: any = {
          product: {
            findMany: async () => [
              {
                id: "catalog-product-a",
                productType: "tire",
                code: "CAT-001",
                name: "Catalogue tire",
                retailPrice: 285,
                currency: "GEL",
                stockQty: 100,
                stockStatus: "in_stock",
                isPublished: true,
              },
            ],
          },
          order: {
            findUnique: async () => stored,
            create: async ({ data }: any) =>
              (stored = {
                ...data,
                createdAt: new Date(),
                items: data.items.create,
                paymentAttempts: [
                  { ...data.paymentAttempts.create, createdAt: new Date() },
                ],
              }),
          },
          paymentAttempt: {
            updateMany: async ({ data }: any) => {
              Object.assign(stored.paymentAttempts[0], data);
              return { count: 1 };
            },
          },
        };
        const prisma = {
          ...tx,
          $transaction: async (fn: any) => fn(tx),
        } as PrismaService;
        const bank = {
          create: async (id: string) => {
            attempts.push(id);
            if (attempts.length === 1) throw new Error("Timeout");
            return {
              reference: "bank-1",
              redirect: "https://payment.bog.ge/?order_id=bank-1",
            };
          },
        } as unknown as BogProvider;
        const service = new CheckoutService(prisma, bank);
        await assert.rejects(service.create(dto));
        const id = stored.id;
        await service.create(dto);
        assert.equal(stored.id, id);
        assert.equal(stored.total, 570);
        assert.equal(attempts[0], attempts[1]);
        assert.deepEqual(openCustomer(stored.customerEncrypted, id), customer);
        await assert.rejects(service.create({ ...dto, firstName: "changed" }));
      },
    );
    await t.test(
      "receipt amount mismatch is rejected and paid state never downgraded",
      async () => {
        const stored: any = {
          id: "a",
          status: "awaiting_payment",
          total: 1,
          currency: "GEL",
          paymentAttempts: [{ id: "attempt", providerReference: "bank-1" }],
        };
        let events = 0;
        const tx: any = {
          $queryRaw: async () => [{ id: "a" }],
          order: {
            findUniqueOrThrow: async () => stored,
            update: async ({ data }: any) => Object.assign(stored, data),
          },
          paymentAttempt: { update: async () => ({}) },
          paymentEvent: {
            upsert: async () => {
              events++;
            },
          },
        };
        const service = new CheckoutService(
          {
            $transaction: async (fn: any) => fn(tx),
          } as unknown as PrismaService,
          {} as BogProvider,
        );
        const receipt = {
          order_id: "bank-1",
          external_order_id: "token",
          order_status: { key: "completed" },
          purchase_units: { request_amount: 2, currency_code: "GEL" },
        };
        await assert.rejects(service.apply(receipt));
        assert.equal(events, 0);
        receipt.purchase_units.request_amount = 1;
        await service.apply(receipt);
        assert.equal(stored.status, "paid");
        await service.apply({ ...receipt, order_status: { key: "rejected" } });
        assert.equal(stored.status, "paid");
      },
    );
  } finally {
    for (const key of [
      "ORDER_CUSTOMER_DATA_KEY",
      "CHECKOUT_ENABLED",
      "BOG_PAYMENTS_ENABLED",
    ]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
