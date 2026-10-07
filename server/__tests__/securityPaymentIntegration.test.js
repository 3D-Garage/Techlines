import { before, after, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { resolve } from "node:path";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../app.js";
import User from "../models/User.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import CheckoutAttempt from "../models/CheckoutAttempt.js";
import CheckoutRequest from "../models/CheckoutRequest.js";
import { initializeCheckout, __setPayPalService } from "../services/checkoutService.js";
import { createFoxpostDirectory, __setFoxpostDirectory } from "../services/foxpostService.js";

// Exercise the production Express stack, real JWTs, indexes, transactions and
// schema validation. Only external PayPal/FOXPOST transport is replaced.
const address = { address: "Webshop utca 1", city: "Budapest", postalCode: "1111", country: "HU" };
const point = { place_id: 12345, operator_id: "hu123", variant: "FOXPOST A-BOX", country: "HU", name: "QA locker", address: "1111 Budapest, Automata utca 2.", street: "Automata utca 2.", city: "Budapest", zip: "1111", service: ["pick up"], load: "normal loaded" };
let mongo, server, base, owner, other, admin, product, orders, calls, createKeys, captureKeys, mutateCapture, malformedCreation;
const provider = {
  async createOrder(payload) {
    calls.create.push(structuredClone(payload));
    if (malformedCreation) return {};
    if (createKeys.has(payload.requestId)) return { id: createKeys.get(payload.requestId) };
    const id = `PP-${payload.referenceId}`;
    createKeys.set(payload.requestId, id);
    orders.set(id, {
      id, intent: "CAPTURE", status: "CREATED", payer: { email_address: "different-paypal-email@example.com", payer_id: "payer" },
      purchase_units: [{ reference_id: payload.referenceId, custom_id: payload.referenceId,
        payee: { merchant_id: payload.merchantId }, amount: { currency_code: "HUF", value: String(payload.total) } }],
    });
    return { id };
  },
  async getOrder(id) { calls.get++; return structuredClone(orders.get(id)); },
  async captureOrder(id, key) {
    calls.capture.push({ id, key });
    if (captureKeys.has(key)) return structuredClone(orders.get(id));
    captureKeys.set(key, id);
    const order = structuredClone(orders.get(id));
    order.status = "COMPLETED";
    order.purchase_units[0].payments = { captures: [{ id: `CAP-${id}`, status: "COMPLETED", amount: { ...order.purchase_units[0].amount } }] };
    if (mutateCapture) mutateCapture(order);
    orders.set(id, order);
    return structuredClone(order);
  },
};

before(async () => {
  process.env.TOKEN_SECRET = "qa-checkout-http-secret";
  process.env.PAYPAL_CLIENT_ID = "qa-client";
  process.env.PAYPAL_CLIENT_SECRET = "qa-secret";
  process.env.PAYPAL_MERCHANT_ID = "qa-merchant";
  mongo = await MongoMemoryReplSet.create({ binary: { downloadDir: resolve(".test-artifacts/mongodb") }, replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: `security_payment_${process.pid}`, autoIndex: false });
  await Product.createCollection();
  await User.createCollection();
  await initializeCheckout();
  [owner, other, admin] = await User.create([
    { name: "Trusted buyer", email: "owner@example.com", password: "password123" },
    { name: "Other buyer", email: "other@example.com", password: "password123" },
    { name: "Administrator", email: "admin@example.com", password: "password123", isAdmin: true },
  ]);
});
beforeEach(async () => {
  await Promise.all([Product.deleteMany({}), Order.deleteMany({}), CheckoutAttempt.deleteMany({}), CheckoutRequest.deleteMany({})]);
  product = await Product.create({ name: "Server product", image: "/server-product.png", brand: "QA", category: "QA", description: "QA", price: 1000, stock: 3 });
  orders = new Map(); createKeys = new Map(); captureKeys = new Map();
  calls = { create: [], capture: [], get: 0 }; mutateCapture = null; malformedCreation = false;
  __setPayPalService(provider);
  __setFoxpostDirectory(createFoxpostDirectory({ fetchList: async () => ({ ok: true, json: async () => [point] }) }));
  // New app instances isolate in-memory HTTP limiter state between test cases.
  server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
    server = null;
  }
});
after(async () => {
  __setPayPalService(null);
  __setFoxpostDirectory(null);
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

async function api(path, { user = owner, body, method = body ? "POST" : "GET" } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer ${jwt.sign({ id: String(user._id) }, process.env.TOKEN_SECRET)}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
const input = (extra = {}) => ({ requestId: "qa-request-123", expectedTotal: 2490, items: [{ productId: String(product._id), qty: 1 }], shippingMethod: "standard", shippingAddress: address, ...extra });
async function create(extra = {}) {
  const result = await api("/api/paypal/create-order", { body: input(extra) });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}
const approve = (attempt) => { orders.get(attempt.id).status = "APPROVED"; };
const confirm = (attempt, user = owner) => api("/api/orders/confirm", { user, body: { checkoutId: attempt.checkoutId } });
async function noPaymentEffects() {
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await Product.findById(product._id)).stock, 3);
  assert.equal((await Product.findById(product._id)).inventoryVersion, 0);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.capture.length, 0);
  assert.equal(calls.get, 0);
}

