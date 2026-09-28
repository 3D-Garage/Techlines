import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import jwt from "jsonwebtoken";

import { createApp } from "../app.js";
import User from "../models/User.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import {
  __setPayPalService as setPayPalRouteService,
  __resetPayPalService as resetPayPalRouteService,
} from "../routes/paypalRoutes.js";
import {
  __setPayPalService as setOrderPayPalService,
  __resetPayPalService as resetOrderPayPalService,
} from "../routes/orderRoutes.js";

process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "security-integration-test-secret";

const USER_ID = "507f1f77bcf86cd799439011";
const OTHER_USER_ID = "507f1f77bcf86cd799439012";
const ADMIN_ID = "507f1f77bcf86cd799439013";
const PRODUCT_ID = "507f1f77bcf86cd799439014";

async function startApp(t) {
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function tokenFor(id, options = { expiresIn: "1h" }) {
  return jwt.sign({ id }, process.env.TOKEN_SECRET, options);
}

function authUser(id = USER_ID, overrides = {}) {
  return {
    _id: id,
    name: "Authenticated User",
    email: "user@example.com",
    isAdmin: false,
    ...overrides,
  };
}

function stubProtectedUsers(t, usersById) {
  const original = User.findById;
  User.findById = (id) => ({
    select: async () => usersById[String(id)] || null,
  });
  t.after(() => {
    User.findById = original;
  });
}

test("security headers and configured CORS origin are returned on real HTTP responses", async (t) => {
  const previousOrigin = process.env.CORS_ORIGIN;
  const previousClientId = process.env.PAYPAL_CLIENT_ID;
  process.env.CORS_ORIGIN = "https://shop.example.test";
  process.env.PAYPAL_CLIENT_ID = "public-client-id";
  t.after(() => {
    if (previousOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previousOrigin;
    if (previousClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = previousClientId;
  });

  const baseUrl = await startApp(t);
  const response = await fetch(`${baseUrl}/api/paypal/client-id`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-xss-protection"), "0");
  assert.equal(response.headers.get("access-control-allow-origin"), "https://shop.example.test");
});

test("protected endpoints reject missing, malformed and expired JWTs without leaking token internals", async (t) => {
  const baseUrl = await startApp(t);
  const expired = tokenFor(USER_ID, { expiresIn: -1 });

  for (const authorization of [undefined, "Bearer not-a-jwt", `Bearer ${expired}`]) {
    const headers = authorization ? { authorization } : {};
    const response = await fetch(`${baseUrl}/api/users`, { headers });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.match(body.message, /not authorized/i);
    assert.doesNotMatch(JSON.stringify(body), /JsonWebTokenError|TokenExpiredError|stack|secret/i);
  }
});

test("valid JWT reaches authorization and admin-only endpoint rejects a normal user", async (t) => {
  const normalUser = authUser();
  stubProtectedUsers(t, { [USER_ID]: normalUser });
  const baseUrl = await startApp(t);

  const response = await fetch(`${baseUrl}/api/users`, {
    headers: { authorization: `Bearer ${tokenFor(USER_ID)}` },
  });

  assert.equal(response.status, 403);
  assert.match((await response.json()).message, /admin/i);
});

test("admin-only endpoint accepts an authenticated admin JWT", async (t) => {
  const adminUser = authUser(ADMIN_ID, { isAdmin: true, email: "admin@example.com" });
  stubProtectedUsers(t, { [ADMIN_ID]: adminUser });

  const originalFind = User.find;
  User.find = () => ({
    select: () => ({
      sort: async () => [{ _id: USER_ID, email: "user@example.com", isAdmin: false }],
    }),
  });
  t.after(() => {
    User.find = originalFind;
  });

  const baseUrl = await startApp(t);
  const response = await fetch(`${baseUrl}/api/users`, {
    headers: { authorization: `Bearer ${tokenFor(ADMIN_ID)}` },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.length, 1);
  assert.equal(body[0].email, "user@example.com");
});

test("should reject profile IDOR when a user tries to update another user", async (t) => {
  const originalFindById = User.findById;
  let targetSaved = false;
  const actor = authUser(USER_ID);
  const target = {
    ...authUser(OTHER_USER_ID, { email: "other@example.com" }),
    save: async function () {
      targetSaved = true;
      return this;
    },
  };

  User.findById = (id) => {
    if (String(id) === USER_ID) {
      return { select: async () => actor };
    }
    if (String(id) === OTHER_USER_ID) {
      return target;
    }
    return null;
  };
  t.after(() => {
    User.findById = originalFindById;
  });

  const baseUrl = await startApp(t);
  const response = await fetch(`${baseUrl}/api/users/profile/${OTHER_USER_ID}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${tokenFor(USER_ID)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "Attacker-controlled name" }),
  });

  assert.equal(response.status, 403);
  assert.equal(targetSaved, false);
});

test("should reject order-history IDOR across users", async (t) => {
  const actor = authUser(USER_ID);
  stubProtectedUsers(t, { [USER_ID]: actor });
  const baseUrl = await startApp(t);

  const response = await fetch(`${baseUrl}/api/users/${OTHER_USER_ID}`, {
    headers: { authorization: `Bearer ${tokenFor(USER_ID)}` },
  });

  assert.equal(response.status, 403);
});

test("successful login returns a verifiable JWT and required login fields are validated", async (t) => {
  const originalFindOne = User.findOne;
  const fakeUser = {
    _id: USER_ID,
    name: "Login User",
    email: "login@example.com",
    isAdmin: false,
    createdAt: new Date().toISOString(),
    matchPasswords: async (password) => password === "correct-password",
  };
  User.findOne = async ({ email }) => (email === fakeUser.email ? fakeUser : null);
  t.after(() => {
    User.findOne = originalFindOne;
  });

  const baseUrl = await startApp(t);
  const success = await fetch(`${baseUrl}/api/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: fakeUser.email, password: "correct-password" }),
  });
  const successBody = await success.json();

  assert.equal(success.status, 200);
  assert.ok(successBody.token);
  assert.equal(jwt.verify(successBody.token, process.env.TOKEN_SECRET).id, USER_ID);

  const missing = await fetch(`${baseUrl}/api/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: fakeUser.email }),
  });
  assert.equal(missing.status, 400);
});

test("duplicate registration and missing registration fields are rejected", async (t) => {
  const originalFindOne = User.findOne;
  User.findOne = async ({ email }) => (email === "duplicate@example.com" ? { _id: USER_ID, email } : null);
  t.after(() => {
    User.findOne = originalFindOne;
  });

  const baseUrl = await startApp(t);
  const duplicate = await fetch(`${baseUrl}/api/users/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Duplicate",
      email: "duplicate@example.com",
      password: "secret123",
    }),
  });
  assert.equal(duplicate.status, 400);

  const missing = await fetch(`${baseUrl}/api/users/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Incomplete", email: "new@example.com" }),
  });
  assert.equal(missing.status, 400);
});

test("NoSQL-style login payload cannot bypass authentication", async (t) => {
  const originalFindOne = User.findOne;
  User.findOne = async ({ email }) => {
    // A secure outcome must never return an account for an operator-shaped credential.
    if (typeof email !== "string") return null;
    return null;
  };
  t.after(() => {
    User.findOne = originalFindOne;
  });

  const baseUrl = await startApp(t);
  const response = await fetch(`${baseUrl}/api/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: { $ne: null }, password: { $ne: null } }),
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.token, undefined);
});

