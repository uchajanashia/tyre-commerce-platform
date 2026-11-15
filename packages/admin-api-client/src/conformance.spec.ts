import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { inspect } from "node:util";

import {
  AdminApiClient,
  ApiContractDecodeError,
  ApiProblemError,
  Secret,
  assertConformanceResponseSchema,
} from "./runtime";
import {
  OperationId,
  componentSchemas,
  operations,
} from "./generated/operations";

interface MatrixBranch {
  readonly kind: "success" | "error";
  readonly mediaType: string;
  readonly problemCodes: readonly string[];
  readonly status: number;
}

interface MatrixRow {
  readonly clientExcluded: boolean;
  readonly operationId: string;
  readonly responses: readonly MatrixBranch[];
}

interface Matrix {
  readonly counts: { readonly callable: number; readonly excluded: number };
  readonly rows: readonly MatrixRow[];
  readonly sensitiveCases: readonly SensitiveCase[];
}

interface SensitiveDescriptor {
  readonly operationId: string;
  readonly pointer: string;
  readonly status: number;
  readonly branch?: string;
  readonly clientIncluded: boolean;
}

interface SensitiveCase {
  readonly branch: string | null;
  readonly classification: string;
  readonly listWildcard: boolean;
  readonly mediaType: string;
  readonly negativeCases: readonly string[];
  readonly operationId: string;
  readonly pointer: string;
  readonly problemPlacementRejected: boolean;
  readonly status: number;
}

const candidateRoot = process.env.TYRE_CONTRACT_CANDIDATE_ROOT
  ? path.resolve(process.env.TYRE_CONTRACT_CANDIDATE_ROOT)
  : path.resolve(__dirname, "../../..");

const matrix = JSON.parse(
  readFileSync(
    path.join(candidateRoot, "reports/admin-governance-increment3e-conformance-matrix.json"),
    "utf8",
  ),
) as Matrix;

const sensitiveDescriptors = (JSON.parse(
  readFileSync(
    path.join(candidateRoot, "packages/admin-api-client/openapi/sensitive-response-registry.resolved.json"),
    "utf8",
  ),
) as { readonly entries: readonly SensitiveDescriptor[] }).entries.filter(
  ({ clientIncluded }) => clientIncluded,
);

test("all 86 generated callable operations exercise every declared status/media response branch and fail closed", async () => {
  const callable = matrix.rows.filter(({ clientExcluded }) => !clientExcluded);
  assert.equal(callable.length, 86);
  let positiveBranches = 0;
  let negativeCases = 0;

  for (const row of callable) {
    const operationId = row.operationId as OperationId;
    const operation = operations[operationId];
    assert.ok(operation, operationId);
    const request = requestFor(operation.path, operation.requiresIdempotencyKey);
    for (const branch of row.responses) {
      const schema =
        branch.kind === "success"
          ? operation.responseSchema
          : (operation.errorResponses as Readonly<
              Record<string, Readonly<Record<string, unknown>>>
            >)[String(branch.status)]?.[branch.mediaType];
      assert.ok(schema, `${operationId}:${branch.status}:${branch.mediaType}`);
      const body = fixture(schema, branch.status);
      const correlation =
        isRecord(body) && typeof body.serverCorrelationId === "string"
          ? body.serverCorrelationId
          : "conformance-correlation";
      const client = clientReturning(branch.status, branch.mediaType, body, correlation);
      if (branch.kind === "success") {
        await client.request(operationId, request as never);
      } else {
        await assert.rejects(
          client.request(operationId, request as never),
          (error: unknown) =>
            error instanceof ApiProblemError &&
            error.httpStatus === branch.status &&
            error.problem.status === branch.status &&
            error.serverCorrelationId === correlation,
        );
      }
      positiveBranches += 1;

      const wrongStatus = clientReturning(599, branch.mediaType, body, correlation);
      await assert.rejects(
        wrongStatus.request(operationId, request as never),
        (error: unknown) =>
          error instanceof ApiContractDecodeError &&
          ["success-status", "error-status"].includes(error.reason),
      );
      negativeCases += 1;

      const wrongMedia = clientReturning(branch.status, "text/plain", body, correlation);
      await assert.rejects(
        wrongMedia.request(operationId, request as never),
        (error: unknown) =>
          error instanceof ApiContractDecodeError &&
          ["content-type", "error-content-type"].includes(error.reason),
      );
      negativeCases += 1;

      const malformed = clientReturning(
        branch.status,
        branch.mediaType,
        null,
        correlation,
      );
      await assert.rejects(
        malformed.request(operationId, request as never),
        (error: unknown) => error instanceof ApiContractDecodeError,
      );
      negativeCases += 1;
    }
  }
  const declared = callable.reduce((total, row) => total + row.responses.length, 0);
  assert.equal(positiveBranches, declared);
  assert.equal(negativeCases, declared * 3);
});

