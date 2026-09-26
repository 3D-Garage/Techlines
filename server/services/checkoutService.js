import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import CheckoutSession from "../models/CheckoutSession.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import * as paypalServiceImport from "./paypalService.js";

export const CHECKOUT_CURRENCY = "HUF";
export const EXPRESS_SHIPPING_PRICE = 3990;
export const STANDARD_SHIPPING_PRICE = 1490;
export const FREE_SHIPPING_THRESHOLD = 10000;
const MAX_ITEMS = 100;
const MAX_QUANTITY = 1000;
const CHECKOUT_LIFETIME_MS = 24 * 60 * 60 * 1000;
const CONFIRMATION_RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;
const CONFIRMATION_CLAIM_TIMEOUT_MS = 60 * 1000;

let paypalService = paypalServiceImport;

export const __setPayPalService = (service) => {
  paypalService = service;
};

export const __resetPayPalService = () => {
  paypalService = paypalServiceImport;
};

export class CheckoutError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "CheckoutError";
    this.statusCode = statusCode;
  }
}

const fail = (statusCode, message) => {
  throw new CheckoutError(statusCode, message);
};

const asPlainDocuments = async (query) => {
  if (query && typeof query.lean === "function") return query.lean();
  return query;
};

const runQueryInSession = async (query, session) => {
  if (query && typeof query.session === "function") return query.session(session);
  return query;
};

const sanitizeAddress = (shippingAddress) => {
  if (!shippingAddress || typeof shippingAddress !== "object" || Array.isArray(shippingAddress)) {
    fail(400, "A valid shipping address is required.");
  }

  const result = {};
  for (const field of ["address", "city", "postalCode", "country"]) {
    if (typeof shippingAddress[field] !== "string") {
      fail(400, "A valid shipping address is required.");
    }
    const value = shippingAddress[field].trim();
    if (value.length < 2 || value.length > 200) {
      fail(400, "A valid shipping address is required.");
    }
    result[field] = value;
  }
  return result;
};

const normalizeItems = (items) => {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    fail(400, "A non-empty cart is required.");
  }

  const seen = new Set();
  return items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      fail(400, "Invalid cart item.");
    }
    const suppliedProductId = String(item.productId || "");
    const qty = Number(item.qty);
    if (!mongoose.isValidObjectId(suppliedProductId)) fail(400, "Invalid product in cart.");
    const productId = new mongoose.Types.ObjectId(suppliedProductId).toString();
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > MAX_QUANTITY) {
      fail(400, "Cart quantities must be positive whole numbers.");
    }
    if (seen.has(productId)) fail(400, "Duplicate products are not allowed in the cart.");
    seen.add(productId);
    return { productId, qty };
  });
};

const calculateShipping = (subtotal, shippingMethod) => {
  if (shippingMethod === "express") return EXPRESS_SHIPPING_PRICE;
  if (shippingMethod !== "standard") fail(400, "Invalid shipping method.");
  return subtotal < FREE_SHIPPING_THRESHOLD ? STANDARD_SHIPPING_PRICE : 0;
};

const loadProducts = async (normalizedItems) => {
  const ids = normalizedItems.map((item) => item.productId);
  const products = await asPlainDocuments(Product.find({ _id: { $in: ids } }));
  const byId = new Map(products.map((product) => [String(product._id), product]));

  return normalizedItems.map(({ productId, qty }) => {
    const product = byId.get(productId);
    if (!product) fail(400, "A product in the cart no longer exists.");
    if (product.available !== true) fail(409, `${product.name} is unavailable.`);
    if (!Number.isSafeInteger(Number(product.stock)) || Number(product.stock) < qty) {
      fail(409, `Insufficient stock for ${product.name}.`);
    }
    const price = Number(product.price);
    if (!Number.isSafeInteger(price) || price < 0) {
      fail(500, `Invalid catalog price for ${product.name}.`);
    }
    return {
      product: product._id,
      name: product.name,
      image: product.image,
      price,
      qty,
    };
  });
};

