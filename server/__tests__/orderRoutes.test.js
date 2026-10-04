import { test } from "node:test";
import assert from "node:assert/strict";
import Order from "../models/Order.js";
import { createOrder, confirmOrder, setDelivered } from "../routes/orderRoutes.js";
import { normalizeCheckoutInput, verifiedCapture } from "../services/checkoutService.js";
import { normalizePayPalCapture } from "../services/paypalService.js";
const res = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.payload = data; return this; } });
test("unpaid order creation is retired for every payload", () => {
  for (const body of [{}, { paymentStatus: "COMPLETED" }, { orderItems: [{ qty: 1 }] }]) {
    const response = res();
    createOrder({ body }, response);
    assert.equal(response.statusCode, 410);
  }
});
test("confirmation requires an authenticated owner and a local checkout ID", async () => {
  await assert.rejects(confirmOrder({ user: null, body: {} }, res(), null), { statusCode: 401 });
  await assert.rejects(confirmOrder({ user: { _id: "owner" }, body: { orderID: "foreign-paypal" } }, res(), null), { statusCode: 404 });
});
test("legacy unpaid orders cannot be delivered", async () => {
  const find = Order.findById;
  Order.findById = async () => ({ paymentStatus: "PENDING" });
  try {
    const response = res();
    await assert.rejects(setDelivered({ params: { id: "order" } }, response, null), /verified paid/);
    assert.equal(response.statusCode, 409);
  } finally { Order.findById = find; }
});
test("checkout validates country, postal code, quantities and request key", () => {
  const body = { requestId: "request123", items: [{ productId: "507f1f77bcf86cd799439011", qty: 1 }], shippingMethod: "standard", shippingAddress: { address: "Main 1", city: "Budapest", postalCode: "1111", country: "hu" } };
  assert.equal(normalizeCheckoutInput(body).shippingAddress.country, "HU");
  assert.throws(() => normalizeCheckoutInput({ ...body, requestId: {} }));
  assert.throws(() => normalizeCheckoutInput({ ...body, shippingAddress: { ...body.shippingAddress, country: "ZZ" } }));
  assert.throws(() => normalizeCheckoutInput({ ...body, shippingAddress: { ...body.shippingAddress, postalCode: "bad" } }));
});
test("missing capture fields have no successful currency or status defaults", () => {
  const capture = normalizePayPalCapture({ id: "order", status: "COMPLETED", amount: { value: "1000" } });
  assert.equal(capture.currency, undefined);
  assert.equal(capture.status, undefined);
  assert.equal(capture.captureId, undefined);
  assert.ok(Number.isNaN(capture.value));
  assert.equal(verifiedCapture({ paypalOrderId: "order" }, { id: "order" }), null);
});
