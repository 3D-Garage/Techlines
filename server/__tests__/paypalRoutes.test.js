import { test } from "node:test";
import assert from "node:assert/strict";
import paypalRoutes, {
  __setPayPalService,
  createPayPalOrderHandler,
  capturePayPalOrderHandler,
  getPayPalClientIdHandler,
} from "../routes/paypalRoutes.js";
import { createCheckoutQuoteHandler } from "../routes/checkoutRoutes.js";
import { calculateOrderPricing } from "../services/pricingService.js";
import Product from "../models/Product.js";

function mockReqRes(body = {}, user = { _id: "u1" }) {
  const req = { body, user };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  const next = (err) => {
    res.nextErr = err;
  };
  return { req, res, next };
}

const PRODUCT_ID_ONE = "507f1f77bcf86cd799439011";
const PRODUCT_ID_TWO = "507f1f77bcf86cd799439012";

test("standard shipping below 10,000 Ft adds 1,490 Ft", async () => {
  Product.findById = async (id) => ({ _id: id, name: `Product ${id}`, price: 3490 });

  const quote = await calculateOrderPricing({
    items: [{ productId: PRODUCT_ID_ONE, qty: 2 }],
    shippingMethod: "standard",
  });

  assert.deepEqual(quote, {
    items: [
      {
        productId: PRODUCT_ID_ONE,
        name: `Product ${PRODUCT_ID_ONE}`,
        image: undefined,
        qty: 2,
        unitPrice: 3490,
        lineTotal: 6980,
      },
    ],
    subtotal: 6980,
    shippingMethod: "standard",
    shippingPrice: 1490,
    total: 8470,
    currency: "HUF",
  });
});

test("standard shipping at exactly 10,000 Ft is free", async () => {
  Product.findById = async (id) => ({ _id: id, name: `Product ${id}`, price: 5000 });

  const quote = await calculateOrderPricing({
    items: [{ productId: PRODUCT_ID_ONE, qty: 2 }],
    shippingMethod: "standard",
  });

  assert.equal(quote.shippingPrice, 0);
  assert.equal(quote.total, 10000);
});

test("standard shipping above 10,000 Ft is free", async () => {
  Product.findById = async (id) => ({ _id: id, name: `Product ${id}`, price: 6000 });

  const quote = await calculateOrderPricing({
    items: [{ productId: PRODUCT_ID_ONE, qty: 2 }],
    shippingMethod: "standard",
  });

  assert.equal(quote.shippingPrice, 0);
  assert.equal(quote.total, 12000);
});

test("express shipping always charges 3,990 Ft", async () => {
  Product.findById = async (id) => ({ _id: id, name: `Product ${id}`, price: 1000 });

  const quote = await calculateOrderPricing({
    items: [{ productId: PRODUCT_ID_ONE, qty: 2 }],
    shippingMethod: "express",
  });

  assert.equal(quote.shippingPrice, 3990);
  assert.equal(quote.total, 5990);
});

test("unsupported shipping method is rejected", async () => {
  await assert.rejects(
    () =>
      calculateOrderPricing({ items: [{ productId: PRODUCT_ID_ONE, qty: 1 }], shippingMethod: "priority" }),
    /Unsupported shipping method/,
  );
});

test("product price is read from the database and not trusted from cart state", async () => {
  Product.findById = async () => ({ _id: PRODUCT_ID_ONE, name: "Updated", price: 2500 });

  const quote = await calculateOrderPricing({
    items: [{ productId: PRODUCT_ID_ONE, qty: 3 }],
    shippingMethod: "standard",
  });

  assert.equal(quote.items[0].unitPrice, 2500);
  assert.equal(quote.items[0].lineTotal, 7500);
  assert.equal(quote.total, 8990);
});

