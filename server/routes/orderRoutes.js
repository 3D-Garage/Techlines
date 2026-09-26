import express from "express";
import asyncHandler from "express-async-handler";
import Order from "../models/Order.js";
import protectRoute from "../middleware/autMiddleware.js";
import { admin } from "../middleware/autMiddleware.js";
import { calculateOrderPricing } from "../services/pricingService.js";

const orderRoutes = express.Router();

const createOrder = asyncHandler(async (req, res) => {
  const { orderItems = [], shippingAddress, paymentMethod, paymentDetails, shippingMethod } = req.body;

  if (!Array.isArray(orderItems) || orderItems.length === 0) {
    res.status(400);
    throw new Error("No order items.");
  }

  if (!shippingMethod) {
    res.status(400);
    throw new Error("Shipping method is required.");
  }

  const quote = await calculateOrderPricing({
    items: orderItems.map((item) => ({
      productId: item?.product_id || item?.productId || item?.id,
      qty: item?.qty,
    })),
    shippingMethod,
  });

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

  const createdOrder = await order.save();
  res.status(201).json(createdOrder);
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
orderRoutes.route("/:id").delete(protectRoute, admin, deleteOrder).put(protectRoute, admin, setDelivered);

export default orderRoutes;
export { createOrder, getOrders, deleteOrder, setDelivered };
