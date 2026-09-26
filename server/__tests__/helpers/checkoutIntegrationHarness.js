import { once } from "node:events";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../../app.js";
import CheckoutSession from "../../models/CheckoutSession.js";
import Order from "../../models/Order.js";
import Product from "../../models/Product.js";
import User from "../../models/User.js";
import {
  __resetPayPalService,
  __setPayPalService,
} from "../../routes/paypalRoutes.js";

const TEST_TOKEN_SECRET = "checkout-integration-test-secret";

const restoreEnvironmentValue = (name, value) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

export async function startCheckoutIntegrationHarness() {
  const previousTokenSecret = process.env.TOKEN_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.TOKEN_SECRET = TEST_TOKEN_SECRET;
  process.env.NODE_ENV = "test";

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replSet.getUri(), { dbName: "checkout-integration" });
  await Promise.all([
    User.syncIndexes(),
    Product.syncIndexes(),
    CheckoutSession.syncIndexes(),
    Order.syncIndexes(),
  ]);

  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const request = async (path, { method = "GET", token, body } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = text;
    }
    return { response, payload };
  };

  const createUser = async (overrides = {}) => {
    const suffix = new mongoose.Types.ObjectId().toString();
    const user = await User.create({
      name: "Checkout Tester",
      email: `checkout-${suffix}@example.test`,
      password: "password123",
      ...overrides,
    });
    return {
      user,
      token: jwt.sign({ id: user._id }, TEST_TOKEN_SECRET, { expiresIn: "1h" }),
    };
  };

  const createProduct = (overrides = {}) =>
    Product.create({
      name: "Sandbox Keyboard",
      image: "/images/sandbox-keyboard.jpg",
      brand: "Sandbox",
      category: "Accessories",
      description: "A product fixture for checkout integration tests.",
      price: 4000,
      stock: 10,
      available: true,
      ...overrides,
    });

  const reset = async () => {
    __resetPayPalService();
    await Promise.all([
      Order.deleteMany({}),
      CheckoutSession.deleteMany({}),
      Product.deleteMany({}),
      User.deleteMany({}),
    ]);
  };

  const close = async () => {
    __resetPayPalService();
    if (server.listening) {
      server.close();
      await once(server, "close");
    }
    await mongoose.disconnect();
    await replSet.stop();
    restoreEnvironmentValue("TOKEN_SECRET", previousTokenSecret);
    restoreEnvironmentValue("NODE_ENV", previousNodeEnv);
  };

  return {
    request,
    createUser,
    createProduct,
    setPayPalService: __setPayPalService,
    reset,
    close,
  };
}
