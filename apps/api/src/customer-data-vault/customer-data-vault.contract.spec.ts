import assert from "node:assert/strict";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Console } from "node:console";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { Writable } from "node:stream";
import { format, inspect } from "node:util";
import { resolve } from "node:path";
import test from "node:test";

import {
  CUSTOMER_DATA_CLASSIFICATIONS,
  DisabledKmsAdapter,
  ENVELOPE_AAD_SCHEMA_VERSION,
  ENVELOPE_ALGORITHM_SUITE,
  ENVELOPE_FORMAT_VERSION,
  EnvelopeCipher,
  EnvelopeState,
  isCustomerDataClassification,
  KmsAdapter,
  PROTECTED_FIELD_METADATA_KEYS,
  PROTECTED_FIELD_REGISTRY,
  ProtectedFieldMetadata,
  RedactedBytes,
  SYNTHETIC_HARNESS_MAX_PLAINTEXT_BYTES,
  validateProtectedFieldRegistry,
  VaultBinding,
  VaultEnvelope,
  VaultOperationContext,
  VaultProtectionError,
} from "./customer-data-vault.contract";

const SYNTHETIC_FIELD = "synthetic.contract.field";
const SYNTHETIC_OWNER = "synthetic-harness";
const SYNTHETIC_RESOURCE = "synthetic-resource-0001";
const SYNTHETIC_SECURITY_NAMESPACE = "synthetic-security-namespace-0001";
const SYNTHETIC_KEY_REF = "synthetic-key-alias";
const SYNTHETIC_KEY_VERSION = "synthetic-key-version-0001";
const FAILURE_MESSAGE = "Customer data protection operation failed.";
const AAD_DOMAIN = "tyre.customer-data-vault.aad";
const observedSensitiveBuffers: Buffer[] = [];

function observeSensitive(value: Buffer): Buffer {
  observedSensitiveBuffers.push(value);
  return value;
}

const SYNTHETIC_REGISTRY = Object.freeze([
  Object.freeze({
    registryFieldId: SYNTHETIC_FIELD,
    owningContext: SYNTHETIC_OWNER,
    classification: "RESTRICTED_CUSTOMER",
    aadSchemaVersion: ENVELOPE_AAD_SCHEMA_VERSION,
    decisionReferences: Object.freeze(["synthetic-test-only"]),
  }),
] as const satisfies readonly ProtectedFieldMetadata[]);

function encodedPart(value: string | number): Buffer {
  const text = String(value);
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > 0xffff_ffff) failClosed();
  const encoded = Buffer.allocUnsafe(4 + byteLength);
  encoded.writeUInt32BE(byteLength, 0);
  const written = encoded.write(text, 4, byteLength, "utf8");
  if (written !== byteLength) {
    encoded.fill(0);
    failClosed();
  }
  return encoded;
}

function expectedCanonicalAad(binding: VaultBinding): Buffer {
  const parts = [
    encodedPart(AAD_DOMAIN),
    encodedPart(binding.formatVersion),
    encodedPart(binding.registryFieldId),
    encodedPart(binding.classification),
    encodedPart(binding.owningContext),
    encodedPart(binding.resourceId),
    encodedPart(binding.securityNamespaceId),
    encodedPart(binding.keyRef),
    encodedPart(binding.keyVersion),
    encodedPart(binding.aadSchemaVersion),
  ];
  const encoded = Buffer.concat(parts);
  for (const part of parts) part.fill(0);
  return encoded;
}

function failClosed(): never {
  throw new VaultProtectionError();
}

/**
 * Test-only adapter. It is deliberately defined in the spec target, which is
 * excluded by the production tsconfig, and uses only Node's in-memory crypto.
 */
class SyntheticInMemoryKmsAdapter implements KmsAdapter {
  readonly #kek: RedactedBytes;
  readonly #admittedKeys: ReadonlySet<string>;
  lastWrapInput?: RedactedBytes;
  lastUnwrappedOutput?: RedactedBytes;
  wrapCalls = 0;
  unwrapCalls = 0;

  constructor(
    kek = randomBytes(32),
    admittedKeys: readonly Readonly<{ keyRef: string; keyVersion: string }>[] = [
      { keyRef: SYNTHETIC_KEY_REF, keyVersion: SYNTHETIC_KEY_VERSION },
    ],
  ) {
    this.#kek = RedactedBytes.copyOf(kek);
    this.#admittedKeys = new Set(
      admittedKeys.map(({ keyRef, keyVersion }) => `${keyRef}\u0000${keyVersion}`),
    );
    kek.fill(0);
  }

  async wrapDataKey(
    keyRef: string,
    keyVersion: string,
    plaintextDek: RedactedBytes,
    context: VaultOperationContext,
  ): Promise<RedactedBytes> {
    this.wrapCalls += 1;
    if (!this.#admittedKeys.has(`${keyRef}\u0000${keyVersion}`)) {
      failClosed();
    }
    this.lastWrapInput = plaintextDek;
    const nonce = randomBytes(12);
    let encrypted: Buffer = Buffer.alloc(0);
    let tag: Buffer = Buffer.alloc(0);
    let packed: Buffer = Buffer.alloc(0);
    let updateChunk: Buffer = Buffer.alloc(0);
    let finalChunk: Buffer = Buffer.alloc(0);
    try {
      return this.#kek.withUnsafeBytes((kek) =>
        context.withCanonicalAad((aad) => {
          const cipher = createCipheriv("aes-256-gcm", kek, nonce);
          cipher.setAAD(aad);
          const input = observeSensitive(plaintextDek.copyForBoundary());
          try {
            updateChunk = observeSensitive(cipher.update(input));
            finalChunk = observeSensitive(cipher.final());
            encrypted = observeSensitive(Buffer.concat([updateChunk, finalChunk]));
          } finally {
            input.fill(0);
          }
          tag = cipher.getAuthTag();
          packed = Buffer.concat([nonce, encrypted, tag]);
          return RedactedBytes.copyOf(packed);
        }),
      );
    } catch {
      return failClosed();
    } finally {
      nonce.fill(0);
      encrypted.fill(0);
      tag.fill(0);
      packed.fill(0);
      updateChunk.fill(0);
      finalChunk.fill(0);
    }
  }

  async unwrapDataKey(
    keyRef: string,
    keyVersion: string,
    wrappedDek: RedactedBytes,
    context: VaultOperationContext,
  ): Promise<RedactedBytes> {
    this.unwrapCalls += 1;
    if (!this.#admittedKeys.has(`${keyRef}\u0000${keyVersion}`)) {
      failClosed();
    }
    const packed = wrappedDek.copyForBoundary();
    let plaintextDek: Buffer = Buffer.alloc(0);
    let updateChunk: Buffer = Buffer.alloc(0);
    let finalChunk: Buffer = Buffer.alloc(0);
    try {
      if (packed.length !== 60) failClosed();
      const nonce = packed.subarray(0, 12);
      const ciphertext = packed.subarray(12, 44);
      const tag = packed.subarray(44, 60);
      const output = this.#kek.withUnsafeBytes((kek) =>
        context.withCanonicalAad((aad) => {
          const decipher = createDecipheriv("aes-256-gcm", kek, nonce);
          decipher.setAAD(aad);
          decipher.setAuthTag(tag);
          updateChunk = observeSensitive(decipher.update(ciphertext));
          finalChunk = observeSensitive(decipher.final());
          return observeSensitive(Buffer.concat([updateChunk, finalChunk]));
        }),
      );
      plaintextDek = output;
      const redacted = RedactedBytes.copyOf(output);
      this.lastUnwrappedOutput = redacted;
      return redacted;
    } catch {
      failClosed();
    } finally {
      packed.fill(0);
      plaintextDek.fill(0);
      updateChunk.fill(0);
      finalChunk.fill(0);
    }
  }

  destroy(): void {
    this.#kek.zeroize();
  }
}

