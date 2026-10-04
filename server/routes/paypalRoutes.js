import express from "express";
import asyncHandler from "express-async-handler";
import protectRoute from "../middleware/autMiddleware.js";
import { createCheckout, checkoutResponse, __setPayPalService } from "../services/checkoutService.js";
const paypalRoutes = express.Router();
export { __setPayPalService };
export const getPayPalClientIdHandler = (_req, res) => {
  if (!process.env.PAYPAL_CLIENT_ID) return res.status(503).json({ message: "PayPal is not configured." });
  return res.json({ clientId: process.env.PAYPAL_CLIENT_ID });
};
export const createPayPalOrderHandler = asyncHandler(async (req, res) => {
  const attempt = await createCheckout(req.user, req.body);
  const status = ["FAILED", "EXPIRED", "REVIEW"].includes(attempt.status) ? 409 : attempt.paypalOrderId ? 200 : 202;
  res.status(status).json(await checkoutResponse(attempt));
});
export const capturePayPalOrderHandler = (_req, res) => res.status(410).json({ message: "Use /api/orders/confirm with checkoutId." });
paypalRoutes.post("/create-order", protectRoute, createPayPalOrderHandler);
paypalRoutes.post("/capture-order", capturePayPalOrderHandler);
paypalRoutes.get("/client-id", getPayPalClientIdHandler);
export default paypalRoutes;
