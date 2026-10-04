// Explicit, isolated Sandbox acceptance check; never uses the application's DB.
import "dotenv/config";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Product from "../models/Product.js";
import CheckoutAttempt from "../models/CheckoutAttempt.js";
import Order from "../models/Order.js";
import { initializeCheckout, createCheckout, processCheckout, __setPayPalService } from "../services/checkoutService.js";
import * as paypal from "../services/paypalService.js";
import { startSandboxReceiptServer } from "./sandboxReceiptServer.js";

const sandboxBase = "https://api-m.sandbox.paypal.com";
if (process.env.PAYPAL_BASE_URL && process.env.PAYPAL_BASE_URL !== sandboxBase) throw new Error("This check only accepts the PayPal Sandbox API");
process.env.PAYPAL_BASE_URL = sandboxBase;
if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET || !process.env.PAYPAL_MERCHANT_ID) throw new Error("Set the Sandbox client ID, client secret and PAYPAL_MERCHANT_ID in .env first");
let mongo, receiptServer, checkout;
let receiptSeen = false;
let apiVerified = false;
try {
  mongo = await MongoMemoryReplSet.create({ binary: { downloadDir: resolve(".test-artifacts/mongodb") }, replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: `sandbox_acceptance_${Date.now()}`, autoIndex: false });
  await Product.createCollection();
  await initializeCheckout();
  receiptServer = await startSandboxReceiptServer({
    readStatus: async () => {
      if (apiVerified) return "COMPLETED";
      if (!checkout) return "CREATING";
      const current = await CheckoutAttempt.findById(checkout._id);
      // Display success only after the CLI has finished all acceptance assertions.
      return current.status === "COMPLETED" ? "PROCESSING" : current.status;
    },
    onReceipt: () => { receiptSeen = true; },
  });
  // Direct approval links require a browser return URL; the production UI uses the SDK.
  __setPayPalService({ ...paypal, createOrder: (payload) => paypal.createOrder({ ...payload, returnUrl: receiptServer.returnUrl, cancelUrl: receiptServer.cancelUrl }) });
  const product = await Product.create({ name: "Sandbox security acceptance", image: "/favicon.png", brand: "Test", category: "Test", description: "Isolated Sandbox acceptance", price: 1000, stock: 1 });
  const user = { _id: new mongoose.Types.ObjectId(), name: "Sandbox Test Customer", email: "sandbox-test@example.com" };
  checkout = await createCheckout(user, { requestId: randomUUID(), items: [{ productId: String(product._id), qty: 1 }], shippingMethod: "standard",
    shippingAddress: { address: "Sandbox utca 1", city: "Budapest", postalCode: "1111", country: "HU" } });
  if (!checkout.paypalOrderId) throw new Error("Sandbox order creation is pending or failed; rerun after checking configuration");
  const paypalOrder = await paypal.getOrder(checkout.paypalOrderId);
  const approval = paypalOrder.links?.find((link) => ["approve", "payer-action"].includes(link.rel));
  if (!approval || new URL(approval.href).hostname !== "www.sandbox.paypal.com") throw new Error("Sandbox approval URL is missing");
  console.log(`Approve this 2,490 HUF Sandbox purchase using a Sandbox buyer account:\n${approval.href}`);
  console.log("The test polls for approval. Only Sandbox funds and a temporary replica set are used.");
  while (Date.now() < checkout.expiresAt.getTime()) {
    await processCheckout(checkout._id);
    const current = await CheckoutAttempt.findById(checkout._id);
    if (current.status === "COMPLETED") {
      const order = await Order.findById(current.order);
      await order.validate();
      const storedProduct = await Product.findById(product._id);
      if (order.paymentStatus !== "COMPLETED" || order.totalPrice !== 2490 || !order.paypalCaptureId || storedProduct.stock !== 0 || order.shippingAddress.address !== "Sandbox utca 1") throw new Error("Sandbox acceptance assertions failed");
      await processCheckout(checkout._id);
      if (await Order.countDocuments() !== 1 || (await Product.findById(product._id)).stock !== 0) throw new Error("Sandbox duplicate confirmation assertions failed");
      apiVerified = true;
      console.log("API_PASS: actual Sandbox capture, validated paid order, webshop address and exactly-once stock/order. Waiting for the browser receipt.");
      const receiptDeadline = Date.now() + 60000;
      while (!receiptSeen && Date.now() < receiptDeadline) await new Promise((done) => setTimeout(done, 250));
      if (!receiptSeen) throw new Error(`Payment API succeeded, but browser return is unverified. Open ${receiptServer.returnUrl} while this test is running to inspect the receipt.`);
      console.log("PASS: Sandbox payment API and browser success receipt both verified.");
      break;
    }
    if (["FAILED", "EXPIRED", "REVIEW"].includes(current.status)) throw new Error(`Sandbox check requires investigation: ${current.status}`);
    await new Promise((done) => setTimeout(done, 5000));
  }
  if ((await CheckoutAttempt.findById(checkout._id)).status !== "COMPLETED") throw new Error("Sandbox approval/capture did not complete within 30 minutes");
} finally {
  __setPayPalService(null);
  if (receiptServer) await receiptServer.close();
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
}
