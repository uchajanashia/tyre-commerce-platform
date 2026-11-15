import { inspect } from "node:util";

export const CUSTOMER_DATA_CLASSIFICATIONS = Object.freeze([
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED_CUSTOMER",
  "SECRET_KEY_MATERIAL",
] as const);

export type CustomerDataClassification =
  (typeof CUSTOMER_DATA_CLASSIFICATIONS)[number];

export function isCustomerDataClassification(
  candidate: unknown,
): candidate is CustomerDataClassification {
  return (
    typeof candidate === "string" &&
    (CUSTOMER_DATA_CLASSIFICATIONS as readonly string[]).includes(candidate)
  );
}

export const PROTECTED_FIELD_METADATA_KEYS = Object.freeze([
  "registryFieldId",
  "owningContext",
  "classification",
  "aadSchemaVersion",
  "decisionReferences",
] as const);

export interface ProtectedFieldMetadata {
  readonly registryFieldId: string;
  readonly owningContext: string;
  readonly classification: "RESTRICTED_CUSTOMER";
  readonly aadSchemaVersion: typeof ENVELOPE_AAD_SCHEMA_VERSION;
  readonly decisionReferences: readonly string[];
}

/**
 * C0.1 admits no customer field. Adding even one entry is a contract change
 * requiring the applicable signed decisions and a successor implementation.
 */
export const PROTECTED_FIELD_REGISTRY = Object.freeze(
  [] as const satisfies readonly ProtectedFieldMetadata[],
);

export function validateProtectedFieldRegistry(
  candidate: unknown,
): asserts candidate is readonly ProtectedFieldMetadata[] {
  if (
    candidate !== PROTECTED_FIELD_REGISTRY ||
    !Array.isArray(candidate) ||
    candidate.length !== 0 ||
    !Object.isFrozen(candidate)
  ) {
    throw new VaultProtectionError();
  }
}

export const ENVELOPE_FORMAT_VERSION = 1 as const;
export const ENVELOPE_ALGORITHM_SUITE = "AES-256-GCM:v1" as const;
export const ENVELOPE_AAD_SCHEMA_VERSION = 1 as const;
export const SYNTHETIC_HARNESS_MAX_PLAINTEXT_BYTES = 4_096 as const;

const REDACTED_BYTES = "[REDACTED:SENSITIVE_BYTES]";
const REDACTED_CONTEXT = "[REDACTED:VAULT_CONTEXT]";
const REDACTED_ENVELOPE = "[REDACTED:VAULT_ENVELOPE]";
const VAULT_FAILURE_MESSAGE = "Customer data protection operation failed.";
const VAULT_AAD_DOMAIN = "tyre.customer-data-vault.aad";
const VAULT_CONTEXT_CONSTRUCTION_AUTHORITY = Symbol(
  "vault-context-construction-authority",
);

/**
 * Owns a defensive copy and prevents accidental String/JSON/inspect exposure.
 * The callback is the sole raw-byte boundary. Callers must not retain it.
 */
export class RedactedBytes {
  readonly #value: Buffer;

  private constructor(value: Buffer) {
    this.#value = value;
    Object.freeze(this);
  }

  static copyOf(value: Uint8Array): RedactedBytes {
    return new RedactedBytes(Buffer.from(value));
  }

