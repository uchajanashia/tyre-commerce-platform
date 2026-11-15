import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";

import {
  AdminApiClient,
  ApiContractDecodeError,
  ApiProblemError,
  Secret,
} from "./runtime";

test("Secret redacts JSON, strings and inspection and is one-use", () => {
  const secret =
    Secret.fromResponse<"credential.access_token">("never-log-this");
  assert.equal(String(secret), "[REDACTED]");
  assert.equal(JSON.stringify({ secret }), '{"secret":"[REDACTED]"}');
  assert.equal(inspect(secret), "Secret([REDACTED])");
  assert.equal(
    secret.consume((value) => value.length),
    14,
  );
  assert.throws(
    () => secret.consume((value) => value),
    /SECRET_ALREADY_CONSUMED/,
  );
});

test("callable operations reject malformed success payloads without exposing values", async () => {
  const client = new AdminApiClient({
    fetch: async () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json", "x-server-correlation-id": "test-correlation" },
      }),
  });
  await assert.rejects(
    client.request("audit-reader.list"),
    (error: unknown) =>
      error instanceof ApiContractDecodeError &&
      error.pointer === "/allowedActions",
  );
});

test("client is same-origin, cancellable and never retries or refreshes implicitly", async () => {
  let calls = 0;
  let unauthorized = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls += 1;
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.signal?.aborted, false);
    return new Response(
      JSON.stringify({
        type: "about:blank",
        title: "Session invalid",
        status: 401,
        code: "UNAUTHORIZED",
        serverCorrelationId: "corr-1",
      }),
      {
        status: 401,
        headers: {
          "content-type": "application/problem+json",
          "x-server-correlation-id": "corr-1",
        },
      },
    );
  };
  const client = new AdminApiClient({
    fetch: fetcher,
    onUnauthorized: () => {
      unauthorized += 1;
    },
  });
  const abort = new AbortController();
  await assert.rejects(
    client.request("governance.decide", {
      path: { id: "approval-1" },
      headers: { "Idempotency-Key": "1234567890abcdef" },
      body: { value: "approve", intentToken: "intent", stepUpToken: "step-up" },
      signal: abort.signal,
    }),
    (error: unknown) =>
      error instanceof ApiProblemError &&
      error.problem.code === "UNAUTHORIZED" &&
      error.problem.type === "about:blank" &&
      error.problem.status === 401,
  );
  assert.equal(calls, 1);
  assert.equal(unauthorized, 1);
  assert.throws(
    () => new AdminApiClient({ basePath: "https://evil.invalid" }),
    /SAME_ORIGIN/,
  );
});

test("wrong success status and malformed RFC problem fail closed", async () => {
  const wrongStatus = new AdminApiClient({
    fetch: async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json", "x-server-correlation-id": "test-correlation" },
      }),
  });
  await assert.rejects(
    wrongStatus.request("governance.prepare-cancellation", {
      path: { id: "request-1" },
    }),
    (error: unknown) =>
      error instanceof ApiContractDecodeError &&
      error.operationId === "governance.prepare-cancellation" &&
      error.pointer === "/" &&
      error.reason === "success-status",
  );

  const malformedProblem = new AdminApiClient({
    fetch: async () =>
      new Response(
        JSON.stringify({
          status: 401,
          code: "invalid-lowercase-code",
          serverCorrelationId: "corr-1",
          leaked: "unexpected",
        }),
        {
          status: 401,
          headers: {
            "content-type": "application/problem+json",
            "x-server-correlation-id": "corr-1",
          },
        },
      ),
  });
  await assert.rejects(
    malformedProblem.request("identity-auth.me"),
    (error: unknown) =>
      error instanceof ApiContractDecodeError &&
      ["required", "const", "enum", "additional-property"].includes(error.reason),
  );
});

test("undeclared error statuses and media types fail before problem wrapping", async () => {
  const problem = {
    type: "urn:tyre:problem:teapot",
    title: "Teapot",
    status: 418,
    code: "TEAPOT",
    serverCorrelationId: "corr-418",
  };
  const undeclaredStatus = new AdminApiClient({
    fetch: async () =>
      new Response(JSON.stringify(problem), {
        status: 418,
        headers: { "content-type": "application/json", "x-server-correlation-id": "corr-418" },
      }),
  });
  await assert.rejects(
    undeclaredStatus.request("identity-auth.me"),
    (error: unknown) =>
      error instanceof ApiContractDecodeError &&
      error.reason === "error-status",
  );

  const undeclaredMedia = new AdminApiClient({
    fetch: async () =>
      new Response("disabled", {
        status: 503,
        headers: { "content-type": "text/plain", "x-server-correlation-id": "test-correlation" },
      }),
  });
  await assert.rejects(
    undeclaredMedia.request("jobs-reader.list"),
    (error: unknown) =>
      error instanceof ApiContractDecodeError &&
      error.reason === "error-content-type",
  );
});

