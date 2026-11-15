import assert from "node:assert/strict";
import test from "node:test";

import { BogProvider } from "./bog.provider";

const KEYS = [
  "CHECKOUT_ENABLED",
  "BOG_PAYMENTS_ENABLED",
  "BOG_HOSTED_PAYMENTS_ENABLED",
  "GOOGLE_PAY_EXTERNAL_ENABLED",
  "APPLE_PAY_EXTERNAL_ENABLED",
  "BOG_CLIENT_ID",
  "BOG_SECRET_KEY",
  "BOG_CALLBACK_URL",
  "BOG_SUCCESS_URL",
  "BOG_FAIL_URL",
  "GOOGLE_PAY_ENVIRONMENT",
  "GOOGLE_PAY_MERCHANT_ID",
  "GOOGLE_PAY_MERCHANT_NAME",
] as const;

const items = [
  {
    productCode: "SKU-1",
    productName: "Tyre",
    quantity: 1,
    unitPrice: 100,
  },
];

async function withBogEnvironment(
  flags: Record<string, string>,
  run: () => Promise<void>,
) {
  const saved = new Map(KEYS.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    for (const key of KEYS) delete process.env[key];
    Object.assign(process.env, {
      CHECKOUT_ENABLED: "true",
      BOG_PAYMENTS_ENABLED: "true",
      BOG_CLIENT_ID: "client",
      BOG_SECRET_KEY: "secret",
      BOG_CALLBACK_URL: "https://api.tyre.ge/payments/bog/callback",
      BOG_SUCCESS_URL: "https://tyre.ge/order/result",
      BOG_FAIL_URL: "https://tyre.ge/order/result",
      GOOGLE_PAY_ENVIRONMENT: "TEST",
      GOOGLE_PAY_MERCHANT_ID: "merchant-id",
      GOOGLE_PAY_MERCHANT_NAME: "tyre.ge",
      ...flags,
    });
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function mockBank(orderResponse: Record<string, unknown>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/protocol/openid-connect/token")) {
      return Response.json({ access_token: "access", expires_in: 300 });
    }
    return Response.json(orderResponse);
  };
  return calls;
}

function captureLogs(bank: BogProvider) {
  const lines: string[] = [];
  Object.defineProperty(bank, "logger", {
    value: {
      log: (message: unknown) => lines.push(String(message)),
      error: (message: unknown) => lines.push(String(message)),
    },
  });
  return lines;
}

test("hosted BOG flow remains the default, allowlisted redirect fallback", async () => {
  await withBogEnvironment({}, async () => {
    const calls = mockBank({
      id: "bog-order",
      _links: { redirect: { href: "https://payment.bog.ge/start" } },
    });
    const result = await new BogProvider().create(
      "66597d03-5293-4d3b-b4ae-8ff820dfb59e",
      "public-order",
      100,
      items,
    );
    assert.deepEqual(result, {
      reference: "bog-order",
      redirect: "https://payment.bog.ge/start",
    });
    const body = JSON.parse(String(calls[1].init?.body));
    assert.equal(body.payment_method, undefined);
    assert.equal(body.purchase_units.total_amount, 100);
  });
});

test("payment provider logs status and attempt ID without response bodies or secrets", async () => {
  await withBogEnvironment({}, async () => {
    let call = 0;
    globalThis.fetch = async () => {
      call++;
      if (call === 1) {
        return Response.json({ access_token: "access", expires_in: 300 });
      }
      return Response.json(
        { error: "do-not-log-bank-response" },
        { status: 422 },
      );
    };
    const bank = new BogProvider();
    const logs = captureLogs(bank);
    const attemptId = "66597d03-5293-4d3b-b4ae-8ff820dfb59e";

    await assert.rejects(
      bank.create(attemptId, "public-order", 100, items),
      /Bank order creation failed/,
    );

    assert.ok(
      logs.includes(
        `payment_provider_failure operation=create_order reason=http_error status=422 attempt_id=${attemptId}`,
      ),
    );
    const rendered = logs.join("\n");
    assert.ok(!rendered.includes("do-not-log-bank-response"));
    assert.ok(!rendered.includes("client"));
    assert.ok(!rendered.includes("secret"));
  });
});

test("payment provider logs OAuth HTTP failures without credential material", async () => {
  await withBogEnvironment({}, async () => {
    globalThis.fetch = async () =>
      Response.json({ error: "do-not-log-oauth-response" }, { status: 401 });
    const bank = new BogProvider();
    const logs = captureLogs(bank);

    await assert.rejects(
      bank.create(
        "66597d03-5293-4d3b-b4ae-8ff820dfb59e",
        "public-order",
        100,
        items,
      ),
      /Bank authentication failed/,
    );

    assert.ok(
      logs.includes(
        "payment_provider_failure operation=oauth reason=http_error status=401",
      ),
    );
    const rendered = logs.join("\n");
    assert.ok(!rendered.includes("do-not-log-oauth-response"));
    assert.ok(!rendered.includes("client"));
    assert.ok(!rendered.includes("secret"));
  });
});