class SyntheticEnvelopeCipher implements EnvelopeCipher {
  readonly #registry: ReadonlyMap<string, ProtectedFieldMetadata>;
  readonly #kms: KmsAdapter;
  readonly #securityNamespaceId: string;
  readonly #keyRef: string;
  readonly #keyVersion: string;

  constructor(
    kms: KmsAdapter,
    registry: readonly ProtectedFieldMetadata[] = SYNTHETIC_REGISTRY,
    securityNamespaceId = SYNTHETIC_SECURITY_NAMESPACE,
    keyRef = SYNTHETIC_KEY_REF,
    keyVersion = SYNTHETIC_KEY_VERSION,
  ) {
    this.#kms = kms;
    this.#securityNamespaceId = securityNamespaceId;
    this.#keyRef = keyRef;
    this.#keyVersion = keyVersion;
    this.#registry = new Map(
      registry.map((entry) => [entry.registryFieldId, entry]),
    );
  }

  async seal(
    registryFieldId: string,
    resourceId: string,
    plaintext: RedactedBytes,
  ): Promise<VaultEnvelope> {
    const entry = this.#registry.get(registryFieldId);
    if (!entry || entry.classification !== "RESTRICTED_CUSTOMER") failClosed();
    const length = plaintext.withUnsafeBytes((value) => value.length);
    if (length < 1 || length > SYNTHETIC_HARNESS_MAX_PLAINTEXT_BYTES) {
      failClosed();
    }

    const binding = this.binding(entry, resourceId);
    const context = VaultOperationContext.fromBinding(binding);
    const rawDek = randomBytes(32);
    const dek = RedactedBytes.copyOf(rawDek);
    rawDek.fill(0);
    const nonce = randomBytes(12);
    let ciphertext: Buffer = Buffer.alloc(0);
    let tag: Buffer = Buffer.alloc(0);
    let wrappedDek: RedactedBytes | undefined;
    let noncePart: RedactedBytes | undefined;
    let ciphertextPart: RedactedBytes | undefined;
    let tagPart: RedactedBytes | undefined;
    try {
      wrappedDek = await this.#kms.wrapDataKey(
        this.#keyRef,
        this.#keyVersion,
        dek,
        context,
      );
      dek.withUnsafeBytes((key) =>
        context.withCanonicalAad((canonical) => {
          const cipher = createCipheriv("aes-256-gcm", key, nonce);
          cipher.setAAD(canonical);
          const input = observeSensitive(plaintext.copyForBoundary());
          let updateChunk: Buffer = Buffer.alloc(0);
          let finalChunk: Buffer = Buffer.alloc(0);
          try {
            updateChunk = cipher.update(input);
            finalChunk = cipher.final();
            ciphertext = Buffer.concat([updateChunk, finalChunk]);
            tag = cipher.getAuthTag();
          } finally {
            input.fill(0);
            updateChunk.fill(0);
            finalChunk.fill(0);
          }
        }),
      );
      noncePart = RedactedBytes.copyOf(nonce);
      ciphertextPart = RedactedBytes.copyOf(ciphertext);
      tagPart = RedactedBytes.copyOf(tag);
      return new VaultEnvelope({
        formatVersion: ENVELOPE_FORMAT_VERSION,
        registryFieldId,
        classification: entry.classification,
        algorithmSuite: ENVELOPE_ALGORITHM_SUITE,
        keyRef: this.#keyRef,
        keyVersion: this.#keyVersion,
        wrappedDek,
        nonce: noncePart,
        ciphertext: ciphertextPart,
        authenticationTag: tagPart,
        aadSchemaVersion: entry.aadSchemaVersion,
      });
    } catch {
      return failClosed();
    } finally {
      dek.zeroize();
      context.zeroize();
      nonce.fill(0);
      ciphertext.fill(0);
      tag.fill(0);
      wrappedDek?.zeroize();
      noncePart?.zeroize();
      ciphertextPart?.zeroize();
      tagPart?.zeroize();
    }
  }

  async open(
    registryFieldId: string,
    resourceId: string,
    envelope: VaultEnvelope,
  ): Promise<RedactedBytes> {
    const entry = this.#registry.get(registryFieldId);
    if (!entry) failClosed();
    const metadata = envelope.readMetadata();
    if (
      metadata.formatVersion !== ENVELOPE_FORMAT_VERSION ||
      metadata.registryFieldId !== registryFieldId ||
      metadata.classification !== entry.classification ||
      metadata.algorithmSuite !== ENVELOPE_ALGORITHM_SUITE ||
      metadata.keyRef !== this.#keyRef ||
      metadata.keyVersion !== this.#keyVersion ||
      metadata.aadSchemaVersion !== entry.aadSchemaVersion
    ) {
      failClosed();
    }

    const binding = this.binding(entry, resourceId);
    const context = VaultOperationContext.fromBinding(binding);
    let dek: RedactedBytes | undefined;
    let output: Buffer = Buffer.alloc(0);
    try {
      return await envelope.withBinaryParts(async (parts) => {
        const lengths = {
          wrappedDek: parts.wrappedDek.withUnsafeBytes((value) => value.length),
          nonce: parts.nonce.withUnsafeBytes((value) => value.length),
          ciphertext: parts.ciphertext.withUnsafeBytes((value) => value.length),
          authenticationTag: parts.authenticationTag.withUnsafeBytes(
            (value) => value.length,
          ),
        };
        if (
          lengths.wrappedDek !== 60 ||
          lengths.nonce !== 12 ||
          lengths.authenticationTag !== 16 ||
          lengths.ciphertext < 1 ||
          lengths.ciphertext > SYNTHETIC_HARNESS_MAX_PLAINTEXT_BYTES
        ) {
          failClosed();
        }
        dek = await this.#kms.unwrapDataKey(
          metadata.keyRef,
          metadata.keyVersion,
          parts.wrappedDek,
          context,
        );
        const nonce = parts.nonce.copyForBoundary();
        const ciphertext = parts.ciphertext.copyForBoundary();
        const tag = parts.authenticationTag.copyForBoundary();
        let updateChunk: Buffer = Buffer.alloc(0);
        let finalChunk: Buffer = Buffer.alloc(0);
        try {
          output = dek.withUnsafeBytes((key) =>
            context.withCanonicalAad((canonical) => {
              const decipher = createDecipheriv("aes-256-gcm", key, nonce);
              decipher.setAAD(canonical);
              decipher.setAuthTag(tag);
              updateChunk = observeSensitive(decipher.update(ciphertext));
              finalChunk = observeSensitive(decipher.final());
              return observeSensitive(Buffer.concat([updateChunk, finalChunk]));
            }),
          );
          return RedactedBytes.copyOf(output);
        } finally {
          nonce.fill(0);
          ciphertext.fill(0);
          tag.fill(0);
          updateChunk.fill(0);
          finalChunk.fill(0);
        }
      });
    } catch {
      return failClosed();
    } finally {
      dek?.zeroize();
      context.zeroize();
      output.fill(0);
    }
  }

  private binding(
    entry: ProtectedFieldMetadata,
    resourceId: string,
  ): VaultBinding {
    return {
      formatVersion: ENVELOPE_FORMAT_VERSION,
      registryFieldId: entry.registryFieldId,
      classification: entry.classification,
      owningContext: entry.owningContext,
      resourceId,
      securityNamespaceId: this.#securityNamespaceId,
      keyRef: this.#keyRef,
      keyVersion: this.#keyVersion,
      aadSchemaVersion: entry.aadSchemaVersion,
    };
  }
}