test("every response requires one bounded correlation header and problems require exact body equality", async () => {
  const successBody = { id: "staff-1", email: "staff@example.test", displayName: "Staff", status: "active", enabled: true, roles: [], assignments: [], createdAt: "2026-07-30T12:00:00.000Z", updatedAt: "2026-07-30T12:00:00.000Z", version: 1, tokenVersion: 1, mfaVersion: 1, mfaEnrolled: false };
  const missing = new AdminApiClient({ fetch: async () => new Response(JSON.stringify(successBody), { status: 200, headers: { "content-type": "application/json" } }) });
  await assert.rejects(missing.request("identity-auth.me"), (error: unknown) =>
    error instanceof ApiContractDecodeError && error.reason === "correlation-header");

  const duplicate = new AdminApiClient({ fetch: async () => new Response(JSON.stringify(successBody), { status: 200, headers: { "content-type": "application/json", "x-server-correlation-id": "one,two" } }) });
  await assert.rejects(duplicate.request("identity-auth.me"), (error: unknown) =>
    error instanceof ApiContractDecodeError && error.reason === "correlation-header");

  const mismatch = new AdminApiClient({ fetch: async () => new Response(JSON.stringify({ type: "about:blank", title: "Unauthorized", status: 401, code: "UNAUTHORIZED", serverCorrelationId: "body-correlation" }), { status: 401, headers: { "content-type": "application/problem+json", "x-server-correlation-id": "header-correlation" } }) });
  await assert.rejects(mismatch.request("identity-auth.me"), (error: unknown) =>
    error instanceof ApiContractDecodeError && error.reason === "correlation-header");
});

test("declared errors enforce the operation-specific response schema", async () => {
  const client = new AdminApiClient({
    fetch: async () =>
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Unrelated",
          status: 503,
          code: "UNRELATED_CODE",
          serverCorrelationId: "corr-503",
        }),
        {
          status: 503,
          headers: {
            "content-type": "application/problem+json",
            "x-server-correlation-id": "corr-503",
          },
        },
      ),
  });
  await assert.rejects(
    client.request("jobs-reader.list"),
    (error: unknown) =>
      error instanceof ApiContractDecodeError && error.reason === "enum",
  );
});

test("success decoder enforces format and schema bounds", async () => {
  const responseBody = {
    intent: {
      intentToken: "selector.one-time-intent-secret",
      actionHash: "a".repeat(43),
      expiresAt: "not-a-date",
      bindings: {
        action: "approval.cancel",
        resourceType: "ApprovalRequest",
        resourceId: "request-1",
        resourceVersion: 2,
        correlationId: "00000000-0000-4000-8000-000000000001",
      },
    },
    requestId: "request-1",
  };
  const client = new AdminApiClient({
    fetch: async () =>
      new Response(JSON.stringify(responseBody), {
        status: 201,
        headers: { "content-type": "application/json", "x-server-correlation-id": "test-correlation" },
      }),
  });
  await assert.rejects(
    client.request("governance.prepare-cancellation", {
      path: { id: "request-1" },
    }),
    (error: unknown) =>
      error instanceof ApiContractDecodeError &&
      error.pointer === "/intent/expiresAt" &&
      error.reason === "format:date-time",
  );
});

test("Governance prepare keeps exact siblings while intent proof remains one-use", async () => {
  const rawIntent = "selector.one-time-intent-secret";
  const client = new AdminApiClient({
    fetch: async () =>
      new Response(
        JSON.stringify({
          intent: {
            intentToken: rawIntent,
            actionHash: "a".repeat(43),
            expiresAt: "2026-07-30T20:00:00.000Z",
            bindings: {
              action: "approval.cancel",
              resourceType: "ApprovalRequest",
              resourceId: "request-1",
              resourceVersion: 2,
              payloadHash: "payload-hash",
              targetSetHash: "target-hash",
              policyHash: "policy-hash",
              policyVersion: 1,
              correlationId: "00000000-0000-4000-8000-000000000001",
            },
          },
          requestId: "request-1",
        }),
        { status: 201, headers: { "content-type": "application/json", "x-server-correlation-id": "test-correlation" } },
      ),
  });

  const prepared = await client.request("governance.prepare-cancellation", {
    path: { id: "request-1" },
  });
  assert.equal(prepared.requestId, "request-1");
  assert.equal(prepared.intent.actionHash, "a".repeat(43));
  assert.equal(prepared.intent.bindings.resourceVersion, 2);
  assert.ok(prepared.intent.intentToken instanceof Secret);
  assert.doesNotMatch(JSON.stringify(prepared), /one-time-intent-secret/);
  assert.equal(
    prepared.intent.intentToken.consume((value) => value),
    rawIntent,
  );
  assert.throws(
    () => prepared.intent.intentToken.consume((value) => value),
    /SECRET_ALREADY_CONSUMED/,
  );
});