test("the two reviewed staff exclusions have zero generated network reachability", async () => {
  const excluded = matrix.rows.filter(({ clientExcluded }) => clientExcluded);
  assert.deepEqual(
    excluded.map(({ operationId }) => operationId).sort(),
    ["staff-admin.create", "staff-admin.resend"],
  );
  let fetchCalls = 0;
  const client = new AdminApiClient({
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("EXCLUDED_FETCH_MUST_NOT_RUN");
    },
  });
  for (const { operationId } of excluded) {
    assert.equal(Object.prototype.hasOwnProperty.call(operations, operationId), false);
    await assert.rejects(
      client.request(operationId as OperationId, {} as never),
      /Cannot read properties of undefined/,
    );
  }
  assert.equal(fetchCalls, 0);
});

test("every callable operation/status problem family rejects a foreign registered code", async () => {
  const callable = matrix.rows.filter(({ clientExcluded }) => !clientExcluded);
  const allCodes = [...new Set(callable.flatMap(({ responses }) =>
    responses.flatMap(({ problemCodes }) => problemCodes)))].sort();
  let swaps = 0;
  for (const row of callable) {
    const operationId = row.operationId as OperationId;
    const operation = operations[operationId];
    const request = requestFor(operation.path, operation.requiresIdempotencyKey);
    for (const branch of row.responses.filter(({ kind }) => kind === "error")) {
      const foreign = allCodes.find((code) => !branch.problemCodes.includes(code));
      assert.ok(foreign, `${operationId}:${branch.status}`);
      const schema = (operation.errorResponses as Readonly<Record<string, Readonly<Record<string, unknown>>>>)[String(branch.status)][branch.mediaType];
      const body = fixture(schema, branch.status) as Record<string, unknown>;
      body.code = foreign;
      await assert.rejects(
        clientReturning(branch.status, branch.mediaType, body).request(operationId, request as never),
        (error: unknown) => error instanceof ApiContractDecodeError && error.reason === "enum",
      );
      swaps += 1;
    }
  }
  assert.equal(swaps, callable.reduce((total, row) => total + row.responses.filter(({ kind }) => kind === "error").length, 0));
});

test("sensitive values redact, clear and never unwrap at a wrong response pointer", async () => {
  const secret = Secret.fromResponse<"fixture">("sensitive-fixture");
  secret.clear();
  assert.throws(() => secret.consume((value) => value), /SECRET_ALREADY_CONSUMED/);

  const raw = "not-at-a-registered-pointer";
  const body = fixture(operations["identity-auth.me"].responseSchema, 200) as Record<
    string,
    unknown
  >;
  body.displayName = raw;
  const response = await clientReturning(200, "application/json", body).request(
    "identity-auth.me",
  );
  assert.equal(response.displayName, raw);
  assert.equal((response.displayName as unknown) instanceof Secret, false);
});