  withUnsafeBytes<T>(operation: (value: Buffer) => T): T {
    return operation(this.#value);
  }

  copyForBoundary(): Buffer {
    return Buffer.from(this.#value);
  }

  zeroize(): void {
    this.#value.fill(0);
  }

  toString(): string {
    return REDACTED_BYTES;
  }

  toJSON(): string {
    return REDACTED_BYTES;
  }

  [inspect.custom](): string {
    return REDACTED_BYTES;
  }
}

export interface VaultBinding {
  readonly formatVersion: typeof ENVELOPE_FORMAT_VERSION;
  readonly registryFieldId: string;
  readonly classification: "RESTRICTED_CUSTOMER";
  readonly owningContext: string;
  readonly resourceId: string;
  readonly securityNamespaceId: string;
  readonly keyRef: string;
  readonly keyVersion: string;
  readonly aadSchemaVersion: typeof ENVELOPE_AAD_SCHEMA_VERSION;
}

export class VaultOperationContext {
  readonly #binding: Readonly<VaultBinding>;
  readonly #canonicalAad: RedactedBytes;

  private constructor(
    binding: Readonly<VaultBinding>,
    canonicalAad: RedactedBytes,
    authority: typeof VAULT_CONTEXT_CONSTRUCTION_AUTHORITY,
  ) {
    if (authority !== VAULT_CONTEXT_CONSTRUCTION_AUTHORITY) {
      throw new VaultProtectionError();
    }
    this.#binding = binding;
    this.#canonicalAad = canonicalAad;
    Object.freeze(this);
  }

  static fromBinding(binding: VaultBinding): VaultOperationContext {
    let canonicalAad: RedactedBytes | undefined;
    try {
      const admitted = admitVaultBinding(binding);
      canonicalAad = buildCanonicalAad(admitted);
      return new VaultOperationContext(
        admitted,
        canonicalAad,
        VAULT_CONTEXT_CONSTRUCTION_AUTHORITY,
      );
    } catch {
      canonicalAad?.zeroize();
      throw new VaultProtectionError();
    }
  }

  matches(binding: VaultBinding): boolean {
    try {
      const admitted = admitVaultBinding(binding);
      return (
        this.#binding.formatVersion === admitted.formatVersion &&
        this.#binding.registryFieldId === admitted.registryFieldId &&
        this.#binding.classification === admitted.classification &&
        this.#binding.owningContext === admitted.owningContext &&
        this.#binding.resourceId === admitted.resourceId &&
        this.#binding.securityNamespaceId === admitted.securityNamespaceId &&
        this.#binding.keyRef === admitted.keyRef &&
        this.#binding.keyVersion === admitted.keyVersion &&
        this.#binding.aadSchemaVersion === admitted.aadSchemaVersion
      );
    } catch {
      return false;
    }
  }

  withCanonicalAad<T>(operation: (aad: Buffer) => T): T {
    return this.#canonicalAad.withUnsafeBytes(operation);
  }

  zeroize(): void {
    this.#canonicalAad.zeroize();
  }

  toString(): string {
    return REDACTED_CONTEXT;
  }

  toJSON(): string {
    return REDACTED_CONTEXT;
  }

  [inspect.custom](): string {
    return REDACTED_CONTEXT;
  }
}

export interface EnvelopeState {
  readonly formatVersion: number;
  readonly registryFieldId: string;
  readonly classification: CustomerDataClassification;
  readonly algorithmSuite: string;
  readonly keyRef: string;
  readonly keyVersion: string;
  readonly wrappedDek: RedactedBytes;
  readonly nonce: RedactedBytes;
  readonly ciphertext: RedactedBytes;
  readonly authenticationTag: RedactedBytes;
  readonly aadSchemaVersion: number;
}

export class VaultEnvelope {
  readonly #state: Readonly<EnvelopeState>;

  constructor(state: EnvelopeState) {
    try {
      this.#state = admitEnvelopeState(state);
    } catch {
      throw new VaultProtectionError();
    }
    Object.freeze(this);
  }

  readMetadata(): Omit<
    EnvelopeState,
    "wrappedDek" | "nonce" | "ciphertext" | "authenticationTag"
  > {
    return Object.freeze({
      formatVersion: this.#state.formatVersion,
      registryFieldId: this.#state.registryFieldId,
      classification: this.#state.classification,
      algorithmSuite: this.#state.algorithmSuite,
      keyRef: this.#state.keyRef,
      keyVersion: this.#state.keyVersion,
      aadSchemaVersion: this.#state.aadSchemaVersion,
    });
  }

  withBinaryParts<T>(
    operation: (
      parts: Readonly<
        Pick<
          EnvelopeState,
          "wrappedDek" | "nonce" | "ciphertext" | "authenticationTag"
        >
      >,
    ) => T,
  ): T {
    return operation({
      wrappedDek: this.#state.wrappedDek,
      nonce: this.#state.nonce,
      ciphertext: this.#state.ciphertext,
      authenticationTag: this.#state.authenticationTag,
    });
  }

  toString(): string {
    return REDACTED_ENVELOPE;
  }

  toJSON(): string {
    return REDACTED_ENVELOPE;
  }

  [inspect.custom](): string {
    return REDACTED_ENVELOPE;
  }
}

export class VaultProtectionError extends Error {
  readonly code = "CUSTOMER_DATA_PROTECTION_FAILED";

  constructor() {
    super(VAULT_FAILURE_MESSAGE);
    this.name = "VaultProtectionError";
    this.stack = `${this.name}: ${this.message}`;
    Object.freeze(this);
  }

  toJSON(): Readonly<{ name: string; code: string; message: string }> {
    return Object.freeze({
      name: this.name,
      code: this.code,
      message: this.message,
    });
  }

  [inspect.custom](): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

function isOpaqueIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 255 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isRedactedBytes(value: unknown): value is RedactedBytes {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === RedactedBytes.prototype
  );
}

function copyRedactedBytes(value: RedactedBytes): RedactedBytes {
  return value.withUnsafeBytes((bytes) => RedactedBytes.copyOf(bytes));
}

function admitVaultBinding(binding: VaultBinding): Readonly<VaultBinding> {
  assertExactDataObject(binding, [
    "formatVersion",
    "registryFieldId",
    "classification",
    "owningContext",
    "resourceId",
    "securityNamespaceId",
    "keyRef",
    "keyVersion",
    "aadSchemaVersion",
  ]);
  if (
    binding.formatVersion !== ENVELOPE_FORMAT_VERSION ||
    !isOpaqueIdentifier(binding.registryFieldId) ||
    binding.classification !== "RESTRICTED_CUSTOMER" ||
    !isOpaqueIdentifier(binding.owningContext) ||
    !isOpaqueIdentifier(binding.resourceId) ||
    !isOpaqueIdentifier(binding.securityNamespaceId) ||
    !isOpaqueIdentifier(binding.keyRef) ||
    !isOpaqueIdentifier(binding.keyVersion) ||
    binding.aadSchemaVersion !== ENVELOPE_AAD_SCHEMA_VERSION
  ) {
    throw new VaultProtectionError();
  }
  return Object.freeze({
    formatVersion: binding.formatVersion,
    registryFieldId: binding.registryFieldId,
    classification: binding.classification,
    owningContext: binding.owningContext,
    resourceId: binding.resourceId,
    securityNamespaceId: binding.securityNamespaceId,
    keyRef: binding.keyRef,
    keyVersion: binding.keyVersion,
    aadSchemaVersion: binding.aadSchemaVersion,
  });
}

function encodeCanonicalAadPart(value: string | number): Buffer {
  const text = String(value);
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > 0xffff_ffff) {
    throw new VaultProtectionError();
  }
  const encoded = Buffer.allocUnsafe(4 + byteLength);
  try {
    encoded.writeUInt32BE(byteLength, 0);
    const written = encoded.write(text, 4, byteLength, "utf8");
    if (written !== byteLength) {
      throw new VaultProtectionError();
    }
    return encoded;
  } catch {
    encoded.fill(0);
    throw new VaultProtectionError();
  }
}

function buildCanonicalAad(binding: Readonly<VaultBinding>): RedactedBytes {
  const parts = [
    encodeCanonicalAadPart(VAULT_AAD_DOMAIN),
    encodeCanonicalAadPart(binding.formatVersion),
    encodeCanonicalAadPart(binding.registryFieldId),
    encodeCanonicalAadPart(binding.classification),
    encodeCanonicalAadPart(binding.owningContext),
    encodeCanonicalAadPart(binding.resourceId),
    encodeCanonicalAadPart(binding.securityNamespaceId),
    encodeCanonicalAadPart(binding.keyRef),
    encodeCanonicalAadPart(binding.keyVersion),
    encodeCanonicalAadPart(binding.aadSchemaVersion),
  ];
  const encoded = Buffer.concat(parts);
  try {
    return RedactedBytes.copyOf(encoded);
  } finally {
    for (const part of parts) {
      part.fill(0);
    }
    encoded.fill(0);
  }
}

function admitEnvelopeState(state: EnvelopeState): Readonly<EnvelopeState> {
  assertExactDataObject(state, [
    "formatVersion",
    "registryFieldId",
    "classification",
    "algorithmSuite",
    "keyRef",
    "keyVersion",
    "wrappedDek",
    "nonce",
    "ciphertext",
    "authenticationTag",
    "aadSchemaVersion",
  ]);
  if (
    state.formatVersion !== ENVELOPE_FORMAT_VERSION ||
    !isOpaqueIdentifier(state.registryFieldId) ||
    state.classification !== "RESTRICTED_CUSTOMER" ||
    state.algorithmSuite !== ENVELOPE_ALGORITHM_SUITE ||
    !isOpaqueIdentifier(state.keyRef) ||
    !isOpaqueIdentifier(state.keyVersion) ||
    !isRedactedBytes(state.wrappedDek) ||
    !isRedactedBytes(state.nonce) ||
    !isRedactedBytes(state.ciphertext) ||
    !isRedactedBytes(state.authenticationTag) ||
    state.aadSchemaVersion !== ENVELOPE_AAD_SCHEMA_VERSION
  ) {
    throw new VaultProtectionError();
  }
  return Object.freeze({
    formatVersion: state.formatVersion,
    registryFieldId: state.registryFieldId,
    classification: state.classification,
    algorithmSuite: state.algorithmSuite,
    keyRef: state.keyRef,
    keyVersion: state.keyVersion,
    wrappedDek: copyRedactedBytes(state.wrappedDek),
    nonce: copyRedactedBytes(state.nonce),
    ciphertext: copyRedactedBytes(state.ciphertext),
    authenticationTag: copyRedactedBytes(state.authenticationTag),
    aadSchemaVersion: state.aadSchemaVersion,
  });
}

function assertExactDataObject(
  candidate: unknown,
  expectedKeys: readonly string[],
): asserts candidate is Record<string, unknown> {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Object.getPrototypeOf(candidate) !== Object.prototype
  ) {
    throw new VaultProtectionError();
  }
  const keys = Reflect.ownKeys(candidate);
  if (
    keys.length !== expectedKeys.length ||
    keys.some(
      (key) => typeof key !== "string" || !expectedKeys.includes(key),
    )
  ) {
    throw new VaultProtectionError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, "value") ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      throw new VaultProtectionError();
    }
  }
}

