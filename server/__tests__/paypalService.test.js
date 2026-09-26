import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  captureOrder,
  createOrder,
  getAccessToken,
  getOrder,
} from "../services/paypalService.js";

const DEFAULT_BASE_URL = "https://api-m.sandbox.paypal.com";
const ENV_KEYS = [
  "PAYPAL_BASE_URL",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
];

function response(payload, { status = 200, text } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text === undefined ? JSON.stringify(payload) : text;
    },
  };
}

describe("paypalService", { concurrency: false }, () => {
  let originalFetch;
  let originalEnvironment;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnvironment = new Map(
      ENV_KEYS.map((key) => [
        key,
        Object.prototype.hasOwnProperty.call(process.env, key)
          ? process.env[key]
          : undefined,
      ])
    );

    delete process.env.PAYPAL_BASE_URL;
    process.env.PAYPAL_CLIENT_ID = "client-id";
    process.env.PAYPAL_CLIENT_SECRET = "client-secret";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("createOrder sends trusted order metadata and an idempotency key", async () => {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return response({ access_token: "access-token" });
      return response({ id: "PAYPAL-ORDER-1", status: "CREATED" });
    };

    const result = await createOrder({
      total: 1250,
      currency: "USD",
      referenceId: "checkout-session-1",
      customId: "user-1",
      requestId: "create-checkout-session-1",
    });

    assert.deepEqual(result, { id: "PAYPAL-ORDER-1", status: "CREATED" });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, `${DEFAULT_BASE_URL}/v1/oauth2/token`);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(
      calls[0].options.headers.Authorization,
      `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`
    );

    const orderRequest = calls[1];
    assert.equal(orderRequest.url, `${DEFAULT_BASE_URL}/v2/checkout/orders`);
    assert.equal(orderRequest.options.method, "POST");
    assert.equal(
      orderRequest.options.headers["PayPal-Request-Id"],
      "create-checkout-session-1"
    );
    assert.deepEqual(JSON.parse(orderRequest.options.body), {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: "checkout-session-1",
          custom_id: "user-1",
          amount: { currency_code: "USD", value: "1250" },
        },
      ],
    });
  });

  test("captureOrder POSTs to the encoded order URL with an idempotency key", async () => {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return response({ access_token: "access-token" });
      return response({ id: "CAPTURE-1", status: "COMPLETED" });
    };

    const result = await captureOrder(
      "PAYPAL/ORDER?1",
      "capture-checkout-session-1"
    );

    assert.deepEqual(result, { id: "CAPTURE-1", status: "COMPLETED" });
    assert.equal(calls.length, 2);
    assert.equal(
      calls[1].url,
      `${DEFAULT_BASE_URL}/v2/checkout/orders/PAYPAL%2FORDER%3F1/capture`
    );
    assert.equal(calls[1].options.method, "POST");
    assert.equal(calls[1].options.body, "{}");
    assert.equal(
      calls[1].options.headers["PayPal-Request-Id"],
      "capture-checkout-session-1"
    );
  });

  test("getOrder retrieves an encoded order ID without a capture request", async () => {
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return response({ access_token: "access-token" });
      return response({ id: "PAYPAL/ORDER 1", status: "APPROVED" });
    };

    const result = await getOrder("PAYPAL/ORDER 1");

    assert.deepEqual(result, { id: "PAYPAL/ORDER 1", status: "APPROVED" });
    assert.equal(calls.length, 2);
    assert.equal(
      calls[1].url,
      `${DEFAULT_BASE_URL}/v2/checkout/orders/PAYPAL%2FORDER%201`
    );
    assert.equal(calls[1].options.method, "GET");
    assert.equal(calls[1].options.body, undefined);
    assert.equal(calls[1].options.headers.Authorization, "Bearer access-token");
    assert.equal(calls[1].options.headers["PayPal-Request-Id"], undefined);
  });

  test("reads PAYPAL_BASE_URL at request time and removes a trailing slash", async () => {
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(url);
      if (url.endsWith("/v1/oauth2/token")) {
        return response({ access_token: "access-token" });
      }
      return response({ id: "ORDER-1" });
    };

    process.env.PAYPAL_BASE_URL = "https://paypal-one.example.test/";
    await getOrder("ORDER-1");
    process.env.PAYPAL_BASE_URL = "https://paypal-two.example.test/api/";
    await getOrder("ORDER-2");

    assert.deepEqual(urls, [
      "https://paypal-one.example.test/v1/oauth2/token",
      "https://paypal-one.example.test/v2/checkout/orders/ORDER-1",
      "https://paypal-two.example.test/api/v1/oauth2/token",
      "https://paypal-two.example.test/api/v2/checkout/orders/ORDER-2",
    ]);
  });

  test("rejects invalid identifiers before making a PayPal request", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return response({ access_token: "unexpected" });
    };

    await assert.rejects(
      createOrder({ total: 1, requestId: "" }),
      /A valid PayPal request ID is required/
    );
    await assert.rejects(
      captureOrder("ORDER-1", "x".repeat(39)),
      /A valid PayPal request ID is required/
    );
    await assert.rejects(
      getOrder(""),
      /A PayPal order ID is required/
    );
    assert.equal(fetchCalls, 0);
  });

  test("fails safely when credentials or token data are missing", async () => {
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return response({});
    };

    delete process.env.PAYPAL_CLIENT_SECRET;
    await assert.rejects(getAccessToken(), /Missing PayPal credentials/);
    assert.equal(fetchCalls, 0);

    process.env.PAYPAL_CLIENT_SECRET = "client-secret";
    await assert.rejects(
      getAccessToken(),
      /PayPal authentication returned an invalid response/
    );
    assert.equal(fetchCalls, 1);
  });

  test("sanitizes PayPal HTTP failures and rejects malformed success responses", async () => {
    let requestCount = 0;
    globalThis.fetch = async () => {
      requestCount += 1;
      if (requestCount === 1) return response({ access_token: "access-token" });
      return response(undefined, {
        status: 422,
        text: "provider response containing sensitive diagnostics",
      });
    };

    await assert.rejects(
      createOrder({ total: 10, requestId: "create-safe-failure" }),
      (error) => {
        assert.equal(
          error.message,
          "PayPal order creation failed with status 422"
        );
        assert.equal(error.message.includes("sensitive diagnostics"), false);
        return true;
      }
    );

    requestCount = 0;
    globalThis.fetch = async () => {
      requestCount += 1;
      if (requestCount === 1) return response({ access_token: "access-token" });
      return response(undefined, { text: "not-json" });
    };

    await assert.rejects(
      getOrder("ORDER-1"),
      /PayPal order retrieval returned an invalid response/
    );
  });
});