test("all 18 callable sensitive descriptors pass the generated exhaustive binding and leakage matrix", async () => {
  assert.equal(sensitiveDescriptors.length, 18);
  assert.equal(matrix.sensitiveCases.length, 18);
  const registryKeys = sensitiveDescriptors.map(sensitiveKey).sort();
  assert.deepEqual(matrix.sensitiveCases.map(sensitiveKey).sort(), registryKeys);
  const expectedNegatives = [
    "wrong-operation", "wrong-status", "wrong-media-type", "wrong-branch",
    "wrong-pointer", "list-placement", "problem-body-placement", "cache-placement",
    "navigation-placement", "cancellation", "error-text", "logging",
    "string-coercion", "json-serialization", "node-inspection",
  ];
  const consoleOutput: string[] = [];
  const restoredConsole = captureConsole(consoleOutput);
  const capabilityReads = { cache: 0, navigation: 0, storage: 0 };
  const restoredCapabilities = trapPersistenceAndNavigation(capabilityReads);
  let positiveBindings = 0;
  let negativeBindings = 0;
  try {
    for (const [index, descriptor] of matrix.sensitiveCases.entries()) {
      assert.deepEqual(descriptor.negativeCases, expectedNegatives);
      assert.equal(descriptor.mediaType, "application/json");
      assert.equal(descriptor.problemPlacementRejected, true);
      const operationId = descriptor.operationId as OperationId;
      const operation = operations[operationId];
      assert.ok(operation, operationId);
      assert.equal(operation.successStatus, descriptor.status);
      const raw = `3f-sensitive-sentinel-${index}`;
      const request = requestFor(operation.path, operation.requiresIdempotencyKey) as never;
      const body = fixture(
        operation.responseSchema,
        descriptor.status,
        "",
        descriptor.branch ?? undefined,
      ) as Record<string, unknown>;
      setPointer(body, descriptor.pointer, raw);
      const recorded: Array<{ input: string; init?: RequestInit }> = [];
      const decoded = await clientRecording(
        descriptor.status,
        descriptor.mediaType,
        body,
        recorded,
      ).request(operationId, request) as unknown;
      const wrapped = getPointer(decoded, descriptor.pointer);
      assert.ok(wrapped instanceof Secret, `${operationId}:${descriptor.pointer}`);
      assert.equal(String(wrapped), "[REDACTED]");
      assert.equal(JSON.stringify(wrapped), '"[REDACTED]"');
      assert.equal(inspect(wrapped), "Secret([REDACTED])");
      assert.equal(recorded.length, 1);
      assert.equal(leakText(recorded).includes(raw), false);
      assert.equal(wrapped.consume((value) => value), raw);
      assert.throws(() => wrapped.consume((value) => value), /SECRET_ALREADY_CONSUMED/);
      assert.equal(String(wrapped), "[REDACTED]");
      positiveBindings += 1;

      const clearBody = fixture(
        operation.responseSchema,
        descriptor.status,
        "",
        descriptor.branch ?? undefined,
      ) as Record<string, unknown>;
      setPointer(clearBody, descriptor.pointer, raw);
      const clearDecoded = await clientReturning(
        descriptor.status,
        descriptor.mediaType,
        clearBody,
      ).request(operationId, request) as unknown;
      const cleared = getPointer(clearDecoded, descriptor.pointer);
      assert.ok(cleared instanceof Secret);
      cleared.clear();
      assert.throws(() => cleared.consume((value) => value), /SECRET_ALREADY_CONSUMED/);

      const wrongStatus = descriptor.status === 200 ? 201 : 200;
      await rejectsWithoutLeak(
        clientReturning(wrongStatus, descriptor.mediaType, body).request(operationId, request),
        raw,
      );
      negativeBindings += 1;
      await rejectsWithoutLeak(
        clientReturning(descriptor.status, "text/plain", body).request(operationId, request),
        raw,
      );
      negativeBindings += 1;

      const wrongOperationId: OperationId = operationId === "identity-auth.me"
        ? "audit-reader.list"
        : "identity-auth.me";
      await rejectsWithoutLeak(
        clientReturning(
          operations[wrongOperationId].successStatus,
          "application/json",
          body,
        ).request(wrongOperationId, requestFor(
          operations[wrongOperationId].path,
          operations[wrongOperationId].requiresIdempotencyKey,
        ) as never),
        raw,
      );
      negativeBindings += 1;

      const wrongPointerBody = fixture(
        operation.responseSchema,
        descriptor.status,
        "",
        descriptor.branch ?? undefined,
      ) as Record<string, unknown>;
      setPointer(wrongPointerBody, descriptor.pointer, "benign-placeholder");
      wrongPointerBody.__wrongSensitivePointer = raw;
      await rejectsWithoutLeak(
        clientReturning(descriptor.status, descriptor.mediaType, wrongPointerBody)
          .request(operationId, request),
        raw,
      );
      negativeBindings += 1;

      const wrongBranch = wrongBranchBody(descriptor, raw);
      await rejectsWithoutLeak(
        clientReturning(200, "application/json", wrongBranch)
          .request("identity-auth.login", requestFor(
            operations["identity-auth.login"].path,
            operations["identity-auth.login"].requiresIdempotencyKey,
          ) as never),
        raw,
      );
      negativeBindings += 1;

      if (descriptor.listWildcard) {
        const listBody = fixture(
          operation.responseSchema,
          descriptor.status,
          "",
          descriptor.branch ?? undefined,
        ) as Record<string, unknown>;
        const secondRaw = `${raw}-second`;
        setPointerList(listBody, descriptor.pointer, [raw, secondRaw]);
        const listDecoded = await clientReturning(
          descriptor.status,
          descriptor.mediaType,
          listBody,
        ).request(operationId, request) as unknown;
        const list = getPointerList(listDecoded, descriptor.pointer);
        assert.equal(list.length, 2);
        assert.ok(list.every((item) => item instanceof Secret));
        assert.deepEqual(
          list.map((item) => item.consume((value) => value)),
          [raw, secondRaw],
        );
      } else {
        const listPlacement = fixture(
          operation.responseSchema,
          descriptor.status,
          "",
          descriptor.branch ?? undefined,
        ) as Record<string, unknown>;
        listPlacement.items = [raw];
        await rejectsWithoutLeak(
          clientReturning(descriptor.status, descriptor.mediaType, listPlacement)
            .request(operationId, request),
          raw,
        );
      }
      negativeBindings += 1;

      const matrixRow = matrix.rows.find((row) => row.operationId === descriptor.operationId);
      const problemBranch = matrixRow?.responses.find(({ kind }) => kind === "error");
      assert.ok(problemBranch, `${operationId}:problem-branch`);
      const errorSchema = (operation.errorResponses as Readonly<
        Record<string, Readonly<Record<string, unknown>>>
      >)[String(problemBranch.status)]?.[problemBranch.mediaType];
      assert.ok(errorSchema);
      const problemBody = fixture(errorSchema, problemBranch.status) as Record<string, unknown>;
      setPointer(problemBody, descriptor.pointer, raw);
      await rejectsWithoutLeak(
        clientReturning(problemBranch.status, problemBranch.mediaType, problemBody)
          .request(operationId, request),
        raw,
      );
      negativeBindings += 1;

      const abort = new AbortController();
      let cancellationCalls = 0;
      const cancellationRequest = {
        ...(request as unknown as Record<string, unknown>),
        signal: abort.signal,
      };
      const cancelled = new AdminApiClient({
        fetch: async (_input, init) => {
          cancellationCalls += 1;
          return await new Promise<Response>((_resolve, reject) => {
            const fail = () => reject(new DOMException("request-cancelled", "AbortError"));
            if (init?.signal?.aborted) fail();
            else init?.signal?.addEventListener("abort", fail, { once: true });
          });
        },
      }).request(operationId, cancellationRequest as never);
      abort.abort();
      await rejectsWithoutLeak(cancelled, raw);
      assert.equal(cancellationCalls, 1);
      negativeBindings += 1;
    }
  } finally {
    restoredCapabilities();
    restoredConsole();
  }
  assert.equal(positiveBindings, 18);
  assert.equal(negativeBindings, 18 * 8);
  assert.equal(consoleOutput.length, 0);
  assert.deepEqual(capabilityReads, { cache: 0, navigation: 0, storage: 0 });
});

