import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import { MongoMemoryReplSet, MongoMemoryServer } from "mongodb-memory-server";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import CheckoutAttempt from "../models/CheckoutAttempt.js";
import CheckoutRequest from "../models/CheckoutRequest.js";
import orderRoutes from "../routes/orderRoutes.js";
import paypalRoutes from "../routes/paypalRoutes.js";
import checkoutRoutes from "../routes/checkoutRoutes.js";
import productRoutes from "../routes/productRoutes.js";
import userRoutes from "../routes/userRoutes.js";
import shippingRoutes from "../routes/shippingRoutes.js";
import { __setFoxpostDirectory, createFoxpostDirectory } from "../services/foxpostService.js";
import { errorHandler } from "../middleware/errorMiddleware.js";
import { initializeCheckout, reconcilePending, requireCheckoutReady, __setPayPalService, processCheckout } from "../services/checkoutService.js";

let mongo, server, base, product, owner, other, admin;
let providerOrders, creationKeys, captureKeys, captureCalls, createCalls, mode, createPayloads;
const foxpostPoint = { place_id: 12345, operator_id: "hu123", variant: "FOXPOST Z-BOX", country: "HU", name: "FOXPOST Z-BOX Test", address: "1111 Budapest, Automata utca 2.", street: "Automata utca 2.", city: "Budapest", zip: "1111", service: ["pick up"], load: "normal loaded" };
const foxpostInput = (extra = {}) => ({ shippingMethod: "foxpost", shippingAddress: undefined, foxpostLockerId: "12345", recipientPhone: "06 (30) 123-4567", ...extra });
const foxpostDirectory = (points = [foxpostPoint]) => createFoxpostDirectory({ fetchList: async () => ({ ok: true, json: async () => points }) });
const address = { address: "Webshop utca 1", city: "Budapest", postalCode: "1111", country: "HU" };
const clone = (value) => structuredClone(value);
const fakePayPal = {
  async createOrder(payload) {
    createCalls++;
    createPayloads.push(payload);
    if (creationKeys.has(payload.requestId)) return { id: creationKeys.get(payload.requestId) };
    const id = `PP-${payload.referenceId}`;
    creationKeys.set(payload.requestId, id);
    providerOrders.set(id, { id, intent: "CAPTURE", status: "CREATED", purchase_units: [{
      reference_id: payload.referenceId, custom_id: payload.referenceId,
      payee: { merchant_id: payload.merchantId }, amount: { currency_code: "HUF", value: String(payload.total) },
      shipping: { address: { address_line_1: "Different PayPal address" } },
    }], payer: { email_address: "different-paypal-email@example.com", payer_id: "payer" } });
    if (mode === "lost-create") { mode = "normal"; throw new Error("response lost after create"); }
    return { id };
  },
  async getOrder(id) {
    if (mode === "lookup-timeout") throw new Error("timeout");
    return clone(providerOrders.get(id));
  },
  async captureOrder(id, requestId) {
    captureCalls++;
    if (mode === "capture-timeout") throw new Error("timeout before capture response");
    if (captureKeys.has(requestId)) return clone(providerOrders.get(id));
    captureKeys.set(requestId, id);
    const order = providerOrders.get(id);
    order.status = "COMPLETED";
    order.purchase_units[0].payments = { captures: [{ id: `CAP-${id}`, status: mode === "declined" ? "DECLINED" : mode === "pending" ? "PENDING" : "COMPLETED", amount: { ...order.purchase_units[0].amount } }] };
    if (mode === "lost-response") { mode = "normal"; throw new Error("captured, response lost"); }
    return clone(order);
  },
};
const tokenFor = (user) => jwt.sign({ id: user._id }, process.env.TOKEN_SECRET);
async function api(path, { user = owner, body, method = body ? "POST" : "GET" } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${tokenFor(user)}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const input = (extra = {}) => ({ requestId: "request-123", expectedTotal: 2490, items: [{ productId: String(product._id), qty: 1 }], shippingMethod: "standard", shippingAddress: address, ...extra });
async function create(extra = {}, user = owner) {
  const subtotal = (extra.items || input().items).reduce((sum, item) => sum + item.qty * product.price, 0);
  const expectedTotal = subtotal + (extra.shippingMethod === "express" ? 3990 : subtotal >= 10000 ? 0 : 1490);
  const result = await api("/api/paypal/create-order", { user, body: input({ expectedTotal, ...extra }) });
  assert.ok([200, 202].includes(result.status), JSON.stringify(result));
  return result.data;
}
const approve = (attempt) => { providerOrders.get(attempt.id).status = "APPROVED"; };
const confirm = (attempt, user = owner) => api("/api/orders/confirm", { user, body: { checkoutId: attempt.checkoutId } });
const due = (id) => CheckoutAttempt.updateOne({ _id: id }, { $set: { nextCheckAt: new Date(0) } });
const cancel = (attempt, user = owner) => api(`/api/checkout/${attempt.checkoutId}/cancel`, { user, body: {} });

test("cancelling an unpaid FOXPOST checkout preserves its snapshot and permits new items and a different locker", async () => {
  const attempt = await create(foxpostInput());
  const snapshot = (await CheckoutAttempt.findById(attempt.checkoutId)).snapshot.toObject();
  const cancelled = await cancel(attempt);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.data.status, "FAILED");
  assert.equal(cancelled.data.issue, "CHECKOUT_CANCELLED");
  assert.deepEqual((await CheckoutAttempt.findById(attempt.checkoutId)).snapshot.toObject(), snapshot);
  assert.equal((await Product.findById(product._id)).stock, 3);
  assert.equal(captureCalls, 0);
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await cancel(attempt)).status, 200);
  // An old popup/confirmation cannot charge the abandoned checkout.
  approve(attempt);
  assert.equal((await confirm(attempt)).status, 409);
  const otherProduct = await Product.create({ name: "Product B", image: "/b.png", brand: "Test", category: "Test", description: "Test", stock: 1, price: 2000 });
  __setFoxpostDirectory(foxpostDirectory([{ ...foxpostPoint, place_id: 999, operator_id: "hu999" }]));
  const next = await create(foxpostInput({ requestId: "new-cart-request", items: [{ productId: String(otherProduct._id), qty: 1 }], expectedTotal: 3490, foxpostLockerId: "999" }));
  assert.notEqual(next.checkoutId, attempt.checkoutId);
  assert.equal(next.quote.items[0].name, "Product B");
  assert.equal(next.foxpostLocker.operator_id, "hu999");
});