function syntheticPlaintext(): RedactedBytes {
  return RedactedBytes.copyOf(
    Buffer.from([0x53, 0x59, 0x4e, 0x54, 0x48, 0x45, 0x54, 0x49, 0x43]),
  );
}

function bytes(value: RedactedBytes): Buffer {
  return value.copyForBoundary();
}

function bytesEqual(left: RedactedBytes, right: RedactedBytes): boolean {
  const leftCopy = bytes(left);
  const rightCopy = bytes(right);
  try {
    return (
      leftCopy.length === rightCopy.length &&
      timingSafeEqual(leftCopy, rightCopy)
    );
  } finally {
    leftCopy.fill(0);
    rightCopy.fill(0);
  }
}

function isZeroized(value: RedactedBytes): boolean {
  const copy = bytes(value);
  try {
    return copy.every((byte) => byte === 0);
  } finally {
    copy.fill(0);
  }
}

function stateOf(envelope: VaultEnvelope): EnvelopeState {
  return envelope.withBinaryParts((binary) => ({
    ...envelope.readMetadata(),
    ...binary,
  }));
}

function changed(
  envelope: VaultEnvelope,
  override: Partial<EnvelopeState>,
): VaultEnvelope {
  return new VaultEnvelope({ ...stateOf(envelope), ...override });
}

function mutate(value: RedactedBytes): RedactedBytes {
  const copy = bytes(value);
  copy[Math.floor(copy.length / 2)]! ^= 0x80;
  const result = RedactedBytes.copyOf(copy);
  copy.fill(0);
  return result;
}

function truncate(value: RedactedBytes): RedactedBytes {
  const copy = bytes(value);
  try {
    return RedactedBytes.copyOf(copy.subarray(0, copy.length - 1));
  } finally {
    copy.fill(0);
  }
}

function resize(value: RedactedBytes, length: number): RedactedBytes {
  const source = bytes(value);
  const resized = Buffer.alloc(length, 0xa5);
  try {
    source.copy(resized, 0, 0, Math.min(source.length, resized.length));
    return RedactedBytes.copyOf(resized);
  } finally {
    source.fill(0);
    resized.fill(0);
  }
}

function syntheticPlaintextOfLength(length: number): RedactedBytes {
  const source = Buffer.alloc(length, 0x5a);
  try {
    return RedactedBytes.copyOf(source);
  } finally {
    source.fill(0);
  }
}

function validBinding(): VaultBinding {
  return {
    formatVersion: ENVELOPE_FORMAT_VERSION,
    registryFieldId: SYNTHETIC_FIELD,
    classification: "RESTRICTED_CUSTOMER",
    owningContext: SYNTHETIC_OWNER,
    resourceId: SYNTHETIC_RESOURCE,
    securityNamespaceId: SYNTHETIC_SECURITY_NAMESPACE,
    keyRef: SYNTHETIC_KEY_REF,
    keyVersion: SYNTHETIC_KEY_VERSION,
    aadSchemaVersion: ENVELOPE_AAD_SCHEMA_VERSION,
  };
}

function hexOf(value: RedactedBytes): string {
  const copy = bytes(value);
  try {
    return copy.toString("hex");
  } finally {
    copy.fill(0);
  }
}

async function assertClosed(
  operation: Promise<unknown> | (() => unknown),
): Promise<void> {
  await captureClosed(operation);
}

async function captureClosed(
  operation: Promise<unknown> | (() => unknown),
): Promise<VaultProtectionError> {
  let captured: unknown;
  try {
    await (typeof operation === "function" ? operation() : operation);
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof VaultProtectionError);
  assert.equal(captured.message, FAILURE_MESSAGE);
  assert.equal(captured.cause, undefined);
  return captured;
}