test("every generated union/null/discriminator alternative is accepted without bypassing sibling constraints", () => {
  const compositions = collectCompositions([
    ...Object.values(componentSchemas),
    ...Object.values(operations).flatMap((operation) => [
      operation.responseSchema,
      ...Object.values(operation.errorResponses).flatMap((media) => Object.values(media)),
    ]),
  ]);
  let alternatives = 0;
  let nullable = 0;
  let discriminators = 0;
  for (const schema of compositions) {
    const branches = Array.isArray(schema.oneOf) ? schema.oneOf : schema.anyOf;
    assert.ok(Array.isArray(branches));
    for (const branch of branches) {
      assert.doesNotThrow(() =>
        assertConformanceResponseSchema(fixture(combineAlternative(schema, branch), 200), schema, "identity-auth.me"),
      );
      alternatives += 1;
      if (isRecord(branch) && branch.type === "null") nullable += 1;
    }
    if (isRecord(schema.discriminator)) {
      discriminators += 1;
      const valid = fixture(schema, 200) as Record<string, unknown>;
      valid[String(schema.discriminator.propertyName)] = "wrong-discriminator";
      assert.throws(() => assertConformanceResponseSchema(valid, schema, "identity-auth.login"));
    }
  }
  assert.ok(compositions.length >= 58);
  assert.ok(alternatives >= 116);
  assert.ok(nullable >= 50);
  assert.equal(discriminators, 1);

  assert.throws(() => assertConformanceResponseSchema("abcd", {
    oneOf: [{ type: "string" }, { type: "string" }],
  }, "identity-auth.me"), /oneOf/);
  assert.doesNotThrow(() => assertConformanceResponseSchema("a", {
    anyOf: [{ type: "string" }, { type: "number" }], maxLength: 1,
  }, "identity-auth.me"));
  assert.throws(() => assertConformanceResponseSchema("too-long", {
    oneOf: [{ type: "string" }, { type: "null" }], maxLength: 2,
  }, "identity-auth.me"), /maxLength/);
  assert.throws(() => assertConformanceResponseSchema(-1, {
    oneOf: [{ type: "number" }, { type: "null" }], minimum: 0,
  }, "identity-auth.me"), /minimum/);
  assert.throws(() => assertConformanceResponseSchema("other", {
    oneOf: [{ type: "string" }, { type: "null" }], enum: ["allowed", null],
  }, "identity-auth.me"), /enum/);
  assert.throws(() => assertConformanceResponseSchema({ kind: "a", leak: true }, {
    oneOf: [{ type: "object", properties: { kind: { const: "a" } }, required: ["kind"], additionalProperties: false }],
  }, "identity-auth.me"), /oneOf|additional-property/);
});