test("cancellation is owner-only and provider lookup failures preserve a resumable READY payment", async () => {
  const attempt = await create();
  assert.equal((await cancel(attempt, other)).status, 404);
  assert.equal((await cancel(attempt, null)).status, 401);
  mode = "lookup-timeout";
  assert.equal((await cancel(attempt)).status, 503);
  const saved = await CheckoutAttempt.findById(attempt.checkoutId);
  assert.equal(saved.status, "READY");
  assert.equal(saved.lockToken, undefined);
  mode = "normal";
  assert.equal((await cancel(attempt)).data.issue, "CHECKOUT_CANCELLED");
});

for (const status of ["CREATING", "PROCESSING", "REVIEW", "COMPLETED"]) test(`cancellation never abandons ${status} payments`, async () => {
  const attempt = await create();
  await CheckoutAttempt.updateOne({ _id: attempt.checkoutId }, { $set: { status } });
  assert.equal((await cancel(attempt)).status, 409);
  assert.equal((await CheckoutAttempt.findById(attempt.checkoutId)).status, status);
  assert.equal(captureCalls, 0);
});

for (const evidence of ["mismatch", "capture", "unknown-status"]) test(`cancellation retains provider ${evidence} evidence for review`, async () => {
  const attempt = await create();
  const order = providerOrders.get(attempt.id);
  if (evidence === "mismatch") order.purchase_units[0].payee.merchant_id = "different";
  if (evidence === "capture") order.purchase_units[0].payments = { captures: [{ id: "unexpected", status: "PENDING" }] };
  if (evidence === "unknown-status") order.status = "UNKNOWN";
  const result = await cancel(attempt);
  assert.equal(result.status, 409);
  assert.equal(result.data.status, "REVIEW");
  assert.equal(captureCalls, 0);
  assert.equal((await Product.findById(product._id)).stock, 3);
});

test("cancellation lease wins before confirmation and prevents any capture", async () => {
  const attempt = await create(); approve(attempt);
  let finishLookup, lookupStarted;
  const started = new Promise((resolve) => { lookupStarted = resolve; });
  __setPayPalService({ ...fakePayPal, getOrder: async (id) => {
    lookupStarted(); await new Promise((resolve) => { finishLookup = resolve; });
    return fakePayPal.getOrder(id);
  } });
  const cancellation = cancel(attempt);
  await started;
  await confirm(attempt);
  assert.equal(captureCalls, 0);
  finishLookup();
  assert.equal((await cancellation).data.issue, "CHECKOUT_CANCELLED");
  assert.equal((await confirm(attempt)).status, 409);
  assert.equal(captureCalls, 0);
});

test("confirmation lease wins before cancellation and the completed payment remains recoverable", async () => {
  const attempt = await create(); approve(attempt);
  let finishCapture, captureStarted;
  const started = new Promise((resolve) => { captureStarted = resolve; });
  __setPayPalService({ ...fakePayPal, captureOrder: async (...args) => {
    captureStarted(); await new Promise((resolve) => { finishCapture = resolve; });
    return fakePayPal.captureOrder(...args);
  } });
  const confirmation = confirm(attempt);
  await started;
  assert.equal((await cancel(attempt)).status, 409);
  assert.equal((await CheckoutAttempt.findById(attempt.checkoutId)).reservation, "HELD");
  finishCapture();
  assert.equal((await confirmation).status, 200);
  assert.equal((await CheckoutAttempt.findById(attempt.checkoutId)).status, "COMPLETED");
  assert.equal(await Order.countDocuments(), 1);
  assert.equal(captureCalls, 1);
});

test("a worker lease keeps READY cancellation retryable without discarding the payment", async () => {
  const attempt = await create();
  let finishLookup, lookupStarted;
  const started = new Promise((resolve) => { lookupStarted = resolve; });
  __setPayPalService({ ...fakePayPal, getOrder: async (id) => {
    lookupStarted(); await new Promise((resolve) => { finishLookup = resolve; });
    return fakePayPal.getOrder(id);
  } });
  const lookup = processCheckout(attempt.checkoutId, { queryOnly: true });
  await started;
  assert.equal((await cancel(attempt)).status, 409);
  finishLookup(); await lookup;
  __setPayPalService(fakePayPal);
  assert.equal((await cancel(attempt)).data.issue, "CHECKOUT_CANCELLED");
});