test("login brute-force threshold returns 429 after the configured limit", async (t) => {
  const originalFindOne = User.findOne;
  User.findOne = async () => null;
  t.after(() => {
    User.findOne = originalFindOne;
  });

  const baseUrl = await startApp(t);
  let response;
  for (let attempt = 1; attempt <= 21; attempt += 1) {
    response = await fetch(`${baseUrl}/api/users/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "attacker@example.com", password: `bad-${attempt}` }),
    });
    if (attempt <= 20) assert.equal(response.status, 401, `attempt ${attempt}`);
  }

  assert.equal(response.status, 429);
  assert.match((await response.json()).message, /too many requests/i);
});

test("order creation derives identity and prices from trusted server state", async (t) => {
  const actor = authUser(USER_ID, { name: "Trusted Name", email: "trusted@example.com" });
  stubProtectedUsers(t, { [USER_ID]: actor });

  const originalFindById = Product.findById;
  Product.findById = async () => ({
    _id: PRODUCT_ID,
    name: "Server Product",
    price: 1000,
    stock: 10,
    available: true,
    save: async function () {
      return this;
    },
  });
  t.after(() => {
    Product.findById = originalFindById;
  });

  const originalSave = Order.prototype.save;
  let savedOrder;
  Order.prototype.save = async function () {
    savedOrder = {
      user: String(this.user),
      username: this.username,
      email: this.email,
      orderItems: this.orderItems.map((item) => ({
        name: item.name,
        qty: item.qty,
        price: item.price,
        product_id: String(item.product_id),
      })),
      shippingPrice: this.shippingPrice,
      totalPrice: this.totalPrice,
    };
    return { _id: "order-1", ...savedOrder };
  };
  t.after(() => {
    Order.prototype.save = originalSave;
  });

  const baseUrl = await startApp(t);
  const response = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokenFor(USER_ID)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      user: OTHER_USER_ID,
      username: "Forged Name",
      email: "forged@example.com",
      orderItems: [{ productId: PRODUCT_ID, qty: 1, price: 1, name: "Forged Product" }],
      shippingAddress: {
        address: "Main St. 1",
        city: "Budapest",
        postalCode: "1111",
        country: "HU",
      },
      shippingMethod: "standard",
      paymentMethod: "PayPal",
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.user, USER_ID);
  assert.equal(savedOrder.user, USER_ID);
  assert.equal(savedOrder.username, "Trusted Name");
  assert.equal(savedOrder.email, "trusted@example.com");
  assert.equal(savedOrder.orderItems[0].price, 1000);
  assert.equal(savedOrder.shippingPrice, 1490);
  assert.equal(savedOrder.totalPrice, 2490);
});

test("client-supplied payment confirmation and totals are rejected before order persistence", async (t) => {
  const actor = authUser(USER_ID);
  stubProtectedUsers(t, { [USER_ID]: actor });

  const originalSave = Order.prototype.save;
  let saveCalls = 0;
  Order.prototype.save = async function () {
    saveCalls += 1;
    return this;
  };
  t.after(() => {
    Order.prototype.save = originalSave;
  });

  const baseUrl = await startApp(t);
  for (const injected of [
    { totalPrice: 1 },
    { shippingPrice: 0 },
    { paidAt: new Date().toISOString() },
    { paymentStatus: "COMPLETED" },
    { paypalOrderId: "forged-order" },
    { paypalCaptureId: "forged-capture" },
    { paymentDetails: { orderId: "forged-order" } },
  ]) {
    const response = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokenFor(USER_ID)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        orderItems: [{ productId: PRODUCT_ID, qty: 1 }],
        shippingMethod: "standard",
        ...injected,
      }),
    });
    assert.equal(response.status, 400, JSON.stringify(injected));
  }

  assert.equal(saveCalls, 0);
});

test("PayPal create-order ignores client totals and uses server-calculated HUF amount", async (t) => {
  const actor = authUser(USER_ID);
  stubProtectedUsers(t, { [USER_ID]: actor });

  const originalFindById = Product.findById;
  Product.findById = async () => ({
    _id: PRODUCT_ID,
    name: "Server Product",
    price: 3000,
    stock: 10,
    available: true,
  });
  t.after(() => {
    Product.findById = originalFindById;
  });

  let serviceInput;
  setPayPalRouteService({
    createOrder: async (input) => {
      serviceInput = input;
      return { id: "PAYPAL_ORDER_ID" };
    },
  });
  t.after(() => resetPayPalRouteService());

  const baseUrl = await startApp(t);
  const response = await fetch(`${baseUrl}/api/paypal/create-order`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokenFor(USER_ID)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      items: [{ productId: PRODUCT_ID, qty: 2, price: 1, unitPrice: 1 }],
      shippingMethod: "standard",
      shippingPrice: 0,
      subtotal: 2,
      total: 2,
      currency: "USD",
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.id, "PAYPAL_ORDER_ID");
  assert.equal(serviceInput.total, 7490);
  assert.equal(serviceInput.currency, "HUF");
  assert.equal(serviceInput.items[0].unitPrice, 3000);
});

test("PayPal confirmation rejects malformed IDs and amount mismatch before creating an order", async (t) => {
  const actor = authUser(USER_ID, { email: "payer@example.com" });
  stubProtectedUsers(t, { [USER_ID]: actor });

  const originalFindById = Product.findById;
  Product.findById = async () => ({
    _id: PRODUCT_ID,
    name: "Server Product",
    price: 1000,
    stock: 10,
    available: true,
  });
  t.after(() => {
    Product.findById = originalFindById;
  });

  const originalFindOne = Order.findOne;
  Order.findOne = async () => null;
  t.after(() => {
    Order.findOne = originalFindOne;
  });

  const originalSave = Order.prototype.save;
  let saveCalls = 0;
  Order.prototype.save = async function () {
    saveCalls += 1;
    return this;
  };
  t.after(() => {
    Order.prototype.save = originalSave;
  });

  setOrderPayPalService({
    getOrder: async () => ({
      id: "PAYPAL_ORDER_ID",
      payer: { email_address: "payer@example.com" },
      purchase_units: [{
        custom_id: "standard",
        items: [{
          sku: PRODUCT_ID,
          name: "Server Product",
          quantity: 1,
          unit_amount: { currency_code: "HUF", value: "1000" },
        }],
        shipping: { address: { country_code: "HU" } },
      }],
    }),
    captureOrder: async () => ({
      id: "CAPTURE_ID",
      status: "COMPLETED",
      payer: { payer_id: "payer-id" },
      purchase_units: [{
        payments: {
          captures: [{
            id: "CAPTURE_ID",
            status: "COMPLETED",
            amount: { currency_code: "HUF", value: "1.00" },
          }],
        },
      }],
    }),
    normalizePayPalCapture: () => ({
      status: "COMPLETED",
      currency: "HUF",
      value: 1,
      captureId: "CAPTURE_ID",
      payerId: "payer-id",
    }),
  });
  t.after(() => resetOrderPayPalService());

  const baseUrl = await startApp(t);

  const malformed = await fetch(`${baseUrl}/api/orders/confirm`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokenFor(USER_ID)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ orderID: "   " }),
  });
  assert.equal(malformed.status, 400);

  const mismatch = await fetch(`${baseUrl}/api/orders/confirm`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokenFor(USER_ID)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ orderID: "PAYPAL_ORDER_ID" }),
  });
  assert.equal(mismatch.status, 422);
  assert.match((await mismatch.json()).message, /does not match/i);
  assert.equal(saveCalls, 0);
});