function clientReturning(
  status: number,
  mediaType: string,
  body: unknown,
  correlation = "conformance-correlation",
): AdminApiClient {
  return new AdminApiClient({
    fetch: async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": mediaType,
          "x-server-correlation-id": correlation,
        },
      }),
  });
}

function clientRecording(
  status: number,
  mediaType: string,
  body: unknown,
  recorded: Array<{ input: string; init?: RequestInit }>,
): AdminApiClient {
  return new AdminApiClient({
    fetch: async (input, init) => {
      recorded.push({ input: String(input), init });
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": mediaType,
          "x-server-correlation-id": "conformance-correlation",
        },
      });
    },
  });
}

function sensitiveKey(descriptor: {
  readonly branch?: string | null;
  readonly operationId: string;
  readonly pointer: string;
  readonly status: number;
}): string {
  return [
    descriptor.operationId,
    descriptor.status,
    descriptor.branch ?? "-",
    descriptor.pointer,
  ].join(":");
}

async function rejectsWithoutLeak(promise: Promise<unknown>, raw: string): Promise<void> {
  let rejection: unknown;
  try {
    await promise;
  } catch (error) {
    rejection = error;
  }
  assert.notEqual(rejection, undefined, "expected fail-closed rejection");
  assert.equal(String(rejection).includes(raw), false);
  assert.equal(inspect(rejection).includes(raw), false);
  assert.equal(safeJson(rejection).includes(raw), false);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "[UNSERIALIZABLE]";
  }
}

