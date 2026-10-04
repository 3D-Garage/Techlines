import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import User from "../models/User.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import { admin } from "../middleware/autMiddleware.js";
import { createCheckoutQuoteHandler } from "../routes/checkoutRoutes.js";
import {
  createPayPalOrderHandler,
  __setPayPalService as __setPaypalRouteService,
} from "../routes/paypalRoutes.js";
import { confirmOrder, __setPayPalService as __setOrderPayPalService } from "../routes/orderRoutes.js";
import { loginUser, registerUser, updateUserProfile } from "../routes/userRoutes.js";
import { getAccessToken, normalizePayPalCapture } from "../services/paypalService.js";

process.env.TOKEN_SECRET = process.env.TOKEN_SECRET || "testsecret";

const PRODUCT_ID = "507f1f77bcf86cd799439011";

const makeRes = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
});

const buildPaypalCapture = () => ({
  id: "CAPTURE_123",
  status: "COMPLETED",
  payer: { payer_id: "payer-123" },
  purchase_units: [
    {
      custom_id: "standard",
      items: [
        {
          sku: PRODUCT_ID,
          name: "Workflow Laptop",
          quantity: 1,
          unit_amount: { currency_code: "HUF", value: "5000" },
        },
      ],
      shipping: {
        address: {
          address_line_1: "Main St. 1",
          admin_area_2: "Budapest",
          postal_code: "1111",
          country_code: "HU",
        },
      },
      amount: { currency_code: "HUF", value: "6490.00" },
      payments: {
        captures: [
          { id: "CAPTURE_123", amount: { currency_code: "HUF", value: "6490.00" }, status: "COMPLETED" },
        ],
      },
    },
  ],
});

const buildPaypalService = () => ({
  createOrder: async ({ total }) => ({ id: "PAYPAL_ORDER_987", total }),
  getOrder: async () => ({
    id: "PAYPAL_ORDER_987",
    payer: { email_address: "alice@example.com" },
    purchase_units: [
      {
        custom_id: "standard",
        items: [
          {
            sku: PRODUCT_ID,
            name: "Workflow Laptop",
            quantity: 1,
            unit_amount: { currency_code: "HUF", value: "5000" },
          },
        ],
        shipping: {
          address: {
            address_line_1: "Main St. 1",
            admin_area_2: "Budapest",
            postal_code: "1111",
            country_code: "HU",
          },
        },
        amount: { currency_code: "HUF", value: "6490.00" },
      },
    ],
  }),
  captureOrder: async () => buildPaypalCapture(),
  normalizePayPalCapture: () => ({
    status: "COMPLETED",
    currency: "HUF",
    value: 6490,
    captureId: "CAPTURE_123",
    payerId: "payer-123",
  }),
});

test("user registration, login and profile update create a valid JWT flow while admin checks block forbidden changes", async () => {
  const seededUser = {
    _id: "u-1",
    name: "Alice",
    email: "alice@example.com",
    isAdmin: false,
    password: "$2a$10$abcdefghijklmnopqrstuv",
    createdAt: new Date().toISOString(),
    matchPasswords: async (rawPassword) => rawPassword === "secret123",
    save: async function () {
      this.name = this.name || "Alice";
      return this;
    },
  };

  User.findOne = async ({ email }) => {
    if (email === "alice@example.com") return seededUser;
    if (email === "new@example.com") return null;
    return null;
  };
  User.create = async ({ name, email, password }) => ({
    _id: "u-2",
    name,
    email,
    password,
    isAdmin: false,
    createdAt: new Date().toISOString(),
  });
  User.findById = async (id) => {
    if (id === "u-1") {
      return seededUser;
    }
    return null;
  };

  const registerRes = makeRes();
  await registerUser(
    { body: { name: "Alice", email: "new@example.com", password: "secret123" } },
    registerRes,
    null,
  );
  assert.equal(registerRes.statusCode, 201);
  assert.ok(registerRes.payload.token);
  const decoded = jwt.verify(registerRes.payload.token, process.env.TOKEN_SECRET);
  assert.equal(decoded.id, "u-2");

  const loginRes = makeRes();
  await loginUser({ body: { email: "alice@example.com", password: "secret123" } }, loginRes, null);
  assert.equal(loginRes.statusCode, 200);
  assert.ok(loginRes.payload.token);

  const updatedUser = {
    ...seededUser,
    name: "Alice Updated",
    save: async function () {
      return { ...this, name: this.name };
    },
  };
  User.findById = async (id) => (id === "u-1" ? updatedUser : null);

  const updateRes = makeRes();
  await updateUserProfile(
    {
      params: { id: "u-1" },
      body: { name: "Alice Updated", password: "newSecret123" },
      user: { _id: "u-1", email: "alice@example.com", isAdmin: false },
    },
    updateRes,
    null,
  );
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.payload.name, "Alice Updated");

  assert.throws(
    () => admin({ user: { _id: "u-3", isAdmin: false } }, makeRes(), () => {}),
    /Not authorized as an admin\./,
  );
});

test("PayPal service token flow and normalized capture payload are valid for the checkout-success path", async () => {
  const originalFetch = globalThis.fetch;
  const originalClientId = process.env.PAYPAL_CLIENT_ID;
  const originalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  process.env.PAYPAL_CLIENT_ID = "client-id";
  process.env.PAYPAL_CLIENT_SECRET = "client-secret";

  globalThis.fetch = async (url) => {
    if (String(url).includes("/oauth2/token")) {
      return {
        ok: true,
        json: async () => ({ access_token: "token-abc" }),
      };
    }

    throw new Error(`Unexpected fetch for ${url}`);
  };

  try {
    const token = await getAccessToken();
    assert.equal(token, "token-abc");

    const normalized = normalizePayPalCapture({
      id: "CAPTURE_123",
      status: "COMPLETED",
      payer: { payer_id: "payer-123" },
      purchase_units: [
        {
          custom_id: "standard",
          items: [
            {
              sku: PRODUCT_ID,
              name: "Workflow Laptop",
              quantity: 1,
              unit_amount: { currency_code: "HUF", value: "5000" },
            },
          ],
          shipping: {
            address: {
              address_line_1: "Main St. 1",
              admin_area_2: "Budapest",
              postal_code: "1111",
              country_code: "HU",
            },
          },
          payments: {
            captures: [
              { id: "CAPTURE_123", amount: { currency_code: "HUF", value: "6490.00" }, status: "COMPLETED" },
            ],
          },
        },
      ],
    });

    assert.equal(normalized.captureId, "CAPTURE_123");
    assert.equal(normalized.status, "COMPLETED");
    assert.equal(normalized.currency, "HUF");
    assert.equal(normalized.value, 6490);
    assert.equal(normalized.shippingMethod, "standard");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) delete process.env.PAYPAL_CLIENT_SECRET;
    else process.env.PAYPAL_CLIENT_SECRET = originalClientSecret;
  }
});