test("classification vocabulary and production protected-field registry are exact, empty, frozen and closed", () => {
  assert.deepEqual(CUSTOMER_DATA_CLASSIFICATIONS, [
    "PUBLIC",
    "INTERNAL",
    "CONFIDENTIAL",
    "RESTRICTED_CUSTOMER",
    "SECRET_KEY_MATERIAL",
  ]);
  assert.deepEqual(PROTECTED_FIELD_METADATA_KEYS, [
    "registryFieldId",
    "owningContext",
    "classification",
    "aadSchemaVersion",
    "decisionReferences",
  ]);
  assert.equal(Object.isFrozen(CUSTOMER_DATA_CLASSIFICATIONS), true);
  assert.equal(Object.isFrozen(PROTECTED_FIELD_METADATA_KEYS), true);
  assert.equal(Object.isFrozen(PROTECTED_FIELD_REGISTRY), true);
  for (const classification of CUSTOMER_DATA_CLASSIFICATIONS) {
    assert.equal(isCustomerDataClassification(classification), true);
  }
  assert.equal(isCustomerDataClassification("unknown"), false);
  assert.equal(isCustomerDataClassification("custom"), false);
  assert.equal(isCustomerDataClassification("other"), false);
  assert.deepEqual(PROTECTED_FIELD_REGISTRY, []);
  assert.doesNotThrow(() =>
    validateProtectedFieldRegistry(PROTECTED_FIELD_REGISTRY),
  );
  assert.throws(() => validateProtectedFieldRegistry([]), VaultProtectionError);
  assert.throws(
    () => validateProtectedFieldRegistry(Object.freeze([SYNTHETIC_REGISTRY[0]])),
    VaultProtectionError,
  );
});

test("authenticated context admits only exact plain data properties and exact supported types", async () => {
  const binding = validBinding();
  const expectedAad = expectedCanonicalAad(binding);
  const valid = VaultOperationContext.fromBinding(binding);
  assert.equal(valid.matches(binding), true);
  valid.withCanonicalAad((aad) => assert.deepEqual(aad, expectedAad));

  const callerAad = RedactedBytes.copyOf(Buffer.from([0xa1]));
  const runtimeConstructor = VaultOperationContext as unknown as new (
    candidate: VaultBinding,
    canonicalAad: RedactedBytes,
    authority?: symbol,
  ) => VaultOperationContext;
  await assertClosed(
    () => new runtimeConstructor(binding, callerAad, Symbol("forged")),
  );
  const extendedFactory = VaultOperationContext.fromBinding as unknown as (
    candidate: VaultBinding,
    canonicalAad: RedactedBytes,
  ) => VaultOperationContext;
  const extraArgumentContext = extendedFactory(binding, callerAad);
  extraArgumentContext.withCanonicalAad((aad) =>
    assert.deepEqual(aad, expectedAad),
  );
  callerAad.withUnsafeBytes((bytes) => bytes.fill(0xff));
  valid.withCanonicalAad((aad) => assert.deepEqual(aad, expectedAad));

  const extra = { ...validBinding(), genericPayload: { value: "forbidden" } };
  const symbol = { ...validBinding(), [Symbol("forbidden")]: true };
  const inherited = Object.assign(
    Object.create({ inheritedPayload: true }),
    validBinding(),
  );
  let getterCalls = 0;
  const descriptors = Object.getOwnPropertyDescriptors(
    validBinding(),
  ) as Record<string, PropertyDescriptor>;
  descriptors.resourceId = {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return SYNTHETIC_RESOURCE;
    },
  };
  const accessor = Object.defineProperties({}, descriptors);
  const invalidTypes = [
    { ...validBinding(), formatVersion: "1" },
    { ...validBinding(), resourceId: "" },
    { ...validBinding(), securityNamespaceId: 1 },
    { ...validBinding(), keyRef: "" },
    { ...validBinding(), keyVersion: null },
    { ...validBinding(), aadSchemaVersion: "1" },
  ];
  for (const candidate of [extra, symbol, inherited, accessor, ...invalidTypes]) {
    await assertClosed(
      () => VaultOperationContext.fromBinding(
        candidate as unknown as VaultBinding,
      ),
    );
  }
  assert.equal(getterCalls, 0);
  expectedAad.fill(0);
  callerAad.zeroize();
  valid.zeroize();
  extraArgumentContext.zeroize();
});

test("disabled shipped adapter fails closed with one redacted error family", async () => {
  const adapter = new DisabledKmsAdapter();
  const secret = syntheticPlaintext();
  const context = VaultOperationContext.fromBinding({
    formatVersion: ENVELOPE_FORMAT_VERSION,
    registryFieldId: SYNTHETIC_FIELD,
    classification: "RESTRICTED_CUSTOMER",
    owningContext: SYNTHETIC_OWNER,
    resourceId: SYNTHETIC_RESOURCE,
    securityNamespaceId: SYNTHETIC_SECURITY_NAMESPACE,
    keyRef: SYNTHETIC_KEY_REF,
    keyVersion: SYNTHETIC_KEY_VERSION,
    aadSchemaVersion: ENVELOPE_AAD_SCHEMA_VERSION,
  });
  await assertClosed(
    adapter.wrapDataKey("opaque", "opaque", secret, context),
  );
  await assertClosed(
    adapter.unwrapDataKey("opaque", "opaque", secret, context),
  );
  secret.zeroize();
  context.zeroize();
});

test("VaultEnvelope is an exact closed value with owned bytes and frozen metadata", async () => {
  const kms = new SyntheticInMemoryKmsAdapter();
  const cipher = new SyntheticEnvelopeCipher(kms);
  const plaintext = syntheticPlaintext();
  const sealed = await cipher.seal(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    plaintext,
  );
  const state = stateOf(sealed);
  const owned = new VaultEnvelope(state);
  const metadata = owned.readMetadata();
  assert.equal(Object.isFrozen(metadata), true);
  assert.deepEqual(Reflect.ownKeys(metadata), [
    "formatVersion",
    "registryFieldId",
    "classification",
    "algorithmSuite",
    "keyRef",
    "keyVersion",
    "aadSchemaVersion",
  ]);
  assert.equal(Object.getPrototypeOf(metadata), Object.prototype);

  state.wrappedDek.zeroize();
  state.nonce.zeroize();
  state.ciphertext.zeroize();
  state.authenticationTag.zeroize();
  const opened = await cipher.open(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    owned,
  );
  assert.equal(bytesEqual(opened, plaintext), true);
  opened.zeroize();
  plaintext.zeroize();
  kms.destroy();
});

