import assert from "node:assert/strict";
import test from "node:test";

import { readRuntimeConfig } from "./runtime-config";

const CONFIG_KEYS = [
  "APP_ENV",
  "NODE_ENV",
  "PORT",
  "CORS_ORIGINS",
  "JWT_SECRET",
  "DATABASE_URL",
  "MINIO_ENDPOINT",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "PHOTO_BASE_URL",
  "TRUST_PROXY_HOPS",
  "CHECKOUT_ENABLED",
  "BOG_PAYMENTS_ENABLED",
  "BOG_HOSTED_PAYMENTS_ENABLED",
  "GOOGLE_PAY_EXTERNAL_ENABLED",
  "APPLE_PAY_EXTERNAL_ENABLED",
  "GOOGLE_PAY_MERCHANT_ID",
  "GOOGLE_PAY_MERCHANT_NAME",
  "GOOGLE_PAY_ENVIRONMENT",
  "CUSTOMER_MASTER_FOUNDATION_ENABLED",
  "CUSTOMER_DATA_VAULT_FOUNDATION_ENABLED",
  "FITMENT_MOCK",
  "WHEEL_SIZE_API_KEY",
  "ADMIN_IDENTITY_ENABLED",
  "ADMIN_PUBLIC_ORIGIN",
  "ADMIN_IDENTITY_SAME_ORIGIN_PROXY_VERIFIED",
  "ADMIN_IDENTITY_P2_EVIDENCE_COMPLETE",
  "ADMIN_IDENTITY_CANONICAL_BACKFILL_REVIEWED",
  "ADMIN_IDENTITY_KEY_WORKFLOWS_REVIEWED",
  "ADMIN_IDENTITY_OPERATOR_MODE",
  "IDENTITY_DELIVERY_ADAPTER",
  "ADMIN_JWT_ISSUER",
  "ADMIN_JWT_AUDIENCE",
  "ADMIN_JWT_KEY_RING_JSON",
  "ADMIN_TOKEN_DIGEST_KEY_RING_JSON",
  "ADMIN_CSRF_KEY_RING_JSON",
  "ADMIN_ENVELOPE_KEY_RING_JSON",
  "ADMIN_TOTP_KEY_RING_JSON",
  "ADMIN_PRIVILEGED_ROLE_KEYS",
  "ADMIN_PRIVILEGED_ROLE_POLICY_REVIEWED",
  "ADMIN_PRIVILEGED_ROLE_POLICY_REVIEW_ID",
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
] as const;

