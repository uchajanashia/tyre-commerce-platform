import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "@nestjs/common";

import { IdentityConfig } from "./identity-config";
import { StaffAdminService } from "./staff-admin.service";
import { StaffSessionService } from "./staff-session.service";

const CONFIG = {
  enabled: true,
  environment: "test",
  allowedOrigins: [],
  accessTokenTtlSeconds: 300,
  clockToleranceSeconds: 5,
  refreshIdleSeconds: 600,
  refreshAbsoluteSeconds: 3600,
  refreshReceiptSeconds: 30,
  deliveryAdapter: "disabled",
  privilegedRoleKeys: ["admin"],
  privilegedRolePolicyReviewed: true,
  canonicalBackfillReviewed: true,
  keyCompromiseWorkflowsReviewed: true,
  operatorMode: false,
} satisfies IdentityConfig;

const ACTOR = {
  id: "actor-fixture",
  email: "actor@example.test",
  sessionId: "session-fixture",
  permissionGrants: [
    { permission: "*", scopeType: "global" as const, scopeId: "" },
  ],
};

test("staff search composes canonical email q and status in one parameterized Prisma where clause", async () => {
  let query: Record<string, unknown> | undefined;
  const prisma = {
    admin: {
      findMany: async (input: Record<string, unknown>) => {
        query = input;
        return [];
      },
    },
  };
  const service = staffService(prisma);

  await service.list(
    ACTOR,
    undefined,
    25,
    "disabled",
    " SEARCH.08@EXAMPLE.TEST ",
  );

  assert.deepEqual(query?.where, {
    status: "disabled",
    OR: [
      { id: "search.08@example.test" },
      { emailNormalized: { contains: "search.08@example.test" } },
    ],
  });
  assert.equal(query?.take, 201);
  assert.deepEqual(query?.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
});

test("staff search rejects blank q and missing or inaccessible cursor with the same bounded problem code", async () => {
  const prisma = {
    admin: {
      findFirst: async () => null,
      findMany: async () => [],
    },
  };
  const service = staffService(prisma);

  await assert.rejects(
    () => service.list(ACTOR, undefined, 25, undefined, "   "),
    hasCode("INVALID_STAFF_QUERY"),
  );
  await assert.rejects(
    () => service.list(ACTOR, "missing-shaped-cursor", 25),
    hasCode("INVALID_CURSOR"),
  );
  await assert.rejects(
    () => service.list(ACTOR, "x".repeat(129), 25),
    hasCode("INVALID_CURSOR"),
  );
});

test("self-session cursor is owner-bound before stable second-page Prisma pagination", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  const prisma = {
    staffSession: {
      findFirst: async (input: unknown) => {
        calls.push({ method: "findFirst", input });
        return { id: "session-page-24" };
      },
      findMany: async (input: unknown) => {
        calls.push({ method: "findMany", input });
        return [];
      },
    },
  };
  const service = new StaffSessionService(
    prisma as never,
    {} as never,
    {} as never,
    CONFIG,
  );

  await service.list("actor-fixture", "session-page-24", 25);

  assert.deepEqual(calls[0], {
    method: "findFirst",
    input: {
      where: { id: "session-page-24", staffUserId: "actor-fixture" },
      select: { id: true },
    },
  });
  assert.deepEqual(calls[1], {
    method: "findMany",
    input: {
      where: { staffUserId: "actor-fixture" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 26,
      cursor: { id: "session-page-24" },
      skip: 1,
      select: {
        id: true,
        createdAt: true,
        lastSeenAt: true,
        idleExpiresAt: true,
        absoluteExpiresAt: true,
        revokedAt: true,
        deviceLabel: true,
        browserFamily: true,
        osFamily: true,
        mfaSatisfiedAt: true,
        authMethod: true,
      },
    },
  });
});

function staffService(prisma: object): StaffAdminService {
  return new StaffAdminService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    CONFIG,
  );
}

function hasCode(expected: string): (error: unknown) => boolean {
  return (error) => {
    if (!(error instanceof BadRequestException)) return false;
    const response = error.getResponse();
    return (
      typeof response === "object" &&
      response !== null &&
      (response as { code?: string }).code === expected
    );
  };
}