test("external Google Pay forwards the opaque token only to BOG", async () => {
  await withBogEnvironment(
    { GOOGLE_PAY_EXTERNAL_ENABLED: "true" },
    async () => {
      const calls = mockBank({ id: "google-order", status: "completed" });
      const token = "opaque-google-wallet-token";
      const result = await new BogProvider().createExternalGooglePay(
        "ef78e53e-c71f-4b8c-b9f5-d227e87b4bfd",
        "public-order",
        100,
        items,
        token,
      );
      assert.deepEqual(result, {
        reference: "google-order",
        outcome: "completed",
      });
      const body = JSON.parse(String(calls[1].init?.body));
      assert.deepEqual(body.payment_method, ["google_pay"]);
      assert.equal(body.application_type, "web");
      assert.equal(body.config.google_pay.google_pay_token, token);
      assert.ok(!JSON.stringify(result).includes(token));
    },
  );
});

test("external wallet redirects cannot escape the BOG payment origin", async () => {
  await withBogEnvironment(
    { GOOGLE_PAY_EXTERNAL_ENABLED: "true" },
    async () => {
      mockBank({
        id: "google-order",
        status: "processing",
        _links: { redirect: { href: "https://attacker.example/3ds" } },
      });
      await assert.rejects(
        new BogProvider().createExternalGooglePay(
          "ef78e53e-c71f-4b8c-b9f5-d227e87b4bfd",
          "public-order",
          100,
          items,
          "opaque-token",
        ),
        /Invalid bank response/,
      );
    },
  );
});

test("wallet tokens are absent from transport errors", async () => {
  await withBogEnvironment(
    { GOOGLE_PAY_EXTERNAL_ENABLED: "true" },
    async () => {
      let call = 0;
      globalThis.fetch = async () => {
        call++;
        if (call === 1) {
          return Response.json({ access_token: "access", expires_in: 300 });
        }
        throw new Error("network unavailable");
      };
      const token = "do-not-leak-this-wallet-token";
      await assert.rejects(
        new BogProvider().createExternalGooglePay(
          "ef78e53e-c71f-4b8c-b9f5-d227e87b4bfd",
          "public-order",
          100,
          items,
          token,
        ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(!error.message.includes(token));
          assert.match(error.message, /verify status before retrying/);
          return true;
        },
      );
    },
  );
});

test("Apple Pay session and completion use separate idempotency keys", async () => {
  await withBogEnvironment({ APPLE_PAY_EXTERNAL_ENABLED: "true" }, async () => {
    const calls = mockBank({
      id: "apple-order",
      result: { epochTimestamp: 123 },
      _links: {
        accept: {
          href: "https://api.bog.ge/payments/v1/ecommerce/orders/apple-order/payment",
        },
      },
    });
    const bank = new BogProvider();
    const session = await bank.createExternalApplePay(
      "c576d196-596b-412f-a9f4-f70b7becd1ae",
      "public-order",
      100,
      items,
    );
    assert.deepEqual(session, {
      reference: "apple-order",
      sessionJson: '{"epochTimestamp":123}',
    });

    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({ id: "apple-order", status: "completed" });
    };
    const completion = await bank.completeExternalApplePay(
      "apple-order",
      "d36c6d38-3286-4f93-9350-3885bf3b43f8",
      "opaque-apple-wallet-token",
    );
    assert.equal(completion.outcome, "completed");
    const completeCall = calls.at(-1)!;
    assert.equal(
      (completeCall.init?.headers as Record<string, string>)["Idempotency-Key"],
      "d36c6d38-3286-4f93-9350-3885bf3b43f8",
    );
    assert.ok(
      !JSON.stringify(completion).includes("opaque-apple-wallet-token"),
    );
  });
});

test("external wallet methods fail closed until their runtime flag is enabled", async () => {
  await withBogEnvironment({}, async () => {
    await assert.rejects(
      new BogProvider().createExternalGooglePay(
        "ef78e53e-c71f-4b8c-b9f5-d227e87b4bfd",
        "public-order",
        100,
        items,
        "opaque-token",
      ),
      /Google Pay is disabled/,
    );
    await assert.rejects(
      new BogProvider().createExternalApplePay(
        "c576d196-596b-412f-a9f4-f70b7becd1ae",
        "public-order",
        100,
        items,
      ),
      /Apple Pay is disabled/,
    );
  });
});
