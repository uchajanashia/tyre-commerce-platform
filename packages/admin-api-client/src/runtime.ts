import { ApiProblem } from "./generated/models";
import {
  OperationId,
  OperationsRequiringRequest,
  RequestByOperation,
  ResponseByOperation,
  componentSchemas,
  operations,
} from "./generated/operations";

declare const secretClass: unique symbol;

/** Opaque immediate-use response value. It is deliberately not assignable to string. */
export class Secret<TClass extends string> {
  declare readonly [secretClass]: TClass;
  #value: string | undefined;

  private constructor(value: string) {
    this.#value = value;
  }

  static fromResponse<T extends string>(value: string): Secret<T> {
    return new Secret<T>(value);
  }

  consume<TResult>(handler: (value: string) => TResult): TResult {
    const value = this.#value;
    this.#value = undefined;
    if (value === undefined) throw new Error("SECRET_ALREADY_CONSUMED");
    return handler(value);
  }

  clear(): void {
    this.#value = undefined;
  }

  toString(): string {
    return "[REDACTED]";
  }

  toJSON(): string {
    return "[REDACTED]";
  }

  get [Symbol.toStringTag](): string {
    return "Secret([REDACTED])";
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "Secret([REDACTED])";
  }
}

export class ApiProblemError extends Error {
  constructor(
    readonly problem: ApiProblem,
    readonly httpStatus: number,
    readonly serverCorrelationId: string | undefined,
  ) {
    super(problem.code);
    this.name = "ApiProblemError";
  }
}

export class ApiContractDecodeError extends Error {
  constructor(
    readonly operationId: OperationId,
    readonly pointer: string,
    readonly reason: string,
  ) {
    super(`INVALID_SUCCESS_RESPONSE:${operationId}:${pointer}:${reason}`);
    this.name = "ApiContractDecodeError";
  }
}

export interface AdminApiClientOptions {
  readonly fetch?: typeof fetch;
  readonly basePath?: string;
  readonly credentials?: "same-origin" | "omit";
  readonly getAccessToken?: () => string | undefined;
  /** Notification only. The generated client never refreshes or replays a request. */
  readonly onUnauthorized?: (context: {
    readonly operationId: OperationId;
  }) => void | Promise<void>;
}

export interface OperationRequest {
  readonly path?: Readonly<Record<string, string>>;
  readonly query?: Readonly<
    Record<string, string | number | boolean | undefined>
  >;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export class AdminApiClient {
  readonly #fetch: typeof fetch;
  readonly #basePath: string;
  readonly #credentials: "same-origin" | "omit";
  readonly #getAccessToken?: () => string | undefined;
  readonly #onUnauthorized?: AdminApiClientOptions["onUnauthorized"];

  constructor(options: AdminApiClientOptions = {}) {
    const basePath = options.basePath ?? "";
    if (
      basePath &&
      (!basePath.startsWith("/") ||
        basePath.startsWith("//") ||
        basePath.includes("://"))
    ) {
      throw new Error("ADMIN_API_BASE_PATH_MUST_BE_SAME_ORIGIN_RELATIVE");
    }
    this.#fetch = options.fetch ?? fetch;
    this.#basePath = basePath.replace(/\/$/, "");
    this.#credentials = options.credentials ?? "same-origin";
    this.#getAccessToken = options.getAccessToken;
    this.#onUnauthorized = options.onUnauthorized;
  }

  async request<TId extends OperationId>(
    operationId: TId,
    ...arguments_: TId extends OperationsRequiringRequest
      ? [request: RequestByOperation[TId]]
      : [request?: RequestByOperation[TId]]
  ): Promise<ResponseByOperation[TId]> {
    const request = (arguments_[0] ?? {}) as OperationRequest;
    const contract = operations[operationId];
    let route = contract.path as string;
    for (const [name, value] of Object.entries(request.path ?? {})) {
      route = route.replace(`{${name}}`, encodeURIComponent(value));
    }
    if (/\{[^}]+\}/.test(route))
      throw new Error("ADMIN_API_PATH_PARAMETER_REQUIRED");
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) query.set(name, String(value));
    }
    const headers = new Headers(request.headers);
    headers.set("Accept", "application/json");
    const accessToken = this.#getAccessToken?.();
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    if (request.body !== undefined)
      headers.set("Content-Type", "application/json");
    const response = await this.#fetch(
      `${this.#basePath}${route}${query.size ? `?${query.toString()}` : ""}`,
      {
        method: contract.method,
        credentials: this.#credentials,
        headers,
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: request.signal,
      },
    );
    const correlation =
      response.headers.get("x-server-correlation-id") ?? undefined;
    if (!isValidServerCorrelation(correlation))
      throw new ApiContractDecodeError(
        operationId,
        "/headers/X-Server-Correlation-Id",
        "correlation-header",
      );
    const mediaType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (!response.ok) {
      const errorResponses = contract.errorResponses as Readonly<
        Record<string, Readonly<Record<string, unknown>>>
      >;
      const statusContract = errorResponses[String(response.status)];
      if (!statusContract)
        throw new ApiContractDecodeError(operationId, "/", "error-status");
      const errorSchema = mediaType ? statusContract[mediaType] : undefined;
      if (!errorSchema)
        throw new ApiContractDecodeError(
          operationId,
          "/",
          "error-content-type",
        );
      const body = (await response.json().catch(() => undefined)) as unknown;
      assertResponseSchema(body, errorSchema, operationId, "");
      const problem = decodeProblem(
        body,
        response.status,
        correlation,
        operationId,
      );
      if (response.status === 401)
        await this.#onUnauthorized?.({ operationId });
      throw new ApiProblemError(problem, response.status, correlation);
    }
    if (response.status !== contract.successStatus) {
      throw new ApiContractDecodeError(operationId, "/", "success-status");
    }
    if (mediaType !== "application/json") {
      throw new ApiContractDecodeError(operationId, "/", "content-type");
    }
    const body = (await response.json().catch(() => undefined)) as unknown;
    assertResponseSchema(body, contract.responseSchema, operationId, "");
    return wrapSensitive(
      body,
      contract.sensitive ?? [],
    ) as ResponseByOperation[TId];
  }
}

