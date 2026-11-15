export interface BogPaymentFeatureConfig {
  enabled: boolean;
  hostedEnabled: boolean;
  googlePayExternalEnabled: boolean;
  applePayExternalEnabled: boolean;
  googlePayMerchantId?: string;
  googlePayMerchantName?: string;
  googlePayEnvironment: "TEST" | "PRODUCTION";
}

const BOG_GOOGLE_PAY_GATEWAY_MERCHANT_ID = "BCR2DN4TXKPITITV";

function flag(name: string, fallback = false): boolean {
  const value = (process.env[name] ?? String(fallback)).trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

/**
 * Wallets are independently gated, while hosted BOG remains the mandatory
 * fallback. Merchant/domain approval is an operational gate, not something the
 * application can infer.
 */
export function readBogPaymentFeatureConfig(): BogPaymentFeatureConfig {
  const enabled = flag("BOG_PAYMENTS_ENABLED");
  const hostedEnabled = flag("BOG_HOSTED_PAYMENTS_ENABLED", enabled);
  const googlePayExternalEnabled = flag("GOOGLE_PAY_EXTERNAL_ENABLED");
  const applePayExternalEnabled = flag("APPLE_PAY_EXTERNAL_ENABLED");
  const googlePayEnvironment = (process.env.GOOGLE_PAY_ENVIRONMENT ?? "TEST")
    .trim()
    .toUpperCase();
  if (
    googlePayEnvironment !== "TEST" &&
    googlePayEnvironment !== "PRODUCTION"
  ) {
    throw new Error("GOOGLE_PAY_ENVIRONMENT must be TEST or PRODUCTION.");
  }
  const googlePayMerchantId = process.env.GOOGLE_PAY_MERCHANT_ID?.trim();
  const googlePayMerchantName = process.env.GOOGLE_PAY_MERCHANT_NAME?.trim();

  if (hostedEnabled && !enabled) {
    throw new Error(
      "BOG_HOSTED_PAYMENTS_ENABLED requires BOG_PAYMENTS_ENABLED=true.",
    );
  }
  if ((googlePayExternalEnabled || applePayExternalEnabled) && !enabled) {
    throw new Error("External wallets require BOG_PAYMENTS_ENABLED=true.");
  }
  if ((googlePayExternalEnabled || applePayExternalEnabled) && !hostedEnabled) {
    throw new Error(
      "External wallets require BOG_HOSTED_PAYMENTS_ENABLED=true as fallback.",
    );
  }
  if (
    googlePayExternalEnabled &&
    (!googlePayMerchantId || !googlePayMerchantName)
  ) {
    throw new Error(
      "External Google Pay requires GOOGLE_PAY_MERCHANT_ID and GOOGLE_PAY_MERCHANT_NAME.",
    );
  }
  if (
    googlePayExternalEnabled &&
    googlePayEnvironment === "PRODUCTION" &&
    !/^.{12,18}$/.test(googlePayMerchantId!)
  ) {
    throw new Error(
      "Production Google Pay requires a Google-issued merchant ID of 12 to 18 characters.",
    );
  }
  if (
    googlePayExternalEnabled &&
    googlePayEnvironment === "PRODUCTION" &&
    googlePayMerchantId === BOG_GOOGLE_PAY_GATEWAY_MERCHANT_ID
  ) {
    throw new Error(
      "GOOGLE_PAY_MERCHANT_ID must be issued by Google; do not use BOG's gatewayMerchantId.",
    );
  }
  if (
    googlePayExternalEnabled &&
    (process.env.APP_ENV ?? process.env.NODE_ENV) === "production" &&
    googlePayEnvironment !== "PRODUCTION"
  ) {
    throw new Error(
      "Production cannot enable external Google Pay with GOOGLE_PAY_ENVIRONMENT=TEST.",
    );
  }

  return {
    enabled,
    hostedEnabled,
    googlePayExternalEnabled,
    applePayExternalEnabled,
    googlePayMerchantId,
    googlePayMerchantName,
    googlePayEnvironment,
  };
}