test("client-supplied price is ignored", async () => {
  Product.findById = async (id) => ({ _id: id, name: `Product ${id}`, price: 3490 });

  const quote = await calculateOrderPricing({
    items: [{ productId: PRODUCT_ID_ONE, qty: 2, unitPrice: 99999 }],
    shippingMethod: "standard",
  });

  assert.equal(quote.items[0].unitPrice, 3490);
  assert.equal(quote.items[0].lineTotal, 6980);
});

test("multiple order items are priced and totaled together", async () => {
  Product.findById = async (id) => ({
    _id: id,
    name: `Product ${id}`,
    price: id === PRODUCT_ID_ONE ? 2000 : 1500,
  });

  const quote = await calculateOrderPricing({
    items: [
      { productId: PRODUCT_ID_ONE, qty: 2 },
      { productId: PRODUCT_ID_TWO, qty: 3 },
    ],
    shippingMethod: "standard",
  });

  assert.equal(quote.subtotal, 8500);
  assert.equal(quote.shippingPrice, 1490);
  assert.equal(quote.total, 9990);
});

test("missing or invalid product is rejected", async () => {
  Product.findById = async (id) =>
    id === PRODUCT_ID_ONE ? null : { _id: id, name: `Product ${id}`, price: 1000 };
  await assert.rejects(
    () =>
      calculateOrderPricing({ items: [{ productId: PRODUCT_ID_ONE, qty: 1 }], shippingMethod: "standard" }),
    /product not found/i,
  );
  await assert.rejects(
    () => calculateOrderPricing({ items: [{ productId: "bad-id", qty: 1 }], shippingMethod: "standard" }),
    /invalid product id/i,
  );
});

test("invalid quantity is rejected", async () => {
  Product.findById = async (id) => ({ _id: id, name: `Product ${id}`, price: 2000 });

  await assert.rejects(
    () =>
      calculateOrderPricing({ items: [{ productId: PRODUCT_ID_ONE, qty: 0 }], shippingMethod: "standard" }),
    /quantity/i,
  );
  await assert.rejects(
    () =>
      calculateOrderPricing({ items: [{ productId: PRODUCT_ID_ONE, qty: -1 }], shippingMethod: "standard" }),
    /quantity/i,
  );
  await assert.rejects(
    () =>
      calculateOrderPricing({ items: [{ productId: PRODUCT_ID_ONE, qty: 1.5 }], shippingMethod: "standard" }),
    /quantity/i,
  );
});

test("quote handler returns server-generated quote and ignores manipulated client values", async () => {
  Product.findById = async (id) => ({ _id: id, name: `Product ${id}`, price: 3490 });

  const { req, res, next } = mockReqRes({
    items: [{ productId: PRODUCT_ID_ONE, qty: 2, unitPrice: 99999 }],
    shippingMethod: "standard",
    shippingPrice: 99999,
    subtotal: 99999,
    total: 99999,
    currency: "USD",
  });

  await createCheckoutQuoteHandler(req, res, next);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    items: [
      {
        productId: PRODUCT_ID_ONE,
        name: `Product ${PRODUCT_ID_ONE}`,
        image: undefined,
        qty: 2,
        unitPrice: 3490,
        lineTotal: 6980,
      },
    ],
    subtotal: 6980,
    shippingMethod: "standard",
    shippingPrice: 1490,
    total: 8470,
    currency: "HUF",
  });
});

test("standalone capture is retired without contacting PayPal", async () => {
  __setPayPalService({
    captureOrder: async (id) => ({ id, status: "COMPLETED" }),
  });
  const { req, res, next } = mockReqRes({ orderID: "ORDER123" });
  await capturePayPalOrderHandler(req, res, next);
  assert.equal(res.statusCode, 410);
});

test("getPayPalClientIdHandler returns the configured public client id", () => {
  const previousClientId = process.env.PAYPAL_CLIENT_ID;
  process.env.PAYPAL_CLIENT_ID = "public-client-id";
  const { req, res } = mockReqRes();
  getPayPalClientIdHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { clientId: "public-client-id" });
  if (previousClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
  else process.env.PAYPAL_CLIENT_ID = previousClientId;
});
