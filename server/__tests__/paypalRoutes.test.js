import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { getPayPalClientIdHandler } from "../routes/paypalRoutes.js";
import Product from "../models/Product.js";
import {
  buildCheckoutQuote,
  EXPRESS_SHIPPING_PRICE,
} from "../services/checkoutService.js";

const mockRes = () => ({
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

test("checkout quote uses database prices and server shipping policy", async (t) => {
  const productId = new mongoose.Types.ObjectId();
  t.mock.method(Product, "find", () => ({
    lean: async () => [
      {
        _id: productId,
        name: "Trusted product",
        image: "image.jpg",
        price: 2500,
        stock: 5,
        available: true,
      },
    ],
  }));

  const quote = await buildCheckoutQuote({
    items: [{ productId: String(productId), qty: 2 }],
    shippingAddress: {
      address: "Main Street 1",
      city: "Budapest",
      postalCode: "1000",
      country: "Hungary",
    },
    shippingMethod: "express",
    shippingPrice: -1,
    totalPrice: 1,
  });

  assert.equal(quote.items[0].price, 2500);
  assert.equal(quote.shippingPrice, EXPRESS_SHIPPING_PRICE);
  assert.equal(quote.totalPrice, 5000 + EXPRESS_SHIPPING_PRICE);
});

test("getPayPalClientIdHandler returns the configured public client id", () => {
  const previousClientId = process.env.PAYPAL_CLIENT_ID;
  process.env.PAYPAL_CLIENT_ID = "public-client-id";
  const res = mockRes();
  getPayPalClientIdHandler({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { clientId: "public-client-id" });
  if (previousClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
  else process.env.PAYPAL_CLIENT_ID = previousClientId;
});