function leakText(value: unknown): string {
  return `${safeJson(value)}\n${inspect(value, { depth: 6 })}`;
}

function wrongBranchBody(descriptor: SensitiveCase, raw: string): Record<string, unknown> {
  const branch = descriptor.pointer === "/accessToken"
    ? "mfa_required"
    : "authenticated";
  const body = fixture(
    operations["identity-auth.login"].responseSchema,
    200,
    "",
    branch,
  ) as Record<string, unknown>;
  setPointer(body, descriptor.pointer, raw);
  return body;
}

function captureConsole(output: string[]): () => void {
  const methods = ["debug", "error", "info", "log", "warn"] as const;
  const original = new Map<typeof methods[number], (...data: unknown[]) => void>();
  for (const method of methods) {
    original.set(method, console[method]);
    console[method] = (...data: unknown[]) => {
      output.push(data.map((item) => leakText(item)).join(" "));
    };
  }
  return () => {
    for (const method of methods) console[method] = original.get(method)!;
  };
}

function trapPersistenceAndNavigation(reads: {
  cache: number;
  navigation: number;
  storage: number;
}): () => void {
  const traps: Array<[string, PropertyDescriptor | undefined]> = [];
  for (const [name, counter] of [
    ["caches", "cache"],
    ["location", "navigation"],
    ["navigation", "navigation"],
    ["localStorage", "storage"],
    ["sessionStorage", "storage"],
  ] as const) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    if (previous && previous.configurable === false) continue;
    traps.push([name, previous]);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => {
        reads[counter] += 1;
        throw new Error(`FORBIDDEN_${name.toUpperCase()}_ACCESS`);
      },
    });
  }
  return () => {
    for (const [name, previous] of traps) {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  };
}

function requestFor(pathTemplate: string, idempotencyRequired: boolean) {
  const pathValues: Record<string, string> = {};
  for (const match of pathTemplate.matchAll(/\{([^}]+)\}/g)) {
    pathValues[match[1]] = "00000000-0000-4000-8000-000000000001";
  }
  return {
    ...(Object.keys(pathValues).length ? { path: pathValues } : {}),
    ...(idempotencyRequired
      ? { headers: { "Idempotency-Key": "conformance-idempotency-key-0001" } }
      : {}),
  };
}

