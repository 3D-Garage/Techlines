import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import jwt from "jsonwebtoken";
import { createApp } from "../app.js";
import User from "../models/User.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import * as paypalService from "../services/paypalService.js";
import {
  __setPayPalService as setPayPalService,
  __resetPayPalService as resetPayPalService,
} from "../routes/paypalRoutes.js";
import {
  __setPayPalService as setOrderService,
  __resetPayPalService as resetOrderService,
} from "../routes/orderRoutes.js";

process.env.TOKEN_SECRET = "payment-http-regression-test-secret";
const USER_ID = "507f1f77bcf86cd799439011";
const OTHER_USER_ID = "507f1f77bcf86cd799439012";
const PRODUCT_ID = "507f1f77bcf86cd799439014";
const PAYPAL_ORDER_ID = "PAYPAL_ORDER_ID";
const CAPTURE_ID = "CAPTURE_ID";
const shippingAddress = { address: "Main St. 1", city: "Budapest", postalCode: "1111", country: "HU" };

function captureFixture() {
  return {
    id: PAYPAL_ORDER_ID,
    status: "COMPLETED",
    payer: { payer_id: "payer-id", email_address: "user@example.com" },
    purchase_units: [{
      custom_id: "standard",
      items: [{ sku: PRODUCT_ID, name: "Server Product", quantity: "1", unit_amount: { currency_code: "HUF", value: "1000" } }],
      shipping: { address: { address_line_1: shippingAddress.address, admin_area_2: shippingAddress.city, postal_code: shippingAddress.postalCode, country_code: shippingAddress.country } },
      amount: { currency_code: "HUF", value: "2490" },
      payments: { captures: [{ id: CAPTURE_ID, status: "COMPLETED", amount: { currency_code: "HUF", value: "2490" } }] },
    }],
  };
}

function storedOrder(owner = USER_ID, overrides = {}) {
  return {
    _id: "507f1f77bcf86cd799439015",
    user: owner,
    email: owner === USER_ID ? "user@example.com" : "private-customer@example.com",
    shippingAddress: { ...shippingAddress, address: "Private customer address" },
    paypalOrderId: PAYPAL_ORDER_ID,
    paypalCaptureId: CAPTURE_ID,
    paymentStatus: "COMPLETED",
    ...overrides,
  };
}

// Only transport/repository boundaries are replaced. Pricing, capture
// normalization, JWT verification, routing and Mongoose validation stay real.
async function harness(t, { capture = captureFixture(), records = [], payerEmail = "user@example.com" } = {}) {
  const state = { records: [...records], getCalls: 0, captureCalls: 0, createCalls: 0, saveAttempts: 0, inventoryWrites: 0 };
  const product = {
    _id: PRODUCT_ID, name: "Server Product", image: "/images/product.jpg", price: 1000, stock: 10, available: true,
    async save() { state.inventoryWrites++; return this; },
  };
  t.mock.method(User, "findById", (id) => ({ select: async () => String(id) === USER_ID
    ? { _id: USER_ID, name: "Test User", email: "user@example.com", isAdmin: false } : null }));
  t.mock.method(Product, "findById", async (id) => String(id) === PRODUCT_ID ? product : null);
  const matches = (record, query) => Object.entries(query).every(([key, value]) => key === "$or"
    ? value.some((branch) => matches(record, branch)) : String(record[key]) === String(value));
  t.mock.method(Order, "findOne", async (query) => state.records.find((record) => matches(record, query)) || null);
  t.mock.method(Order.prototype, "save", async function () {
    state.saveAttempts++;
    // Never let an invalid paid order appear successfully persisted in QA.
    await this.validate();
    const record = this.toObject();
    if (state.records.some((saved) => saved.paypalOrderId === record.paypalOrderId || saved.paypalCaptureId === record.paypalCaptureId)) {
      throw Object.assign(new Error("Duplicate payment"), { code: 11000 });
    }
    state.records.push(record);
    return this;
  });
  const service = {
    ...paypalService,
    async getOrder() {
      state.getCalls++;
      const order = captureFixture();
      order.status = "APPROVED";
      order.payer.email_address = payerEmail;
      delete order.purchase_units[0].payments;
      return order;
    },
    async captureOrder() { state.captureCalls++; return structuredClone(capture); },
    async createOrder() { state.createCalls++; return { id: PAYPAL_ORDER_ID }; },
  };
  setPayPalService(service);
  setOrderService(service);
  t.after(() => { resetPayPalService(); resetOrderService(); });
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (endpoint, body) => fetch(`${base}${endpoint}`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt.sign({ id: USER_ID }, process.env.TOKEN_SECRET)}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const confirm = () => post("/api/orders/confirm", { orderID: PAYPAL_ORDER_ID });
  return { state, product, post, confirm };
}