export interface KmsAdapter {
  wrapDataKey(
    keyRef: string,
    keyVersion: string,
    plaintextDek: RedactedBytes,
    context: VaultOperationContext,
  ): Promise<RedactedBytes>;

  unwrapDataKey(
    keyRef: string,
    keyVersion: string,
    wrappedDek: RedactedBytes,
    context: VaultOperationContext,
  ): Promise<RedactedBytes>;
}

export interface EnvelopeCipher {
  seal(
    registryFieldId: string,
    resourceId: string,
    plaintext: RedactedBytes,
  ): Promise<VaultEnvelope>;

  open(
    registryFieldId: string,
    resourceId: string,
    envelope: VaultEnvelope,
  ): Promise<RedactedBytes>;
}

/**
 * The only shipped adapter. It cannot wrap or unwrap and has no configuration,
 * credentials, provider SDK, filesystem, environment, subprocess or network.
 */
export class DisabledKmsAdapter implements KmsAdapter {
  async wrapDataKey(
    _keyRef: string,
    _keyVersion: string,
    _plaintextDek: RedactedBytes,
    _context: VaultOperationContext,
  ): Promise<RedactedBytes> {
    throw new VaultProtectionError();
  }

  async unwrapDataKey(
    _keyRef: string,
    _keyVersion: string,
    _wrappedDek: RedactedBytes,
    _context: VaultOperationContext,
  ): Promise<RedactedBytes> {
    throw new VaultProtectionError();
  }
}