export const buildCheckoutQuote = async ({ items, shippingAddress, shippingMethod }) => {
  const normalizedItems = normalizeItems(items);
  const address = sanitizeAddress(shippingAddress);
  const trustedItems = await loadProducts(normalizedItems);
  const subtotal = trustedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
  if (!Number.isSafeInteger(subtotal)) fail(500, "The cart total is invalid.");
  const shippingPrice = calculateShipping(subtotal, shippingMethod);
  const totalPrice = subtotal + shippingPrice;
  if (!Number.isSafeInteger(totalPrice)) fail(500, "The order total is invalid.");

  return {
    items: trustedItems,
    shippingAddress: address,
    shippingMethod,
    subtotal,
    shippingPrice,
    totalPrice,
    currency: CHECKOUT_CURRENCY,
  };
};

export const createPayPalCheckout = async ({ user, body }) => {
  if (!user?._id) fail(401, "Authentication is required.");
  const quote = await buildCheckoutQuote(body || {});
  const checkout = new CheckoutSession({
    user: user._id,
    ...quote,
    paypalCreateRequestId: randomUUID(),
    paypalCaptureRequestId: randomUUID(),
    status: "CREATING",
    expiresAt: new Date(Date.now() + CHECKOUT_LIFETIME_MS),
  });
  await checkout.save();

  let paypalOrder;
  try {
    paypalOrder = await paypalService.createOrder({
      total: quote.totalPrice,
      currency: quote.currency,
      referenceId: String(checkout._id),
      customId: String(user._id),
      requestId: checkout.paypalCreateRequestId,
    });
  } catch (error) {
    checkout.status = "FAILED";
    await checkout.save().catch(() => {});
    throw new CheckoutError(502, "PayPal could not create the payment.");
  }

  const paypalOrderId = typeof paypalOrder?.id === "string" ? paypalOrder.id.trim() : "";
  if (!paypalOrderId || paypalOrderId.length > 100) {
    checkout.status = "FAILED";
    await checkout.save().catch(() => {});
    fail(502, "PayPal returned an invalid order.");
  }

  checkout.paypalOrderId = paypalOrderId;
  checkout.status = "CREATED";
  await checkout.save();

  return {
    id: checkout.paypalOrderId,
    subtotal: checkout.subtotal,
    shippingPrice: checkout.shippingPrice,
    totalPrice: checkout.totalPrice,
    total: checkout.totalPrice,
    currency: checkout.currency,
    quote: {
      subtotal: checkout.subtotal,
      shippingPrice: checkout.shippingPrice,
      totalPrice: checkout.totalPrice,
      currency: checkout.currency,
    },
  };
};

const moneyMatches = (amount, expectedValue, expectedCurrency) => {
  if (!amount || amount.currency_code !== expectedCurrency) return false;
  if (typeof amount.value !== "string" && typeof amount.value !== "number") return false;
  const value = String(amount.value);
  if (!/^\d+(?:\.\d+)?$/.test(value)) return false;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric === expectedValue;
};

const getPurchaseUnit = (paypalOrder, checkout) => {
  if (!paypalOrder || paypalOrder.id !== checkout.paypalOrderId) {
    fail(422, "The PayPal order could not be verified.");
  }
  const purchaseUnits = paypalOrder.purchase_units;
  if (!Array.isArray(purchaseUnits) || purchaseUnits.length !== 1) {
    fail(422, "The PayPal order could not be verified.");
  }
  const purchaseUnit = purchaseUnits[0];
  if (
    purchaseUnit.reference_id !== String(checkout._id) ||
    purchaseUnit.custom_id !== String(checkout.user)
  ) {
    fail(403, "The PayPal order does not belong to this checkout.");
  }
  if (!moneyMatches(purchaseUnit.amount, checkout.totalPrice, checkout.currency)) {
    fail(422, "The PayPal order amount or currency does not match the checkout.");
  }
  return purchaseUnit;
};

