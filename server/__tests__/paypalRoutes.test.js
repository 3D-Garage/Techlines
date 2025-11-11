import { test } from "node:test";
import assert from "node:assert/strict";
import paypalRoutes, {
  __setPayPalService,
  createPayPalOrderHandler,
  capturePayPalOrderHandler,
} from "../routes/paypalRoutes.js";
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

test("createPayPalOrderHandler computes total from DB and returns id", async () => {
  // stub products
  Product.findById = async (id) => ({ _id: id, price: id === "p1" ? 100 : 200 });
  // stub PayPal client
  __setPayPalService({
    createOrder: async ({ total }) => {
      assert.equal(total, Math.round(100 * 2 + 200 * 1));
      return { id: "PAYPAL_ORDER_ID" };
    },
  });
  const body = { items: [{ productId: "p1", qty: 2 }, { productId: "p2", qty: 1 }], shippingPrice: 0 };
  const { req, res, next } = mockReqRes(body);
  await createPayPalOrderHandler(req, res, next);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { id: "PAYPAL_ORDER_ID" });
});

test("capturePayPalOrderHandler returns capture payload", async () => {
  __setPayPalService({
    captureOrder: async (id) => ({ id, status: "COMPLETED" }),
  });
  const { req, res, next } = mockReqRes({ orderID: "ORDER123" });
  await capturePayPalOrderHandler(req, res, next);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { id: "ORDER123", status: "COMPLETED" });
});

