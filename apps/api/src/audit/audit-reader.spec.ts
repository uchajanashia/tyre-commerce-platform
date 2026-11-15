import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import {
  assertServerAuditContext,
  serverAuditContextForInternal,
  serverAuditContextFromRequest,
} from "./audit-context";
import { AuditCursorPayload, AuditCursorService } from "./audit-cursor.service";
import {
  AUDIT_EVENT_SCHEMAS,
  assertSafeAuditText,
  projectSafeAuditFields,
  registeredAuditSchema,
} from "./audit-event-registry";
import {
  AuditReaderConfig,
  readAuditReaderConfig,
} from "./audit-reader.config";

const CONFIG_KEYS = [
  "APP_ENV",
  "NODE_ENV",
  "ADMIN_AUDIT_READER_ENABLED",
  "AUDIT_READER_CURSOR_MAX_TTL_SECONDS",
  "AUDIT_READER_MAX_PAGE_SIZE",
  "AUDIT_READER_MAX_TIME_RANGE_SECONDS",
  "AUDIT_READER_MAX_FILTERS",
  "AUDIT_READER_MAX_CURSOR_BYTES",
  "AUDIT_READER_DETAIL_PADDING_MS",
  "AUDIT_READER_QUERY_PLAN_POLICY_ID",
  "AUDIT_READER_POLICY_VERSION",
  "AUDIT_READER_CURSOR_KEY_RING_JSON",
  "AUDIT_READER_DATABASE_URL",
  "AUDIT_READER_DATABASE_ROLE",
  "AUDIT_WRITER_DATABASE_URL",
  "AUDIT_WRITER_DATABASE_ROLE",
  "AUDIT_RUNTIME_CONTEXT_KEY_ID",
  "AUDIT_RUNTIME_CONTEXT_KEY",
  "AUDIT_RUNTIME_CONTEXT_TTL_SECONDS",
  "DATABASE_URL",
] as const;

function withEnvironment(
  values: Record<string, string>,
  run: () => void,
): void {
  const previous = new Map(CONFIG_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of CONFIG_KEYS) delete process.env[key];
    Object.assign(process.env, values);
    run();
  } finally {
    for (const [key, value] of previous)
      value === undefined
        ? delete process.env[key]
        : (process.env[key] = value);
  }
}

function validConfig(
  now = Date.now(),
  keyId = "cursor-current",
): AuditReaderConfig {
  return {
    requested: true,
    enabled: true,
    disabledReasons: [],
    cursorMaxTtlSeconds: 60,
    maxPageSize: 25,
    maxTimeRangeSeconds: 3600,
    maxFilters: 8,
    maxCursorBytes: 4096,
    detailPaddingMs: 1,
    queryPlanPolicyId: "test-plan-v1",
    readerPolicyVersion: 1,
    cursorKeys: [
      {
        id: keyId,
        material: randomBytes(32),
        state: "issuing",
        notBefore: now - 1_000,
        verifyUntil: now + 120_000,
        revoked: false,
      },
    ],
  };
}

function cursorPayload(): Omit<
  AuditCursorPayload,
  "cursorVersion" | "keyId" | "issuedAt" | "expiresAt"
> {
  return {
    viewerId: "viewer-1",
    sessionId: "session-1",
    accountVersion: 1,
    tokenVersion: 1,
    minimumAuthContractVersion: 1,
    securityControlVersion: 1,
    authorizationGraphDigestVersion: 1,
    authorizationGraphDigest: "A".repeat(43),
    readerPolicyVersion: 1,
    normalizedFilterHash: "B".repeat(43),
    sortField: "occurredAt",
    sortDirection: "desc",
    pageSize: 10,
    asOfOccurredAt: "2026-07-30T00:00:00.000Z",
    lastSortValue: "2026-07-29T00:00:00.000Z",
    lastOccurredAt: "2026-07-29T00:00:00.000Z",
    lastEventId: "event-1",
  };
}