function assertResponseSchema(
  value: unknown,
  schemaValue: unknown,
  operationId: OperationId,
  pointer: string,
): void {
  if (!isRecord(schemaValue))
    throw new ApiContractDecodeError(
      operationId,
      pointer || "/",
      "invalid-schema",
    );
  if (typeof schemaValue["$ref"] === "string") {
    const name = schemaValue["$ref"].split("/").at(-1) ?? "";
    const referenced = (componentSchemas as Readonly<Record<string, unknown>>)[
      name
    ];
    if (!referenced)
      throw new ApiContractDecodeError(
        operationId,
        pointer || "/",
        "missing-schema-ref",
      );
    assertResponseSchema(value, referenced, operationId, pointer);
    assertCompositionSiblings(value, schemaValue, operationId, pointer, ["$ref"]);
    return;
  }
  const oneOf = schemaValue["oneOf"];
  if (Array.isArray(oneOf)) {
    const matches = oneOf.filter((branch) => {
      try {
        assertResponseSchema(value, branch, operationId, pointer);
        return true;
      } catch {
        return false;
      }
    });
    if (matches.length !== 1)
      throw new ApiContractDecodeError(operationId, pointer || "/", "oneOf");
    assertCompositionSiblings(value, schemaValue, operationId, pointer, ["oneOf", "discriminator"]);
    return;
  }
  const anyOf = schemaValue["anyOf"];
  if (Array.isArray(anyOf)) {
    const matched = anyOf.some((branch) => {
      try {
        assertResponseSchema(value, branch, operationId, pointer);
        return true;
      } catch {
        return false;
      }
    });
    if (!matched)
      throw new ApiContractDecodeError(operationId, pointer || "/", "anyOf");
    assertCompositionSiblings(value, schemaValue, operationId, pointer, ["anyOf", "discriminator"]);
    return;
  }
  const allOf = schemaValue["allOf"];
  if (Array.isArray(allOf)) {
    for (const branch of allOf)
      assertResponseSchema(value, branch, operationId, pointer);
    assertCompositionSiblings(value, schemaValue, operationId, pointer, ["allOf", "discriminator"]);
    return;
  }
  if ("const" in schemaValue && value !== schemaValue["const"]) {
    throw new ApiContractDecodeError(operationId, pointer || "/", "const");
  }
  if (
    Array.isArray(schemaValue["enum"]) &&
    !schemaValue["enum"].includes(value)
  ) {
    throw new ApiContractDecodeError(operationId, pointer || "/", "enum");
  }
  const declaredType = schemaValue["type"];
  if (Array.isArray(declaredType)) {
    const matched = declaredType.some((type) => {
      try {
        assertResponseSchema(
          value,
          { ...schemaValue, type },
          operationId,
          pointer,
        );
        return true;
      } catch {
        return false;
      }
    });
    if (!matched)
      throw new ApiContractDecodeError(operationId, pointer || "/", "type");
    return;
  }
  const type = declaredType;
  if (type === "string" && typeof value !== "string")
    throw new ApiContractDecodeError(operationId, pointer || "/", "string");
  if (
    (type === "number" || type === "integer") &&
    (typeof value !== "number" || !Number.isFinite(value))
  )
    throw new ApiContractDecodeError(operationId, pointer || "/", "number");
  if (type === "boolean" && typeof value !== "boolean")
    throw new ApiContractDecodeError(operationId, pointer || "/", "boolean");
  if (type === "null" && value !== null)
    throw new ApiContractDecodeError(operationId, pointer || "/", "null");
  if (typeof value === "string") {
    assertStringConstraints(value, schemaValue, operationId, pointer);
  }
  if (typeof value === "number") {
    assertNumberConstraints(value, schemaValue, operationId, pointer, type);
  }
  if (type === "array") {
    if (!Array.isArray(value))
      throw new ApiContractDecodeError(operationId, pointer || "/", "array");
    if (schemaValue["items"] === false && value.length !== 0)
      throw new ApiContractDecodeError(
        operationId,
        pointer || "/",
        "empty-array",
      );
    assertCardinality(value, schemaValue, operationId, pointer, "Items");
    if (schemaValue["uniqueItems"] === true) {
      const identities = value.map((item) => JSON.stringify(item));
      if (new Set(identities).size !== identities.length)
        throw new ApiContractDecodeError(
          operationId,
          pointer || "/",
          "uniqueItems",
        );
    }
    if (schemaValue["items"] !== false)
      value.forEach((item, index) =>
        assertResponseSchema(
          item,
          schemaValue["items"],
          operationId,
          `${pointer}/${index}`,
        ),
      );
  }
  if (type === "object" || isRecord(schemaValue["properties"])) {
    if (!isRecord(value))
      throw new ApiContractDecodeError(operationId, pointer || "/", "object");
    const properties = isRecord(schemaValue["properties"])
      ? schemaValue["properties"]
      : {};
    assertCardinality(
      Object.keys(value),
      schemaValue,
      operationId,
      pointer,
      "Properties",
    );
    for (const required of Array.isArray(schemaValue["required"])
      ? schemaValue["required"]
      : []) {
      if (typeof required === "string" && !(required in value))
        throw new ApiContractDecodeError(
          operationId,
          `${pointer}/${required}`,
          "required",
        );
    }
    if (schemaValue["additionalProperties"] === false) {
      for (const name of Object.keys(value))
        if (!(name in properties))
          throw new ApiContractDecodeError(
            operationId,
            `${pointer}/${name}`,
            "additional-property",
          );
    }
    for (const [name, child] of Object.entries(properties)) {
      if (name in value)
        assertResponseSchema(
          value[name],
          child,
          operationId,
          `${pointer}/${name}`,
        );
    }
  }
}