test("VaultEnvelope rejects extra, generic, inherited, accessor, symbol, missing and invalid fields without invoking getters", async () => {
  const kms = new SyntheticInMemoryKmsAdapter();
  const cipher = new SyntheticEnvelopeCipher(kms);
  const plaintext = syntheticPlaintext();
  const sealed = await cipher.seal(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    plaintext,
  );
  const valid = stateOf(sealed);
  let getterCalls = 0;
  const accessorDescriptors = Object.getOwnPropertyDescriptors(
    valid,
  ) as Record<string, PropertyDescriptor>;
  accessorDescriptors.keyRef = {
    enumerable: true,
    configurable: true,
    get() {
      getterCalls += 1;
      return SYNTHETIC_KEY_REF;
    },
  };
  const accessor = Object.defineProperties({}, accessorDescriptors);
  const inherited = Object.assign(
    Object.create({ customerPayload: "forbidden" }),
    valid,
  );
  const missing = { ...valid } as Record<string, unknown>;
  delete missing.keyVersion;
  const cases: unknown[] = [
    { ...valid, extra: "forbidden" },
    { ...valid, customerPayload: { nested: { arbitrary: true } } },
    { ...valid, plaintextLikeValue: "synthetic@example.invalid" },
    { ...valid, [Symbol("forbidden")]: "payload" },
    inherited,
    accessor,
    missing,
    { ...valid, formatVersion: "1" },
    { ...valid, registryFieldId: "" },
    { ...valid, classification: "CONFIDENTIAL" },
    { ...valid, algorithmSuite: new String(ENVELOPE_ALGORITHM_SUITE) },
    { ...valid, keyRef: 1 },
    { ...valid, keyVersion: "" },
    { ...valid, wrappedDek: Buffer.alloc(60) },
    { ...valid, nonce: new Uint8Array(12) },
    { ...valid, ciphertext: {} },
    { ...valid, authenticationTag: null },
    { ...valid, aadSchemaVersion: 1n },
  ];
  for (const candidate of cases) {
    await assertClosed(
      () => new VaultEnvelope(candidate as EnvelopeState),
    );
  }
  assert.equal(getterCalls, 0);
  plaintext.zeroize();
  kms.destroy();
});

test("synthetic AES-256-GCM envelope round-trips and equal input is non-deterministic", async () => {
  const kms = new SyntheticInMemoryKmsAdapter();
  const cipher = new SyntheticEnvelopeCipher(kms);
  const plaintext = syntheticPlaintext();
  const first = await cipher.seal(SYNTHETIC_FIELD, SYNTHETIC_RESOURCE, plaintext);
  const second = await cipher.seal(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    plaintext,
  );
  const opened = await cipher.open(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    first,
  );
  assert.equal(bytesEqual(opened, plaintext), true);
  first.withBinaryParts((a) =>
    second.withBinaryParts((b) => {
      assert.equal(bytesEqual(a.nonce, b.nonce), false);
      assert.equal(bytesEqual(a.wrappedDek, b.wrappedDek), false);
      assert.equal(bytesEqual(a.ciphertext, b.ciphertext), false);
    }),
  );
  plaintext.zeroize();
  opened.zeroize();
  kms.destroy();
});

test("AAD field, resource and owning-context mismatches fail closed", async () => {
  const kms = new SyntheticInMemoryKmsAdapter();
  const cipher = new SyntheticEnvelopeCipher(kms);
  const plaintext = syntheticPlaintext();
  const envelope = await cipher.seal(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    plaintext,
  );
  await assertClosed(
    cipher.open("synthetic.contract.unknown", SYNTHETIC_RESOURCE, envelope),
  );
  await assertClosed(
    cipher.open(SYNTHETIC_FIELD, "synthetic-resource-0002", envelope),
  );
  const otherOwner = new SyntheticEnvelopeCipher(kms, [
    { ...SYNTHETIC_REGISTRY[0], owningContext: "synthetic-other-owner" },
  ]);
  await assertClosed(
    otherOwner.open(SYNTHETIC_FIELD, SYNTHETIC_RESOURCE, envelope),
  );
  plaintext.zeroize();
  kms.destroy();
});

test("namespace, admitted key alias, immutable key version and registry AAD-version swaps fail closed", async () => {
  const admittedKeys = [
    { keyRef: SYNTHETIC_KEY_REF, keyVersion: SYNTHETIC_KEY_VERSION },
    { keyRef: "synthetic-key-alias-0002", keyVersion: SYNTHETIC_KEY_VERSION },
    { keyRef: SYNTHETIC_KEY_REF, keyVersion: "synthetic-key-version-0002" },
  ];
  const kms = new SyntheticInMemoryKmsAdapter(randomBytes(32), admittedKeys);
  const cipher = new SyntheticEnvelopeCipher(kms);
  const plaintext = syntheticPlaintext();
  const envelope = await cipher.seal(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    plaintext,
  );

  const namespaceCipher = new SyntheticEnvelopeCipher(
    kms,
    SYNTHETIC_REGISTRY,
    "synthetic-security-namespace-0002",
  );
  const unwrapBeforeNamespace = kms.unwrapCalls;
  await assertClosed(
    namespaceCipher.open(SYNTHETIC_FIELD, SYNTHETIC_RESOURCE, envelope),
  );
  assert.equal(kms.unwrapCalls, unwrapBeforeNamespace + 1);

  const aliasCipher = new SyntheticEnvelopeCipher(
    kms,
    SYNTHETIC_REGISTRY,
    SYNTHETIC_SECURITY_NAMESPACE,
    "synthetic-key-alias-0002",
    SYNTHETIC_KEY_VERSION,
  );
  const aliasEnvelope = changed(envelope, {
    keyRef: "synthetic-key-alias-0002",
  });
  const unwrapBeforeAlias = kms.unwrapCalls;
  await assertClosed(
    aliasCipher.open(SYNTHETIC_FIELD, SYNTHETIC_RESOURCE, aliasEnvelope),
  );
  assert.equal(kms.unwrapCalls, unwrapBeforeAlias + 1);

  const versionCipher = new SyntheticEnvelopeCipher(
    kms,
    SYNTHETIC_REGISTRY,
    SYNTHETIC_SECURITY_NAMESPACE,
    SYNTHETIC_KEY_REF,
    "synthetic-key-version-0002",
  );
  const versionEnvelope = changed(envelope, {
    keyVersion: "synthetic-key-version-0002",
  });
  const unwrapBeforeVersion = kms.unwrapCalls;
  await assertClosed(
    versionCipher.open(SYNTHETIC_FIELD, SYNTHETIC_RESOURCE, versionEnvelope),
  );
  assert.equal(kms.unwrapCalls, unwrapBeforeVersion + 1);

  const invalidRegistry = Object.freeze([
    Object.freeze({
      ...SYNTHETIC_REGISTRY[0],
      aadSchemaVersion: 2,
    }),
  ]) as unknown as readonly ProtectedFieldMetadata[];
  const registryVersionCipher = new SyntheticEnvelopeCipher(
    kms,
    invalidRegistry,
  );
  const unwrapBeforeRegistryVersion = kms.unwrapCalls;
  await assertClosed(
    registryVersionCipher.open(
      SYNTHETIC_FIELD,
      SYNTHETIC_RESOURCE,
      envelope,
    ),
  );
  assert.equal(kms.unwrapCalls, unwrapBeforeRegistryVersion);
  plaintext.zeroize();
  kms.destroy();
});

