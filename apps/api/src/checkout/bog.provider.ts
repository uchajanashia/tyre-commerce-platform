import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { verify } from "node:crypto";
import { customerDigest } from "./checkout-customer";
import { readBogPaymentFeatureConfig } from "./bog-payment.config";

const BOG_API_ORIGIN = "https://api.bog.ge";
const BOG_PAYMENT_ORIGIN = "https://payment.bog.ge";
const MAX_WALLET_TOKEN_BYTES = 256 * 1024;

const KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu4RUyAw3+CdkS3ZNILQh
zHI9Hemo+vKB9U2BSabppkKjzjjkf+0Sm76hSMiu/HFtYhqWOESryoCDJoqffY0Q
1VNt25aTxbj068QNUtnxQ7KQVLA+pG0smf+EBWlS1vBEAFbIas9d8c9b9sSEkTrr
TYQ90WIM8bGB6S/KLVoT1a7SnzabjoLc5Qf/SLDG5fu8dH8zckyeYKdRKSBJKvhx
tcBuHV4f7qsynQT+f2UYbESX/TLHwT5qFWZDHZ0YUOUIvb8n7JujVSGZO9/+ll/g
4ZIWhC1MlJgPObDwRkRd8NFOopgxMcMsDIZIoLbWKhHVq67hdbwpAq9K9WMmEhPn
PwIDAQAB
-----END PUBLIC KEY-----`;

export function httpsConfig(name: string): string {
  const value = process.env[name] || "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error();
    return url.toString();
  } catch {
    throw new ServiceUnavailableException(`${name} is not configured`);
  }
}
export interface BogReceipt {
  order_id: string;
  external_order_id: string;
  order_status: { key: string };
  purchase_units: { request_amount: string | number; currency_code: string; transfer_amount?: string | number; refund_amount?: string | number };
  actions?: { action_id: string; action: string; status: string; amount: string | number }[];
}

export type BogExternalPaymentResult =
  | { reference: string; outcome: "completed" | "processing" }
  | { reference: string; outcome: "action_required"; redirect: string };

export interface BogApplePaySession {
  reference: string;
  /** Opaque BOG/Apple merchant-validation payload. Never persist or log it. */
  sessionJson: string;
}

interface BogOrderItem {
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

function walletToken(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_WALLET_TOKEN_BYTES
  ) {
    throw new ServiceUnavailableException("Invalid wallet response");
  }
  return value;
}

function merchantSession(value: unknown): string {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new ServiceUnavailableException("Invalid bank response");
  }
  if (!encoded || Buffer.byteLength(encoded, "utf8") > MAX_WALLET_TOKEN_BYTES) {
    throw new ServiceUnavailableException("Invalid bank response");
  }
  return encoded;
}

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceUnavailableException("Invalid bank response");
  }
  return value as Record<string, any>;
}

function paymentRedirect(value: unknown): string {
  try {
    if (typeof value !== "string") throw new Error();
    const url = new URL(value);
    if (url.origin !== BOG_PAYMENT_ORIGIN || url.username || url.password) {
      throw new Error();
    }
    return url.toString();
  } catch {
    throw new ServiceUnavailableException("Invalid bank response");
  }
}

@Injectable()
export class BogProvider implements OnModuleInit {
  private readonly logger = new Logger(BogProvider.name);

  onModuleInit() {
    const features = readBogPaymentFeatureConfig();
    if (!features.enabled) return;
    if (
      process.env.CHECKOUT_ENABLED !== "true" ||
      !process.env.BOG_CLIENT_ID ||
      !process.env.BOG_SECRET_KEY
    )
      throw new Error("BOG checkout configuration missing");
    for (const name of ["BOG_CALLBACK_URL", "BOG_SUCCESS_URL", "BOG_FAIL_URL"])
      httpsConfig(name);
    customerDigest("startup-check");
  }
  private token?: { value: string; until: number };
  async accessToken(): Promise<string> {
    if (this.token && this.token.until > Date.now() + 30000)
      return this.token.value;
    if (!process.env.BOG_CLIENT_ID || !process.env.BOG_SECRET_KEY)
      throw new ServiceUnavailableException("Payments are not configured");
    this.logger.log("payment_provider_request operation=oauth");
    let response: Response;
    try {
      response = await fetch(
        "https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token",
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: `Basic ${Buffer.from(`${process.env.BOG_CLIENT_ID}:${process.env.BOG_SECRET_KEY}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        },
      );
    } catch {
      this.logger.error(
        "payment_provider_failure operation=oauth reason=network_error",
      );
      throw new ServiceUnavailableException("Bank authentication failed");
    }
    if (!response.ok) {
      this.logger.error(
        `payment_provider_failure operation=oauth reason=http_error status=${response.status}`,
      );
      throw new ServiceUnavailableException("Bank authentication failed");
    }
    let data: { access_token: string; expires_in: number };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      this.logger.error(
        `payment_provider_failure operation=oauth reason=invalid_json status=${response.status}`,
      );
      throw new ServiceUnavailableException("Invalid bank response");
    }
    if (
      typeof data.access_token !== "string" ||
      !Number.isFinite(data.expires_in)
    ) {
      this.logger.error(
        `payment_provider_failure operation=oauth reason=invalid_payload status=${response.status}`,
      );
      throw new ServiceUnavailableException("Invalid bank response");
    }
    this.logger.log(
      `payment_provider_success operation=oauth status=${response.status}`,
    );
    this.token = {
      value: data.access_token,
      until: Date.now() + Math.min(data.expires_in, 3600) * 1000,
    };
    return data.access_token;
  }
  async create(
    attemptId: string,
    externalId: string,
    total: number,
    items: BogOrderItem[],
  ) {
    if (!readBogPaymentFeatureConfig().hostedEnabled)
      throw new ServiceUnavailableException("Hosted payments are disabled");
    const success = new URL(httpsConfig("BOG_SUCCESS_URL"));
    const fail = new URL(httpsConfig("BOG_FAIL_URL"));
    success.searchParams.set("order", externalId);
    fail.searchParams.set("order", externalId);
    const data = await this.createOrder(attemptId, {
      ...this.orderBody(externalId, total, items),
      redirect_urls: { success: success.toString(), fail: fail.toString() },
    });
    if (typeof data.id !== "string") {
      this.logger.error(
        `payment_provider_failure operation=create_order reason=missing_order_id attempt_id=${attemptId}`,
      );
      throw new ServiceUnavailableException("Invalid bank response");
    }
    let redirect: string;
    try {
      redirect = paymentRedirect(data._links?.redirect?.href);
    } catch {
      this.logger.error(
        `payment_provider_failure operation=create_order reason=invalid_redirect attempt_id=${attemptId}`,
      );
      throw new ServiceUnavailableException("Invalid bank response");
    }
    return {
      reference: data.id,
      redirect,
    };
  }

  async createExternalGooglePay(
    attemptId: string,
    externalId: string,
    total: number,
    items: BogOrderItem[],
    googlePayToken: string,
  ): Promise<BogExternalPaymentResult> {
    if (!readBogPaymentFeatureConfig().googlePayExternalEnabled)
      throw new ServiceUnavailableException("Google Pay is disabled");
    const data = await this.createOrder(attemptId, {
      ...this.orderBody(externalId, total, items),
      application_type: "web",
      payment_method: ["google_pay"],
      config: {
        google_pay: {
          external: true,
          google_pay_token: walletToken(googlePayToken),
        },
      },
    });
    return this.externalResult(data);
  }

  async createExternalApplePay(
    attemptId: string,
    externalId: string,
    total: number,
    items: BogOrderItem[],
  ): Promise<BogApplePaySession> {
    if (!readBogPaymentFeatureConfig().applePayExternalEnabled)
      throw new ServiceUnavailableException("Apple Pay is disabled");
    const data = await this.createOrder(attemptId, {
      ...this.orderBody(externalId, total, items),
      application_type: "web",
      payment_method: ["apple_pay"],
      config: { apple_pay: { external: true } },
    });
    if (typeof data.id !== "string" || data.result === undefined)
      throw new ServiceUnavailableException("Invalid bank response");
    const expected = `${BOG_API_ORIGIN}/payments/v1/ecommerce/orders/${encodeURIComponent(data.id)}/payment`;
    if (data._links?.accept?.href !== expected)
      throw new ServiceUnavailableException("Invalid bank response");
    return { reference: data.id, sessionJson: merchantSession(data.result) };
  }

  async completeExternalApplePay(
    reference: string,
    completionId: string,
    applePayToken: string,
  ): Promise<BogExternalPaymentResult> {
    if (!readBogPaymentFeatureConfig().applePayExternalEnabled)
      throw new ServiceUnavailableException("Apple Pay is disabled");
    const response = await this.bankFetch(
      `${BOG_API_ORIGIN}/payments/v1/ecommerce/orders/${encodeURIComponent(reference)}/payment`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          "Content-Type": "application/json",
          "Idempotency-Key": completionId,
        },
        body: JSON.stringify({ apple_pay_token: walletToken(applePayToken) }),
      },
      "complete_apple_pay",
      completionId,
    );
    if (!response.ok) {
      this.logger.error(
        `payment_provider_failure operation=complete_apple_pay reason=http_error status=${response.status} attempt_id=${completionId}`,
      );
      throw new ServiceUnavailableException(
        "Bank payment completion failed; verify status before retrying",
      );
    }
    let data: Record<string, any>;
    try {
      data = await this.responseJson(response);
    } catch {
      this.logger.error(
        `payment_provider_failure operation=complete_apple_pay reason=invalid_json status=${response.status} attempt_id=${completionId}`,
      );
      throw new ServiceUnavailableException("Invalid bank response");
    }
    this.logger.log(
      `payment_provider_success operation=complete_apple_pay status=${response.status} attempt_id=${completionId}`,
    );
    return this.externalResult(data);
  }

  private orderBody(externalId: string, total: number, items: BogOrderItem[]) {
    return {
      callback_url: httpsConfig("BOG_CALLBACK_URL"),
      external_order_id: externalId,
      capture: "automatic",
      ttl: 15,
      purchase_units: {
        currency: "GEL",
        total_amount: total,
        basket: items.map((item) => ({
          product_id: item.productCode,
          description: item.productName,
          quantity: item.quantity,
          unit_price: item.unitPrice,
        })),
      },
    };
  }

  private async createOrder(
    attemptId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, any>> {
    this.logger.log(
      `payment_provider_request operation=create_order attempt_id=${attemptId}`,
    );
    const response = await this.bankFetch(
      `${BOG_API_ORIGIN}/payments/v1/ecommerce/orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          "Content-Type": "application/json",
          "Accept-Language": "ka",
          "Idempotency-Key": attemptId,
        },
        body: JSON.stringify(body),
      },
      "create_order",
      attemptId,
    );
    if (!response.ok) {
      this.logger.error(
        `payment_provider_failure operation=create_order reason=http_error status=${response.status} attempt_id=${attemptId}`,
      );
      throw new ServiceUnavailableException(
        "Bank order creation failed; retry with the same request",
      );
    }
    let data: Record<string, any>;
    try {
      data = await this.responseJson(response);
    } catch {
      this.logger.error(
        `payment_provider_failure operation=create_order reason=invalid_json status=${response.status} attempt_id=${attemptId}`,
      );
      throw new ServiceUnavailableException("Invalid bank response");
    }
    this.logger.log(
      `payment_provider_success operation=create_order status=${response.status} attempt_id=${attemptId}`,
    );
    return data;
  }

  private externalResult(data: Record<string, any>): BogExternalPaymentResult {
    if (typeof data.id !== "string")
      throw new ServiceUnavailableException("Invalid bank response");
    if (data._links?.redirect?.href) {
      return {
        reference: data.id,
        outcome: "action_required",
        redirect: paymentRedirect(data._links.redirect.href),
      };
    }
    return {
      reference: data.id,
      outcome: data.status === "completed" ? "completed" : "processing",
    };
  }

  private async bankFetch(
    url: string,
    init: RequestInit,
    operation: "create_order" | "complete_apple_pay" | "refund",
    attemptId: string,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // Never attach request bodies here: wallet tokens are payment secrets.
      this.logger.error(
        `payment_provider_failure operation=${operation} reason=network_error attempt_id=${attemptId}`,
      );
      throw new ServiceUnavailableException(
        "Bank request failed; verify status before retrying",
      );
    }
  }

  private async responseJson(response: Response): Promise<Record<string, any>> {
    try {
      return asRecord(await response.json());
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Invalid bank response");
    }
  }
  async refund(reference: string, requestId: string, amountMinor: number): Promise<string> {
    if (process.env.BOG_REFUNDS_ENABLED !== 'true' || process.env.BOG_PAYMENTS_ENABLED !== 'true')
      throw new ServiceUnavailableException('Refunds are disabled');
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) throw new ServiceUnavailableException('Invalid refund amount');
    const response = await this.bankFetch(`${BOG_API_ORIGIN}/payments/v1/payment/refund/${encodeURIComponent(reference)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json', 'Idempotency-Key': requestId },
      body: JSON.stringify({ amount: amountMinor / 100 }),
    }, 'refund', requestId);
    if (!response.ok) throw new ServiceUnavailableException('Refund result unconfirmed');
    const data = await this.responseJson(response);
    if (data.key !== 'request_received' || typeof data.action_id !== 'string' || !data.action_id)
      throw new ServiceUnavailableException('Refund result unconfirmed');
    return data.action_id;
  }
  async receipt(reference: string): Promise<BogReceipt> {
    const response = await fetch(
      `https://api.bog.ge/payments/v1/receipt/${encodeURIComponent(reference)}`,
      {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${await this.accessToken()}` },
      },
    );
    if (!response.ok)
      throw new ServiceUnavailableException("Bank status unavailable");
    return (await response.json()) as BogReceipt;
  }
  callback(raw: Buffer, signature: string): BogReceipt {
    try {
      if (
        !signature ||
        !verify("RSA-SHA256", raw, KEY, Buffer.from(signature, "base64"))
      )
        throw new Error();
      const payload = JSON.parse(raw.toString("utf8")) as {
        event: string;
        body: BogReceipt;
      };
      if (payload.event !== "order_payment") throw new Error();
      return payload.body;
    } catch {
      throw new UnauthorizedException("Invalid bank callback");
    }
  }
}
