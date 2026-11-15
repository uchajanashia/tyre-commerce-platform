import { IdentityConfig, readIdentityConfig } from "../auth/identity-config";
import { AuditReaderConfig, readAuditReaderConfig } from "../audit/audit-reader.config";
import { readBogPaymentFeatureConfig } from "../checkout/bog-payment.config";

export type AppEnvironment = "development" | "production" | "test";

export interface RuntimeConfig {
  appEnvironment: AppEnvironment;
  port: number;
  corsOrigins: string[];
  trustProxyHops: number;
  checkoutEnabled: boolean;
  bogPaymentsEnabled: boolean;
  bogHostedPaymentsEnabled: boolean;
  googlePayExternalEnabled: boolean;
  applePayExternalEnabled: boolean;
  googlePayEnvironment: "TEST" | "PRODUCTION";
  customerMasterFoundationEnabled: boolean;
  customerDataVaultFoundationEnabled: false;
  fitmentMock: boolean;
  identity: IdentityConfig;
  auditReader: AuditReaderConfig;
}

const DEV_CORS_ORIGINS = ["http://localhost:4200", "http://localhost:4300"];

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function parseEnvironment(): AppEnvironment {
  const value = (
    process.env.APP_ENV ??
    process.env.NODE_ENV ??
    "development"
  ).trim();
  if (value === "development" || value === "production" || value === "test") {
    return value;
  }
  throw new Error("APP_ENV must be development, production or test.");
}

function parsePort(): number {
  const value = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return value;
}

function parseTrustProxyHops(environment: AppEnvironment): number {
  const value = Number(
    process.env.TRUST_PROXY_HOPS ?? (environment === "production" ? 1 : 0),
  );
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new Error("TRUST_PROXY_HOPS must be an integer between 0 and 2.");
  }
  return value;
}

function parseBoolean(name: string, fallback = false): boolean {
  const value = (process.env[name] ?? String(fallback)).trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function parseCorsOrigins(environment: AppEnvironment): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw && environment === "production") {
    throw new Error("CORS_ORIGINS is required in production.");
  }

  const origins = (raw ? raw.split(",") : DEV_CORS_ORIGINS)
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0 || origins.includes("*")) {
    throw new Error(
      'CORS_ORIGINS must contain explicit origins and cannot contain "*".',
    );
  }

  return origins.map((origin) => {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
    if (url.origin !== origin || url.username || url.password) {
      throw new Error(
        `CORS origin must be an origin without path or credentials: ${origin}`,
      );
    }
    if (environment === "production" && url.protocol !== "https:") {
      throw new Error(`Production CORS origin must use HTTPS: ${origin}`);
    }
    return url.origin;
  });
}

function validateProductionSecrets(environment: AppEnvironment, identityEnabled: boolean): void {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!identityEnabled && !jwtSecret) {
    throw new Error("JWT_SECRET is required while legacy authentication is enabled.");
  }
  if (environment !== "production") {
    return;
  }

  if (jwtSecret && (
    jwtSecret.length < 32 ||
    jwtSecret === "change-me-to-a-long-random-string"
  )) {
    throw new Error(
      "JWT_SECRET must be a non-default secret of at least 32 characters.",
    );
  }

  const databaseUrl = required("DATABASE_URL");
  let database: URL;
  try {
    database = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (database.protocol !== "postgresql:" && database.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must be a PostgreSQL URL.");
  }
  if (decodeURIComponent(database.username) !== "tyre_api_runtime") {
    throw new Error(
      "Production DATABASE_URL must authenticate as the least-privilege tyre_api_runtime LOGIN.",
    );
  }
  required("MINIO_ENDPOINT");
  required("MINIO_ACCESS_KEY");
  required("MINIO_SECRET_KEY");
  const photoBaseUrl = required("PHOTO_BASE_URL");
  if (!photoBaseUrl.startsWith("https://")) {
    throw new Error("PHOTO_BASE_URL must use HTTPS in production.");
  }
}

function parseFitmentMock(environment: AppEnvironment): boolean {
  const fitmentMock = parseBoolean("FITMENT_MOCK");
  if (environment === "production") {
    if (fitmentMock) {
      throw new Error("FITMENT_MOCK must be false in production.");
    }
    required("WHEEL_SIZE_API_KEY");
    return false;
  }
  return fitmentMock;
}

function parseCustomerMasterFoundationEnabled(
  environment: AppEnvironment,
): boolean {
  const enabled = parseBoolean("CUSTOMER_MASTER_FOUNDATION_ENABLED");
  if (environment === "production" && enabled) {
    throw new Error(
      "CUSTOMER_MASTER_FOUNDATION_ENABLED is hard-denied in production until an implementation contract defines the authorized, evidence-bound release marker.",
    );
  }
  return enabled;
}

function parseCustomerDataVaultFoundationEnabled(
  environment: AppEnvironment,
): false {
  const enabled = parseBoolean("CUSTOMER_DATA_VAULT_FOUNDATION_ENABLED");
  if (enabled) {
    throw new Error(
      environment === "production"
        ? "CUSTOMER_DATA_VAULT_FOUNDATION_ENABLED is hard-denied in production."
        : "CUSTOMER_DATA_VAULT_FOUNDATION_ENABLED must remain false.",
    );
  }
  return false;
}

export function readRuntimeConfig(): RuntimeConfig {
  const appEnvironment = parseEnvironment();
  const corsOrigins = parseCorsOrigins(appEnvironment);
  const identity = readIdentityConfig();
  validateProductionSecrets(appEnvironment, identity.enabled);
  const checkoutEnabled = parseBoolean("CHECKOUT_ENABLED");
  const paymentFeatures = readBogPaymentFeatureConfig();
  const bogPaymentsEnabled = paymentFeatures.enabled;
  if (bogPaymentsEnabled && !checkoutEnabled) {
    throw new Error("BOG_PAYMENTS_ENABLED requires CHECKOUT_ENABLED=true.");
  }
  return {
    appEnvironment,
    port: parsePort(),
    corsOrigins,
    trustProxyHops: parseTrustProxyHops(appEnvironment),
    checkoutEnabled,
    bogPaymentsEnabled,
    bogHostedPaymentsEnabled: paymentFeatures.hostedEnabled,
    googlePayExternalEnabled: paymentFeatures.googlePayExternalEnabled,
    applePayExternalEnabled: paymentFeatures.applePayExternalEnabled,
    googlePayEnvironment: paymentFeatures.googlePayEnvironment,
    customerMasterFoundationEnabled:
      parseCustomerMasterFoundationEnabled(appEnvironment),
    customerDataVaultFoundationEnabled:
      parseCustomerDataVaultFoundationEnabled(appEnvironment),
    fitmentMock: parseFitmentMock(appEnvironment),
    identity,
    auditReader: readAuditReaderConfig(),
  };
}