test("classification, format, algorithm, AAD version, key reference and key version mismatches fail closed", async () => {
  const kms = new SyntheticInMemoryKmsAdapter();
  const cipher = new SyntheticEnvelopeCipher(kms);
  const plaintext = syntheticPlaintext();
  const envelope = await cipher.seal(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    plaintext,
  );
  const cases: Partial<EnvelopeState>[] = [
    { classification: "CONFIDENTIAL" },
    { formatVersion: 2 },
    { algorithmSuite: "UNSUPPORTED" },
    { aadSchemaVersion: 2 },
    { keyRef: "synthetic-other-key" },
    { keyVersion: "synthetic-other-version" },
  ];
  for (const override of cases) {
    await assertClosed(() =>
      cipher.open(
        SYNTHETIC_FIELD,
        SYNTHETIC_RESOURCE,
        changed(envelope, override),
      ),
    );
  }
  plaintext.zeroize();
  kms.destroy();
});

test("plaintext and ciphertext ceilings are exact and adversarial open rejects before copying or provider calls", async () => {
  const kms = new SyntheticInMemoryKmsAdapter();
  const cipher = new SyntheticEnvelopeCipher(kms);
  const empty = syntheticPlaintextOfLength(0);
  const one = syntheticPlaintextOfLength(1);
  const maximum = syntheticPlaintextOfLength(
    SYNTHETIC_HARNESS_MAX_PLAINTEXT_BYTES,
  );
  const oversized = syntheticPlaintextOfLength(
    SYNTHETIC_HARNESS_MAX_PLAINTEXT_BYTES + 1,
  );
  await assertClosed(cipher.seal(SYNTHETIC_FIELD, SYNTHETIC_RESOURCE, empty));
  const oneEnvelope = await cipher.seal(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    one,
  );
  const maximumEnvelope = await cipher.seal(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    maximum,
  );
  await assertClosed(
    cipher.seal(SYNTHETIC_FIELD, SYNTHETIC_RESOURCE, oversized),
  );
  const openedOne = await cipher.open(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    oneEnvelope,
  );
  const openedMaximum = await cipher.open(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    maximumEnvelope,
  );
  assert.equal(bytesEqual(openedOne, one), true);
  assert.equal(bytesEqual(openedMaximum, maximum), true);

  const state = stateOf(maximumEnvelope);
  const emptyCiphertextEnvelope = changed(maximumEnvelope, {
    ciphertext: resize(state.ciphertext, 0),
  });
  const oversizedCiphertextEnvelope = changed(maximumEnvelope, {
    ciphertext: resize(
      state.ciphertext,
      SYNTHETIC_HARNESS_MAX_PLAINTEXT_BYTES + 1,
    ),
  });
  const unwrapBefore = kms.unwrapCalls;
  await assertClosed(
    cipher.open(
      SYNTHETIC_FIELD,
      SYNTHETIC_RESOURCE,
      emptyCiphertextEnvelope,
    ),
  );
  await assertClosed(
    cipher.open(
      SYNTHETIC_FIELD,
      SYNTHETIC_RESOURCE,
      oversizedCiphertextEnvelope,
    ),
  );
  assert.equal(kms.unwrapCalls, unwrapBefore);

  for (const value of [
    empty,
    one,
    maximum,
    oversized,
    openedOne,
    openedMaximum,
  ]) {
    value.zeroize();
  }
  kms.destroy();
});

test("ciphertext, nonce, tag and wrapped-DEK tamper or truncation never returns plaintext", async () => {
  const kms = new SyntheticInMemoryKmsAdapter();
  const cipher = new SyntheticEnvelopeCipher(kms);
  const plaintext = syntheticPlaintext();
  const envelope = await cipher.seal(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    plaintext,
  );
  const state = stateOf(envelope);
  for (const override of [
    { ciphertext: mutate(state.ciphertext) },
    { nonce: mutate(state.nonce) },
    { authenticationTag: mutate(state.authenticationTag) },
    { wrappedDek: mutate(state.wrappedDek) },
    { ciphertext: truncate(state.ciphertext) },
    { nonce: truncate(state.nonce) },
    { authenticationTag: truncate(state.authenticationTag) },
    { wrappedDek: truncate(state.wrappedDek) },
  ]) {
    await assertClosed(
      cipher.open(
        SYNTHETIC_FIELD,
        SYNTHETIC_RESOURCE,
        changed(envelope, override),
      ),
    );
  }
  plaintext.zeroize();
  kms.destroy();
});

