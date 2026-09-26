import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import { confirmOrder, createOrder, __resetPayPalService, __setPayPalService } from "../routes/orderRoutes.js";

const PRODUCT_ID = "507f1f77bcf86cd799439011";
const DEFAULT_PRODUCT = {
  _id: PRODUCT_ID,
  name: "Server Product",
  price: 1000,
  stock: 10,
  available: true,
};

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

const buildPayPalCapture = (overrides = {}) => ({
  id: "CAPTURE_ID",
  status: "COMPLETED",
  payer: { payer_id: "payer-123" },
  purchase_units: [
    {
      custom_id: "standard",
      items: [
        {
          sku: PRODUCT_ID,
          name: "Server Product",
          quantity: 1,
          unit_amount: { currency_code: "HUF", value: "1000" },
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
      amount: { currency_code: "HUF", value: "2490.00" },
      payments: {
        captures: [{ id: "CAPTURE_ID", amount: { currency_code: "HUF", value: "2490.00" }, status: "COMPLETED" }],
      },
    },
  ],
  ...overrides,
});

const buildPayPalService = (overrides = {}) => ({
  getOrder: async () => ({
    id: "PAYPAL_ORDER_ID",
    payer: { email_address: "good@example.com" },
    purchase_units: [
      {
        custom_id: "standard",
        items: [
          {
            sku: PRODUCT_ID,
            name: "Server Product",
            quantity: 1,
            unit_amount: { currency_code: "HUF", value: "1000" },
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
        amount: { currency_code: "HUF", value: "2490.00" },
      },
    ],
  }),
  captureOrder: async () => buildPayPalCapture(),
  normalizePayPalCapture: () => ({
    status: "COMPLETED",
    currency: "HUF",
    value: 2490,
    captureId: "CAPTURE_ID",
    payerId: "payer-123",
  }),
  ...overrides,
});

test("createOrder rejects client-paid payloads before saving a local order", async () => {
  Product.findById = async () => DEFAULT_PRODUCT;
  const req = {
    body: {
      orderItems: [{ productId: PRODUCT_ID, qty: 1 }],
      shippingMethod: "standard",
      paymentDetails: { orderId: "po-1" },
    },
    user: { _id: PRODUCT_ID, name: "Good", email: "good@example.com" },
  };
  const res = makeRes();

  await assert.rejects(() => createOrder(req, res, null), /Paid orders must be confirmed via \/api\/orders\/confirm\./);
  assert.equal(res.statusCode, 400);
});

test("confirmOrder verifies capture and creates a paid order once", async () => {
  Product.findById = async () => DEFAULT_PRODUCT;
  Product.findOneAndUpdate = async () => ({ ...DEFAULT_PRODUCT, stock: 9 });
  Order.findOne = async (query) => {
    if (query?.paypalOrderId === "PAYPAL_ORDER_ID") return null;
    if (query?.paypalCaptureId === "CAPTURE_ID") return null;
    return null;
  };

  let savedOrder = null;
  const originalSave = Order.prototype.save;
  Order.prototype.save = async function () {
    savedOrder = {
      _id: "order-123",
      paypalOrderId: this.paypalOrderId,
      paypalCaptureId: this.paypalCaptureId,
      totalPrice: this.totalPrice,
      shippingPrice: this.shippingPrice,
      paymentStatus: this.paymentStatus,
      paidAt: this.paidAt,
    };
    return savedOrder;
  };

  __setPayPalService(buildPayPalService());

  try {
    const req = {
      body: { orderID: "PAYPAL_ORDER_ID" },
      user: { _id: PRODUCT_ID, name: "Good", email: "good@example.com" },
    };
    const res = makeRes();

    await confirmOrder(req, res, null);

    assert.equal(res.statusCode, 201);
    assert.equal(savedOrder.paypalOrderId, "PAYPAL_ORDER_ID");
    assert.equal(savedOrder.paypalCaptureId, "CAPTURE_ID");
    assert.equal(savedOrder.totalPrice, 2490);
    assert.equal(savedOrder.paymentStatus, "COMPLETED");
  } finally {
    Order.prototype.save = originalSave;
    __resetPayPalService();
  }
});

test("confirmOrder rejects missing or invalid PayPal order ID", async () => {
  const req = { body: { orderID: "   " }, user: { _id: PRODUCT_ID, email: "good@example.com" } };
  const res = makeRes();

  await assert.rejects(() => confirmOrder(req, res, null), /Missing or invalid PayPal order ID\./);
  assert.equal(res.statusCode, 400);
});

test("confirmOrder rejects unauthenticated requests", async () => {
  const req = { body: { orderID: "PAYPAL_ORDER_ID" }, user: null };
  const res = makeRes();

  await assert.rejects(() => confirmOrder(req, res, null), /Not authorized, no user\./);
  assert.equal(res.statusCode, 401);
});

test("confirmOrder rejects payment that is not completed", async () => {
  Product.findById = async () => DEFAULT_PRODUCT;
  Product.findOneAndUpdate = async () => ({ ...DEFAULT_PRODUCT, stock: 9 });
  Order.findOne = async () => null;
  __setPayPalService(
    buildPayPalService({
      normalizePayPalCapture: () => ({ status: "PENDING", currency: "HUF", value: 2490, captureId: "CAPTURE_ID", payerId: "payer-123" }),
    }),
  );

  const req = { body: { orderID: "PAYPAL_ORDER_ID" }, user: { _id: PRODUCT_ID, name: "Good", email: "good@example.com" } };
  const res = makeRes();

  await assert.rejects(() => confirmOrder(req, res, null), /PayPal payment is not completed\./);
  assert.equal(res.statusCode, 402);
  __resetPayPalService();
});

test("confirmOrder rejects non-HUF currency", async () => {
  Product.findById = async () => DEFAULT_PRODUCT;
  Product.findOneAndUpdate = async () => ({ ...DEFAULT_PRODUCT, stock: 9 });
  Order.findOne = async () => null;
  __setPayPalService(
    buildPayPalService({
      normalizePayPalCapture: () => ({ status: "COMPLETED", currency: "USD", value: 2490, captureId: "CAPTURE_ID", payerId: "payer-123" }),
    }),
  );

  const req = { body: { orderID: "PAYPAL_ORDER_ID" }, user: { _id: PRODUCT_ID, name: "Good", email: "good@example.com" } };
  const res = makeRes();

  await assert.rejects(() => confirmOrder(req, res, null), /PayPal captured currency must be HUF\./);
  assert.equal(res.statusCode, 422);
  __resetPayPalService();
});

test("confirmOrder rejects captured amount mismatch against server total", async () => {
  Product.findById = async () => DEFAULT_PRODUCT;
  Product.findOneAndUpdate = async () => ({ ...DEFAULT_PRODUCT, stock: 9 });
  Order.findOne = async () => null;
  __setPayPalService(
    buildPayPalService({
      normalizePayPalCapture: () => ({ status: "COMPLETED", currency: "HUF", value: 1234, captureId: "CAPTURE_ID", payerId: "payer-123" }),
    }),
  );

  const req = { body: { orderID: "PAYPAL_ORDER_ID" }, user: { _id: PRODUCT_ID, name: "Good", email: "good@example.com" } };
  const res = makeRes();

  await assert.rejects(() => confirmOrder(req, res, null), /Captured amount does not match the server-calculated total\./);
  assert.equal(res.statusCode, 422);
  __resetPayPalService();
});

test("confirmOrder rejects PayPal lookup failures", async () => {
  __setPayPalService({
    getOrder: async () => {
      throw new Error("PayPal order lookup failed");
    },
    captureOrder: async () => buildPayPalCapture(),
    normalizePayPalCapture: () => ({ status: "COMPLETED", currency: "HUF", value: 2490, captureId: "CAPTURE_ID", payerId: "payer-123" }),
  });

  const req = { body: { orderID: "PAYPAL_ORDER_ID" }, user: { _id: PRODUCT_ID, name: "Good", email: "good@example.com" } };
  const res = makeRes();

  await assert.rejects(() => confirmOrder(req, res, null), /Unable to verify PayPal order\.|PayPal order lookup failed/);
  assert.equal(res.statusCode, 400);
  __resetPayPalService();
});

test("confirmOrder returns the existing order when the PayPal order ID already exists", async () => {
  const existing = { _id: "existing-order", paypalOrderId: "PAYPAL_ORDER_ID" };
  Order.findOne = async (query) => (query?.paypalOrderId === "PAYPAL_ORDER_ID" ? existing : null);
  const req = { body: { orderID: "PAYPAL_ORDER_ID" }, user: { _id: PRODUCT_ID, email: "good@example.com" } };
  const res = makeRes();

  await confirmOrder(req, res, null);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload, existing);
});

test("confirmOrder returns the existing order when the PayPal capture ID already exists", async () => {
  Product.findById = async () => DEFAULT_PRODUCT;
  Product.findOneAndUpdate = async () => ({ ...DEFAULT_PRODUCT, stock: 9 });
  const existing = { _id: "existing-capture", paypalCaptureId: "CAPTURE_ID" };
  Order.findOne = async (query) => {
    if (query?.paypalOrderId === "PAYPAL_ORDER_ID") return null;
    if (query?.paypalCaptureId === "CAPTURE_ID") return existing;
    return null;
  };
  __setPayPalService(buildPayPalService());

  const req = { body: { orderID: "PAYPAL_ORDER_ID" }, user: { _id: PRODUCT_ID, name: "Good", email: "good@example.com" } };
  const res = makeRes();

  await confirmOrder(req, res, null);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload, existing);
  __resetPayPalService();
});

test("confirmOrder is idempotent for repeated confirmation requests", async () => {
  Product.findById = async () => DEFAULT_PRODUCT;
  Product.findOneAndUpdate = async () => ({ ...DEFAULT_PRODUCT, stock: 9 });
  let saveCalls = 0;
  const originalSave = Order.prototype.save;
  Order.prototype.save = async function () {
    saveCalls += 1;
    return { _id: "order-duplicate", paypalOrderId: this.paypalOrderId, paypalCaptureId: this.paypalCaptureId };
  };

  let existingOrder = null;
  Order.findOne = async (query) => {
    if (query?.paypalOrderId === "PAYPAL_ORDER_ID" && existingOrder) return existingOrder;
    if (query?.paypalCaptureId === "CAPTURE_ID" && existingOrder) return existingOrder;
    return null;
  };

  __setPayPalService(buildPayPalService());

  try {
    const user = { _id: PRODUCT_ID, name: "Good", email: "good@example.com" };
    const firstRes = makeRes();
    const secondRes = makeRes();

    await confirmOrder({ body: { orderID: "PAYPAL_ORDER_ID" }, user }, firstRes, null);
    existingOrder = { _id: "order-duplicate", paypalOrderId: "PAYPAL_ORDER_ID", paypalCaptureId: "CAPTURE_ID" };
    await confirmOrder({ body: { orderID: "PAYPAL_ORDER_ID" }, user }, secondRes, null);

    assert.equal(firstRes.statusCode, 201);
    assert.equal(secondRes.statusCode, 200);
    assert.equal(saveCalls, 1);
  } finally {
    Order.prototype.save = originalSave;
    __resetPayPalService();
  }
});

test("confirmOrder does not decrement stock twice for repeated confirmation", async () => {
  const originalReadyState = Object.getOwnPropertyDescriptor(mongoose.connection, "readyState");
  const originalStartSession = mongoose.startSession;
  Object.defineProperty(mongoose.connection, "readyState", { value: 1, configurable: true });
  mongoose.startSession = async () => ({
    withTransaction: async (callback) => {
      await callback();
    },
    endSession() {},
  });

  Product.findById = async () => DEFAULT_PRODUCT;
  let decrementCount = 0;
  Product.findOneAndUpdate = async () => {
    decrementCount += 1;
    return { ...DEFAULT_PRODUCT, stock: 9 };
  };

  let existingOrder = null;
  Order.findOne = async (query) => {
    if (query?.paypalOrderId === "PAYPAL_ORDER_ID" && existingOrder) return existingOrder;
    if (query?.paypalCaptureId === "CAPTURE_ID" && existingOrder) return existingOrder;
    return null;
  };

  const originalSave = Order.prototype.save;
  Order.prototype.save = async function () {
    return { _id: "order-duplicate", paypalOrderId: this.paypalOrderId, paypalCaptureId: this.paypalCaptureId };
  };
  __setPayPalService(buildPayPalService());

  try {
    const user = { _id: PRODUCT_ID, name: "Good", email: "good@example.com" };
    const firstRes = makeRes();
    const secondRes = makeRes();

    await confirmOrder({ body: { orderID: "PAYPAL_ORDER_ID" }, user }, firstRes, null);
    existingOrder = { _id: "order-duplicate", paypalOrderId: "PAYPAL_ORDER_ID", paypalCaptureId: "CAPTURE_ID" };
    await confirmOrder({ body: { orderID: "PAYPAL_ORDER_ID" }, user }, secondRes, null);

    assert.equal(decrementCount, 1);
    assert.equal(secondRes.statusCode, 200);
  } finally {
    if (originalReadyState) {
      Object.defineProperty(mongoose.connection, "readyState", originalReadyState);
    }
    mongoose.startSession = originalStartSession;
    Order.prototype.save = originalSave;
    __resetPayPalService();
  }
});

test("confirmOrder rejects inventory conflicts before local order creation", async () => {
  const originalReadyState = Object.getOwnPropertyDescriptor(mongoose.connection, "readyState");
  const originalStartSession = mongoose.startSession;
  Object.defineProperty(mongoose.connection, "readyState", { value: 1, configurable: true });
  mongoose.startSession = async () => ({
    withTransaction: async (callback) => {
      await callback();
    },
    endSession() {},
  });

  Product.findById = async () => DEFAULT_PRODUCT;
  Product.findOneAndUpdate = async () => null;
  Order.findOne = async () => null;
  __setPayPalService(buildPayPalService());

  const req = { body: { orderID: "PAYPAL_ORDER_ID" }, user: { _id: PRODUCT_ID, name: "Good", email: "good@example.com" } };
  const res = makeRes();

  try {
    await assert.rejects(() => confirmOrder(req, res, null), /Requested quantity exceeds available stock|Insufficient stock/i);
  } finally {
    if (originalReadyState) {
      Object.defineProperty(mongoose.connection, "readyState", originalReadyState);
    }
    mongoose.startSession = originalStartSession;
    __resetPayPalService();
  }
});
