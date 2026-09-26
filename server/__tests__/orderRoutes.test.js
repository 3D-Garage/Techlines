import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder } from "../routes/orderRoutes.js";
import Order from "../models/Order.js";

function mockReqRes(body = {}, user = null) {
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

test("createOrder uses req.user and ignores body.userInfo", async () => {
  let instanceData;
  // Stub save to capture instance state
  Order.prototype.save = async function () {
    instanceData = {
      user: this.user,
      username: this.username,
      email: this.email,
      shippingPrice: this.shippingPrice,
      totalPrice: this.totalPrice,
      orderItems: this.orderItems,
    };
    return { _id: "ord1", ...instanceData };
  };

  const body = {
    orderItems: [{ name: "A", qty: 1, image: "i", price: 10, product_id: "507f1f77bcf86cd799439011" }],
    shippingAddress: { address: "a", city: "c", postalCode: "p", country: "h" },
    paymentMethod: "PayPal",
    shippingMethod: "standard",
    shippingPrice: 999,
    totalPrice: 9999,
    paymentDetails: { orderId: "po1" },
    userInfo: { _id: "bad", name: "Evil", email: "evil@example.com" },
  };
  const user = { _id: "507f1f77bcf86cd799439011", name: "Good", email: "good@example.com" };
  const Product = (await import("../models/Product.js")).default;
  Product.findById = async (id) => ({ _id: id, name: "Server Product", price: 1000 });

  const { req, res, next } = mockReqRes(body, user);
  await createOrder(req, res, next);
  assert.equal(res.statusCode, 201);
  assert.equal(String(instanceData.user), user._id);
  assert.equal(instanceData.username, user.name);
  assert.equal(instanceData.email, user.email);
  assert.equal(instanceData.shippingPrice, 1490);
  assert.equal(instanceData.totalPrice, 2490);
  assert.equal(instanceData.orderItems[0].price, 1000);
});