for (const shippingMethod of ["standard", "express", "foxpost"]) {
  for (const price of [500, 1500]) test(`${shippingMethod}: changed price ${price} requires acceptance before any checkout or PayPal call`, async () => {
    const original = input(shippingMethod === "foxpost" ? foxpostInput() : { shippingMethod });
    original.expectedTotal = shippingMethod === "express" ? 4990 : 2490;
    await Product.updateOne({ _id: product._id }, { $set: { price } });
    const changed = await api("/api/paypal/create-order", { body: original });
    assert.equal(changed.status, 409);
    assert.equal(changed.data.code, "QUOTE_CHANGED");
    assert.equal(changed.data.creationRejected, true);
    assert.equal(changed.data.quote.total, price + (shippingMethod === "express" ? 3990 : 1490));
    assert.equal(await CheckoutAttempt.countDocuments(), 0);
    assert.equal(createCalls, 0);
    const accepted = await create({ ...original, requestId: "accepted-request", expectedTotal: changed.data.quote.total });
    assert.equal(accepted.total, changed.data.quote.total);
    await Product.updateOne({ _id: product._id }, { $set: { price: 9000 } });
    __setFoxpostDirectory({ getLockers: async () => { throw new Error("must not refresh"); } });
    const retry = await api("/api/paypal/create-order", { body: { ...original, requestId: "accepted-request", expectedTotal: undefined } });
    assert.equal(retry.status, 200);
    assert.equal(retry.data.checkoutId, accepted.checkoutId);
    assert.equal(retry.data.total, changed.data.quote.total);
    assert.equal(createCalls, 1);
  });
}

test("another price change after acceptance requires a fresh acceptance", async () => {
  const first = await api("/api/paypal/create-order", { body: input({ expectedTotal: 2000 }) });
  assert.equal(first.data.quote.total, 2490);
  await Product.updateOne({ _id: product._id }, { $set: { price: 2000 } });
  const second = await api("/api/paypal/create-order", { body: input({ requestId: "second-quote", expectedTotal: first.data.quote.total }) });
  assert.equal(second.status, 409);
  assert.equal(second.data.quote.total, 3490);
  assert.equal(await CheckoutAttempt.countDocuments(), 0);
  assert.equal(createCalls, 0);
});

for (const shippingMethod of ["standard", "express", "foxpost"]) test(`${shippingMethod}: a definitive quote rejection prevents an earlier concurrent request from creating a payment`, async () => {
  const original = input(shippingMethod === "foxpost" ? foxpostInput() : { shippingMethod });
  original.expectedTotal = shippingMethod === "express" ? 4990 : 2490;
  const validate = Order.prototype.validate;
  let resume, entered, pause = true;
  const gate = new Promise((resolve) => { resume = resolve; });
  const validating = new Promise((resolve) => { entered = resolve; });
  Order.prototype.validate = async function (...args) {
    const result = await validate.apply(this, args);
    if (pause) { pause = false; entered(); await gate; }
    return result;
  };
  const pending = api("/api/paypal/create-order", { body: original });
  let rejected;
  try {
    await validating;
    await Product.updateOne({ _id: product._id }, { $set: { price: 1500 } });
    rejected = await api("/api/paypal/create-order", { body: original });
  } finally { resume(); Order.prototype.validate = validate; }
  const earlier = await pending;
  assert.equal(rejected.status, 409);
  assert.equal(rejected.data.code, "QUOTE_CHANGED");
  assert.equal(rejected.data.creationRejected, true);
  assert.equal(earlier.status, 409);
  assert.deepEqual(earlier.data, rejected.data);
  assert.equal(await CheckoutAttempt.countDocuments(), 0);
  assert.equal(createCalls, 0);

  // A lost rejection response and a server restart cannot revive this request.
  await initializeCheckout();
  const replay = await api("/api/paypal/create-order", { body: { ...original, expectedTotal: rejected.data.quote.total } });
  assert.deepEqual(replay, rejected);
  assert.equal(await CheckoutAttempt.countDocuments(), 0);
  assert.equal(createCalls, 0);
  const accepted = await create({ ...original, requestId: "accepted-after-race", expectedTotal: rejected.data.quote.total });
  assert.equal(accepted.total, rejected.data.quote.total);
  assert.equal(createCalls, 1);
});

test("a committed checkout wins over a delayed request that calculated a changed quote", async () => {
  await Product.updateOne({ _id: product._id }, { $set: { price: 2000 } });
  const findById = Product.findById;
  let resume, entered, pause = true;
  const gate = new Promise((resolve) => { resume = resolve; });
  const pricing = new Promise((resolve) => { entered = resolve; });
  Product.findById = async function (...args) {
    const result = await findById.apply(this, args);
    if (pause) { pause = false; entered(); await gate; }
    return result;
  };
  const pending = api("/api/paypal/create-order", { body: input(foxpostInput()) });
  let created;
  try {
    await pricing;
    await Product.updateOne({ _id: product._id }, { $set: { price: 1000 } });
    created = await create(foxpostInput());
  } finally { resume(); Product.findById = findById; }
  const delayed = await pending;
  assert.equal(delayed.status, 200);
  assert.equal(delayed.data.checkoutId, created.checkoutId);
  assert.equal(delayed.data.total, 2490);
  assert.equal(delayed.data.creationRejected, undefined);
  assert.equal(await CheckoutAttempt.countDocuments(), 1);
  assert.equal(await CheckoutRequest.countDocuments({ status: "CREATED" }), 1);
  assert.equal(createCalls, 1);
});

test("concurrent quote rejections persist one decision without a checkout or PayPal call", async () => {
  await Product.updateOne({ _id: product._id }, { $set: { price: 1500 } });
  const results = await Promise.all(Array.from({ length: 3 }, () => api("/api/paypal/create-order", { body: input() })));
  for (const result of results) {
    assert.equal(result.status, 409);
    assert.deepEqual(result, results[0]);
  }
  assert.equal(await CheckoutRequest.countDocuments({ status: "REJECTED" }), 1);
  assert.equal(await CheckoutAttempt.countDocuments(), 0);
  assert.equal(createCalls, 0);
});

