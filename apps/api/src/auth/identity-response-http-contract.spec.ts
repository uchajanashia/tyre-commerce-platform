import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import { INestApplication, Module, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { PrismaService } from "../prisma/prisma.service";
import { IDENTITY_CONFIG, IdentityConfig } from "./identity-config";
import { IdentityAccessGuard } from "./identity-access.guard";
import { IdentityAuthController } from "./identity-auth.controller";
import { IdentityAuthService, StaffProjection } from "./identity-auth.service";
import { IdentityJwtService } from "./identity-jwt.service";
import { InvitationController } from "./invitation.controller";
import { InvitationService } from "./invitation.service";
import { MfaController, StepUpController } from "./mfa.controller";
import { MfaService } from "./mfa.service";
import { RolesGuard } from "./roles.guard";
import { StaffAdminController } from "./staff-admin.controller";
import { StaffAdminService } from "./staff-admin.service";
import { StaffSessionService } from "./staff-session.service";

const ORIGIN = "http://localhost:4300";
const OPAQUE = "x".repeat(64);
const DATE = "2026-07-30T12:00:00.000Z";
const STAFF: StaffProjection = {
  id: "staff-fixture",
  email: "operator@example.test",
  displayName: "Fixture operator",
  role: "staff",
  enabled: true,
  status: "active",
  mfaRequired: true,
  mfaEnrolled: true,
  version: 7,
  permissions: ["staff.manage"],
  permissionGrants: [
    { permission: "staff.manage", scopeType: "global", scopeId: "" },
  ],
};
const LOGIN_BODY = {
  status: "authenticated" as const,
  accessToken: "fixture-access-token",
  accessExpiresAt: DATE,
  refreshToken: "fixture-refresh-token",
  staff: STAFF,
};
const INVITATION = {
  invitationId: "invitation-fixture",
  expiresAt: DATE,
  developmentOneTimeUrl: `${ORIGIN}/admin/invitations/accept#one-time-secret`,
};

const config: IdentityConfig = {
  enabled: true,
  environment: "test",
  adminPublicOrigin: ORIGIN,
  allowedOrigins: [ORIGIN],
  accessTokenTtlSeconds: 300,
  clockToleranceSeconds: 5,
  refreshIdleSeconds: 600,
  refreshAbsoluteSeconds: 3600,
  refreshReceiptSeconds: 30,
  deliveryAdapter: "manual",
  privilegedRoleKeys: [],
  privilegedRolePolicyReviewed: true,
  canonicalBackfillReviewed: true,
  keyCompromiseWorkflowsReviewed: true,
  operatorMode: false,
};

const identity = {
  assertEnabled: () => undefined,
  login: async (email: string) =>
    email.startsWith("mfa")
      ? {
          status: "mfa_required" as const,
          challengeToken: "fixture-challenge-token",
          expiresAt: DATE,
        }
      : LOGIN_BODY,
  completeLoginMfa: async () => LOGIN_BODY,
  staffInfo: async () => STAFF,
  staffInfoFromSession: async () => STAFF,
};

const sessions = {
  csrfProof: async () => "fixture-csrf-token",
  rotate: async () => ({
    accessToken: "fixture-rotated-access-token",
    accessExpiresAt: DATE,
    refreshToken: "fixture-rotated-refresh-token",
    sessionId: "session-fixture",
    rotationResult: "rotated" as const,
  }),
};

const invitations = {
  acceptInvite: async () => ({
    status: "pending_activation" as const,
    mfaRequired: true,
    activationProof: "fixture-activation-proof",
  }),
};

const mfa = {
  startEnrollment: async () => ({
    enrollmentToken: "fixture-enrollment-token",
    otpauthUri: "otpauth://fixture",
    expiresAt: DATE,
  }),
  confirmEnrollment: async () => ({
    confirmed: true as const,
    recoveryCodes: ["fixture-recovery-one", "fixture-recovery-two"],
  }),
  issueStepUp: async () => ({
    stepUpToken: "fixture-step-up-token",
    expiresAt: DATE,
  }),
};

const staff = {
  create: async (_actor: unknown, input: { email: string }) => ({
    staff: {
      id: "created-staff",
      email: input.email,
      status: "invited" as const,
      version: 1,
    },
    invitation:
      input.email === "production-delivery@example.test"
        ? {
            invitationId: INVITATION.invitationId,
            expiresAt: INVITATION.expiresAt,
          }
        : INVITATION,
  }),
  resendInvitation: async () => ({
    targetId: "created-staff",
    version: 2,
    invitation: INVITATION,
  }),
  previewTargetSessionRevoke: async () => ({
    requestedActionHash: "fixture-target-session-action-hash",
  }),
  revokeTargetSession: async () => ({
    revoked: true as const,
    targetVersion: 8,
  }),
};

@Module({
  controllers: [
    IdentityAuthController,
    InvitationController,
    MfaController,
    StepUpController,
    StaffAdminController,
  ],
  providers: [
    { provide: IDENTITY_CONFIG, useValue: config },
    { provide: IdentityAuthService, useValue: identity },
    { provide: StaffSessionService, useValue: sessions },
    { provide: InvitationService, useValue: invitations },
    { provide: MfaService, useValue: mfa },
    { provide: StaffAdminService, useValue: staff },
    {
      provide: IdentityJwtService,
      useValue: {
        verify: async () => ({ sid: "session-fixture", sub: STAFF.id, ver: 7 }),
      },
    },
    {
      provide: PrismaService,
      useValue: {
        staffSession: {
          findUnique: async () => ({
            id: "session-fixture",
            staffUserId: STAFF.id,
            revokedAt: null,
            idleExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
            absoluteExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
            authContractVersion: 2,
            tokenVersionSnapshot: 7,
            lastSeenAt: new Date("2099-01-01T00:00:00.000Z"),
            staffUser: { tokenVersion: 7, enabled: true, status: "active" },
          }),
          updateMany: async () => ({ count: 0 }),
        },
        securityControl: {
          findUnique: async () => ({ minimumAuthContractVersion: 2 }),
        },
      },
    },
    IdentityAccessGuard,
    RolesGuard,
  ],
})
class IdentityResponseHttpContractModule {}

test("sensitive Identity HTTP responses preserve exact sibling fields and nested secret reachability", async (context) => {
  const app = await NestFactory.create(IdentityResponseHttpContractModule, {
    logger: false,
    abortOnError: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, "127.0.0.1");
  context.after(async () => app.close());
  const address = app.getHttpServer().address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;

  const authenticated = await jsonRequest(base, "/admin/v1/auth/login", {
    method: "POST",
    body: {
      email: "operator@example.test",
      password: "correct horse battery staple",
    },
  });
  assert.equal(authenticated.response.status, 200);
  assert.deepEqual(authenticated.body, withoutRefresh(LOGIN_BODY));
  assert.equal("refreshToken" in authenticated.body, false);
  assert.match(
    authenticated.response.headers.get("set-cookie") ?? "",
    /tyre_admin_refresh=/i,
  );

  const challenged = await jsonRequest(base, "/admin/v1/auth/login", {
    method: "POST",
    body: {
      email: "mfa@example.test",
      password: "correct horse battery staple",
    },
  });
  assert.deepEqual(challenged.body, {
    status: "mfa_required",
    challengeToken: "fixture-challenge-token",
    expiresAt: DATE,
  });

  const completed = await jsonRequest(base, "/admin/v1/auth/mfa/challenge", {
    method: "POST",
    body: { challengeToken: OPAQUE, code: "123456" },
  });
  assert.deepEqual(completed.body, withoutRefresh(LOGIN_BODY));

  const csrf = await jsonRequest(base, "/admin/v1/auth/csrf", {
    cookie: "tyre_admin_refresh=fixture-refresh-token",
  });
  assert.deepEqual(csrf.body, { csrfToken: "fixture-csrf-token" });
  assert.equal(csrf.response.headers.get("cache-control"), "no-store");

  const refreshed = await jsonRequest(base, "/admin/v1/auth/refresh", {
    method: "POST",
    cookie: "tyre_admin_refresh=fixture-refresh-token",
    headers: { "x-csrf-token": "fixture-csrf-token" },
  });
  assert.deepEqual(refreshed.body, {
    accessToken: "fixture-rotated-access-token",
    accessExpiresAt: DATE,
    rotationResult: "rotated",
    staff: STAFF,
  });

  const accepted = await jsonRequest(base, "/admin/v1/invitations/accept", {
    method: "POST",
    body: { token: OPAQUE, password: "correct horse battery staple" },
  });
  assert.deepEqual(accepted.body, {
    status: "pending_activation",
    mfaRequired: true,
    activationProof: "fixture-activation-proof",
  });

  const enrollment = await jsonRequest(base, "/admin/v1/mfa/enrollment/start", {
    method: "POST",
    body: { activationProof: OPAQUE },
  });
  assert.equal(enrollment.response.status, 201);
  assert.deepEqual(enrollment.body, {
    enrollmentToken: "fixture-enrollment-token",
    otpauthUri: "otpauth://fixture",
    expiresAt: DATE,
  });

  const confirmed = await jsonRequest(
    base,
    "/admin/v1/mfa/enrollment/confirm",
    {
      method: "POST",
      body: { enrollmentToken: OPAQUE, code: "123456" },
    },
  );
  assert.deepEqual(confirmed.body, {
    confirmed: true,
    recoveryCodes: ["fixture-recovery-one", "fixture-recovery-two"],
  });

  const steppedUp = await jsonRequest(base, "/admin/v1/auth/step-up", {
    method: "POST",
    bearer: "fixture-access",
    body: { requestedActionHash: "a".repeat(43), code: "123456" },
  });
  assert.deepEqual(steppedUp.body, {
    stepUpToken: "fixture-step-up-token",
    expiresAt: DATE,
  });

  const created = await jsonRequest(base, "/admin/v1/staff", {
    method: "POST",
    bearer: "fixture-access",
    headers: { "idempotency-key": "fixture-create-key-0001" },
    body: {
      email: "created@example.test",
      displayName: "Created staff",
      mfaRequired: true,
      assignments: [],
      stepUpToken: OPAQUE,
    },
  });
  assert.deepEqual(created.body, {
    staff: {
      id: "created-staff",
      email: "created@example.test",
      status: "invited",
      version: 1,
    },
    invitation: INVITATION,
  });
  assert.equal("developmentOneTimeUrl" in created.body, false);
  assert.equal(
    (created.body.invitation as Record<string, unknown>).developmentOneTimeUrl,
    INVITATION.developmentOneTimeUrl,
  );

  const productionShapedCreate = await jsonRequest(base, "/admin/v1/staff", {
    method: "POST",
    bearer: "fixture-access",
    headers: { "idempotency-key": "fixture-create-key-0002" },
    body: {
      email: "production-delivery@example.test",
      displayName: "Production delivery",
      mfaRequired: true,
      assignments: [],
      stepUpToken: OPAQUE,
    },
  });
  assert.deepEqual(productionShapedCreate.body, {
    staff: {
      id: "created-staff",
      email: "production-delivery@example.test",
      status: "invited",
      version: 1,
    },
    invitation: {
      invitationId: INVITATION.invitationId,
      expiresAt: INVITATION.expiresAt,
    },
  });

  const resent = await jsonRequest(
    base,
    "/admin/v1/staff/created-staff/invitations/resend",
    {
      method: "POST",
      bearer: "fixture-access",
      headers: { "idempotency-key": "fixture-resend-key-0001" },
      body: {
        expectedVersion: 1,
        reasonCode: "operator_request",
        stepUpToken: OPAQUE,
      },
    },
  );
  assert.deepEqual(resent.body, {
    targetId: "created-staff",
    version: 2,
    invitation: INVITATION,
  });

  const previewTargetRevoke = await jsonRequest(
    base,
    "/admin/v1/staff/created-staff/sessions/session-fixture/revoke/preview",
    {
      method: "POST",
      bearer: "fixture-access",
      body: { expectedVersion: 7 },
    },
  );
  assert.equal(previewTargetRevoke.response.status, 201);
  assert.deepEqual(previewTargetRevoke.body, {
    requestedActionHash: "fixture-target-session-action-hash",
  });

  const previewWithUnexpectedProof = await jsonRequest(
    base,
    "/admin/v1/staff/created-staff/sessions/session-fixture/revoke/preview",
    {
      method: "POST",
      bearer: "fixture-access",
      body: { expectedVersion: 7, stepUpToken: OPAQUE },
    },
  );
  assert.equal(previewWithUnexpectedProof.response.status, 400);

  const executeWithoutProof = await jsonRequest(
    base,
    "/admin/v1/staff/created-staff/sessions/session-fixture",
    {
      method: "DELETE",
      bearer: "fixture-access",
      body: { expectedVersion: 7 },
    },
  );
  assert.equal(executeWithoutProof.response.status, 400);

  const executedTargetRevoke = await jsonRequest(
    base,
    "/admin/v1/staff/created-staff/sessions/session-fixture",
    {
      method: "DELETE",
      bearer: "fixture-access",
      body: { expectedVersion: 7, stepUpToken: OPAQUE },
    },
  );
  assert.equal(executedTargetRevoke.response.status, 200);
  assert.deepEqual(executedTargetRevoke.body, {
    revoked: true,
    targetVersion: 8,
  });
});

function withoutRefresh(
  value: typeof LOGIN_BODY,
): Omit<typeof LOGIN_BODY, "refreshToken"> {
  const { refreshToken: _refreshToken, ...body } = value;
  return body;
}

async function jsonRequest(
  base: string,
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    bearer?: string;
    cookie?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    headers: {
      origin: ORIGIN,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...options.headers,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  return { response, body: (await response.json()) as Record<string, unknown> };
}
