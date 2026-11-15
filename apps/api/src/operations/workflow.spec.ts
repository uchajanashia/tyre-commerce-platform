import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Module, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { IdentityAccessGuard } from "../auth/identity-access.guard";
import { IDENTITY_CONFIG } from "../auth/identity-config";
import { RolesGuard } from "../auth/roles.guard";
import { PrismaService } from "../prisma/prisma.service";
import { WorkflowController } from "./workflow.controller";
import { StockWorkflowService } from "./stock-workflow.service";
import { RefundWorkflowService, refundBudget } from "./refund-workflow.service";
import {
  CustomerHistoryService,
  contactKeys,
} from "./customer-history.service";
import { minorAmount } from "./workflow-policy";
import { buildCartQuote } from "../checkout/cart-quote.service";
import { serializePublicProduct } from "../products/public-product.serializer";
import { BogProvider } from "../checkout/bog.provider";

test("refund balance counts external returns and unknown outcomes without double-counting completed refunds", () => {
  assert.equal(
    refundBudget(100, 3000n, [
      { state: "succeeded", amountMinor: 2000n },
      { state: "needs_review", amountMinor: 4000n },
    ]),
    3000,
  );
  assert.equal(
    refundBudget(100, 0n, [
      { state: "succeeded", amountMinor: 2000n },
      { state: "failed", amountMinor: 4000n },
    ]),
    8000,
  );
  for (const invalid of ["NaN", "-1", "1e3", "1.001", "Infinity", undefined])
    assert.equal(minorAmount(invalid), null);
  assert.equal(minorAmount("123.45"), 12345);
  assert.equal(minorAmount("0.01"), 1);
});
test("normalized contact pairs group conservatively and remain keyed hashes", () => {
  process.env.ORDER_CUSTOMER_DATA_KEY = Buffer.alloc(32, 33).toString(
    "base64url",
  );
  assert.deepEqual(
    contactKeys({ email: " A@Example.invalid ", phone: "555 12 34 56" }),
    contactKeys({ email: "a@example.invalid", phone: "00995555123456" }),
  );
  assert.notEqual(
    contactKeys({ email: "a@example.invalid", phone: "555123456" }).identityKey,
    contactKeys({ email: "b@example.invalid", phone: "555123456" }).identityKey,
  );
});
test("reserved quantities affect quotes and public availability but are never exposed", () => {
  const product = {
    id: "t",
    productType: "tire",
    code: "t",
    name: "Tyre",
    retailPrice: 100,
    currency: "GEL",
    stockQty: 4,
    reservedQty: 4,
    stockStatus: "in_stock",
    isPublished: true,
  } as const;
  assert.equal(
    buildCartQuote([{ productId: "t", quantity: 1 }], [product]).allAvailable,
    false,
  );
  const serialized = serializePublicProduct(
    { ...product, tireModel: null } as any,
    (value) => value,
  );
  assert.equal("reservedQty" in serialized, false);
  assert.equal("stockQty" in serialized, false);
  assert.equal(serialized.availability, "out_of_stock");
});
test("BOG refund sends exact minor-unit amount with durable idempotency and requires an accepted action id", async () => {
  const original = global.fetch;
  process.env.BOG_REFUNDS_ENABLED = "true";
  process.env.BOG_PAYMENTS_ENABLED = "true";
  const bank = new BogProvider();
  bank.accessToken = async () => "fixture";
  let sent: RequestInit | undefined;
  try {
    global.fetch = async (url, init) => {
      assert.equal(
        String(url),
        "https://api.bog.ge/payments/v1/payment/refund/bank-id",
      );
      sent = init;
      return Response.json({ key: "request_received", action_id: "action" });
    };
    const id = randomUUID();
    assert.equal(await bank.refund("bank-id", id, 12345), "action");
    assert.deepEqual(JSON.parse(sent!.body as string), { amount: 123.45 });
    assert.equal((sent!.headers as any)["Idempotency-Key"], id);
    assert.equal(sent!.redirect, "error");
    global.fetch = async () => Response.json({ status: "ok" });
    await assert.rejects(() => bank.refund("bank-id", id, 12345));
  } finally {
    global.fetch = original;
  }
});
test("real HTTP guards allow refunds only to administrator with permission and reject invalid commands", async () => {
  const previousSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  let refunds = 0;
  let issues = 0;
  @Module({
    controllers: [WorkflowController],
    providers: [
      JwtAuthGuard,
      RolesGuard,
      { provide: IDENTITY_CONFIG, useValue: { enabled: true } },
      {
        provide: IdentityAccessGuard,
        useValue: {
          canActivate(ctx: any) {
            const req = ctx.switchToHttp().getRequest();
            const permission = req.headers["x-permission"];
            if (!permission) return false;
            req.user = {
              id: "fixture",
              email: "fixture@example.invalid",
              role: req.headers["x-role"] ?? "staff",
              permissions: permission.split(","),
              permissionGrants: [],
            };
            return true;
          },
        },
      },
      { provide: PrismaService, useValue: {} },
      {
        provide: StockWorkflowService,
        useValue: {
          move: async () => {
            issues++;
            return { ok: true };
          },
        },
      },
      { provide: CustomerHistoryService, useValue: {} },
      {
        provide: RefundWorkflowService,
        useValue: {
          request: async () => {
            refunds++;
            return { id: "fixture", state: "queued" };
          },
        },
      },
    ],
  })
  class FixtureModule {}
  const app = await NestFactory.create(FixtureModule, {
    logger: false,
    abortOnError: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(0, "127.0.0.1");
  try {
    const url = `${await app.getUrl()}/admin/v1/operations/orders/order/refunds`;
    const body = { requestId: randomUUID(), amountMinor: 100, reason: "Test" };
    const send = (role: string, permission: string, value: unknown = body) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-role": role,
          "x-permission": permission,
        },
        body: JSON.stringify(value),
      });
    assert.equal((await send("staff", "*")).status, 403);
    assert.equal((await send("admin", "orders.read")).status, 403);
    assert.equal(
      (await send("admin", "payments.refund", { ...body, amountMinor: 0.5 }))
        .status,
      400,
    );
    assert.equal(
      (
        await send("admin", "payments.refund", {
          ...body,
          requestId: "not-uuid",
        })
      ).status,
      400,
    );
    const accepted = await send("admin", "payments.refund");
    assert.equal(accepted.status, 201);
    assert.equal(accepted.headers.get("cache-control"), "no-store");
    assert.equal(refunds, 1);
    const issue = await fetch(url.replace("/refunds", "/issue"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-role": "staff",
        "x-permission": "orders.fulfill",
      },
      body: JSON.stringify({
        requestId: randomUUID(),
        items: [{ orderItemId: "line", quantity: -1 }],
      }),
    });
    assert.equal(issue.status, 400);
    assert.equal(issues, 0);
  } finally {
    await app.close();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