function assertCompositionSiblings(
  value: unknown,
  schema: Record<string, unknown>,
  operationId: OperationId,
  pointer: string,
  omitted: readonly string[],
): void {
  const siblings = { ...schema };
  for (const key of omitted) delete siblings[key];
  if (Object.keys(siblings).length > 0)
    assertResponseSchema(value, siblings, operationId, pointer);
}

/** Test-only conformance hook; not exported from the package public index. */
export function assertConformanceResponseSchema(
  value: unknown,
  schema: unknown,
  operationId: OperationId,
): void {
  assertResponseSchema(value, schema, operationId, "");
}

function decodeProblem(
  value: unknown,
  status: number,
  correlation: string | undefined,
  operationId: OperationId,
): ApiProblem {
  assertResponseSchema(
    value,
    (componentSchemas as Readonly<Record<string, unknown>>)["ApiProblem"],
    operationId,
    "",
  );
  if (!isRecord(value) || value["status"] !== status)
    throw new ApiContractDecodeError(operationId, "/status", "http-status");
  if (value["serverCorrelationId"] !== correlation)
    throw new ApiContractDecodeError(
      operationId,
      "/serverCorrelationId",
      "correlation-header",
    );
  return {
    status: value["status"] as number,
    code: value["code"] as string,
    serverCorrelationId: value["serverCorrelationId"] as string,
    ...(typeof value["type"] === "string" ? { type: value["type"] } : {}),
    ...(typeof value["title"] === "string" ? { title: value["title"] } : {}),
    ...(typeof value["detail"] === "string" ? { detail: value["detail"] } : {}),
    ...(Array.isArray(value["violations"])
      ? {
          violations: value["violations"] as Array<{
            readonly pointer: string;
            readonly code: string;
          }>,
        }
      : {}),
  };
}

function isValidServerCorrelation(value: string | undefined): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

