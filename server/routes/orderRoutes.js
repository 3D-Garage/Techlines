import express from "express";
import asyncHandler from "express-async-handler";
import Order from "../models/Order.js";
import protectRoute from "../middleware/autMiddleware.js";
import { admin } from "../middleware/autMiddleware.js";

const orderRoutes = express.Router();

const createOrder = asyncHandler(async (req, res) => {
  const { orderItems, shippingAddress, paymentMethod, shippingPrice, totalPrice, paymentDetails } = req.body;
  if (orderItems && orderItems.length === 0) {
    res.status(400);
    throw new Error("No order items.");
  } else {
    // Prefer authenticated user from token over client-provided data
    const userFromToken = req.user;
    const order = new Order({
      orderItems,
      user: userFromToken?._id,
      username: userFromToken?.name,
      email: userFromToken?.email,
      shippingAddress,
      paymentMethod,
      paymentDetails,
      shippingPrice,
      totalPrice,
      paidAt: paymentDetails?.orderId ? new Date() : undefined,
    });

    const createdOrder = await order.save();
    res.status(201).json(createdOrder);
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
orderRoutes.route("/:id").delete(protectRoute, admin, deleteOrder).put(protectRoute, admin, setDelivered);

export default orderRoutes;
export { createOrder, getOrders, deleteOrder, setDelivered };