test("failed checkout persistence rolls back its request decision and permits a safe retry", async () => {
  const createAttempt = CheckoutAttempt.create;
  CheckoutAttempt.create = async function (_documents, { session }) {
    assert.equal((await CheckoutRequest.findOne({ user: owner._id }).session(session)).status, "CREATED");
    throw new Error("Injected checkout persistence failure");
  };
  let failed;
  try { failed = await api("/api/paypal/create-order", { body: input() }); }
  finally { CheckoutAttempt.create = createAttempt; }
  assert.equal(failed.status, 500);
  assert.equal(failed.data.creationRejected, undefined);
  assert.equal(await CheckoutRequest.countDocuments(), 0);
  assert.equal(await CheckoutAttempt.countDocuments(), 0);
  assert.equal(createCalls, 0);
  const retried = await create();
  assert.equal(retried.status, "READY");
  assert.equal(await CheckoutRequest.countDocuments({ status: "CREATED" }), 1);
  assert.equal(createCalls, 1);
});

for (const expectedTotal of [undefined, null, "2490", 2490.5, 0, -1]) test(`new checkout rejects invalid expectedTotal ${expectedTotal}`, async () => {
  const result = await api("/api/paypal/create-order", { body: input({ expectedTotal }) });
  assert.equal(result.status, 400);
  assert.equal(result.data.creationRejected, true);
  assert.equal(await CheckoutAttempt.countDocuments(), 0);
  assert.equal(createCalls, 0);
});

for (const prefix of ["20", "30", "31", "50", "51", "70"]) test(`FOXPOST ${prefix} mobile prefix validates through the order model`, async () => {
  const attempt = await create(foxpostInput({ recipientPhone: `06 ${prefix} 123 4567` }));
  assert.equal(attempt.recipientPhone, `+36${prefix}1234567`);
  approve(attempt);
  assert.equal((await confirm(attempt)).status, 200);
});