function assertStringConstraints(
  value: string,
  schema: Record<string, unknown>,
  operationId: OperationId,
  pointer: string,
): void {
  if (
    typeof schema["minLength"] === "number" &&
    value.length < schema["minLength"]
  )
    throw new ApiContractDecodeError(operationId, pointer || "/", "minLength");
  if (
    typeof schema["maxLength"] === "number" &&
    value.length > schema["maxLength"]
  )
    throw new ApiContractDecodeError(operationId, pointer || "/", "maxLength");
  if (typeof schema["pattern"] === "string") {
    let expression: RegExp;
    try {
      expression = new RegExp(schema["pattern"]);
    } catch {
      throw new ApiContractDecodeError(
        operationId,
        pointer || "/",
        "invalid-pattern",
      );
    }
    if (!expression.test(value))
      throw new ApiContractDecodeError(operationId, pointer || "/", "pattern");
  }
  if (
    typeof schema["format"] === "string" &&
    !matchesFormat(value, schema["format"])
  )
    throw new ApiContractDecodeError(
      operationId,
      pointer || "/",
      `format:${schema["format"]}`,
    );
}

function assertNumberConstraints(
  value: number,
  schema: Record<string, unknown>,
  operationId: OperationId,
  pointer: string,
  type: unknown,
): void {
  if (type === "integer" && !Number.isInteger(value))
    throw new ApiContractDecodeError(operationId, pointer || "/", "integer");
  const constraints: Array<
    [string, (actual: number, expected: number) => boolean]
  > = [
    ["minimum", (actual, expected) => actual >= expected],
    ["maximum", (actual, expected) => actual <= expected],
    ["exclusiveMinimum", (actual, expected) => actual > expected],
    ["exclusiveMaximum", (actual, expected) => actual < expected],
  ];
  for (const [name, accepts] of constraints) {
    const expected = schema[name];
    if (typeof expected === "number" && !accepts(value, expected))
      throw new ApiContractDecodeError(operationId, pointer || "/", name);
  }
  if (
    typeof schema["multipleOf"] === "number" &&
    Math.abs(
      value / schema["multipleOf"] - Math.round(value / schema["multipleOf"]),
    ) > Number.EPSILON
  )
    throw new ApiContractDecodeError(operationId, pointer || "/", "multipleOf");
}

function assertCardinality(
  value: readonly unknown[],
  schema: Record<string, unknown>,
  operationId: OperationId,
  pointer: string,
  suffix: "Items" | "Properties",
): void {
  const minimum = schema[`min${suffix}`];
  const maximum = schema[`max${suffix}`];
  if (typeof minimum === "number" && value.length < minimum)
    throw new ApiContractDecodeError(
      operationId,
      pointer || "/",
      `min${suffix}`,
    );
  if (typeof maximum === "number" && value.length > maximum)
    throw new ApiContractDecodeError(
      operationId,
      pointer || "/",
      `max${suffix}`,
    );
}

function matchesFormat(value: string, format: string): boolean {
  if (format === "date-time")
    return (
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) && Number.isFinite(Date.parse(value))
    );
  if (format === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (format === "uuid")
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  if (format === "uri") {
    try {
      const parsed = new URL(value);
      return Boolean(parsed.protocol && parsed.hostname);
    } catch {
      return false;
    }
  }
  if (format === "uri-reference") {
    if (/[\u0000-\u0020]/.test(value)) return false;
    try {
      void new URL(value, "https://contract.invalid/");
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function wrapSensitive(
  value: unknown,
  descriptors: readonly {
    readonly pointer: string;
    readonly classification: string;
  }[],
): unknown {
  if (!isRecord(value) || descriptors.length === 0) return value;
  const copy = structuredClone(value);
  for (const descriptor of descriptors) {
    const parts = descriptor.pointer.split("/").filter(Boolean);
    wrapAt(copy, parts, descriptor.classification);
  }
  return copy;
}

function wrapAt(value: unknown, parts: string[], classification: string): void {
  if (parts.length === 0) return;
  const head = parts[0];
  if (head === undefined) return;
  const tail = parts.slice(1);
  if (head === "*") {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (tail.length === 0 && typeof value[index] === "string") {
          value[index] = Secret.fromResponse<typeof classification>(
            value[index],
          );
        } else {
          wrapAt(value[index], tail, classification);
        }
      }
    }
    return;
  }
  if (!isRecord(value) || !(head in value)) return;
  if (tail.length === 0 && typeof value[head] === "string") {
    value[head] = Secret.fromResponse<typeof classification>(value[head]);
  } else {
    wrapAt(value[head], tail, classification);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