const verifyCompletedPayPalOrder = (paypalOrder, checkout, { associationAlreadyVerified = false } = {}) => {
  let purchaseUnit;
  if (associationAlreadyVerified) {
    if (!paypalOrder || paypalOrder.id !== checkout.paypalOrderId) {
      fail(422, "The PayPal order could not be verified.");
    }
    if (!Array.isArray(paypalOrder.purchase_units) || paypalOrder.purchase_units.length !== 1) {
      fail(422, "The PayPal order could not be verified.");
    }
    purchaseUnit = paypalOrder.purchase_units[0];
    if (
      (purchaseUnit.reference_id !== undefined && purchaseUnit.reference_id !== String(checkout._id)) ||
      (purchaseUnit.custom_id !== undefined && purchaseUnit.custom_id !== String(checkout.user)) ||
      (purchaseUnit.amount !== undefined &&
        !moneyMatches(purchaseUnit.amount, checkout.totalPrice, checkout.currency))
    ) {
      fail(422, "The captured PayPal order does not match the checkout.");
    }
  } else {
    purchaseUnit = getPurchaseUnit(paypalOrder, checkout);
  }
  if (paypalOrder.status !== "COMPLETED") {
    fail(422, "The PayPal payment is not completed.");
  }

  const captures = purchaseUnit.payments?.captures;
  if (!Array.isArray(captures) || captures.length !== 1) {
    fail(422, "The PayPal capture could not be verified.");
  }
  const capture = captures[0];
  if (capture.status !== "COMPLETED") fail(422, "The PayPal capture is not completed.");
  if (!capture.id || typeof capture.id !== "string") {
    fail(422, "The PayPal capture could not be verified.");
  }
  if (!moneyMatches(capture.amount, checkout.totalPrice, checkout.currency)) {
    fail(422, "The captured amount or currency does not match the checkout.");
  }

  const captureTime = new Date(capture.create_time);
  return {
    captureId: capture.id,
    payerId: typeof paypalOrder.payer?.payer_id === "string" ? paypalOrder.payer.payer_id : undefined,
    paidAt: Number.isNaN(captureTime.valueOf()) ? new Date() : captureTime,
  };
};

const validateCurrentInventory = async (checkout) => {
  const products = await asPlainDocuments(
    Product.find({ _id: { $in: checkout.items.map((item) => item.product) } }),
  );
  const byId = new Map(products.map((product) => [String(product._id), product]));
  for (const item of checkout.items) {
    const product = byId.get(String(item.product));
    if (!product || product.available !== true) fail(409, `${item.name} is unavailable.`);
    if (!Number.isSafeInteger(Number(product.stock)) || Number(product.stock) < item.qty) {
      fail(409, `Insufficient stock for ${item.name}.`);
    }
  }
};

const findExistingOrder = async (paypalOrderId) => Order.findOne({ "paymentDetails.orderId": paypalOrderId });

const belongsToUser = (document, user) => String(document?.user) === String(user?._id);

const isVerifiedLocalOrder = (order, paypalOrderId, captureId) =>
  order?.paymentDetails?.provider === "PayPal" &&
  order.paymentDetails.orderId === paypalOrderId &&
  typeof order.paymentDetails.captureId === "string" &&
  (!captureId || order.paymentDetails.captureId === captureId) &&
  order.paymentDetails.status === "COMPLETED" &&
  order.paymentDetails.currency === CHECKOUT_CURRENCY &&
  Number(order.paymentDetails.amount) === Number(order.totalPrice) &&
  Boolean(order.checkoutSession) &&
  Boolean(order.paidAt);

const buildOrderDocument = (checkout, user, verifiedPayment) => ({
  user: user._id,
  username: user.name,
  email: user.email,
  orderItems: checkout.items.map((item) => ({
    product_id: item.product,
    name: item.name,
    image: item.image,
    price: item.price,
    qty: item.qty,
  })),
  shippingAddress: checkout.shippingAddress,
  paymentMethod: "PayPal",
  paymentDetails: {
    provider: "PayPal",
    orderId: checkout.paypalOrderId,
    captureId: verifiedPayment.captureId,
    status: "COMPLETED",
    amount: checkout.totalPrice,
    currency: checkout.currency,
    payerId: verifiedPayment.payerId,
  },
  shippingPrice: checkout.shippingPrice,
  totalPrice: checkout.totalPrice,
  paidAt: verifiedPayment.paidAt,
  checkoutSession: checkout._id,
});