for (const endpoint of ["/api/orders", "/api/paypal/capture-order"]) {
  test(`${endpoint} is retired with 410 even for forged payment fields and malformed provider IDs`, async () => {
    for (const user of [owner, null]) {
      for (const orderID of ["another-customers-paypal-order", { $ne: null }, ["forged"], "   "]) {
        const result = await api(endpoint, { user, body: { ...input(), orderID, user: String(other._id), paymentMethod: "CashOnDelivery",
          totalPrice: 1, shippingPrice: 0, paymentStatus: "COMPLETED", paidAt: new Date().toISOString(), paypalCaptureId: "forged" } });
        assert.equal(result.status, 410);
        assert.equal(result.body.id, undefined);
      }
    }
    await noPaymentEffects();
    assert.equal(await CheckoutAttempt.countDocuments(), 0);
  });
}

test("checkout creation rejects missing authentication before pricing, persistence or provider calls", async () => {
  const result = await api("/api/paypal/create-order", { user: null, body: input() });
  assert.equal(result.status, 401);
  await noPaymentEffects();
  assert.equal(await CheckoutAttempt.countDocuments(), 0);
});

for (const shippingMethod of ["teleport", { $ne: null }]) {
  test(`quote rejects unsupported shipping ${JSON.stringify(shippingMethod)} with controlled 400 before side effects`, async () => {
    const result = await api("/api/checkout/quote", { body: input({ shippingMethod }) });
    await noPaymentEffects();
    assert.equal(await CheckoutAttempt.countDocuments(), 0);
    assert.equal(result.status, 400, JSON.stringify(result.body));
  });
}

for (const [label, override, status] of [
  ["operator product ID", { items: [{ productId: { $ne: null }, qty: 1 }] }, 400],
  ["fractional quantity", { items: [{ qty: 1.5 }] }, 400],
  ["unsupported shipping", { shippingMethod: "teleport" }, 400],
  ["operator shipping", { shippingMethod: { $ne: null } }, 400],
  ["incomplete address", { shippingAddress: { country: "HU" } }, 400],
  ["invalid country", { shippingAddress: { ...address, country: "ZZ" } }, 400],
  ["invalid expected total", { expectedTotal: "2490" }, 400],
  ["missing product", { items: [{ productId: "507f1f77bcf86cd799439099", qty: 1 }] }, 404],
]) {
  test(`new checkout rejects ${label} before creating a provider order or reserving inventory`, async () => {
    const result = await api("/api/paypal/create-order", { body: input(override) });
    assert.equal(result.status, status, JSON.stringify(result.body));
    assert.equal(result.body.creationRejected, true);
    await noPaymentEffects();
    assert.equal(await CheckoutAttempt.countDocuments(), 0);
  });
}