function withEnvironment(
  values: Partial<Record<(typeof CONFIG_KEYS)[number], string>>,
  run: () => void,
): void {
  const previous = new Map(CONFIG_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of CONFIG_KEYS) delete process.env[key];
    Object.assign(process.env, values);
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("development uses only the two local application origins by default", () => {
  withEnvironment(
    { APP_ENV: "development", JWT_SECRET: "development-only" },
    () => {
      assert.deepEqual(readRuntimeConfig(), {
        appEnvironment: "development",
        port: 3000,
        corsOrigins: ["http://localhost:4200", "http://localhost:4300"],
        trustProxyHops: 0,
        checkoutEnabled: false,
        bogPaymentsEnabled: false,
        bogHostedPaymentsEnabled: false,
        googlePayExternalEnabled: false,
        applePayExternalEnabled: false,
        googlePayEnvironment: "TEST",
        customerMasterFoundationEnabled: false,
        customerDataVaultFoundationEnabled: false,
        fitmentMock: false,
        identity: {
          enabled: false,
          environment: "development",
          allowedOrigins: ["http://localhost:4200", "http://localhost:4300"],
          accessTokenTtlSeconds: 600,
          clockToleranceSeconds: 30,
          refreshIdleSeconds: 604800,
          refreshAbsoluteSeconds: 2592000,
          refreshReceiptSeconds: 10,
          deliveryAdapter: "disabled",
          privilegedRoleKeys: [],
          privilegedRolePolicyReviewed: false,
          canonicalBackfillReviewed: false,
          keyCompromiseWorkflowsReviewed: false,
          operatorMode: false,
        },
        auditReader: {
          requested: false,
          enabled: false,
          disabledReasons: ["FLAG_FALSE"],
        },
      });
    },
  );
});

test("payment features remain disabled by default and cannot be enabled inconsistently", () => {
  withEnvironment(
    {
      APP_ENV: "development",
      JWT_SECRET: "development-only",
      BOG_PAYMENTS_ENABLED: "true",
    },
    () => assert.throws(readRuntimeConfig, /requires CHECKOUT_ENABLED/),
  );
  withEnvironment(
    {
      APP_ENV: "development",
      JWT_SECRET: "development-only",
      CHECKOUT_ENABLED: "true",
      GOOGLE_PAY_EXTERNAL_ENABLED: "true",
    },
    () =>
      assert.throws(
        readRuntimeConfig,
        /External wallets require BOG_PAYMENTS_ENABLED/,
      ),
  );
  withEnvironment(
    {
      APP_ENV: "development",
      JWT_SECRET: "development-only",
      CHECKOUT_ENABLED: "true",
      BOG_PAYMENTS_ENABLED: "true",
      BOG_HOSTED_PAYMENTS_ENABLED: "false",
      APPLE_PAY_EXTERNAL_ENABLED: "true",
    },
    () => assert.throws(readRuntimeConfig, /hosted.*fallback/i),
  );
});

test("wallet feature flags are independent and hosted defaults on with BOG", () => {
  withEnvironment(
    {
      APP_ENV: "development",
      JWT_SECRET: "development-only",
      CHECKOUT_ENABLED: "true",
      BOG_PAYMENTS_ENABLED: "true",
      GOOGLE_PAY_EXTERNAL_ENABLED: "true",
      GOOGLE_PAY_MERCHANT_ID: "merchant-id",
      GOOGLE_PAY_MERCHANT_NAME: "tyre.ge",
    },
    () => {
      const config = readRuntimeConfig();
      assert.equal(config.bogHostedPaymentsEnabled, true);
      assert.equal(config.googlePayExternalEnabled, true);
      assert.equal(config.applePayExternalEnabled, false);
      assert.equal(config.googlePayEnvironment, "TEST");
    },
  );
});

test("production Google Pay fails closed for test mode or an invalid merchant ID", () => {
  const base = {
    APP_ENV: "production",
    JWT_SECRET: "a-production-secret-that-is-longer-than-32-characters",
    DATABASE_URL: "postgresql://tyre_api_runtime:runtime-secret@database/tyre",
    CORS_ORIGINS: "https://tyre.ge,https://admin.tyre.ge",
    MINIO_ENDPOINT: "minio",
    MINIO_ACCESS_KEY: "access",
    MINIO_SECRET_KEY: "secret",
    PHOTO_BASE_URL: "https://media.tyre.ge/tyre-photos",
    WHEEL_SIZE_API_KEY: "a-real-key",
    CHECKOUT_ENABLED: "true",
    BOG_PAYMENTS_ENABLED: "true",
    GOOGLE_PAY_EXTERNAL_ENABLED: "true",
    GOOGLE_PAY_MERCHANT_NAME: "tyre.ge",
  };

  withEnvironment(
    {
      ...base,
      GOOGLE_PAY_ENVIRONMENT: "TEST",
      GOOGLE_PAY_MERCHANT_ID: "BCR2DN4TXKPITITV",
    },
    () => assert.throws(readRuntimeConfig, /cannot enable.*TEST/i),
  );
  withEnvironment(
    {
      ...base,
      GOOGLE_PAY_ENVIRONMENT: "PRODUCTION",
      GOOGLE_PAY_MERCHANT_ID: "placeholder",
    },
    () => assert.throws(readRuntimeConfig, /Google-issued merchant ID/),
  );
  withEnvironment(
    {
      ...base,
      GOOGLE_PAY_ENVIRONMENT: "PRODUCTION",
      GOOGLE_PAY_MERCHANT_ID: "BCR2DN4TXKPITITV",
    },
    () => assert.throws(readRuntimeConfig, /do not use BOG's gatewayMerchantId/),
  );
});

test("customer master foundation defaults off and is unconditionally hard-denied in production", () => {
  withEnvironment({ APP_ENV: "test", JWT_SECRET: "test-only" }, () =>
    assert.equal(readRuntimeConfig().customerMasterFoundationEnabled, false),
  );
  withEnvironment(
    {
      APP_ENV: "production",
      CUSTOMER_MASTER_FOUNDATION_ENABLED: "true",
      JWT_SECRET: "a-production-secret-that-is-longer-than-32-characters",
      DATABASE_URL:
        "postgresql://tyre_api_runtime:runtime-secret@database/tyre",
      CORS_ORIGINS: "https://tyre.ge,https://admin.tyre.ge",
      MINIO_ENDPOINT: "minio",
      MINIO_ACCESS_KEY: "access",
      MINIO_SECRET_KEY: "secret",
      PHOTO_BASE_URL: "https://media.tyre.ge/tyre-photos",
      WHEEL_SIZE_API_KEY: "a-real-key",
    },
    () => assert.throws(readRuntimeConfig, /hard-denied in production/),
  );
});

test("customer data vault foundation is hard-off and production true fails startup", () => {
  withEnvironment({ APP_ENV: "test", JWT_SECRET: "test-only" }, () =>
    assert.equal(readRuntimeConfig().customerDataVaultFoundationEnabled, false),
  );
  withEnvironment(
    {
      APP_ENV: "development",
      JWT_SECRET: "development-only",
      CUSTOMER_DATA_VAULT_FOUNDATION_ENABLED: "true",
    },
    () => assert.throws(readRuntimeConfig, /must remain false/),
  );
  withEnvironment(
    {
      APP_ENV: "production",
      CUSTOMER_DATA_VAULT_FOUNDATION_ENABLED: "true",
      JWT_SECRET: "a-production-secret-that-is-longer-than-32-characters",
      DATABASE_URL:
        "postgresql://tyre_api_runtime:runtime-secret@database/tyre",
      CORS_ORIGINS: "https://tyre.ge,https://admin.tyre.ge",
      MINIO_ENDPOINT: "minio",
      MINIO_ACCESS_KEY: "access",
      MINIO_SECRET_KEY: "secret",
      PHOTO_BASE_URL: "https://media.tyre.ge/tyre-photos",
      WHEEL_SIZE_API_KEY: "a-real-key",
    },
    () => assert.throws(readRuntimeConfig, /hard-denied in production/),
  );
});

test("production fails fast for a weak JWT secret", () => {
  withEnvironment(
    {
      APP_ENV: "production",
      JWT_SECRET: "short",
      CORS_ORIGINS: "https://tyre.ge,https://admin.tyre.ge",
    },
    () => assert.throws(readRuntimeConfig, /at least 32 characters/),
  );
});

test("production rejects wildcard and insecure browser origins", () => {
  const base = {
    APP_ENV: "production",
    JWT_SECRET: "a-production-secret-that-is-longer-than-32-characters",
    DATABASE_URL: "postgresql://tyre_api_runtime:runtime-secret@database/tyre",
    MINIO_ENDPOINT: "minio",
    MINIO_ACCESS_KEY: "access",
    MINIO_SECRET_KEY: "secret",
    PHOTO_BASE_URL: "https://media.tyre.ge/tyre-photos",
  };

  withEnvironment({ ...base, CORS_ORIGINS: "*" }, () => {
    assert.throws(readRuntimeConfig, /cannot contain/);
  });
  withEnvironment({ ...base, CORS_ORIGINS: "http://tyre.ge" }, () => {
    assert.throws(readRuntimeConfig, /must use HTTPS/);
  });
});

test("valid production configuration preserves the agreed exact origins", () => {
  withEnvironment(
    {
      APP_ENV: "production",
      PORT: "3000",
      JWT_SECRET: "a-production-secret-that-is-longer-than-32-characters",
      DATABASE_URL:
        "postgresql://tyre_api_runtime:runtime-secret@database/tyre",
      CORS_ORIGINS: "https://tyre.ge,https://admin.tyre.ge",
      MINIO_ENDPOINT: "minio",
      MINIO_ACCESS_KEY: "access",
      MINIO_SECRET_KEY: "secret",
      PHOTO_BASE_URL: "https://media.tyre.ge/tyre-photos",
      WHEEL_SIZE_API_KEY: "a-real-key",
    },
    () => {
      assert.deepEqual(readRuntimeConfig().corsOrigins, [
        "https://tyre.ge",
        "https://admin.tyre.ge",
      ]);
      assert.equal(readRuntimeConfig().trustProxyHops, 1);
      assert.equal(readRuntimeConfig().fitmentMock, false);
    },
  );
});

test("production rejects bootstrap or otherwise unexpected database LOGINs", () => {
  const base = {
    APP_ENV: "production",
    JWT_SECRET: "a-production-secret-that-is-longer-than-32-characters",
    CORS_ORIGINS: "https://tyre.ge,https://admin.tyre.ge",
    MINIO_ENDPOINT: "minio",
    MINIO_ACCESS_KEY: "access",
    MINIO_SECRET_KEY: "secret",
    PHOTO_BASE_URL: "https://media.tyre.ge/tyre-photos",
    WHEEL_SIZE_API_KEY: "a-real-key",
  };
  withEnvironment(
    { ...base, DATABASE_URL: "postgresql://tyre:secret@database/tyre" },
    () => {
      assert.throws(
        readRuntimeConfig,
        /least-privilege tyre_api_runtime LOGIN/,
      );
    },
  );
});

test("production requires a real Wheel-Size key and forbids fitment mock mode", () => {
  const base = {
    APP_ENV: "production",
    JWT_SECRET: "a-production-secret-that-is-longer-than-32-characters",
    DATABASE_URL: "postgresql://tyre_api_runtime:runtime-secret@database/tyre",
    CORS_ORIGINS: "https://tyre.ge,https://admin.tyre.ge",
    MINIO_ENDPOINT: "minio",
    MINIO_ACCESS_KEY: "access",
    MINIO_SECRET_KEY: "secret",
    PHOTO_BASE_URL: "https://media.tyre.ge/tyre-photos",
  };

  withEnvironment({ ...base }, () => {
    assert.throws(readRuntimeConfig, /WHEEL_SIZE_API_KEY is required/);
  });
  withEnvironment(
    { ...base, WHEEL_SIZE_API_KEY: "a-real-key", FITMENT_MOCK: "true" },
    () => {
      assert.throws(
        readRuntimeConfig,
        /FITMENT_MOCK must be false in production/,
      );
    },
  );
});

test("proxy trust is explicit and bounded", () => {
  withEnvironment(
    {
      APP_ENV: "development",
      JWT_SECRET: "development-only",
      TRUST_PROXY_HOPS: "3",
    },
    () => assert.throws(readRuntimeConfig, /between 0 and 2/),
  );
  withEnvironment(
    {
      APP_ENV: "development",
      JWT_SECRET: "development-only",
      TRUST_PROXY_HOPS: "1",
    },
    () => assert.equal(readRuntimeConfig().trustProxyHops, 1),
  );
});

test("identity v2 is disabled by default and cannot enable without its exact origin", () => {
  withEnvironment(
    {
      APP_ENV: "development",
      JWT_SECRET: "development-only",
      ADMIN_IDENTITY_ENABLED: "true",
    },
    () => assert.throws(readRuntimeConfig, /ADMIN_PUBLIC_ORIGIN is required/),
  );
  withEnvironment(
    {
      APP_ENV: "development",
      JWT_SECRET: "development-only",
      ADMIN_IDENTITY_ENABLED: "true",
      ADMIN_PUBLIC_ORIGIN: "http://evil.example",
    },
    () => assert.throws(readRuntimeConfig, /only on localhost/),
  );
  withEnvironment(
    {
      APP_ENV: "development",
      JWT_SECRET: "development-only",
      ADMIN_IDENTITY_ENABLED: "true",
      ADMIN_PUBLIC_ORIGIN: "http://localhost:4300",
      CORS_ORIGINS: "http://localhost:4300",
      ADMIN_PRIVILEGED_ROLE_KEYS: "admin",
    },
    () => assert.throws(readRuntimeConfig, /ADMIN_JWT_ISSUER/),
  );
});