const commitTransaction = async (session) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await session.commitTransaction();
      return;
    } catch (error) {
      const unknownResult = error?.hasErrorLabel?.("UnknownTransactionCommitResult");
      if (!unknownResult || attempt >= 2) throw error;
    }
  }
};

const finalizeCheckoutTransactionally = async (checkout, user, paymentState) => {
  const session = await mongoose.startSession();
  let order;
  let created = false;
  try {
    session.startTransaction({
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });

    const existingQuery = Order.findOne({
      $or: [{ "paymentDetails.orderId": checkout.paypalOrderId }, { checkoutSession: checkout._id }],
    });
    const existing = await runQueryInSession(existingQuery, session);
    if (existing) {
      if (!belongsToUser(existing, user) || !isVerifiedLocalOrder(existing, checkout.paypalOrderId)) {
        fail(409, "The PayPal order has already been used.");
      }
      order = existing;
      await commitTransaction(session);
      return { order, created: false };
    }

    // Claim the inventory inside the transaction before making the irreversible capture call.
    // A verification/capture failure aborts the transaction, so stock remains unchanged.
    for (const item of checkout.items) {
      const product = await Product.findOneAndUpdate(
        { _id: item.product, available: true, stock: { $gte: item.qty } },
        { $inc: { stock: -item.qty } },
        { new: true, session },
      );
      if (!product) fail(409, `Insufficient stock or unavailable product: ${item.name}.`);
    }

    if (!paymentState.verifiedPayment) {
      // From this point a timeout is ambiguous: PayPal may have completed the
      // capture even if its response never reaches this process.
      paymentState.paymentMayBeCaptured = true;
      try {
        paymentState.paypalOrder = await paypalService.captureOrder(
          checkout.paypalOrderId,
          checkout.paypalCaptureRequestId,
        );
      } catch (_error) {
        throw new CheckoutError(502, "PayPal could not capture the payment. Please retry.");
      }
      paymentState.verifiedPayment = verifyCompletedPayPalOrder(paymentState.paypalOrder, checkout, {
        associationAlreadyVerified: true,
      });
    }

    const createdOrders = await Order.create(
      [buildOrderDocument(checkout, user, paymentState.verifiedPayment)],
      { session },
    );
    order = createdOrders[0];
    created = true;
    const checkoutUpdate = await CheckoutSession.updateOne(
      {
        _id: checkout._id,
        status: "CONFIRMING",
        confirmationStartedAt: checkout.confirmationStartedAt,
      },
      {
        $set: {
          status: "COMPLETED",
          captureId: paymentState.verifiedPayment.captureId,
          order: order._id,
        },
        $unset: { expiresAt: "", confirmationStartedAt: "" },
      },
      { session },
    );
    if (checkoutUpdate.matchedCount !== 1) fail(409, "Checkout no longer exists.");

    await commitTransaction(session);
  } finally {
    if (session.inTransaction()) await session.abortTransaction().catch(() => {});
    await session.endSession();
  }
  return { order, created };
};

const isDuplicateKeyError = (error) => error?.code === 11000;
const isRetryableTransactionError = (error) =>
  error?.hasErrorLabel?.("TransientTransactionError") ||
  error?.hasErrorLabel?.("UnknownTransactionCommitResult");