before(async () => {
  process.env.TOKEN_SECRET = "isolated-checkout-test-secret";
  process.env.PAYPAL_CLIENT_ID = "test-client";
  process.env.PAYPAL_CLIENT_SECRET = "test-secret";
  process.env.PAYPAL_MERCHANT_ID = "test-merchant";
  mongo = await MongoMemoryReplSet.create({ binary: { downloadDir: resolve(".test-artifacts/mongodb") }, replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: `checkout_test_${process.pid}`, autoIndex: false });
  await Product.createCollection();
  await User.createCollection();
  await initializeCheckout();
  [owner, other, admin] = await User.create([
    { name: "Owner", email: "owner@example.com", password: "password123" },
    { name: "Other", email: "other@example.com", password: "password123" },
    { name: "Admin", email: "admin@example.com", password: "password123", isAdmin: true },
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/orders", orderRoutes);
  app.use("/api/paypal", paypalRoutes);
  app.use("/api/checkout", checkoutRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/shipping", shippingRoutes);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise((done) => server.once("listening", done));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  __setPayPalService(null);
  __setFoxpostDirectory(null);
  if (server) await new Promise((done) => server.close(done));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
beforeEach(async () => {
  await Promise.all([Product.deleteMany({}), Order.deleteMany({}), CheckoutAttempt.deleteMany({}), CheckoutRequest.deleteMany({})]);
  product = await Product.create({ name: "Server product", image: "/server.png", brand: "Test", category: "Test", description: "Test", stock: 3, price: 1000 });
  providerOrders = new Map(); creationKeys = new Map(); captureKeys = new Map();
  captureCalls = 0; createCalls = 0; mode = "normal";
  __setPayPalService(fakePayPal);
  createPayloads = [];
  __setFoxpostDirectory(foxpostDirectory());
});

test("FOXPOST uses the official locker address in PayPal, snapshot and order despite client address manipulation", async () => {
  const attempt = await create(foxpostInput({ shippingAddress: address, foxpostLocker: { name: "Fake", operator_id: "fake", address: "Fake" } }));
  const officialAddress = { address: foxpostPoint.street, city: "Budapest", postalCode: "1111", country: "HU" };
  assert.deepEqual(attempt.shippingAddress, officialAddress);
  assert.deepEqual(createPayloads[0].shippingAddress.toObject(), officialAddress);
  assert.equal(createPayloads[0].fullName, owner.name);
  assert.equal(attempt.recipientPhone, "+36301234567");
  assert.equal(attempt.foxpostLocker.operator_id, "hu123");
  assert.equal(attempt.recipientEmail, owner.email);
  approve(attempt);
  const paid = await confirm(attempt);
  assert.equal(paid.status, 200);
  assert.deepEqual(paid.data.shippingAddress, officialAddress);
  assert.equal(paid.data.shippingMethod, "foxpost");
  assert.equal(paid.data.foxpostLocker.name, foxpostPoint.name);
  assert.equal(paid.data.foxpostLocker.type, "Z-BOX");
  assert.equal(paid.data.recipientPhone, "+36301234567");
  await confirm(attempt);
  assert.equal(await Order.countDocuments(), 1);
  assert.equal(captureCalls, 1);
});

test("identical FOXPOST retries normalize phone, preserve the snapshot and survive list changes or outages", async () => {
  const attempt = await create(foxpostInput());
  __setFoxpostDirectory({ getLockers: async () => { throw Object.assign(new Error("offline"), { statusCode: 503 }); } });
  const retry = await create(foxpostInput({ recipientPhone: "+36301234567", shippingAddress: address }));
  assert.equal(retry.checkoutId, attempt.checkoutId);
  assert.deepEqual(retry.foxpostLocker, attempt.foxpostLocker);
  assert.equal(createCalls, 1);
  assert.equal((await api(`/api/checkout/${attempt.checkoutId}`)).status, 200);
  for (const extra of [{ recipientPhone: "+36701234567" }, { foxpostLockerId: "99999" }]) {
    assert.equal((await api("/api/paypal/create-order", { body: input(foxpostInput(extra)) })).status, 409);
  }
  __setFoxpostDirectory(foxpostDirectory([{ ...foxpostPoint, load: "overloaded" }]));
  assert.equal((await create(foxpostInput())).checkoutId, attempt.checkoutId);
  approve(attempt);
  assert.equal((await confirm(attempt)).status, 200);
});

test("FOXPOST lost provider creation response resumes from saved snapshot after the directory changes", async () => {
  mode = "lost-create";
  const first = await create(foxpostInput());
  assert.equal(first.status, "CREATING");
  __setFoxpostDirectory(foxpostDirectory([{ ...foxpostPoint, variant: "Packeta Z-Pont" }]));
  const retry = await create(foxpostInput());
  assert.equal(retry.checkoutId, first.checkoutId);
  assert.equal(retry.status, "READY");
  assert.equal(creationKeys.size, 1);
  assert.deepEqual(createPayloads[0].shippingAddress.toObject(), createPayloads[1].shippingAddress.toObject());
});

test("invalid FOXPOST phone and unknown or ineligible points reject creation before PayPal", async () => {
  let requestNumber = 0;
  for (const extra of [{ recipientPhone: "+3611234567" }, { recipientPhone: "" }, { foxpostLockerId: "999" }, { foxpostLockerId: null }]) {
    const result = await api("/api/paypal/create-order", { body: input(foxpostInput({ ...extra, requestId: `invalid-foxpost-${requestNumber++}` })) });
    assert.equal(result.status, 400); assert.equal(result.data.creationRejected, true);
  }
  for (const extra of [{ load: "overloaded" }, { variant: "Packeta Z-Pont" }, { country: "SK" }, { closeDate: "2020-01-01" }, { service: ["dispatch"] }, { operator_id: "" }, { operator_id: "   " }]) {
    __setFoxpostDirectory(foxpostDirectory([
      { ...foxpostPoint, ...extra },
      { ...foxpostPoint, place_id: 999, operator_id: "hu999" },
    ]));
    assert.equal((await api("/api/paypal/create-order", { body: input(foxpostInput({ requestId: `invalid-foxpost-${requestNumber++}` })) })).status, 400);
  }
  assert.equal(createCalls, 0); assert.equal(await CheckoutAttempt.countDocuments(), 0);
});

test("a directory with no eligible FOXPOST points rejects creation with 503 and no side effects", async () => {
  for (const points of [[], [{ ...foxpostPoint, variant: "Packeta Z-Pont" }]]) {
    __setFoxpostDirectory(foxpostDirectory(points));
    assert.equal((await api("/api/shipping/foxpost/lockers", { user: null })).status, 503);
    const result = await api("/api/paypal/create-order", { body: input(foxpostInput()) });
    assert.equal(result.status, 503);
    assert.equal(result.data.creationRejected, true);
  }
  assert.equal(createCalls, 0);
  assert.equal(await CheckoutAttempt.countDocuments(), 0);
  assert.equal((await Product.findById(product._id)).stock, 3);
});

test("directory endpoint filters points; outage rejects only new FOXPOST attempts while other methods and quotes work", async () => {
  __setFoxpostDirectory(foxpostDirectory([foxpostPoint, { ...foxpostPoint, place_id: 999, variant: "Packeta Z-Pont" }]));
  const list = await api("/api/shipping/foxpost/lockers", { user: null });
  assert.equal(list.status, 200); assert.equal(list.data.lockers.length, 1);
  __setFoxpostDirectory(createFoxpostDirectory({ fetchList: async () => { throw new Error("offline"); } }));
  assert.equal((await api("/api/shipping/foxpost/lockers")).status, 503);
  const rejected = await api("/api/paypal/create-order", { body: input(foxpostInput()) });
  assert.equal(rejected.status, 503); assert.equal(rejected.data.creationRejected, true);
  assert.equal(createCalls, 0);
  assert.equal((await api("/api/checkout/quote", { body: { items: input().items, shippingMethod: "foxpost" } })).status, 200);
  assert.equal((await create({ requestId: "standard-after-outage" })).status, "READY");
  assert.equal((await create({ requestId: "express-request", shippingMethod: "express" })).status, "READY");
});

test("legacy active checkout without the new shipping fields resumes and confirms without migration", async () => {
  const attempt = await create();
  await CheckoutRequest.deleteMany({});
  await CheckoutAttempt.collection.updateOne({ _id: new mongoose.Types.ObjectId(attempt.checkoutId) }, { $unset: { "snapshot.shippingMethod": "", "snapshot.recipientPhone": "", "snapshot.foxpostLocker": "" } });
  const retry = await create({ expectedTotal: undefined });
  assert.equal(retry.checkoutId, attempt.checkoutId);
  assert.equal(retry.shippingMethod, "standard");
  assert.equal(createCalls, 1);
  approve(attempt);
  const paid = await confirm(attempt);
  assert.equal(paid.status, 200);
  assert.equal(paid.data.shippingMethod, undefined);
  assert.equal(paid.data.recipientPhone, undefined);
  assert.equal(paid.data.foxpostLocker, undefined);
  assert.deepEqual(paid.data.shippingAddress, address);
});

test("retired public endpoints cannot reserve stock or create a fulfillable order", async () => {
  assert.equal((await api("/api/orders", { user: null, body: input() })).status, 410);
  assert.equal((await api("/api/paypal/capture-order", { user: null, body: { orderID: "external" } })).status, 410);
  const legacy = await Order.create({ user: owner._id, username: owner.name, email: owner.email, orderItems: [{ product_id: product._id, name: product.name, image: product.image, qty: 1, price: 1000 }], shippingAddress: address });
  assert.equal((await api(`/api/orders/${legacy._id}`, { user: admin, method: "PUT", body: {} })).status, 409);
  assert.equal((await Product.findById(product._id)).stock, 3);
  assert.equal(captureCalls, 0);
});
test("real schema validates a paid order with server image and saved webshop address, independent of payer email", async () => {
  const attempt = await create({ total: 1, shippingPrice: 1, items: [{ productId: String(product._id), qty: 1, price: 1 }] });
  assert.equal((await confirm(attempt)).status, 202);
  assert.equal((await Product.findById(product._id)).stock, 3);
  approve(attempt);
  const result = await confirm(attempt);
  assert.equal(result.status, 200);
  assert.equal(result.data.totalPrice, 2490);
  assert.equal(result.data.orderItems[0].image, "/server.png");
  assert.equal(result.data.shippingAddress.address, address.address);
  const saved = await api(`/api/checkout/${attempt.checkoutId}`);
  assert.equal(saved.data.quote.items[0].image, "/server.png");
  assert.equal(saved.data.quote.items[0].unitPrice, 1000);
  assert.equal(saved.data.quote.shippingMethod, "standard");
  await (await Order.findById(result.data._id)).validate();
  assert.equal((await Product.findById(product._id)).stock, 2);
  assert.equal((await api(`/api/orders/${result.data._id}`, { user: admin, method: "PUT", body: {} })).status, 200);
});
test("foreign owners receive 404 on status, confirm, completed retries and order lookup; reconciliation is admin-only", async () => {
  const attempt = await create();
  for (const completed of [false, true]) {
    if (completed) { approve(attempt); await confirm(attempt); }
    assert.equal((await confirm(attempt, other)).status, 404);
    assert.equal((await api(`/api/checkout/${attempt.checkoutId}`, { user: other })).status, 404);
    assert.equal((await api(`/api/checkout/${attempt.checkoutId}/reconcile`, { user: other, body: {} })).status, 403);
    assert.equal((await api("/api/checkout/admin/pending", { user: other })).status, 403);
  }
  const order = await Order.findOne({});
  assert.equal((await api(`/api/orders/${order._id}`, { user: other })).status, 404);
  assert.equal((await api(`/api/users/${owner._id}`, { user: other })).status, 404);
  assert.equal((await create({}, other)).checkoutId === attempt.checkoutId, false);
});
test("duplicate items are aggregated and an identical request survives price changes; changed content conflicts", async () => {
  const items = [{ productId: String(product._id), qty: 1 }, { productId: String(product._id), qty: 1 }];
  const attempt = await create({ items });
  await Product.updateOne({ _id: product._id }, { $set: { price: 8000 } });
  const retry = await create({ items: [{ productId: String(product._id), qty: 2 }] });
  assert.equal(retry.checkoutId, attempt.checkoutId);
  assert.equal(createCalls, 1);
  const conflict = await api("/api/paypal/create-order", { body: input({ items: [{ productId: String(product._id), qty: 3 }] }) });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.creationRejected, undefined);
  approve(attempt);
  const paid = await confirm(attempt);
  assert.equal(paid.data.totalPrice, 3490);
  assert.equal(paid.data.orderItems.length, 1);
  assert.equal(paid.data.orderItems[0].qty, 2);
  assert.equal((await Product.findById(product._id)).stock, 1);
});
test("missing required image and aggregate overstock are rejected before any provider creation", async () => {
  await Product.collection.updateOne({ _id: product._id }, { $unset: { image: "" } });
  const invalid = await api("/api/paypal/create-order", { body: input() });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.creationRejected, true);
  assert.equal(createCalls, 0);
  await Product.updateOne({ _id: product._id }, { $set: { image: "/image.png", stock: 1 } });
  const overstock = await api("/api/paypal/create-order", { body: input({ requestId: "overstock-request", items: [{ productId: String(product._id), qty: 1 }, { productId: String(product._id), qty: 1 }] }) });
  assert.equal(overstock.status, 409);
  assert.equal(overstock.data.creationRejected, true);
  assert.equal(createCalls, 0);
  assert.equal(await CheckoutAttempt.countDocuments(), 0);
});

test("missing and archived products return explicit creation rejection before a checkout exists", async () => {
  const missing = await api("/api/paypal/create-order", { body: input({ items: [{ productId: String(new mongoose.Types.ObjectId()), qty: 1 }] }) });
  assert.equal(missing.status, 404);
  assert.equal(missing.data.creationRejected, true);
  await Product.updateOne({ _id: product._id }, { $set: { archivedAt: new Date() } });
  const archived = await api("/api/paypal/create-order", { body: input({ requestId: "archived-request" }) });
  assert.equal(archived.status, 409);
  assert.equal(archived.data.creationRejected, true);
  assert.equal(createCalls, 0);
  assert.equal(await CheckoutAttempt.countDocuments(), 0);
});
test("two buyers of the last item and parallel confirmations never oversell or double-capture", async () => {
  await Product.updateOne({ _id: product._id }, { $set: { stock: 1 } });
  const a = await create(); const b = await create({}, other);
  approve(a); approve(b);
  await Promise.all([confirm(a), confirm(a), confirm(b, other), confirm(b, other)]);
  assert.equal(await Order.countDocuments(), 1);
  assert.equal((await Product.findById(product._id)).stock, 0);
  assert.equal(captureCalls, 1);
  const winning = await CheckoutAttempt.findOne({ status: "COMPLETED" });
  const winningUser = String(winning.user) === String(owner._id) ? owner : other;
  assert.equal((await confirm({ checkoutId: String(winning._id) }, winningUser)).status, 200);
  assert.equal(captureCalls, 1);
});
test("multi-product reservation failure rolls back every stock change", async () => {
  const second = await Product.create({ name: "Second", image: "/2.png", brand: "Test", category: "Test", description: "Test", stock: 1, price: 1000 });
  const attempt = await create({ items: [{ productId: String(product._id), qty: 1 }, { productId: String(second._id), qty: 1 }] });
  await Product.updateOne({ _id: second._id }, { $set: { stock: 0 } });
  approve(attempt);
  assert.equal((await confirm(attempt)).status, 409);
  assert.equal((await Product.findById(product._id)).stock, 3);
  assert.equal(captureCalls, 0);
});
test("lost create response is recovered using the persisted creation request ID", async () => {
  mode = "lost-create";
  const first = await create();
  assert.equal(first.status, "CREATING");
  const retry = await create();
  assert.equal(retry.checkoutId, first.checkoutId);
  assert.equal(creationKeys.size, 1);
  assert.ok(retry.id);
});
test("lost successful capture response is reconciled by lookup without another capture", async () => {
  const attempt = await create(); approve(attempt); mode = "lost-response";
  assert.equal((await confirm(attempt)).status, 202);
  assert.equal((await Product.findById(product._id)).stock, 2);
  await due(attempt.checkoutId); await reconcilePending();
  assert.equal((await confirm(attempt)).status, 200);
  assert.equal(captureCalls, 1);
  assert.equal(await Order.countDocuments(), 1);
});
test("database failure after successful capture recovers after restart initialization", async () => {
  const attempt = await create(); approve(attempt);
  const save = Order.prototype.save;
  Order.prototype.save = async () => { throw new Error("database write failure"); };
  try { assert.equal((await confirm(attempt)).status, 202); }
  finally { Order.prototype.save = save; }
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await Product.findById(product._id)).stock, 2);
  await due(attempt.checkoutId);
  // A fresh Node process reads only durable MongoDB state and provider evidence.
  const recovery = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import mongoose from 'mongoose';
    import { initializeCheckout, reconcilePending, __setPayPalService } from './server/services/checkoutService.js';
    await mongoose.connect(process.env.CHECKOUT_TEST_URI, { dbName: process.env.CHECKOUT_TEST_DB, autoIndex: false });
    await initializeCheckout();
    __setPayPalService({ getOrder: async () => JSON.parse(process.env.CHECKOUT_TEST_PROVIDER_ORDER), captureOrder: async () => { throw new Error('Recovery must not capture twice'); } });
    await reconcilePending();
    await mongoose.disconnect();
  `], { encoding: "utf8", timeout: 30000, env: { ...process.env, CHECKOUT_TEST_URI: mongo.getUri(), CHECKOUT_TEST_DB: `checkout_test_${process.pid}`, CHECKOUT_TEST_PROVIDER_ORDER: JSON.stringify(providerOrders.get(attempt.id)) } });
  assert.equal(recovery.status, 0, recovery.stderr);
  assert.equal(await Order.countDocuments(), 1);
  assert.equal(captureCalls, 1);
});
test("concurrent creation requests share one checkout and one provider order", async () => {
  const results = await Promise.all([create(), create(), create()]);
  assert.equal(new Set(results.map((result) => result.checkoutId)).size, 1);
  assert.equal(await CheckoutAttempt.countDocuments(), 1);
  assert.equal(await CheckoutRequest.countDocuments({ status: "CREATED" }), 1);
  assert.equal(creationKeys.size, 1);
  assert.equal(createCalls, 1);
});
test("proven decline releases once while timeout and pending captures keep reservations", async () => {
  const declined = await create(); approve(declined); mode = "declined";
  assert.equal((await confirm(declined)).status, 409);
  await confirm(declined); await due(declined.checkoutId); await reconcilePending();
  assert.equal((await Product.findById(product._id)).stock, 3);
  const uncertain = await create({ requestId: "uncertain-123" }); approve(uncertain); mode = "capture-timeout";
  assert.equal((await confirm(uncertain)).status, 202);
  assert.equal((await Product.findById(product._id)).stock, 2);
  mode = "pending"; await confirm(uncertain);
  await confirm(uncertain);
  assert.equal((await Product.findById(product._id)).stock, 2);
  assert.equal(await Order.countDocuments(), 0);
});
test("retry uses the original capture key and stops posting at thirty minutes; REVIEW only queries", async () => {
  const attempt = await create(); approve(attempt); mode = "capture-timeout";
  await confirm(attempt);
  const stored = await CheckoutAttempt.findById(attempt.checkoutId);
  const original = fakePayPal.captureOrder;
  const keys = [];
  fakePayPal.captureOrder = async (id, key) => { keys.push(key); return original(id, key); };
  try {
    await confirm(attempt);
    assert.deepEqual(keys, [stored.captureRequestId]);
    await CheckoutAttempt.updateOne({ _id: stored._id }, { $set: { processingStartedAt: new Date(Date.now() - 31 * 60000) } });
    await confirm(attempt);
    assert.equal((await CheckoutAttempt.findById(stored._id)).status, "REVIEW");
    const calls = captureCalls;
    await due(stored._id); await reconcilePending();
    await api(`/api/checkout/${stored._id}/reconcile`, { user: admin, body: {} });
    assert.equal(captureCalls, calls);
    assert.equal((await Product.findById(product._id)).stock, 2);
  } finally { fakePayPal.captureOrder = original; }
});
test("wrong merchant, currency, amount, order ID and absent provider fields cannot produce paid orders", async () => {
  const mutations = [
    (order) => { order.id = "wrong-id"; },
    (order) => { order.purchase_units[0].payee.merchant_id = "wrong"; },
    (order) => { order.purchase_units[0].amount.currency_code = "USD"; },
    (order) => { order.purchase_units[0].amount.value = "1"; },
    (order) => { delete order.purchase_units[0].payee; },
  ];
  for (let i = 0; i < mutations.length; i++) {
    const attempt = await create({ requestId: `mismatch-${i}` }); approve(attempt);
    mutations[i](providerOrders.get(attempt.id));
    assert.equal((await confirm(attempt)).status, 202);
    assert.equal((await CheckoutAttempt.findById(attempt.checkoutId)).status, "REVIEW");
  }
  assert.equal(captureCalls, 0);
  assert.equal(await Order.countDocuments(), 0);
});
test("expired unstarted quotes never capture; an expired durable lease can be recovered", async () => {
  const expired = await create(); approve(expired);
  await CheckoutAttempt.updateOne({ _id: expired.checkoutId }, { $set: { expiresAt: new Date(0) } });
  assert.equal((await confirm(expired)).status, 409);
  assert.equal(captureCalls, 0);
  const attempt = await create({ requestId: "lease-recovery" }); approve(attempt);
  await CheckoutAttempt.updateOne({ _id: attempt.checkoutId }, { $set: { lockToken: "dead-process", lockUntil: new Date(Date.now() + 60000) } });
  assert.equal((await confirm(attempt)).status, 202);
  await CheckoutAttempt.updateOne({ _id: attempt.checkoutId }, { $set: { lockUntil: new Date(0) } });
  assert.equal((await confirm(attempt)).status, 200);
});
test("admin stale inventory edits conflict and product/order archives preserve safe retries", async () => {
  const attempt = await create(); approve(attempt);
  const paid = await confirm(attempt);
  assert.equal((await api(`/api/products/${product._id}`, { user: admin, method: "PUT", body: { stock: 99, inventoryVersion: 0 } })).status, 409);
  const updated = await api(`/api/products/${product._id}`, { user: admin, method: "PUT", body: { stock: 10, inventoryVersion: 1 } });
  assert.equal(updated.status, 200);
  assert.equal((await api(`/api/products/${product._id}`, { user: admin, method: "DELETE" })).status, 200);
  assert.equal((await api(`/api/orders/${paid.data._id}`, { user: admin, method: "DELETE" })).status, 200);
  assert.equal((await confirm(attempt)).status, 200);
  assert.equal((await create()).checkoutId, attempt.checkoutId);
  assert.ok((await Order.findById(paid.data._id)).archivedAt);
  assert.ok(await Product.findById(product._id));
  assert.equal(captureCalls, 1);
});
test("archive during an uncertain payment preserves reservation and release on later proven decline", async () => {
  const attempt = await create(); approve(attempt); mode = "capture-timeout";
  await confirm(attempt);
  await api(`/api/products/${product._id}`, { user: admin, method: "DELETE" });
  assert.equal((await Product.findById(product._id)).stock, 2);
  const providerOrder = providerOrders.get(attempt.id);
  providerOrder.purchase_units[0].payments = { captures: [{ id: "declined-capture", status: "DECLINED", amount: { ...providerOrder.purchase_units[0].amount } }] };
  assert.equal((await confirm(attempt)).status, 409);
  await confirm(attempt);
  assert.equal((await Product.findById(product._id)).stock, 3);
  assert.ok((await Product.findById(product._id)).archivedAt);
});
test("missing capture currency, amount or status cannot turn a held reservation into a paid order", async () => {
  const attempt = await create(); approve(attempt); mode = "pending";
  await confirm(attempt);
  const order = providerOrders.get(attempt.id);
  const capture = order.purchase_units[0].payments.captures[0];
  capture.status = "COMPLETED";
  delete capture.amount.currency_code;
  await confirm(attempt);
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await Product.findById(product._id)).stock, 2);
  capture.amount.currency_code = "HUF";
  delete capture.status;
  await confirm(attempt);
  assert.equal(await Order.countDocuments(), 0);
});
test("startup collision preflight and incomplete configuration disable payment without changing legacy records", async () => {
  await Order.collection.dropIndex("paypalOrderId_1");
  const duplicates = await Order.collection.insertMany([{ paypalOrderId: "duplicate-legacy" }, { paypalOrderId: "duplicate-legacy" }]);
  try {
    await assert.rejects(initializeCheckout(), /Duplicate payment keys/);
    assert.equal((await api("/api/paypal/create-order", { body: input() })).status, 503);
    assert.equal(await Order.countDocuments({ paypalOrderId: "duplicate-legacy" }), 2);
  } finally {
    await Order.collection.deleteMany({ _id: { $in: Object.values(duplicates.insertedIds) } });
    await initializeCheckout();
  }
  const merchant = process.env.PAYPAL_MERCHANT_ID;
  delete process.env.PAYPAL_MERCHANT_ID;
  try {
    await assert.rejects(initializeCheckout(), /configuration is incomplete/);
    assert.equal((await api("/api/paypal/create-order", { body: input() })).status, 503);
    assert.equal(createCalls, 0);
  } finally { process.env.PAYPAL_MERCHANT_ID = merchant; await initializeCheckout(); }
});
test("a real standalone MongoDB cannot enable checkout", async () => {
  const standalone = await MongoMemoryServer.create({ binary: { downloadDir: resolve(".test-artifacts/mongodb") } });
  try {
    await mongoose.disconnect();
    await mongoose.connect(standalone.getUri(), { dbName: "isolated_standalone_test", autoIndex: false });
    await assert.rejects(initializeCheckout(), /replica set/);
    assert.throws(requireCheckoutReady, { statusCode: 503 });
  } finally {
    await mongoose.disconnect(); await standalone.stop();
    await mongoose.connect(mongo.getUri(), { dbName: `checkout_test_${process.pid}`, autoIndex: false });
    await initializeCheckout();
  }
});