function fixture(schemaValue: unknown, httpStatus: number, propertyName = "", branchName?: string): unknown {
  if (!isRecord(schemaValue)) throw new Error("FIXTURE_SCHEMA_INVALID");
  if (typeof schemaValue.$ref === "string") {
    const name = schemaValue.$ref.split("/").at(-1) ?? "";
    const schema = (componentSchemas as Readonly<Record<string, unknown>>)[name];
    if (!schema) throw new Error(`FIXTURE_REF_MISSING:${name}`);
    return fixture(schema, httpStatus, propertyName, branchName);
  }
  if (Array.isArray(schemaValue.allOf)) {
    return schemaValue.allOf.reduce<unknown>((current, branch) => {
      const value = fixture(branch, httpStatus, propertyName, branchName);
      return isRecord(current) && isRecord(value)
        ? { ...current, ...value }
        : value;
    }, {});
  }
  if (Array.isArray(schemaValue.oneOf)) {
    const selected = branchName
      ? schemaValue.oneOf.find((branch) =>
          isRecord(branch) && isRecord(branch.properties) &&
          isRecord(branch.properties.status) && branch.properties.status.const === branchName,
        )
      : undefined;
    return fixture(combineAlternative(schemaValue, selected ?? schemaValue.oneOf[0]), httpStatus, propertyName, branchName);
  }
  if (Array.isArray(schemaValue.anyOf)) {
    return fixture(combineAlternative(schemaValue, schemaValue.anyOf[0]), httpStatus, propertyName, branchName);
  }
  if ("const" in schemaValue) return schemaValue.const;
  if (Array.isArray(schemaValue.enum)) return schemaValue.enum[0];
  const type = Array.isArray(schemaValue.type)
    ? schemaValue.type.find((value) => value !== "null")
    : schemaValue.type;
  if (type === "object" || isRecord(schemaValue.properties)) {
    const value: Record<string, unknown> = {};
    for (const name of (schemaValue.required as readonly string[] | undefined) ?? []) {
      const child = (schemaValue.properties as Record<string, unknown>)[name];
      value[name] = name === "status" && isRecord(child) && child.type === "integer"
        ? httpStatus
        : fixture(child, httpStatus, name, branchName);
    }
    return value;
  }
  if (type === "array") {
    if (schemaValue.items === false || schemaValue.maxItems === 0) return [];
    const count = Math.max(Number(schemaValue.minItems ?? 0), 1);
    return Array.from({ length: count }, () => fixture(schemaValue.items, httpStatus, "", branchName));
  }
  if (type === "boolean") return true;
  if (type === "integer" || type === "number") {
    return Math.max(Number(schemaValue.minimum ?? 0), 1);
  }
  if (type === "null") return null;
  if (type === "string" || type === undefined) {
    if (schemaValue.format === "date-time") return "2026-07-30T12:00:00.000Z";
    if (schemaValue.format === "email") return "conformance@example.test";
    if (schemaValue.format === "uuid") return "00000000-0000-4000-8000-000000000001";
    if (schemaValue.format === "uri") return "https://conformance.invalid/resource";
    if (schemaValue.format === "uri-reference") return "urn:tyre:conformance";
    if (schemaValue.pattern === "^\\d{6}$") return "123456";
    if (schemaValue.pattern === "^[A-Z][A-Z0-9_]{1,127}$") return "CONFORMANCE_ERROR";
    if (schemaValue.pattern === "^[A-Za-z0-9_-]+$") return "conformance_value";
    const minimum = Math.max(Number(schemaValue.minLength ?? 1), 1);
    return propertyName === "serverCorrelationId"
      ? "conformance-correlation"
      : "x".repeat(minimum);
  }
  throw new Error(`FIXTURE_TYPE_UNSUPPORTED:${String(type)}`);
}

function setPointer(root: Record<string, unknown>, pointer: string, value: string): void {
  const parts = pointer.split("/").filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const next = parts[index + 1];
    if (index === parts.length - 1) current[part] = value;
    else if (next === "*") {
      current[part] = [value];
      return;
    } else {
      if (!isRecord(current[part])) current[part] = {};
      current = current[part] as Record<string, unknown>;
    }
  }
}

function setPointerList(
  root: Record<string, unknown>,
  pointer: string,
  values: readonly string[],
): void {
  assert.ok(pointer.endsWith("/*"));
  const listPointer = pointer.slice(0, -2);
  const parts = listPointer.split("/").filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (index === parts.length - 1) current[part] = [...values];
    else {
      if (!isRecord(current[part])) current[part] = {};
      current = current[part] as Record<string, unknown>;
    }
  }
}

function getPointerList(root: unknown, pointer: string): Secret<string>[] {
  assert.ok(pointer.endsWith("/*"));
  const list = getPointer(root, pointer.slice(0, -2));
  assert.ok(Array.isArray(list));
  return list as Secret<string>[];
}

function getPointer(root: unknown, pointer: string): unknown {
  let current = root;
  for (const part of pointer.split("/").filter(Boolean)) {
    current = part === "*"
      ? (Array.isArray(current) ? current[0] : undefined)
      : (isRecord(current) ? current[part] : undefined);
  }
  return current;
}

function collectCompositions(roots: readonly unknown[]): Record<string, any>[] {
  const found: Record<string, any>[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown): void => {
    if (!isRecord(value) || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value.oneOf) || Array.isArray(value.anyOf)) found.push(value);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  roots.forEach(visit);
  return found;
}

function combineAlternative(parent: Record<string, any>, branch: unknown): Record<string, any> {
  if (!isRecord(branch)) throw new Error("ALTERNATIVE_SCHEMA_INVALID");
  const combined = { ...parent, ...branch };
  delete combined.oneOf;
  delete combined.anyOf;
  delete combined.discriminator;
  return combined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
