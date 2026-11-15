import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  BadRequestException,
  ConflictException,
  Module,
  ValidationPipe,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { IdentityAccessGuard } from "../auth/identity-access.guard";
import { IDENTITY_CONFIG } from "../auth/identity-config";
import { RolesGuard } from "../auth/roles.guard";
import { OperationsQuery, VehicleAssignmentDto } from "./operations.query";
import {
  checkedStatus,
  CommerceReaderService,
  orderLabel,
  orderSearchTerm,
} from "./commerce-reader.service";
import { InventoryReaderService } from "./inventory-reader.service";
import { CustomerContactReaderService } from "./customer-contact-reader.service";
import { VehicleVisualService } from "./vehicle-visual.service";
import { OperationsController } from "./operations.controller";
import { isAuthorizedByMetadata } from "../auth/roles.guard";
import { PERMISSIONS_KEY } from "../auth/permissions.decorator";
import { sealCustomer } from "../checkout/checkout-customer";

const context = {
  actorId: "staff-fixture",
  actorEmail: "staff@example.invalid",
  correlationId: "correlation-fixture",
};
test("order references match receipt numbering at the Tbilisi year boundary", () => {
  const id = "12345678-abcd-1234-abcd-123456abcdef";
  assert.equal(
    orderLabel(id, new Date("2025-12-31T21:00:00Z")),
    "TYR-2026-ABCDEF",
  );
  assert.equal(orderSearchTerm("TYR-2026-ABCDEF"), "ABCDEF");
});
test("operations migration registers permissions only without schema or staff privilege changes", () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      "../../prisma/migrations/20261014010000_operations_permissions/migration.sql",
    ),
    "utf8",
  );
  assert.match(sql, /INSERT INTO "Permission"/);
  assert.doesNotMatch(
    sql,
    /\b(?:CREATE|ALTER|DROP|GRANT|UPDATE|DELETE)\b|"RolePermission"|"CustomerMaster"/,
  );
});
test("operations pagination and input validation reject oversized, fractional and unknown values", async () => {
  for (const value of [
    { page: 0 },
    { pageSize: 1000 },
    { page: 1.5 },
    { q: "x".repeat(81) },
  ]) {
    assert.ok((await validate(plainToInstance(OperationsQuery, value))).length);
  }
  assert.deepEqual(
    await validate(
      plainToInstance(OperationsQuery, { page: "2", pageSize: "25" }),
    ),
    [],
  );
  assert.throws(
    () => checkedStatus("refunded", ["paid", "pending"]),
    BadRequestException,
  );
  assert.ok(
    (
      await validate(
        plainToInstance(VehicleAssignmentDto, {
          classification: "../bad",
          expectedUpdatedAt: "yesterday",
        }),
      )
    ).length,
  );
});
test("every domain read and visual write has an independent permission", () => {
  for (const [handler, permission] of Object.entries({
    orders: "orders.read",
    payments: "payments.read",
    inventoryList: "inventory.read",
    vehicles: "catalog.read",
    contacts: "orders.contacts.read",
    assign: "catalog.write",
  })) {
    const required = Reflect.getMetadata(
      PERMISSIONS_KEY,
      OperationsController.prototype[handler as keyof OperationsController],
    );
    assert.deepEqual(required, [permission]);
    assert.equal(isAuthorizedByMetadata({ permissions: required }), false);
    assert.equal(
      isAuthorizedByMetadata({
        permissions: required,
        user: {
          id: "x",
          email: "x@example.invalid",
          role: "staff",
          enabled: true,
          permissions: [],
          permissionGrants: [],
        },
      }),
      false,
    );
  }
});
test("summary does not query or reveal domains outside global permissions", async () => {
  let calls = 0;
  const service = {
    summary: async () => {
      calls++;
      return {};
    },
  };
  const controller = new OperationsController(
    service as never,
    service as never,
    {} as never,
    {} as never,
  );
  const result = await controller.summary({
    ...context,
    headers: {},
    user: {
      id: "x",
      email: "x@example.invalid",
      role: "staff",
      enabled: true,
      permissions: [],
      permissionGrants: [
        { permission: "orders.read", scopeType: "channel", scopeId: "online" },
      ],
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.orders, null);
  assert.equal(result.catalog, null);
});
test("order reader selects no access tokens or encrypted contacts and keeps whole-GEL snapshots", async () => {
  let select: any;
  const now = new Date();
  const db = {
    order: {
      findMany: async (args: any) => {
        select = args.select;
        return [
          {
            id: "order-1",
            status: "paid",
            total: 380,
            currency: "GEL",
            deliveryMethod: "pickup",
            createdAt: now,
            updatedAt: now,
            items: [
              {
                productCode: "SKU",
                productName: "Tire",
                quantity: 4,
                unitPrice: 95,
              },
            ],
          },
        ];
      },
      count: async () => 1,
    },
    $transaction: async (promises: any[]) => Promise.all(promises),
  };
  const result = await new CommerceReaderService(db as never).orders(
    new OperationsQuery(),
  );
  assert.equal(select.publicToken, undefined);
  assert.equal(select.customerEncrypted, undefined);
  assert.equal(select.receiptPdfEncrypted, undefined);
  assert.equal(result.items[0].amount, 380);
  assert.equal(result.items[0].quantity, 4);
});
test("inventory reader preserves unknown counts rather than manufacturing zero", async () => {
  const db = {
    product: {
      findMany: async () => [
        {
          id: "SKU",
          code: "SKU",
          name: "Tire",
          size: "175/70R13",
          productType: "tire",
          vehicleClass: "passenger",
          width: 175,
          profile: 70,
          rimDiameter: 13,
          stockQty: null,
          stockStatus: "in_stock",
          retailPrice: 95,
          isPublished: true,
          updatedAt: new Date(),
          tireModelId: "model",
        },
      ],
      count: async () => 1,
    },
    $transaction: async (p: any[]) => Promise.all(p),
  };
  const result = await new InventoryReaderService(db as never).list(
    new OperationsQuery(),
  );
  assert.equal(result.items[0].quantity, null);
  assert.equal(result.items[0].status, "unknown");
});
test("customer reads expose only existing name/contact fields and audit identifiers without PII", async () => {
  const previous = process.env.ORDER_CUSTOMER_DATA_KEY;
  process.env.ORDER_CUSTOMER_DATA_KEY = Buffer.alloc(32, 9).toString(
    "base64url",
  );
  try {
    const encrypted = sealCustomer(
      {
        firstName: "Fixture",
        lastName: "Contact",
        email: "fixture@example.invalid",
        phone: "synthetic-phone",
        personalNumber: "never-return",
        address: "never-return-address",
      },
      "order-1",
    );
    const tx = {
      order: {
        findMany: async () => [
          {
            id: "order-1",
            customerEncrypted: encrypted,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        count: async () => 1,
      },
    };
    let audit: any;
    const service = new CustomerContactReaderService(
      { $transaction: async (fn: any) => fn(tx) } as never,
      {
        recordWithClient: async (_: any, event: any) => {
          audit = event;
        },
      } as never,
    );
    const result = await service.list(new OperationsQuery(), context);
    assert.equal(result.items[0].title, "Fixture Contact");
    assert.equal(JSON.stringify(result).includes("never-return"), false);
    assert.equal(
      JSON.stringify(audit).includes("fixture@example.invalid"),
      false,
    );
    assert.deepEqual(audit.metadata.orderIds, ["order-1"]);
  } finally {
    if (previous === undefined) delete process.env.ORDER_CUSTOMER_DATA_KEY;
    else process.env.ORDER_CUSTOMER_DATA_KEY = previous;
  }
});
test("contact decryption failure is isolated and does not return ciphertext", async () => {
  const tx = {
    order: {
      findMany: async () => [
        {
          id: "order-1",
          customerEncrypted: "bad-ciphertext",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      count: async () => 1,
    },
  };
  const result = await new CustomerContactReaderService(
    { $transaction: async (f: any) => f(tx) } as never,
    { recordWithClient: async () => {} } as never,
  ).list(new OperationsQuery(), context);
  assert.equal(result.items[0].status, "unavailable");
  assert.equal(JSON.stringify(result).includes("bad-ciphertext"), false);
});
test("stale visual edits fail before audit and never silently overwrite", async () => {
  let audited = false;
  const tx = {
    product: {
      findUnique: async () => ({
        productType: "tire",
        updatedAt: new Date(),
        vehicleClassification: null,
      }),
      updateMany: async () => ({ count: 0 }),
    },
  };
  const service = new VehicleVisualService(
    { $transaction: async (f: any) => f(tx) } as never,
    {
      recordWithClient: async () => {
        audited = true;
      },
    } as never,
  );
  await assert.rejects(
    service.assign(
      "sku",
      {
        classification: "vehicle-city-car",
        expectedUpdatedAt: new Date(0).toISOString(),
      },
      context,
    ),
    ConflictException,
  );
  assert.equal(audited, false);
});
test("visual mutation and its audit share a transaction and change no fitment fields", async () => {
  const now = new Date();
  let data: any;
  let auditClient: any;
  const tx = {
    product: {
      findUnique: async () => ({
        productType: "tire",
        updatedAt: now,
        vehicleClassification: null,
      }),
      updateMany: async (args: any) => {
        data = args.data;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => ({
        vehicleClassification: data.vehicleClassification,
        updatedAt: data.updatedAt,
      }),
    },
  };
  const result = await new VehicleVisualService(
    { $transaction: async (f: any) => f(tx) } as never,
    {
      recordWithClient: async (client: any) => {
        auditClient = client;
      },
    } as never,
  ).assign(
    "sku",
    {
      classification: "vehicle-city-car",
      expectedUpdatedAt: now.toISOString(),
    },
    context,
  );
  assert.deepEqual(Object.keys(data).sort(), [
    "updatedAt",
    "vehicleClassification",
  ]);
  assert.equal(auditClient, tx);
  assert.ok(Date.parse(result.updatedAt) > now.getTime());
});

test("operations HTTP pipeline enforces role permissions, bounded DTOs and no-store responses", async () => {
  let calls = 0;
  const previousSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  @Module({
    controllers: [OperationsController],
    providers: [
      RolesGuard,
      JwtAuthGuard,
      { provide: IDENTITY_CONFIG, useValue: { enabled: true } },
      {
        provide: IdentityAccessGuard,
        useValue: {
          canActivate(ctx: any) {
            const req = ctx.switchToHttp().getRequest();
            const permission = req.headers["x-fixture-permission"];
            if (!permission) return false;
            req.user = {
              id: "fixture",
              email: "fixture@example.invalid",
              role: "staff",
              permissions: [permission],
              permissionGrants: [
                { permission, scopeType: "global", scopeId: null },
              ],
            };
            return true;
          },
        },
      },
      {
        provide: CommerceReaderService,
        useValue: {
          orders: async (query: OperationsQuery) => {
            calls++;
            return {
              items: [],
              total: 0,
              page: query.page,
              pageSize: query.pageSize,
            };
          },
        },
      },
      { provide: InventoryReaderService, useValue: {} },
      { provide: CustomerContactReaderService, useValue: {} },
      { provide: VehicleVisualService, useValue: {} },
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
    const url = `${await app.getUrl()}/admin/v1/operations/orders`;
    assert.equal((await fetch(url)).status, 403);
    assert.equal(
      (
        await fetch(url, {
          headers: { "x-fixture-permission": "catalog.read" },
        })
      ).status,
      403,
    );
    const headers = { "x-fixture-permission": "orders.read" };
    assert.equal((await fetch(`${url}?pageSize=999`, { headers })).status, 400);
    assert.equal(calls, 0);
    const response = await fetch(`${url}?page=2&pageSize=10`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      items: [],
      total: 0,
      page: 2,
      pageSize: 10,
    });
    assert.equal(calls, 1);
  } finally {
    await app.close();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});
