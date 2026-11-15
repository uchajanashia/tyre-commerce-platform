import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import { IdentityAuthController } from "./identity-auth.controller";
import {
  InvitationController,
  PasswordResetController,
} from "./invitation.controller";
import { MfaController, StepUpController } from "./mfa.controller";
import { RecoveryController } from "./recovery.controller";
import {
  RoleCatalogController,
  StaffAdminController,
} from "./staff-admin.controller";

type ControllerClass = { prototype: object };

interface ExpectedOperation {
  readonly controller: ControllerClass;
  readonly handler: string;
  readonly operationId: string;
  readonly status: number;
}

const EXPECTED: readonly ExpectedOperation[] = [
  {
    controller: IdentityAuthController,
    handler: "login",
    operationId: "identity-auth.login",
    status: 200,
  },
  {
    controller: IdentityAuthController,
    handler: "completeMfa",
    operationId: "identity-auth.complete-mfa",
    status: 200,
  },
  {
    controller: IdentityAuthController,
    handler: "csrf",
    operationId: "identity-auth.csrf",
    status: 200,
  },
  {
    controller: IdentityAuthController,
    handler: "refresh",
    operationId: "identity-auth.refresh",
    status: 200,
  },
  {
    controller: IdentityAuthController,
    handler: "logout",
    operationId: "identity-auth.logout",
    status: 200,
  },
  {
    controller: IdentityAuthController,
    handler: "me",
    operationId: "identity-auth.me",
    status: 200,
  },
  {
    controller: IdentityAuthController,
    handler: "listSessions",
    operationId: "identity-auth.list-sessions",
    status: 200,
  },
  {
    controller: IdentityAuthController,
    handler: "revokeSession",
    operationId: "identity-auth.revoke-session",
    status: 200,
  },
  {
    controller: IdentityAuthController,
    handler: "revokeAll",
    operationId: "identity-auth.revoke-all",
    status: 201,
  },
  {
    controller: InvitationController,
    handler: "inspect",
    operationId: "invitation.inspect",
    status: 200,
  },
  {
    controller: InvitationController,
    handler: "accept",
    operationId: "invitation.accept",
    status: 200,
  },
  {
    controller: PasswordResetController,
    handler: "request",
    operationId: "password-reset.request",
    status: 202,
  },
  {
    controller: PasswordResetController,
    handler: "complete",
    operationId: "password-reset.complete",
    status: 200,
  },
  {
    controller: MfaController,
    handler: "start",
    operationId: "mfa.start",
    status: 201,
  },
  {
    controller: MfaController,
    handler: "confirm",
    operationId: "mfa.confirm",
    status: 201,
  },
  {
    controller: StepUpController,
    handler: "stepUp",
    operationId: "step-up.step-up",
    status: 201,
  },
  {
    controller: StaffAdminController,
    handler: "list",
    operationId: "staff-admin.list",
    status: 200,
  },
  {
    controller: StaffAdminController,
    handler: "create",
    operationId: "staff-admin.create",
    status: 201,
  },
  {
    controller: StaffAdminController,
    handler: "previewCreate",
    operationId: "staff-admin.preview-create",
    status: 201,
  },
  {
    controller: StaffAdminController,
    handler: "detail",
    operationId: "staff-admin.detail",
    status: 200,
  },
  {
    controller: StaffAdminController,
    handler: "previewResend",
    operationId: "staff-admin.preview-resend",
    status: 201,
  },
  {
    controller: StaffAdminController,
    handler: "resend",
    operationId: "staff-admin.resend",
    status: 201,
  },
  {
    controller: StaffAdminController,
    handler: "targetSessions",
    operationId: "staff-admin.target-sessions",
    status: 200,
  },
  {
    controller: StaffAdminController,
    handler: "previewTargetSessionRevoke",
    operationId: "staff-admin.preview-target-session-revoke",
    status: 201,
  },
  {
    controller: StaffAdminController,
    handler: "revokeTargetSession",
    operationId: "staff-admin.revoke-target-session",
    status: 200,
  },
  {
    controller: StaffAdminController,
    handler: "activate",
    operationId: "staff-admin.activate",
    status: 201,
  },
  {
    controller: StaffAdminController,
    handler: "previewActivate",
    operationId: "staff-admin.preview-activate",
    status: 201,
  },
  {
    controller: StaffAdminController,
    handler: "disable",
    operationId: "staff-admin.disable",
    status: 201,
  },
  {
    controller: StaffAdminController,
    handler: "previewDisable",
    operationId: "staff-admin.preview-disable",
    status: 201,
  },
  {
    controller: StaffAdminController,
    handler: "reenable",
    operationId: "staff-admin.reenable",
    status: 201,
  },
  {
    controller: StaffAdminController,
    handler: "previewReenable",
    operationId: "staff-admin.preview-reenable",
    status: 201,
  },
  {
    controller: StaffAdminController,
    handler: "assignments",
    operationId: "staff-admin.assignments",
    status: 200,
  },
  {
    controller: StaffAdminController,
    handler: "previewAssignments",
    operationId: "staff-admin.preview-assignments",
    status: 201,
  },
  {
    controller: RoleCatalogController,
    handler: "roles",
    operationId: "role-catalog.roles",
    status: 200,
  },
  {
    controller: RecoveryController,
    handler: "request",
    operationId: "recovery.request",
    status: 201,
  },
  {
    controller: RecoveryController,
    handler: "previewRequest",
    operationId: "recovery.preview-request",
    status: 201,
  },
  {
    controller: RecoveryController,
    handler: "approve",
    operationId: "recovery.approve",
    status: 201,
  },
  {
    controller: RecoveryController,
    handler: "previewApproval",
    operationId: "recovery.preview-approval",
    status: 200,
  },
] as const;

test("all 38 Admin identity inventory operations publish exact status-bound response metadata", () => {
  assert.equal(EXPECTED.length, 38);
  assert.equal(
    new Set(EXPECTED.map(({ operationId }) => operationId)).size,
    EXPECTED.length,
  );

  for (const expected of EXPECTED) {
    const method = (
      expected.controller.prototype as unknown as Record<string, unknown>
    )[expected.handler];
    assert.equal(
      typeof method,
      "function",
      `${expected.operationId} handler exists`,
    );
    const operation = Reflect.getMetadata(
      "swagger/apiOperation",
      method as object,
    ) as { operationId?: string } | undefined;
    assert.equal(
      operation?.operationId,
      expected.operationId,
      `${expected.operationId} stable operationId`,
    );
    const responses = Reflect.getMetadata(
      "swagger/apiResponse",
      method as object,
    ) as
      | Record<
          string,
          {
            type?: unknown;
            schema?: {
              oneOf?: unknown[];
              discriminator?: { propertyName?: string };
            };
          }
        >
      | undefined;
    const response = responses?.[String(expected.status)];
    assert.ok(
      response,
      `${expected.operationId} publishes status ${expected.status}`,
    );
    const hasType = typeof response.type === "function";
    const hasDiscriminatedUnion =
      Array.isArray(response.schema?.oneOf) &&
      response.schema.oneOf.length > 1 &&
      response.schema.discriminator?.propertyName === "status";
    assert.ok(
      hasType || hasDiscriminatedUnion,
      `${expected.operationId} publishes an exact DTO or discriminated union`,
    );
  }
});