test("owned PayPal order replay returns the stored order without payment or stock side effects", async (t) => {
  const existing = storedOrder();
  const h = await harness(t, { records: [existing] });
  const response = await h.confirm();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), existing);
  assert.equal(h.state.getCalls, 0);
  assert.equal(h.state.captureCalls, 0);
  assert.equal(h.state.saveAttempts, 0);
  assert.equal(h.state.inventoryWrites, 0);
});

for (const branch of ["order ID", "capture ID"]) {
  test(`PayPal ${branch} replay cannot disclose another customer's order`, async (t) => {
    const existing = storedOrder(OTHER_USER_ID, branch === "capture ID" ? { paypalOrderId: "OTHER_PAYPAL_ORDER_ID" } : {});
    const h = await harness(t, { records: [existing] });
    const response = await h.confirm();
    const body = await response.json();
    assert.equal(h.state.saveAttempts, 0);
    assert.equal(h.state.inventoryWrites, 0);
    assert.doesNotMatch(JSON.stringify(body), /private-customer@example\.com|Private customer address|507f1f77bcf86cd799439015/);
    assert.ok([403, 404].includes(response.status), `foreign replay must be denied, received ${response.status}`);
    if (branch === "order ID") {
      assert.equal(h.state.getCalls, 0);
      assert.equal(h.state.captureCalls, 0);
    }
  });
}

test("owned PayPal capture replay returns the original order without saving or reducing stock", async (t) => {
  const existing = storedOrder(USER_ID, { paypalOrderId: "PREVIOUS_PAYPAL_ORDER_ID" });
  const h = await harness(t, { records: [existing] });
  const response = await h.confirm();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), existing);
  assert.equal(h.state.saveAttempts, 0);
  assert.equal(h.state.inventoryWrites, 0);
});

test("valid paid confirmation passes the actual order schema and HTTP replay consumes stock only once", async (t) => {
  const h = await harness(t);
  const first = await h.confirm();
  const order = await first.json();
  assert.equal(first.status, 201, JSON.stringify(order));
  assert.equal(order.user, USER_ID);
  assert.equal(order.paypalOrderId, PAYPAL_ORDER_ID);
  assert.equal(order.paypalCaptureId, CAPTURE_ID);
  assert.equal(order.paymentStatus, "COMPLETED");
  assert.equal(order.totalPrice, 2490);
  assert.ok(order.paidAt);
  assert.equal(order.orderItems[0].image, h.product.image);
  const second = await h.confirm();
  assert.equal(second.status, 200);
  assert.equal((await second.json())._id, order._id);
  assert.equal(h.state.records.length, 1);
  assert.equal(h.state.saveAttempts, 1);
  assert.equal(h.state.captureCalls, 1);
  assert.equal(h.state.inventoryWrites, 1);
  assert.equal(h.product.stock, 9);
});