test("wrong synthetic KEK fails closed and plaintext DEKs are best-effort zeroized on success and failure", async () => {
  observedSensitiveBuffers.length = 0;
  const sealingKms = new SyntheticInMemoryKmsAdapter();
  const cipher = new SyntheticEnvelopeCipher(sealingKms);
  const plaintext = syntheticPlaintext();
  const envelope = await cipher.seal(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    plaintext,
  );
  assert.ok(sealingKms.lastWrapInput);
  assert.equal(isZeroized(sealingKms.lastWrapInput), true);
  const opened = await cipher.open(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    envelope,
  );
  assert.ok(sealingKms.lastUnwrappedOutput);
  assert.equal(isZeroized(sealingKms.lastUnwrappedOutput), true);
  opened.zeroize();

  const wrongKms = new SyntheticInMemoryKmsAdapter();
  await assertClosed(
    new SyntheticEnvelopeCipher(wrongKms).open(
      SYNTHETIC_FIELD,
      SYNTHETIC_RESOURCE,
      envelope,
    ),
  );

  const broken = changed(envelope, {
    authenticationTag: mutate(stateOf(envelope).authenticationTag),
  });
  await assertClosed(
    cipher.open(SYNTHETIC_FIELD, SYNTHETIC_RESOURCE, broken),
  );
  assert.ok(sealingKms.lastUnwrappedOutput);
  assert.equal(isZeroized(sealingKms.lastUnwrappedOutput), true);
  assert.ok(observedSensitiveBuffers.length > 0);
  for (const buffer of observedSensitiveBuffers) {
    assert.equal(
      buffer.every((byte) => byte === 0),
      true,
      "every retained plaintext/DEK crypto chunk must be cleared",
    );
  }
  plaintext.zeroize();
  sealingKms.destroy();
  wrongKms.destroy();
});

test("DEK is zeroized when wrapping fails and adapter detail is not propagated", async () => {
  let capturedDek: RedactedBytes | undefined;
  const failingAdapter: KmsAdapter = {
    async wrapDataKey(
      _keyRef,
      _keyVersion,
      plaintextDek,
      _context,
    ): Promise<RedactedBytes> {
      capturedDek = plaintextDek;
      throw new Error("synthetic-adapter-detail-must-not-escape");
    },
    async unwrapDataKey(): Promise<RedactedBytes> {
      throw new Error("synthetic-adapter-detail-must-not-escape");
    },
  };
  const plaintext = syntheticPlaintext();
  await assertClosed(
    new SyntheticEnvelopeCipher(failingAdapter).seal(
      SYNTHETIC_FIELD,
      SYNTHETIC_RESOURCE,
      plaintext,
    ),
  );
  assert.ok(capturedDek);
  assert.equal(isZeroized(capturedDek), true);
  plaintext.zeroize();
});

test("every failure branch has byte-identical String, JSON, inspect, stack, format and console diagnostics", async () => {
  const kms = new SyntheticInMemoryKmsAdapter();
  const cipher = new SyntheticEnvelopeCipher(kms);
  const plaintext = syntheticPlaintext();
  const plaintextHex = hexOf(plaintext);
  const envelope = await cipher.seal(
    SYNTHETIC_FIELD,
    SYNTHETIC_RESOURCE,
    plaintext,
  );
  const binaryHex = envelope.withBinaryParts((parts) =>
    Object.values(parts)
      .map(hexOf)
      .join(""),
  );
  const state = stateOf(envelope);
  const malformedError = await captureClosed(
    () =>
      new VaultEnvelope({
        ...state,
        genericPayload: "synthetic@example.invalid",
      } as EnvelopeState),
  );
  const tagError = await captureClosed(
    cipher.open(
      SYNTHETIC_FIELD,
      SYNTHETIC_RESOURCE,
      changed(envelope, {
        authenticationTag: mutate(state.authenticationTag),
      }),
    ),
  );
  const wrongKms = new SyntheticInMemoryKmsAdapter();
  const wrongKekError = await captureClosed(
    new SyntheticEnvelopeCipher(wrongKms).open(
      SYNTHETIC_FIELD,
      SYNTHETIC_RESOURCE,
      envelope,
    ),
  );
  const disabledContext = VaultOperationContext.fromBinding(validBinding());
  const disabledError = await captureClosed(
    new DisabledKmsAdapter().unwrapDataKey(
      SYNTHETIC_KEY_REF,
      SYNTHETIC_KEY_VERSION,
      state.wrappedDek,
      disabledContext,
    ),
  );
  disabledContext.zeroize();
  const unwrapBeforeOversize = kms.unwrapCalls;
  const oversizeError = await captureClosed(
    cipher.open(
      SYNTHETIC_FIELD,
      SYNTHETIC_RESOURCE,
      changed(envelope, {
        ciphertext: resize(
          state.ciphertext,
          SYNTHETIC_HARNESS_MAX_PLAINTEXT_BYTES + 1,
        ),
      }),
    ),
  );
  assert.equal(kms.unwrapCalls, unwrapBeforeOversize);
  const adapterError = await captureClosed(
    new SyntheticEnvelopeCipher({
      async wrapDataKey(): Promise<RedactedBytes> {
        throw new Error("synthetic-adapter-detail-must-not-escape");
      },
      async unwrapDataKey(): Promise<RedactedBytes> {
        throw new Error("synthetic-adapter-detail-must-not-escape");
      },
    }).seal(SYNTHETIC_FIELD, SYNTHETIC_RESOURCE, plaintext),
  );
  const errors = [
    malformedError,
    tagError,
    wrongKekError,
    disabledError,
    oversizeError,
    adapterError,
  ];
  const diagnostics = errors.map((error) => {
    const writes: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        writes.push(String(chunk));
        callback();
      },
    });
    new Console({ stdout: sink, stderr: sink, colorMode: false }).error(error);
    return {
      string: String(error),
      json: JSON.stringify(error),
      inspect: inspect(error),
      stack: error.stack,
      format: format("%o", error),
      console: writes.join(""),
      ownKeys: Reflect.ownKeys(error).map(String),
    };
  });
  for (const diagnostic of diagnostics.slice(1)) {
    assert.deepEqual(diagnostic, diagnostics[0]);
  }
  const rendered = [
    String(plaintext),
    JSON.stringify(plaintext),
    inspect(plaintext),
    String(envelope),
    JSON.stringify(envelope),
    inspect(envelope),
    format("%o %o", plaintext, envelope),
    ...diagnostics.flatMap((diagnostic) => Object.values(diagnostic).flat()),
  ].join("\n");
  assert.doesNotMatch(rendered, new RegExp(plaintextHex, "i"));
  assert.equal(rendered.includes(binaryHex), false);
  assert.equal(rendered.includes(SYNTHETIC_RESOURCE), false);
  assert.equal(rendered.includes(SYNTHETIC_KEY_REF), false);
  assert.equal(rendered.includes(SYNTHETIC_KEY_VERSION), false);
  assert.equal(rendered.includes("synthetic-adapter-detail"), false);
  assert.equal(rendered.includes("synthetic@example.invalid"), false);
  assert.match(rendered, /REDACTED/);
  assert.match(rendered, new RegExp(FAILURE_MESSAGE));
  plaintext.zeroize();
  kms.destroy();
  wrongKms.destroy();
});

