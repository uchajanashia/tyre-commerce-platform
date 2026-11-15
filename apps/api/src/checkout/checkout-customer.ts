import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

export interface CheckoutCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  personalNumber?: string;
  address?: string;
}

function key(): Buffer {
  const value = process.env.ORDER_CUSTOMER_DATA_KEY || "";
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value) {
    throw new Error(
      "ORDER_CUSTOMER_DATA_KEY must be 32 canonical base64url bytes",
    );
  }
  return bytes;
}

export function customerDigest(value: unknown): string {
  const secret = key();
  try {
    return createHmac("sha256", secret)
      .update("checkout-request:v1:")
      .update(JSON.stringify(value))
      .digest("hex");
  } finally {
    secret.fill(0);
  }
}

export function sealCustomer(
  customer: CheckoutCustomer,
  orderId: string,
): string {
  const secret = key();
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", secret, nonce);
    cipher.setAAD(Buffer.from(`tyre:checkout:v1:${orderId}`));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(customer), "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      nonce.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  } finally {
    secret.fill(0);
  }
}

export function openCustomer(
  envelope: string,
  orderId: string,
): CheckoutCustomer {
  const secret = key();
  try {
    const [version, nonce, tag, ciphertext, extra] = envelope.split(".");
    if (version !== "v1" || !nonce || !tag || !ciphertext || extra)
      throw new Error("Invalid envelope");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      secret,
      Buffer.from(nonce, "base64url"),
    );
    cipher.setAAD(Buffer.from(`tyre:checkout:v1:${orderId}`));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(
      Buffer.concat([
        cipher.update(Buffer.from(ciphertext, "base64url")),
        cipher.final(),
      ]).toString("utf8"),
    ) as CheckoutCustomer;
  } catch {
    throw new Error("Unable to read checkout customer");
  } finally {
    secret.fill(0);
  }
}

export function sealReceipt(pdf: Buffer, orderId: string): string {
  const secret = key();
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", secret, nonce);
    cipher.setAAD(Buffer.from(`tyre:receipt:v1:${orderId}`));
    const ciphertext = Buffer.concat([cipher.update(pdf), cipher.final()]);
    return [
      "v1",
      nonce.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  } finally {
    secret.fill(0);
  }
}
export function openReceipt(envelope: string, orderId: string): Buffer {
  const secret = key();
  try {
    const [version, nonce, tag, ciphertext, extra] = envelope.split(".");
    if (version !== "v1" || !nonce || !tag || !ciphertext || extra)
      throw new Error("Invalid envelope");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      secret,
      Buffer.from(nonce, "base64url"),
    );
    cipher.setAAD(Buffer.from(`tyre:receipt:v1:${orderId}`));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      cipher.update(Buffer.from(ciphertext, "base64url")),
      cipher.final(),
    ]);
  } finally {
    secret.fill(0);
  }
}