test("audit reader stays disabled without owner configuration and is hard-denied in production", () => {
  withEnvironment(
    { ADMIN_AUDIT_READER_ENABLED: "true", APP_ENV: "development" },
    () => {
      const config = readAuditReaderConfig();
      assert.equal(config.enabled, false);
      assert.ok(
        config.disabledReasons.includes(
          "AUDIT_READER_CURSOR_MAX_TTL_SECONDS_REQUIRED",
        ),
      );
    },
  );
  const now = Date.now();
  const key = randomBytes(32).toString("base64url");
  withEnvironment(
    {
      ADMIN_AUDIT_READER_ENABLED: "true",
      APP_ENV: "production",
      AUDIT_READER_CURSOR_MAX_TTL_SECONDS: "60",
      AUDIT_READER_MAX_PAGE_SIZE: "25",
      AUDIT_READER_MAX_TIME_RANGE_SECONDS: "3600",
      AUDIT_READER_MAX_FILTERS: "8",
      AUDIT_READER_MAX_CURSOR_BYTES: "4096",
      AUDIT_READER_DETAIL_PADDING_MS: "5",
      AUDIT_READER_QUERY_PLAN_POLICY_ID: "owner-plan-v1",
      AUDIT_READER_POLICY_VERSION: "1",
      AUDIT_READER_CURSOR_KEY_RING_JSON: JSON.stringify({
        keys: [
          {
            id: "current",
            key,
            state: "issuing",
            notBefore: new Date(now - 1_000).toISOString(),
            verifyUntil: new Date(now + 120_000).toISOString(),
            revoked: false,
          },
        ],
      }),
    },
    () => {
      const config = readAuditReaderConfig();
      assert.equal(config.enabled, false);
      assert.ok(config.disabledReasons.includes("PRODUCTION_HARD_DENY"));
    },
  );
});

test("audit runtime requires distinct dedicated reader/writer URLs, logins and credentials", () => {
  const now = Date.now();
  const cursorKey = randomBytes(32).toString("base64url");
  const contextKey = randomBytes(32).toString("base64url");
  const base = {
    ADMIN_AUDIT_READER_ENABLED: "true",
    APP_ENV: "development",
    DATABASE_URL:
      "postgresql://migration:owner-password@database:5432/tyre?schema=public",
    AUDIT_READER_CURSOR_MAX_TTL_SECONDS: "60",
    AUDIT_READER_MAX_PAGE_SIZE: "25",
    AUDIT_READER_MAX_TIME_RANGE_SECONDS: "3600",
    AUDIT_READER_MAX_FILTERS: "8",
    AUDIT_READER_MAX_CURSOR_BYTES: "4096",
    AUDIT_READER_DETAIL_PADDING_MS: "5",
    AUDIT_READER_QUERY_PLAN_POLICY_ID: "owner-plan-v1",
    AUDIT_READER_POLICY_VERSION: "1",
    AUDIT_READER_CURSOR_KEY_RING_JSON: JSON.stringify({
      keys: [
        {
          id: "current",
          key: cursorKey,
          state: "issuing",
          notBefore: new Date(now - 1_000).toISOString(),
          verifyUntil: new Date(now + 120_000).toISOString(),
          revoked: false,
        },
      ],
    }),
    AUDIT_READER_DATABASE_URL:
      "postgresql://audit_reader_login:reader-password@database:5432/tyre?schema=public",
    AUDIT_READER_DATABASE_ROLE: "audit_reader_login",
    AUDIT_WRITER_DATABASE_URL:
      "postgresql://audit_writer_login:writer-password@database:5432/tyre?schema=public",
    AUDIT_WRITER_DATABASE_ROLE: "audit_writer_login",
    AUDIT_RUNTIME_CONTEXT_KEY_ID: "runtime-current",
    AUDIT_RUNTIME_CONTEXT_KEY: contextKey,
    AUDIT_RUNTIME_CONTEXT_TTL_SECONDS: "10",
  };
  withEnvironment(base, () =>
    assert.equal(readAuditReaderConfig().enabled, true),
  );
  withEnvironment(
    {
      ...base,
      AUDIT_WRITER_DATABASE_URL: base.AUDIT_READER_DATABASE_URL,
      AUDIT_WRITER_DATABASE_ROLE: base.AUDIT_READER_DATABASE_ROLE,
    },
    () => {
      const result = readAuditReaderConfig();
      assert.equal(result.enabled, false);
      assert.ok(result.disabledReasons.includes("AUDIT_DATABASE_ROLE_INVALID"));
    },
  );
  withEnvironment(
    {
      ...base,
      AUDIT_WRITER_DATABASE_URL:
        "postgresql://audit_writer_login:reader-password@database:5432/tyre?schema=public",
    },
    () => {
      assert.equal(readAuditReaderConfig().enabled, false);
    },
  );
  withEnvironment(
    {
      ...base,
      AUDIT_WRITER_DATABASE_URL:
        "postgresql://audit_writer_login:writer-password@other-database:5432/tyre?schema=public",
    },
    () => {
      assert.equal(readAuditReaderConfig().enabled, false);
    },
  );
  withEnvironment(
    {
      ...base,
      AUDIT_READER_DATABASE_URL:
        "postgresql://migration:reader-password@database:5432/tyre?schema=public",
      AUDIT_READER_DATABASE_ROLE: "migration",
    },
    () => {
      assert.equal(readAuditReaderConfig().enabled, false);
    },
  );
});

