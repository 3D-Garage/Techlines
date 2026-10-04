import mongoose from "mongoose";
import { createHash, randomUUID } from "node:crypto";
import validator from "validator";
import CheckoutAttempt from "../models/CheckoutAttempt.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import { aggregateInventory, decrementInventory } from "./inventoryService.js";
import { calculateOrderPricing, SUPPORTED_SHIPPING_METHODS } from "./pricingService.js";
import * as paypal from "./paypalService.js";

const WINDOW = 30 * 60 * 1000;
const LEASE = 120 * 1000;
const terminal = new Set(["COMPLETED", "FAILED", "EXPIRED"]);
let ready = false;
let provider = paypal;
export const __setPayPalService = (service) => { provider = service || paypal; };
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
async function validateCreation(callback) {
  try { return await callback(); }
  catch (error) {
    const status = error.statusCode || (error.name === "ValidationError" ? 400 : 500);
    if ([400, 404, 409, 422].includes(status)) error.creationRejected = true;
    throw error;
  }
}
export function requireCheckoutReady() {
  if (!ready || mongoose.connection.readyState !== 1) throw fail("Checkout is unavailable: transaction-capable database and payment configuration are required.", 503);
}

// Never drop existing indexes. Detect collisions before adding any unique index.
export async function initializeCheckout() {
  ready = false;
  if (!process.env.PAYPAL_MERCHANT_ID || !process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) throw new Error("PayPal configuration is incomplete (client, secret, merchant ID required)");
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("Checkout requires a MongoDB replica set or sharded cluster");
  for (const model of [Order, CheckoutAttempt]) {
    await model.createCollection();
    for (const [fields, options] of model.schema.indexes()) {
      if (!options.unique) continue;
      const keys = Object.keys(fields);
      const match = options.sparse ? { $or: keys.map((key) => ({ [key]: { $exists: true } })) } : {};
      const collisions = await model.aggregate([
        { $match: match }, { $group: { _id: Object.fromEntries(keys.map((key, index) => [`key${index}`, `$${key}`])), count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } }, { $limit: 1 },
      ]);
      if (collisions.length) throw new Error(`Duplicate payment keys in ${model.collection.name}; manual migration required`);
    }
  }
  await Order.createIndexes();
  await CheckoutAttempt.createIndexes();
  // Prove transaction support and permissions using a no-op write.
  await transaction(async (session) => {
    await CheckoutAttempt.updateOne({ _id: new mongoose.Types.ObjectId() }, { $set: { issue: "probe" } }, { session });
  });
  ready = true;
}

async function transaction(callback) {
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => callback(session)); }
  finally { await session.endSession(); }
}

export function normalizeCheckoutInput(body = {}) {
  if (typeof body.requestId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(body.requestId)) throw fail("A valid requestId is required.", 400);
  if (!SUPPORTED_SHIPPING_METHODS.has(body.shippingMethod)) throw fail("Unsupported shipping method", 400);
  const address = body.shippingAddress;
  const shippingAddress = {};
  for (const [key, max] of [["address", 300], ["city", 120], ["postalCode", 60], ["country", 2]]) {
    const value = typeof address?.[key] === "string" ? address[key].trim() : "";
    if (!value || value.length > max || /[\x00-\x1f]/.test(value)) throw fail("A complete, valid shipping address is required.", 400);
    shippingAddress[key] = key === "country" ? value.toUpperCase() : value;
  }
  if (!validator.isISO31661Alpha2(shippingAddress.country) || (shippingAddress.country === "HU" && !/^\d{4}$/.test(shippingAddress.postalCode))) throw fail("Invalid country or postal code.", 400);
  return { items: aggregateInventory(body.items), shippingMethod: body.shippingMethod, shippingAddress };
}

