import express from "express";
import mongoose from "mongoose";
import asyncHandler from "express-async-handler";
import Order from "../models/Order.js";
import protectRoute from "../middleware/autMiddleware.js";
import { admin } from "../middleware/autMiddleware.js";
import { decrementInventory, validateInventory } from "../services/inventoryService.js";
import { calculateOrderPricing } from "../services/pricingService.js";
import * as paypalSvcImport from "../services/paypalService.js";

const orderRoutes = express.Router();
let paypalSvc = paypalSvcImport;

export const __setPayPalService = (mock) => {
  paypalSvc = mock || paypalSvcImport;
};

export const __resetPayPalService = () => {
  paypalSvc = paypalSvcImport;
};

const normalizeOrderItems = (items = []) =>
  items
    .filter(Boolean)
    .map((item) => ({
      productId: item?.productId ?? item?.product_id ?? item?.id ?? item?._id,
      qty: Number(item?.qty ?? item?.quantity ?? 1),
      name: item?.name,
      image: item?.image || "",
      price: Number(item?.price ?? item?.unitPrice ?? 0),
    }))
    .filter((item) => item.productId && Number.isFinite(item.qty) && item.qty > 0);

const parsePayPalItems = (items = []) =>
  items
    .filter(Boolean)
    .map((item) => {
      const productId = item?.sku ?? item?.product_id ?? item?.productId ?? item?.id ?? item?._id ?? null;
      const quantity = Number(item?.quantity ?? item?.qty ?? 1);
      const unitPrice = Number(item?.unit_amount?.value ?? item?.price ?? item?.unitPrice ?? 0);
      return { productId, qty: quantity, name: item?.name, image: item?.image || "", price: unitPrice };
    })
    .filter((item) => item.productId && Number.isFinite(item.qty) && item.qty > 0);

const createOrder = asyncHandler(async (req, res) => {
  const { orderItems = [], shippingAddress, paymentMethod, paymentDetails, shippingMethod } = req.body;

  const hasClientSuppliedPaymentData =
    Boolean(paymentDetails?.orderId || paymentDetails?.paypalOrderId) ||
    req.body?.shippingPrice != null ||
    req.body?.totalPrice != null ||
    req.body?.paymentStatus != null ||
    req.body?.paidAt != null ||
    req.body?.paypalOrderId != null ||
    req.body?.paypalCaptureId != null;

  if (hasClientSuppliedPaymentData) {
    res.status(400);
    throw new Error("Paid orders must be confirmed via /api/orders/confirm.");
  }

  if (!Array.isArray(orderItems) || orderItems.length === 0) {
    res.status(400);
    throw new Error("No order items.");
  }

  if (!shippingMethod) {
    res.status(400);
    throw new Error("Shipping method is required.");
  }

  if (paymentDetails?.orderId && mongoose.connection.readyState === 1) {
    try {
      const existingOrder = await Order.findOne({ "paymentDetails.orderId": paymentDetails.orderId });
      if (existingOrder) {
        return res.status(200).json(existingOrder);
      }
    } catch (error) {
      // Ignore idempotency lookup failures when the database is not connected in lightweight unit tests.
    }
  }

  const inventoryItems = orderItems.map((item) => ({
    productId: item?.product_id || item?.productId || item?.id,
    qty: item?.qty,
  }));

  const quote = await calculateOrderPricing({ items: inventoryItems, shippingMethod });

  const normalizedOrderItems = quote.items.map((item) => {
    const originalItem = orderItems.find(
      (candidate) =>
        String(candidate?.product_id || candidate?.productId || candidate?.id) === String(item.productId),
    );

    return {
      name: item.name,
      qty: item.qty,
      image: originalItem?.image || "",
      price: item.unitPrice,
      product_id: item.productId,
    };
  });

  const userFromToken = req.user;
  const session = mongoose.connection.readyState === 1 ? await mongoose.startSession() : null;

  try {
    let createdOrder;

    if (session) {
      await session.withTransaction(async () => {
        await validateInventory(inventoryItems);
        await decrementInventory(inventoryItems, session);

        const order = new Order({
          orderItems: normalizedOrderItems,
          user: userFromToken?._id,
          username: userFromToken?.name,
          email: userFromToken?.email,
          shippingAddress,
          paymentMethod,
          paymentDetails,
          shippingPrice: quote.shippingPrice,
          totalPrice: quote.total,
          paidAt: paymentDetails?.orderId ? new Date() : undefined,
        });

        createdOrder = await order.save({ session });
      });
    } else {
      await validateInventory(inventoryItems);
      await decrementInventory(inventoryItems);

      const order = new Order({
        orderItems: normalizedOrderItems,
        user: userFromToken?._id,
        username: userFromToken?.name,
        email: userFromToken?.email,
        shippingAddress,
        paymentMethod,
        paymentDetails,
        shippingPrice: quote.shippingPrice,
        totalPrice: quote.total,
        paidAt: paymentDetails?.orderId ? new Date() : undefined,
      });

      createdOrder = await order.save();
    }

    res.status(201).json(createdOrder);
  } catch (error) {
    throw error;
  } finally {
    if (session) {
      session.endSession();
    }
  }
});

