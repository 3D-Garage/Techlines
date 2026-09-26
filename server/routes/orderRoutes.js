import express from "express";
import asyncHandler from "express-async-handler";
import Order from "../models/Order.js";
import protectRoute, { admin } from "../middleware/autMiddleware.js";
import { confirmPayPalCheckout } from "../services/checkoutService.js";

const orderRoutes = express.Router();

export const rejectDirectOrderCreation = (_req, res) => {
  res.status(405);
  throw new Error("Orders can only be created by confirming a verified PayPal payment.");
};

export const confirmOrder = asyncHandler(async (req, res) => {
  const { order, created } = await confirmPayPalCheckout({ user: req.user, body: req.body });
  res.status(created ? 201 : 200).json(order);
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
  // Use an update query so legacy orders created before verified-payment fields
  // were introduced can still be marked delivered without a full-document save.
  const order = await Order.findByIdAndUpdate(
    req.params.id,
    { $set: { isDelivered: true, deliveredAt: new Date() } },
    { new: true, runValidators: true }
  );
  if (!order) {
    res.status(404);
    throw new Error("Order not found.");
  }
  res.json(order);
});

orderRoutes.post("/confirm", protectRoute, confirmOrder);
orderRoutes.route("/").post(protectRoute, rejectDirectOrderCreation).get(protectRoute, admin, getOrders);
orderRoutes.route("/:id").delete(protectRoute, admin, deleteOrder).put(protectRoute, admin, setDelivered);

export default orderRoutes;
export { getOrders, deleteOrder, setDelivered };