export async function createCheckout(user, body) {
  requireCheckoutReady();
  if (!user?._id) throw fail("Not authorized, no user.", 401);
  const input = await validateCreation(() => normalizeCheckoutInput(body));
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let attempt = await CheckoutAttempt.findOne({ user: user._id, requestId: body.requestId });
  if (!attempt) {
    const quote = await validateCreation(() => calculateOrderPricing(input));
    const snapshot = new Order({
      user: user._id, username: user.name, email: user.email,
      orderItems: quote.items.map((item) => ({ name: item.name, image: item.image, qty: item.qty, price: item.unitPrice, product_id: item.productId })),
      shippingAddress: input.shippingAddress, shippingPrice: quote.shippingPrice, totalPrice: quote.total, paymentMethod: "PayPal",
    });
    await validateCreation(() => snapshot.validate());
    try {
      attempt = await CheckoutAttempt.create({
        user: user._id, requestId: body.requestId, fingerprint, snapshot: snapshot.toObject(), quote,
        merchantId: process.env.PAYPAL_MERCHANT_ID,
        createRequestId: randomUUID(), captureRequestId: randomUUID(), expiresAt: new Date(Date.now() + WINDOW),
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      attempt = await CheckoutAttempt.findOne({ user: user._id, requestId: body.requestId });
      if (!attempt) throw error;
    }
  }
  if (attempt.fingerprint !== fingerprint) throw fail("requestId was already used for different checkout data.", 409);
  if (attempt.status === "CREATING") await processCheckout(attempt._id);
  return CheckoutAttempt.findById(attempt._id);
}

export async function ownedCheckout(id, user) {
  if (!user?._id) throw fail("Not authorized, no user.", 401);
  if (typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id)) throw fail("Checkout not found.", 404);
  const attempt = await CheckoutAttempt.findOne({ _id: id, user: user._id });
  if (!attempt) throw fail("Checkout not found.", 404);
  return attempt;
}
export async function checkoutResponse(attempt) {
  const order = attempt.status === "COMPLETED" ? await Order.findOne({ _id: attempt.order, user: attempt.user, checkoutId: attempt._id }) : null;
  return { checkoutId: attempt._id, id: attempt.paypalOrderId, status: attempt.status, expiresAt: attempt.expiresAt, shippingAddress: attempt.snapshot.shippingAddress, quote: attempt.quote, total: attempt.quote.total, issue: attempt.issue, order };
}

async function claim(id) {
  const now = new Date();
  return CheckoutAttempt.findOneAndUpdate({ _id: id, status: { $nin: [...terminal] }, $or: [{ lockUntil: { $exists: false } }, { lockUntil: { $lte: now } }] },
    { $set: { lockToken: randomUUID(), lockUntil: new Date(Date.now() + LEASE) } }, { new: true });
}
async function patch(attempt, values, session) {
  const updated = await CheckoutAttempt.findOneAndUpdate({ _id: attempt._id, lockToken: attempt.lockToken, lockUntil: { $gt: new Date() } }, { $set: values }, { new: true, session, runValidators: true });
  if (!updated) throw fail("Checkout processing lease expired.", 409);
  return updated;
}
function validAmount(amount, expected) {
  return amount?.currency_code === "HUF" && typeof amount.value === "string" && /^\d+(?:\.0{1,2})?$/.test(amount.value) && Number(amount.value) === expected;
}
export function verifyProviderOrder(attempt, order) {
  const unit = order?.purchase_units?.[0];
  return Boolean(order?.id === attempt.paypalOrderId && order.intent === "CAPTURE" && order.purchase_units.length === 1 &&
    unit.reference_id === String(attempt._id) && unit.custom_id === String(attempt._id) && unit.payee?.merchant_id === attempt.merchantId && validAmount(unit.amount, attempt.quote.total));
}
export function verifiedCapture(attempt, order) {
  if (!verifyProviderOrder(attempt, order)) return null;
  const captures = order.purchase_units[0].payments?.captures;
  if (!Array.isArray(captures) || captures.length !== 1) return null;
  const capture = captures[0];
  if (typeof capture.id !== "string" || !capture.id || !validAmount(capture.amount, attempt.quote.total)) return null;
  return capture;
}

async function reserve(attempt) {
  let updated;
  try {
    await transaction(async (session) => {
      await new Order(attempt.snapshot.toObject()).validate();
      await decrementInventory(attempt.quote.items, session);
      updated = await patch(attempt, { status: "PROCESSING", reservation: "HELD", processingStartedAt: new Date(), nextCheckAt: new Date() }, session);
    });
  } catch (error) {
    // Transaction rollback guarantees nothing was captured or partly reserved.
    if (error.statusCode === 409 && error.code === "INSUFFICIENT_STOCK") {
      return patch(attempt, { status: "FAILED", issue: "INSUFFICIENT_STOCK" });
    }
    throw error;
  }
  return updated;
}
async function release(attempt) {
  return transaction(async (session) => {
    const current = await CheckoutAttempt.findOne({ _id: attempt._id, lockToken: attempt.lockToken }).session(session);
    if (current.reservation === "HELD") {
      for (const item of current.quote.items) {
        const result = await Product.updateOne({ _id: item.productId }, { $inc: { stock: item.qty, inventoryVersion: 1 } }, { session });
        if (result.matchedCount !== 1) throw new Error("Reserved product is missing");
      }
    }
    return patch(current, { status: "FAILED", reservation: current.reservation === "HELD" ? "RELEASED" : current.reservation, issue: "PAYMENT_FAILED" }, session);
  });
}
async function finalize(attempt, order, capture) {
  if (attempt.reservation !== "HELD") return patch(attempt, { status: "REVIEW", issue: "CAPTURE_WITHOUT_RESERVATION" });
  await transaction(async (session) => {
    const snapshot = attempt.snapshot.toObject();
    const paidOrder = new Order({ ...snapshot, checkoutId: attempt._id, paypalOrderId: attempt.paypalOrderId, paypalCaptureId: capture.id,
      paymentStatus: "COMPLETED", paidAt: new Date(), paymentDetails: { orderId: attempt.paypalOrderId, payerId: order.payer?.payer_id } });
    await paidOrder.save({ session });
    await patch(attempt, { status: "COMPLETED", reservation: "CONSUMED", paypalCaptureId: capture.id, order: paidOrder._id, issue: "" }, session);
  });
}

// All entry points (HTTP, restart worker, admin) share the same durable lease.
// A provider error is uncertain: never release stock from an HTTP status alone.
export async function processCheckout(id, { queryOnly = false } = {}) {
  requireCheckoutReady();
  let attempt = await claim(id);
  if (!attempt) return;
  try {
    if (attempt.status === "CREATING") {
      if (Date.now() >= attempt.expiresAt.getTime()) { await patch(attempt, { status: "EXPIRED" }); return; }
      if (queryOnly) return;
      const created = await provider.createOrder({ ...attempt.quote, shippingAddress: attempt.snapshot.shippingAddress, fullName: attempt.snapshot.username,
        referenceId: String(attempt._id), merchantId: attempt.merchantId, requestId: attempt.createRequestId });
      if (typeof created?.id !== "string" || !created.id) throw new Error("PayPal did not return an order ID");
      attempt = await patch(attempt, { paypalOrderId: created.id, status: "READY", issue: "", nextCheckAt: new Date(Date.now() + 60000) });
      return;
    }
    if (attempt.processingStartedAt && Date.now() - attempt.processingStartedAt.getTime() >= WINDOW && attempt.status !== "REVIEW") {
      attempt = await patch(attempt, { status: "REVIEW", issue: "PAYMENT_REVIEW_REQUIRED", nextCheckAt: new Date(Date.now() + 300000) });
    }
    // Always look up before any capture or retry, including after lost responses.
    const order = await provider.getOrder(attempt.paypalOrderId);
    if (!verifyProviderOrder(attempt, order)) {
      await patch(attempt, { status: "REVIEW", issue: "PROVIDER_ORDER_MISMATCH", nextCheckAt: new Date(Date.now() + 300000) }); return;
    }
    const capture = verifiedCapture(attempt, order);
    if (capture?.status === "COMPLETED" && order.status === "COMPLETED") { await finalize(attempt, order, capture); return; }
    if (capture && ["DECLINED", "DENIED", "FAILED"].includes(capture.status)) { await release(attempt); return; }
    if (order.status === "VOIDED" && !order.purchase_units[0].payments?.captures?.length) { await release(attempt); return; }
    const expired = Date.now() >= attempt.expiresAt.getTime();
    if (attempt.reservation === "NONE" && expired && attempt.status === "READY") { await patch(attempt, { status: "EXPIRED" }); return; }
    const retryExpired = attempt.processingStartedAt && Date.now() - attempt.processingStartedAt.getTime() >= WINDOW;
    if (retryExpired || attempt.status === "REVIEW") {
      await patch(attempt, { status: "REVIEW", issue: attempt.issue || "PAYMENT_REVIEW_REQUIRED", nextCheckAt: new Date(Date.now() + 300000) }); return;
    }
    if (order.purchase_units[0].payments?.captures?.length || order.status !== "APPROVED" || queryOnly) {
      await patch(attempt, { nextCheckAt: new Date(Date.now() + 60000) }); return;
    }
    if (attempt.reservation === "NONE") attempt = await reserve(attempt);
    if (attempt.reservation !== "HELD") return;
    attempt = await patch(attempt, { captureAttemptedAt: attempt.captureAttemptedAt || new Date() });
    const result = await provider.captureOrder(attempt.paypalOrderId, attempt.captureRequestId);
    const completed = verifiedCapture(attempt, result);
    if (completed?.status === "COMPLETED" && result.status === "COMPLETED") await finalize(attempt, result, completed);
    else if (completed && ["DECLINED", "DENIED", "FAILED"].includes(completed.status)) await release(attempt);
    else await patch(attempt, { issue: "PAYMENT_PENDING", nextCheckAt: new Date(Date.now() + 60000) });
  } catch (_error) {
    // Keep private provider/database details out of the API and logs.
    await patch(attempt, { issue: "RECONCILIATION_REQUIRED", nextCheckAt: new Date(Date.now() + (attempt.status === "REVIEW" ? 300000 : 60000)) }).catch(() => {});
  } finally {
    await CheckoutAttempt.updateOne({ _id: attempt._id, lockToken: attempt.lockToken }, { $unset: { lockToken: "", lockUntil: "" } });
  }
}

export async function reconcilePending() {
  requireCheckoutReady();
  const attempts = await CheckoutAttempt.find({ status: { $nin: [...terminal] }, nextCheckAt: { $lte: new Date() } }).select("_id status").sort({ nextCheckAt: 1 }).limit(100);
  for (let index = 0; index < attempts.length; index += 4) {
    // Bounded concurrency prevents a slow provider lookup from blocking every payment.
    const results = await Promise.allSettled(attempts.slice(index, index + 4).map((attempt) => processCheckout(attempt._id, { queryOnly: attempt.status === "REVIEW" })));
    if (results.some((result) => result.status === "rejected")) console.error("Checkout reconciliation database operation failed");
  }
}
export function startCheckoutWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await reconcilePending(); }
    catch (_error) { console.error("Checkout reconciliation unavailable"); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(tick, 60000);
  timer.unref();
  return () => clearInterval(timer);
}
