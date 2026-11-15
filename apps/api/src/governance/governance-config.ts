import { SymmetricKeyEntry, SymmetricKeyRing } from "../auth/identity-config";

export const GOVERNANCE_CONFIG = Symbol("GOVERNANCE_CONFIG");

export interface BootstrapEvidenceDescriptor {
  [key: string]: string | number;
  decisionId: string;
  revision: number;
}

export interface GovernanceConfig {
  enabled: boolean;
  environment: "development" | "production" | "test";
  actionIntentTtlSeconds: number;
  actionIntentKeys?: SymmetricKeyRing;
  idempotencyKeys?: SymmetricKeyRing;
  bootstrapEvidenceVerified: boolean;
  controlPlaneReviewQuorum?: number;
  bootstrapEvidenceDescriptors?: BootstrapEvidenceDescriptor[];
}

function bool(name: string, fallback = false): boolean {
  const raw = (process.env[name] ?? String(fallback)).trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function environment(): GovernanceConfig["environment"] {
  const raw = (
    process.env.APP_ENV ??
    process.env.NODE_ENV ??
    "development"
  ).trim();
  if (raw === "development" || raw === "production" || raw === "test")
    return raw;
  throw new Error("APP_ENV must be development, production or test.");
}

function parseSigningRing(name: string): SymmetricKeyRing {
  const raw = process.env[name];
  if (!raw)
    throw new Error(
      `${name} is required when ADMIN_APPROVAL_PLATFORM_ENABLED=true.`,
    );
  let parsed: {
    currentKeyId?: string;
    keys?: Array<{ id?: string; state?: string; keyBase64?: string }>;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
  if (!parsed.currentKeyId || !Array.isArray(parsed.keys))
    throw new Error(`${name} has an invalid key-ring shape.`);
  const keys = new Map<string, SymmetricKeyEntry>();
  for (const item of parsed.keys) {
    if (!item.id || !item.keyBase64 || !item.state || keys.has(item.id))
      throw new Error(`${name} contains an invalid key entry.`);
    if (!["sign+verify", "verify-only", "revoked"].includes(item.state))
      throw new Error(`${name} contains an invalid key state.`);
    const key = Buffer.from(item.keyBase64, "base64");
    if (key.length !== 32 || key.toString("base64") !== item.keyBase64)
      throw new Error(`${name} keys must be canonical 32-byte base64 values.`);
    keys.set(item.id, {
      id: item.id,
      state: item.state as SymmetricKeyEntry["state"],
      key,
    });
  }
  const current = keys.get(parsed.currentKeyId);
  if (!current || current.state !== "sign+verify")
    throw new Error(`${name} current key must be sign+verify.`);
  return { currentKeyId: parsed.currentKeyId, keys };
}

export function readGovernanceConfig(): GovernanceConfig {
  const env = environment();
  const enabled = bool("ADMIN_APPROVAL_PLATFORM_ENABLED");
  if (!enabled)
    return {
      enabled: false,
      environment: env,
      actionIntentTtlSeconds: 120,
      bootstrapEvidenceVerified: false,
    };
  const ttl = Number(process.env.ADMIN_ACTION_INTENT_TTL_SECONDS ?? 120);
  if (!Number.isInteger(ttl) || ttl < 30 || ttl > 300)
    throw new Error(
      "ADMIN_ACTION_INTENT_TTL_SECONDS must be between 30 and 300.",
    );
  const actionIntentKeys = parseSigningRing(
    "ADMIN_ACTION_INTENT_KEY_RING_JSON",
  );
  const idempotencyKeys = parseSigningRing(
    "ADMIN_GOVERNANCE_IDEMPOTENCY_KEY_RING_JSON",
  );
  for (const actionEntry of actionIntentKeys.keys.values()) {
    for (const idempotencyEntry of idempotencyKeys.keys.values()) {
      if (actionEntry.key.equals(idempotencyEntry.key))
        throw new Error(
          "Governance key material must not be reused across purposes.",
        );
    }
  }
  const requestedBootstrap = bool("ADMIN_APPROVAL_BOOTSTRAP_EVIDENCE_VERIFIED");
  // A runtime environment variable is not D-05 evidence. Only tests may inject
  // verified evidence until the evidence verifier increment is implemented.
  if (env === "production" && requestedBootstrap)
    throw new Error(
      "Production approval bootstrap verification is not implemented.",
    );
  if (env === "production")
    throw new Error("Production approval platform remains DENIED.");
  return {
    enabled: true,
    environment: env,
    actionIntentTtlSeconds: ttl,
    actionIntentKeys,
    idempotencyKeys,
    bootstrapEvidenceVerified: false,
  };
}