export const confirmPayPalCheckout = async ({ user, body }) => {
  if (!user?._id) fail(401, "Authentication is required.");
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail(400, "A PayPal order ID is required.");
  }
  const keys = Object.keys(body);
  if (keys.length !== 1 || !["paypalOrderId", "orderID"].includes(keys[0])) {
    fail(400, "Only the PayPal order ID may be provided.");
  }
  const suppliedOrderId = body.paypalOrderId ?? body.orderID;
  const paypalOrderId = typeof suppliedOrderId === "string" ? suppliedOrderId.trim() : "";
  if (!paypalOrderId || paypalOrderId.length > 100) fail(400, "A valid PayPal order ID is required.");

  const existingOrder = await findExistingOrder(paypalOrderId);
  if (existingOrder) {
    if (!belongsToUser(existingOrder, user)) fail(404, "Checkout not found.");
    if (!isVerifiedLocalOrder(existingOrder, paypalOrderId)) {
      fail(409, "This legacy order requires payment reconciliation.");
    }
    return { order: existingOrder, created: false };
  }

  let checkout = await CheckoutSession.findOne({ paypalOrderId, user: user._id });
  if (!checkout) fail(404, "Checkout not found.");
  if (checkout.status === "COMPLETED" || checkout.order) {
    fail(409, "This checkout has already been finalized.");
  }
  if (checkout.expiresAt && checkout.expiresAt < new Date()) fail(410, "Checkout has expired.");

  await validateCurrentInventory(checkout);

  let paypalOrder;
  try {
    paypalOrder = await paypalService.getOrder(paypalOrderId);
  } catch (_error) {
    throw new CheckoutError(502, "PayPal could not verify the payment.");
  }
  getPurchaseUnit(paypalOrder, checkout);

  if (paypalOrder.status !== "APPROVED" && paypalOrder.status !== "COMPLETED") {
    fail(422, "The PayPal payment is not approved or completed.");
  }

  const paymentState = {
    paypalOrder,
    verifiedPayment:
      paypalOrder.status === "COMPLETED" ? verifyCompletedPayPalOrder(paypalOrder, checkout) : null,
    paymentMayBeCaptured: paypalOrder.status === "COMPLETED",
  };

  // Serialize confirmation before the irreversible capture call. A stale claim
  // can be reclaimed after a crashed process; a live claim returns a retryable
  // conflict without making a second PayPal capture request.
  const confirmationStartedAt = new Date();
  const staleClaimBefore = new Date(Date.now() - CONFIRMATION_CLAIM_TIMEOUT_MS);
  const recoveryExpiry = new Date(Date.now() + CONFIRMATION_RECOVERY_MS);
  const claimedCheckout = await CheckoutSession.findOneAndUpdate(
    {
      _id: checkout._id,
      user: user._id,
      order: { $exists: false },
      $or: [
        { status: { $in: ["CREATED", "CAPTURED"] } },
        { status: "CONFIRMING", confirmationStartedAt: { $lte: staleClaimBefore } },
        { status: "CONFIRMING", confirmationStartedAt: { $exists: false } },
      ],
    },
    {
      $set: { status: "CONFIRMING", confirmationStartedAt },
      $max: { expiresAt: recoveryExpiry },
    },
    { new: true },
  );
  if (!claimedCheckout) {
    const finalizedOrder = await findExistingOrder(paypalOrderId);
    if (
      finalizedOrder &&
      belongsToUser(finalizedOrder, user) &&
      isVerifiedLocalOrder(finalizedOrder, paypalOrderId)
    ) {
      return { order: finalizedOrder, created: false };
    }
    fail(409, "Order confirmation is already in progress. Please retry.");
  }
  checkout = claimedCheckout;

  try {
    return await finalizeCheckoutTransactionally(checkout, user, paymentState);
  } catch (error) {
    if (!paymentState.paymentMayBeCaptured) {
      await CheckoutSession.updateOne(
        {
          _id: checkout._id,
          status: "CONFIRMING",
          confirmationStartedAt: checkout.confirmationStartedAt,
        },
        { $set: { status: "CREATED" }, $unset: { confirmationStartedAt: "" } },
      ).catch(() => {});
    }
    if (isRetryableTransactionError(error)) {
      fail(409, "Order confirmation is already in progress or needs to be retried.");
    }
    if (!isDuplicateKeyError(error)) throw error;
    const captureId = paymentState.verifiedPayment?.captureId;
    const duplicate = await Order.findOne({
      $or: [
        { "paymentDetails.orderId": paypalOrderId },
        ...(captureId ? [{ "paymentDetails.captureId": captureId }] : []),
      ],
    });
    if (
      duplicate &&
      belongsToUser(duplicate, user) &&
      isVerifiedLocalOrder(duplicate, paypalOrderId, captureId)
    ) {
      return { order: duplicate, created: false };
    }
    fail(409, "The PayPal order or capture has already been used.");
  }
};