// Nested capture status must be checked even when the order status is COMPLETED.
const invalidCaptures = [
  ["pending capture", 402, (capture) => { capture.purchase_units[0].payments.captures[0].status = "PENDING"; }],
  ["USD capture", 422, (capture) => { capture.purchase_units[0].payments.captures[0].amount.currency_code = "USD"; }],
  ["missing currency", 400, (capture) => { delete capture.purchase_units[0].payments.captures[0].amount.currency_code; }],
  ["missing capture ID", 400, (capture) => { delete capture.purchase_units[0].payments.captures[0].id; }],
  ["missing capture records", 400, (capture) => { delete capture.purchase_units[0].payments; }],
  ["missing purchase units", 400, (capture) => { delete capture.purchase_units; }],
];
for (const endpoint of ["/api/paypal/capture-order", "/api/orders/confirm"]) {
  for (const [label, expectedStatus, mutate] of invalidCaptures) {
    test(`${endpoint} rejects ${label} without persisting an order or changing stock`, async (t) => {
      const capture = captureFixture();
      mutate(capture);
      const h = await harness(t, { capture });
      const response = await h.post(endpoint, { orderID: PAYPAL_ORDER_ID });
      const body = await response.json();
      // Missing evidence must be rejected before even attempting persistence;
      // a later schema error is not a successful payment validation outcome.
      assert.equal(h.state.saveAttempts, 0, "invalid payment evidence reached order.save");
      assert.equal(h.state.inventoryWrites, 0);
      assert.equal(h.state.records.length, 0);
      assert.equal(response.status, expectedStatus, JSON.stringify(body));
      assert.equal(body.id, undefined, "raw upstream capture was exposed as a successful result");
    });
  }
}

test("standalone capture verifies the authenticated owner before making a capture call", async (t) => {
  const h = await harness(t, { payerEmail: "private-customer@example.com" });
  const response = await h.post("/api/paypal/capture-order", { orderID: PAYPAL_ORDER_ID });
  const body = await response.json();
  assert.equal(h.state.captureCalls, 0, "another customer's payment was captured before checking ownership");
  assert.ok([403, 404].includes(response.status));
  assert.equal(body.id, undefined);
  assert.equal(h.state.inventoryWrites, 0);
});

for (const [label, orderID] of [["object", { $ne: null }], ["array", [PAYPAL_ORDER_ID]], ["blank", "   "]]) {
  test(`standalone capture rejects ${label} order IDs before calling PayPal`, async (t) => {
    const h = await harness(t);
    const response = await h.post("/api/paypal/capture-order", { orderID });
    await response.json();
    assert.equal(h.state.captureCalls, 0);
    assert.equal(response.status, 400);
  });
}

for (const endpoint of ["/api/orders", "/api/checkout/quote", "/api/paypal/create-order"]) {
  for (const shippingMethod of ["teleport", { $ne: null }]) {
    test(`${endpoint} rejects invalid shipping ${JSON.stringify(shippingMethod)} before side effects`, async (t) => {
      const h = await harness(t);
      const response = await h.post(endpoint, {
        items: [{ productId: PRODUCT_ID, qty: 1 }],
        orderItems: [{ productId: PRODUCT_ID, qty: 1, image: "/images/product.jpg" }],
        shippingMethod, shippingAddress, paymentMethod: "PayPal",
      });
      await response.json();
      assert.equal(h.state.saveAttempts, 0);
      assert.equal(h.state.inventoryWrites, 0);
      assert.equal(h.state.createCalls, 0);
      assert.equal(response.status, 400);
    });
  }
}

for (const shippingMethod of ["standard", "express"]) {
  for (const paymentMethod of ["CashOnDelivery", "unknown", { $ne: null }]) {
    test(`catalog orders reject ${JSON.stringify(paymentMethod)} with ${shippingMethod} shipping before stock changes`, async (t) => {
      const h = await harness(t);
      const response = await h.post("/api/orders", {
        orderItems: [{ productId: PRODUCT_ID, qty: 1, image: "/images/product.jpg" }],
        shippingMethod, shippingAddress, paymentMethod,
      });
      await response.json();
      assert.equal(h.state.saveAttempts, 0, "unsupported payment method reached persistence");
      assert.equal(h.state.inventoryWrites, 0, "unsupported payment method changed inventory");
      assert.equal(response.status, 400);
    });
  }
}
