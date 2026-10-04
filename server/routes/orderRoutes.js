import express from "express";
import asyncHandler from "express-async-handler";
import Order from "../models/Order.js";
import CheckoutAttempt from "../models/CheckoutAttempt.js";
import mongoose from "mongoose";
import protectRoute, { admin } from "../middleware/autMiddleware.js";
import { ownedCheckout, checkoutResponse, processCheckout, __setPayPalService } from "../services/checkoutService.js";

const orderRoutes = express.Router();
export { __setPayPalService };
export const __resetPayPalService = () => __setPayPalService(null);
export const createOrder = (_req, res) => res.status(410).json({ message: "Use /api/paypal/create-order and /api/orders/confirm." });
export const confirmOrder = asyncHandler(async (req, res) => {
  const attempt = await ownedCheckout(req.body?.checkoutId, req.user);
  await processCheckout(attempt._id);
  const result = await checkoutResponse(await ownedCheckout(String(attempt._id), req.user));
  if (result.status === "COMPLETED" && result.order) return res.json(result.order);
  return res.status(["FAILED", "EXPIRED"].includes(result.status) ? 409 : 202).json(result);
});
export const getOrders = asyncHandler(async (_req, res) => res.json(await Order.find({ archivedAt: { $exists: false } }).sort({ createdAt: -1 })));
export const getOrder = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404); throw new Error("Order not found."); }
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
  if (!order) { res.status(404); throw new Error("Order not found."); }
  res.json(order);
});
export const deleteOrder = asyncHandler(async (req, res) => {
  const order = await Order.findByIdAndUpdate(req.params.id, { $set: { archivedAt: new Date() } }, { new: true });
  if (!order) { res.status(404); throw new Error("Order not found."); }
  res.json({ _id: order._id });
});
export const setDelivered = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) { res.status(404); throw new Error("Order not found."); }
  const proof = order.checkoutId && await CheckoutAttempt.findOne({ _id: order.checkoutId, user: order.user, order: order._id,
    status: "COMPLETED", paypalOrderId: order.paypalOrderId, paypalCaptureId: order.paypalCaptureId });
  if (order.archivedAt || order.paymentStatus !== "COMPLETED" || !order.paidAt || !order.paypalOrderId || !order.paypalCaptureId || !proof) {
    res.status(409); throw new Error("Only a verified paid catalog order can be delivered.");
  }
  order.isDelivered = true;
  order.deliveredAt = new Date();
  res.json(await order.save());
});
orderRoutes.route("/").post(createOrder).get(protectRoute, admin, getOrders);
orderRoutes.post("/confirm", protectRoute, confirmOrder);
orderRoutes.route("/:id").get(protectRoute, getOrder).delete(protectRoute, admin, deleteOrder).put(protectRoute, admin, setDelivered);
export default orderRoutes;