for (const shippingMethod of ["standard", "express", "foxpost"]) {
  test(`${shippingMethod} checkout freezes server identity, prices, HUF and PayPal despite forged client fields`, async () => {
    const expectedTotal = shippingMethod === "express" ? 4990 : 2490;
    const attempt = await create({ shippingMethod, expectedTotal,
      ...(shippingMethod === "foxpost" ? { foxpostLockerId: "12345", recipientPhone: "+36301234567" } : {}),
      user: String(other._id), username: "Forged", email: "forged@example.com", paymentMethod: "CashOnDelivery", paymentStatus: "COMPLETED",
      totalPrice: 1, shippingPrice: 0, subtotal: 1, total: 1, currency: "USD", paypalOrderId: "forged", paypalCaptureId: "forged",
      items: [{ productId: String(product._id), qty: 1, price: 1, name: "Forged", image: "/forged.png" }],
    });
    const stored = await CheckoutAttempt.findById(attempt.checkoutId);
    assert.equal(String(stored.user), String(owner._id));
    assert.equal(stored.snapshot.username, owner.name);
    assert.equal(stored.snapshot.email, owner.email);
    assert.equal(stored.snapshot.paymentMethod, "PayPal");
    assert.equal(stored.snapshot.paymentStatus, "PENDING");
    assert.equal(stored.snapshot.paypalCaptureId, undefined);
    assert.equal(stored.snapshot.orderItems[0].name, product.name);
    assert.equal(stored.snapshot.orderItems[0].image, product.image);
    assert.equal(stored.snapshot.orderItems[0].price, 1000);
    assert.equal(stored.quote.total, expectedTotal);
    assert.equal(stored.quote.currency, "HUF");
    assert.equal(calls.create[0].total, expectedTotal);
    assert.equal(calls.create[0].merchantId, "qa-merchant");
    assert.equal(calls.create[0].fullName, owner.name);
    assert.equal(calls.capture.length, 0);
    assert.equal((await Product.findById(product._id)).stock, 3);
    assert.equal(await Order.countDocuments(), 0);
  });
}

test("a forged displayed total returns QUOTE_CHANGED before payment or reservation", async () => {
  const result = await api("/api/paypal/create-order", { body: input({ expectedTotal: 1 }) });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "QUOTE_CHANGED");
  assert.equal(result.body.quote.total, 2490);
  await noPaymentEffects();
  assert.equal(await CheckoutAttempt.countDocuments(), 0);
});

test("provider create response without an ID stays recoverable and reuses the saved request identity", async () => {
  malformedCreation = true;
  const first = await api("/api/paypal/create-order", { body: input() });
  assert.equal(first.status, 202);
  assert.equal(first.body.status, "CREATING");
  assert.equal(first.body.id, undefined);
  assert.equal(await CheckoutAttempt.countDocuments(), 1);
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await Product.findById(product._id)).stock, 3);
  malformedCreation = false;
  const resumed = await create();
  assert.equal(resumed.checkoutId, first.body.checkoutId);
  assert.equal(calls.create[0].requestId, calls.create[1].requestId);
  assert.equal(await CheckoutAttempt.countDocuments(), 1);
});

test("HTTP concurrent confirmation and owned/archived replays produce one schema-valid order and consume inventory once", async () => {
  const attempt = await create(); approve(attempt);
  const results = await Promise.all(Array.from({ length: 5 }, () => confirm(attempt)));
  assert.ok(results.every((result) => [200, 202].includes(result.status)));
  const paid = await confirm(attempt);
  assert.equal(paid.status, 200);
  assert.equal(paid.body.paymentStatus, "COMPLETED");
  assert.equal(paid.body.orderItems[0].image, product.image);
  assert.equal(paid.body.shippingAddress.address, address.address);
  assert.equal(paid.body.email, owner.email, "PayPal payer email is not the local owner");
  const record = await Order.findById(paid.body._id);
  await record.validate();
  assert.equal(record.totalPrice, 2490);
  await Order.updateOne({ _id: record._id }, { $set: { archivedAt: new Date() } });
  const replay = await confirm(attempt);
  assert.equal(replay.status, 200);
  assert.equal(replay.body._id, paid.body._id);
  assert.equal(await Order.countDocuments(), 1);
  assert.equal(calls.capture.length, 1);
  assert.equal((await Product.findById(product._id)).stock, 2);
  assert.equal((await Product.findById(product._id)).inventoryVersion, 1);
});

test("foreign checkout, provider-ID and completed/archived order replays cannot disclose customer data or capture payments", async () => {
  const attempt = await create(); approve(attempt);
  for (const phase of ["APPROVED", "COMPLETED", "ARCHIVED"]) {
    let paid;
    if (phase !== "APPROVED") paid = (await confirm(attempt)).body;
    if (phase === "ARCHIVED") await Order.updateOne({ _id: paid._id }, { $set: { archivedAt: new Date() } });
    const before = JSON.stringify(calls);
    const requests = [
      [`/api/checkout/${attempt.checkoutId}`, {}],
      ["/api/orders/confirm", { body: { checkoutId: attempt.checkoutId } }],
      [`/api/checkout/${attempt.checkoutId}/cancel`, { body: {} }],
      ["/api/orders/confirm", { body: { orderID: attempt.id, paypalCaptureId: paid?.paypalCaptureId } }],
      ...(paid ? [[`/api/orders/${paid._id}`, {}]] : []),
    ];
    for (const [path, options] of requests) {
      const result = await api(path, { user: other, ...options });
      assert.equal(result.status, 404, `${phase} ${path}`);
      assert.doesNotMatch(JSON.stringify(result.body), /owner@example\.com|Webshop utca|Trusted buyer|server-product/);
      assert.equal(result.body.order, undefined);
    }
    assert.equal(JSON.stringify(calls), before);
  }
  assert.equal(await Order.countDocuments(), 1);
  assert.equal(calls.capture.length, 1);
  assert.equal((await Product.findById(product._id)).stock, 2);
});