test("ac1 is canonical, authenticated, bounded and obeys rotation/revocation", () => {
  const now = new Date();
  const oldConfig = validConfig(now.getTime(), "old");
  const old = new AuditCursorService(oldConfig);
  const token = old.issue(cursorPayload(), now);
  assert.deepEqual(
    old.decrypt(token, new Date(now.getTime() + 1_000)).viewerId,
    "viewer-1",
  );
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => old.decrypt(tampered, now), /INVALID_AUDIT_CURSOR/);

  const rotated = validConfig(now.getTime(), "new");
  rotated.cursorKeys!.push({
    ...oldConfig.cursorKeys![0],
    state: "retiring",
    retiringSince: now.getTime(),
    verifyUntil: now.getTime() + 60_000,
  });
  const rotatingReader = new AuditCursorService(rotated);
  assert.equal(
    rotatingReader.decrypt(token, new Date(now.getTime() + 1_000)).keyId,
    "old",
  );
  rotated.cursorKeys![1].revoked = true;
  assert.throws(
    () => rotatingReader.decrypt(token, now),
    /INVALID_AUDIT_CURSOR/,
  );
  assert.throws(
    () => old.decrypt("x".repeat(5000), now),
    /INVALID_AUDIT_CURSOR/,
  );
  assert.throws(() =>
    old.issue({ ...cursorPayload(), asOfOccurredAt: "not-a-time" }, now),
  );
  assert.throws(() =>
    old.issue(
      { ...cursorPayload(), lastOccurredAt: "2026-07-31T00:00:00.000Z" },
      now,
    ),
  );
  assert.throws(() =>
    old.issue(
      { ...cursorPayload(), lastSortValue: "2026-07-29T00:00:00Z" },
      now,
    ),
  );
  assert.throws(() =>
    old.issue({ ...cursorPayload(), authorizationGraphDigest: "short" }, now),
  );
  assert.throws(() =>
    old.issue(
      { ...cursorPayload(), sortField: "outcome", lastSortValue: "unknown" },
      now,
    ),
  );
});

test("V2 registry rejects secrets, unsafe controls/bidi and untrusted correlation contexts", () => {
  const schema = registeredAuditSchema("audit.reader.cursor_rejected", 1);
  assert.equal(schema, AUDIT_EVENT_SCHEMAS[0]);
  assert.throws(
    () => assertSafeAuditText("line\nbreak", 100, "text"),
    /AUDIT_UNSAFE_TEXT/,
  );
  assert.throws(
    () => assertSafeAuditText("spoof\u202Etxt", 100, "text"),
    /AUDIT_UNSAFE_TEXT/,
  );
  assert.throws(
    () =>
      projectSafeAuditFields(schema, "metadata", {
        accessToken: "raw",
      } as never),
    /NOT_REGISTERED/,
  );
  assert.throws(
    () =>
      projectSafeAuditFields(schema, "metadata", {
        code: { raw: true },
      } as never),
    /TYPE_MISMATCH/,
  );
  assert.deepEqual(
    projectSafeAuditFields(schema, "metadata", {
      code: "INVALID",
      keyId: "secret-key-id",
    }),
    [
      {
        key: "code",
        label: "Validation code",
        classification: "public_operational",
        value: "INVALID",
      },
      {
        key: "keyId",
        label: "Cursor key",
        classification: "masked",
        value: "[masked]",
      },
    ],
  );
  assert.throws(
    () => assertServerAuditContext({ serverCorrelationId: "client" } as never),
    /NOT_SERVER_OWNED/,
  );
  assert.doesNotThrow(() =>
    assertServerAuditContext(serverAuditContextForInternal()),
  );
  assert.equal(
    serverAuditContextFromRequest({ headers: { "x-request-id": "bad\nvalue" } })
      .clientRequestId,
    undefined,
  );
});
