import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, captureOrder, getOrder } from "../services/paypalService.js";
test("PayPal transport sends persisted idempotency keys, merchant, frozen address and item/shipping breakdown with timeouts", async () => {
  const originalFetch = global.fetch;
  const previous = { client: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET };
  process.env.PAYPAL_CLIENT_ID = "test-client"; process.env.PAYPAL_CLIENT_SECRET = "test-secret";
  const requests = [];
  global.fetch = async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    if (url.endsWith("/oauth2/token")) return { ok: true, json: async () => ({ access_token: "test-token" }) };
    requests.push({ url, options });
    return { ok: true, json: async () => ({ id: "order" }) };
  };
  try {
    await createOrder({ total: 3490, subtotal: 2000, shippingPrice: 1490, referenceId: "checkout", merchantId: "merchant", fullName: "Buyer",
      requestId: "saved-create-key", returnUrl: "http://127.0.0.1:1234/sandbox/return", cancelUrl: "http://127.0.0.1:1234/sandbox/cancel", items: [{ productId: "product", name: "Product", qty: 2, unitPrice: 1000 }],
      shippingAddress: { address: "Webshop utca 1", city: "Budapest", postalCode: "1111", country: "HU" } });
    await getOrder("order"); await captureOrder("order", "saved-capture-key");
    assert.equal(requests[0].options.headers["PayPal-Request-Id"], "saved-create-key");
    assert.equal(requests[2].options.headers["PayPal-Request-Id"], "saved-capture-key");
    const body = JSON.parse(requests[0].options.body);
    const unit = body.purchase_units[0];
    assert.equal(body.payment_source.paypal.experience_context.shipping_preference, "SET_PROVIDED_ADDRESS");
    assert.equal(body.payment_source.paypal.experience_context.return_url, "http://127.0.0.1:1234/sandbox/return");
    assert.equal(body.payment_source.paypal.experience_context.cancel_url, "http://127.0.0.1:1234/sandbox/cancel");
    assert.equal(unit.payee.merchant_id, "merchant");
    assert.equal(unit.shipping.address.address_line_1, "Webshop utca 1");
    assert.equal(unit.amount.breakdown.item_total.value, "2000");
    assert.equal(unit.amount.breakdown.shipping.value, "1490");
    assert.equal(unit.items[0].quantity, "2");
    assert.equal(unit.custom_id, "checkout");
    assert.throws(() => captureOrder("order"), /request ID/);
  } finally {
    global.fetch = originalFetch;
    if (previous.client === undefined) delete process.env.PAYPAL_CLIENT_ID; else process.env.PAYPAL_CLIENT_ID = previous.client;
    if (previous.secret === undefined) delete process.env.PAYPAL_CLIENT_SECRET; else process.env.PAYPAL_CLIENT_SECRET = previous.secret;
  }
});