for (const [label, checkoutId] of [["operator", { $ne: null }], ["array", ["507f1f77bcf86cd799439011"]], ["blank", "   "], ["missing", undefined]]) {
  test(`confirmation rejects ${label} checkout IDs without touching provider or inventory`, async () => {
    const result = await api("/api/orders/confirm", { body: { checkoutId } });
    assert.equal(result.status, 404);
    await noPaymentEffects();
  });
}

for (const [label, mutate] of [
  ["wrong merchant", (order) => { order.purchase_units[0].payee.merchant_id = "other-merchant"; }],
  ["wrong order ID", (order) => { order.id = "different-order"; }],
  ["USD order", (order) => { order.purchase_units[0].amount.currency_code = "USD"; }],
  ["wrong order amount", (order) => { order.purchase_units[0].amount.value = "1"; }],
  ["wrong checkout reference", (order) => { order.purchase_units[0].custom_id = "another-checkout"; }],
]) {
  test(`${label} provider evidence goes to REVIEW before reservation or capture`, async () => {
    const attempt = await create(); approve(attempt); mutate(orders.get(attempt.id));
    const result = await confirm(attempt);
    assert.equal(result.status, 202);
    assert.equal(result.body.status, "REVIEW");
    assert.equal(await Order.countDocuments(), 0);
    assert.equal(calls.capture.length, 0);
    assert.equal((await Product.findById(product._id)).stock, 3);
  });
}

for (const [label, mutate] of [
  ["pending capture", (order) => { order.purchase_units[0].payments.captures[0].status = "PENDING"; }],
  ["USD capture", (order) => { order.purchase_units[0].payments.captures[0].amount.currency_code = "USD"; }],
  ["wrong capture amount", (order) => { order.purchase_units[0].payments.captures[0].amount.value = "1"; }],
  ["missing currency", (order) => { delete order.purchase_units[0].payments.captures[0].amount.currency_code; }],
  ["missing capture ID", (order) => { delete order.purchase_units[0].payments.captures[0].id; }],
  ["missing capture status", (order) => { delete order.purchase_units[0].payments.captures[0].status; }],
  ["missing capture records", (order) => { delete order.purchase_units[0].payments; }],
  ["missing purchase units", (order) => { delete order.purchase_units; }],
]) {
  test(`${label} cannot produce a paid order and preserves the uncertain inventory reservation`, async () => {
    const attempt = await create(); approve(attempt); mutateCapture = mutate;
    const result = await confirm(attempt);
    assert.equal(result.status, 202);
    assert.equal(await Order.countDocuments(), 0);
    assert.equal(calls.capture.length, 1);
    assert.equal((await CheckoutAttempt.findById(attempt.checkoutId)).reservation, "HELD");
    assert.equal((await Product.findById(product._id)).stock, 2);
  });
}

test("admin reconciliation is query-only and ordinary users cannot initiate it", async () => {
  const attempt = await create(); approve(attempt);
  assert.equal((await api(`/api/checkout/${attempt.checkoutId}/reconcile`, { body: {} })).status, 403);
  assert.equal((await api(`/api/checkout/${attempt.checkoutId}/reconcile`, { user: admin, body: {} })).status, 200);
  assert.equal(calls.capture.length, 0);
  assert.equal((await Product.findById(product._id)).stock, 3);
  assert.equal(await Order.countDocuments(), 0);
});

test("the extracted production app still mounts the FOXPOST directory route", async () => {
  const result = await api("/api/shipping/foxpost/lockers", { user: null });
  assert.equal(result.status, 200);
  assert.equal(result.body.lockers[0].place_id, "12345");
  assert.equal(result.body.lockers[0].operator_id, "hu123");
});