test("test-only harness has no environment, filesystem, subprocess, provider or network capability", () => {
  const source = [
    SyntheticInMemoryKmsAdapter.toString(),
    SyntheticEnvelopeCipher.toString(),
  ].join("\n");
  assert.doesNotMatch(
    source,
    /\b(?:process|env|fetch|axios|http|https|net|tls|dns|fs|child_process|spawn|exec|fork|writeFile|readFile)\b/i,
  );
  const productionContract = readFileSync(
    resolve(
      __dirname,
      "..",
      "..",
      "src",
      "customer-data-vault",
      "customer-data-vault.contract.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    productionContract,
    /from\s+["'](?:node:crypto|crypto|node:fs|fs|node:net|net|node:http|http|node:https|https|node:dns|dns|node:child_process|child_process)["']/,
  );
  assert.doesNotMatch(productionContract, /\bprocess\.env\b/);
  const apiRoot = resolve(__dirname, "..", "..");
  assert.match(
    readFileSync(resolve(apiRoot, "tsconfig.build.json"), "utf8"),
    /"\*\*\/\*\.spec\.ts"/,
  );
  assert.equal(
    readdirSync(resolve(apiRoot, "dist", "customer-data-vault")).some((name) =>
      name.includes(".spec."),
    ),
    false,
  );
});

function filesBelow(root: string): string[] {
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

test("C0.1 adds no persistence, customer/API/OpenAPI/client/Admin/job/event/provider surface", () => {
  const apiRoot = resolve(__dirname, "..", "..");
  const workspaceRoot = resolve(apiRoot, "..", "..");
  const unrelatedReleaseMigrations = new Set([
    "20261014020000_internal_commerce_workflows",
    "20260911010000_checkout_customer_receipt",
    "20260922010000_add_payment_attempt_method",
    "20261014010000_operations_permissions",
  ]);
  assert.equal(
    readdirSync(resolve(apiRoot, "prisma", "migrations"), {
      withFileTypes: true,
      // Separate checkout/payment and permission releases do not add a vault.
    }).filter(
      (entry) => entry.isDirectory() && !unrelatedReleaseMigrations.has(entry.name),
    ).length,
    23,
  );
  const persistenceText = [
    readFileSync(resolve(apiRoot, "prisma", "schema.prisma"), "utf8"),
    ...filesBelow(resolve(apiRoot, "prisma", "migrations")).map((path) =>
      readFileSync(path, "utf8"),
    ),
  ].join("\n");
  assert.doesNotMatch(
    persistenceText,
    /CustomerDataVault|ProtectedCustomerValue|WrappedCustomerDek/i,
  );

  const forbiddenRoots = [
    resolve(apiRoot, "src", "app.module.ts"),
    resolve(apiRoot, "src", "admin"),
    resolve(apiRoot, "prisma", "seed.ts"),
    resolve(workspaceRoot, "apps", "adminka", "src", "app"),
    resolve(workspaceRoot, "packages", "admin-api-client", "src"),
    resolve(workspaceRoot, "tools", "openapi"),
  ];
  const protectedVerifierControlPlane = new Set(
    [
      "tools/openapi/client-admission.spec.mjs",
      "tools/openapi/protected-conformance.mjs",
      "tools/openapi/protected-source-digests.json",
    ].map((path) => resolve(workspaceRoot, path)),
  );
  const exposed = forbiddenRoots
    .flatMap(filesBelow)
    .filter((path) => /\.(?:ts|json|mjs)$/.test(path))
    .filter((path) => !protectedVerifierControlPlane.has(path))
    .filter((path) =>
      /CustomerDataVault|customer-data-vault|customerDataVaultFoundation/i.test(
        readFileSync(path, "utf8"),
      ),
    );
  assert.deepEqual(exposed, []);

  const shippedVaultSources = filesBelow(resolve(apiRoot, "src", "customer-data-vault"))
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".spec.ts"));
  assert.deepEqual(
    shippedVaultSources.map((path) => path.split(/[\\/]/).at(-1)),
    ["customer-data-vault.contract.ts"],
  );
  const shippedSource = shippedVaultSources
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert.doesNotMatch(
    shippedSource,
    /\b(?:Controller|Module|Service|Handler|Event|Outbox|Prisma|Repository)\b/,
  );
  assert.doesNotMatch(
    shippedSource,
    /\b(?:email|phone|address|consent|taxId|externalId|tokeniz|blind.?index|deterministic|search)\b/i,
  );
});

test("every committed API/Admin/deployment flag is literal false and production has no override", () => {
  const apiRoot = resolve(__dirname, "..", "..");
  const workspaceRoot = resolve(apiRoot, "..", "..");
  for (const relative of [
    "apps/api/.env.example",
    "apps/api/.env.production.example",
    "deploy/.env.production.example",
  ]) {
    const source = readFileSync(resolve(workspaceRoot, relative), "utf8");
    assert.match(
      source,
      /^CUSTOMER_DATA_VAULT_FOUNDATION_ENABLED=false$/m,
    );
    assert.doesNotMatch(
      source,
      /^CUSTOMER_DATA_VAULT_FOUNDATION_ENABLED=(?:true|\$\{)/m,
    );
  }
  const compose = readFileSync(
    resolve(workspaceRoot, "compose.production.yml"),
    "utf8",
  );
  assert.equal(
    (
      compose.match(
        /CUSTOMER_DATA_VAULT_FOUNDATION_ENABLED: "false"/g,
      ) ?? []
    ).length,
    2,
  );
  assert.doesNotMatch(
    compose,
    /CUSTOMER_DATA_VAULT_FOUNDATION_ENABLED:\s*\$\{/,
  );
  for (const relative of [
    "apps/adminka/src/environments/environment.ts",
    "apps/adminka/src/environments/environment.development.ts",
  ]) {
    assert.match(
      readFileSync(resolve(workspaceRoot, relative), "utf8"),
      /customerDataVaultFoundationEnabled: false/,
    );
  }
});
