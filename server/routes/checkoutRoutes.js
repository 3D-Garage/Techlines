import express from "express";
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import protectRoute, { admin } from "../middleware/autMiddleware.js";
import CheckoutAttempt from "../models/CheckoutAttempt.js";
import { calculateOrderPricing } from "../services/pricingService.js";
import { ownedCheckout, checkoutResponse, processCheckout, cancelCheckout } from "../services/checkoutService.js";
const checkoutRoutes = express.Router();
export const createCheckoutQuoteHandler = asyncHandler(async (req, res) => res.json(await calculateOrderPricing(req.body || {})));
export const getCheckout = asyncHandler(async (req, res) => res.json(await checkoutResponse(await ownedCheckout(req.params.id, req.user))));
export const cancelCheckoutHandler = asyncHandler(async (req, res) => {
  const attempt = await cancelCheckout(req.params.id, req.user);
  res.status(["FAILED", "EXPIRED"].includes(attempt.status) ? 200 : 409).json(await checkoutResponse(attempt));
});
export const pendingCheckouts = asyncHandler(async (_req, res) => res.json(await CheckoutAttempt.find({ status: { $in: ["CREATING", "PROCESSING", "REVIEW"] } })
  .select("user status reservation paypalOrderId processingStartedAt nextCheckAt issue createdAt").sort({ createdAt: 1 })));
export const reconcileCheckout = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id) || !await CheckoutAttempt.exists({ _id: req.params.id })) { res.status(404); throw new Error("Checkout not found."); }
  // Admin can inspect provider evidence, but cannot initiate/retry a capture.
  await processCheckout(req.params.id, { queryOnly: true });
  res.json(await checkoutResponse(await CheckoutAttempt.findById(req.params.id)));
});
checkoutRoutes.post("/quote", createCheckoutQuoteHandler);
checkoutRoutes.get("/admin/pending", protectRoute, admin, pendingCheckouts);
checkoutRoutes.post("/:id/reconcile", protectRoute, admin, reconcileCheckout);
checkoutRoutes.post("/:id/cancel", protectRoute, cancelCheckoutHandler);
checkoutRoutes.get("/:id", protectRoute, getCheckout);
export default checkoutRoutes;