const confirmOrder = asyncHandler(async (req, res) => {
  if (!req.user) {
    res.status(401);
    throw new Error("Not authorized, no user.");
  }

  const { orderID } = req.body || {};
  const normalizedPayPalOrderId = typeof orderID === "string" ? orderID.trim() : "";

  if (!normalizedPayPalOrderId) {
    res.status(400);
    throw new Error("Missing or invalid PayPal order ID.");
  }

  const existingOrder = await Order.findOne({ paypalOrderId: normalizedPayPalOrderId });
  if (existingOrder) {
    return res.status(200).json(existingOrder);
  }

  let paypalOrder;
  try {
    paypalOrder = await paypalSvc.getOrder(normalizedPayPalOrderId);
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Unable to verify PayPal order.");
  }

  if (!paypalOrder || !paypalOrder.id) {
    res.status(400);
    throw new Error("PayPal order is missing or invalid.");
  }

  const payerEmail = String(paypalOrder?.payer?.email_address || "").trim();
  if (!payerEmail) {
    res.status(403);
    throw new Error("PayPal payer information is missing.");
  }
  if (req.user?.email && payerEmail.toLowerCase() !== String(req.user.email).trim().toLowerCase()) {
    res.status(403);
    throw new Error("PayPal payer does not match the authenticated user.");
  }

  let captured;
  try {
    captured = await paypalSvc.captureOrder(normalizedPayPalOrderId, `confirm-${normalizedPayPalOrderId}`);
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "PayPal capture failed.");
  }

  const normalizedPayment = paypalSvc.normalizePayPalCapture(captured);

  if (normalizedPayment.status !== "COMPLETED") {
    res.status(402);
    throw new Error("PayPal payment is not completed.");
  }

  if (normalizedPayment.currency !== "HUF") {
    res.status(422);
    throw new Error("PayPal captured currency must be HUF.");
  }

  const purchaseUnit = Array.isArray(captured?.purchase_units) ? (captured.purchase_units[0] ?? {}) : {};
  const orderShippingAddress = {
    address: purchaseUnit.shipping?.address?.address_line_1 || "",
    city: purchaseUnit.shipping?.address?.admin_area_2 || "",
    postalCode: purchaseUnit.shipping?.address?.postal_code || "",
    country: purchaseUnit.shipping?.address?.country_code || "HU",
  };
  const rawItems = parsePayPalItems(purchaseUnit.items || []);
  if (!rawItems.length) {
    res.status(400);
    throw new Error("PayPal order has no verifiable line items.");
  }
  const shippingMethod = purchaseUnit.custom_id || "standard";
  const quote = await calculateOrderPricing({
    items: rawItems.map((item) => ({ productId: item.productId, qty: item.qty })),
    shippingMethod,
  });

  if (Number(normalizedPayment.value) !== Number(quote.total)) {
    res.status(422);
    throw new Error("Captured amount does not match the server-calculated total.");
  }

  const duplicateCaptureOrder = await Order.findOne({ paypalCaptureId: normalizedPayment.captureId });
  if (duplicateCaptureOrder) {
    return res.status(200).json(duplicateCaptureOrder);
  }

  const inventoryItems = quote.items.map((item) => ({ productId: item.productId, qty: item.qty }));
  const normalizedOrderItems = quote.items.map((item) => ({
    name: item.name,
    qty: item.qty,
    image: "",
    price: item.unitPrice,
    product_id: item.productId,
  }));

  const session = mongoose.connection.readyState === 1 ? await mongoose.startSession() : null;

  try {
    let createdOrder;

    if (session) {
      await session.withTransaction(async () => {
        await validateInventory(inventoryItems);
        await decrementInventory(inventoryItems, session);

        const order = new Order({
          orderItems: normalizedOrderItems,
          user: req.user._id,
          username: req.user.name,
          email: req.user.email,
          shippingAddress: orderShippingAddress,
          paymentMethod: "PayPal",
          paymentDetails: { orderId: normalizedPayPalOrderId, payerId: normalizedPayment.payerId },
          paypalOrderId: normalizedPayPalOrderId,
          paypalCaptureId: normalizedPayment.captureId,
          paymentStatus: normalizedPayment.status,
          shippingPrice: quote.shippingPrice,
          totalPrice: quote.total,
          paidAt: new Date(),
        });

        try {
          createdOrder = await order.save({ session });
        } catch (saveError) {
          if (saveError?.code === 11000) {
            const duplicateOrder = await Order.findOne({
              $or: [
                { paypalOrderId: normalizedPayPalOrderId },
                { paypalCaptureId: normalizedPayment.captureId },
              ],
            });
            if (duplicateOrder) {
              createdOrder = duplicateOrder;
              return;
            }
          }
          throw saveError;
        }
      });
    } else {
      await validateInventory(inventoryItems);
      await decrementInventory(inventoryItems);

      const order = new Order({
        orderItems: normalizedOrderItems,
        user: req.user._id,
        username: req.user.name,
        email: req.user.email,
        shippingAddress: orderShippingAddress,
        paymentMethod: "PayPal",
        paymentDetails: { orderId: normalizedPayPalOrderId, payerId: normalizedPayment.payerId },
        paypalOrderId: normalizedPayPalOrderId,
        paypalCaptureId: normalizedPayment.captureId,
        paymentStatus: normalizedPayment.status,
        shippingPrice: quote.shippingPrice,
        totalPrice: quote.total,
        paidAt: new Date(),
      });

      try {
        createdOrder = await order.save();
      } catch (saveError) {
        if (saveError?.code === 11000) {
          const duplicateOrder = await Order.findOne({
            $or: [
              { paypalOrderId: normalizedPayPalOrderId },
              { paypalCaptureId: normalizedPayment.captureId },
            ],
          });
          if (duplicateOrder) {
            createdOrder = duplicateOrder;
          } else {
            throw saveError;
          }
        } else {
          throw saveError;
        }
      }
    }

    res.status(201).json(createdOrder);
  } catch (error) {
    throw error;
  } finally {
    if (session) {
      session.endSession();
    }
  }
});

const getOrders = asyncHandler(async (_req, res) => {
  const orders = await Order.find({}).sort({ createdAt: -1 });
  res.json(orders);
});

const deleteOrder = asyncHandler(async (req, res) => {
  const order = await Order.findByIdAndDelete(req.params.id);
  if (!order) {
    res.status(404);
    throw new Error("Order not found.");
  }
  res.json({ _id: order._id });
});

const setDelivered = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) {
    res.status(404);
    throw new Error("Order not found.");
  }
  order.isDelivered = true;
  order.deliveredAt = new Date();
  const updatedOrder = await order.save();
  res.json(updatedOrder);
});

orderRoutes.route("/").post(protectRoute, createOrder).get(protectRoute, admin, getOrders);
orderRoutes.route("/confirm").post(protectRoute, confirmOrder);
orderRoutes.route("/:id").delete(protectRoute, admin, deleteOrder).put(protectRoute, admin, setDelivered);

export default orderRoutes;
export { createOrder, confirmOrder, getOrders, deleteOrder, setDelivered };
