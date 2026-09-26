import express from "express";
import asyncHandler from "express-async-handler";
import protectRoute from "../middleware/autMiddleware.js";
import {
  __resetPayPalService,
  __setPayPalService,
  createPayPalCheckout,
} from "../services/checkoutService.js";

const paypalRoutes = express.Router();

export const getPayPalClientIdHandler = (_req, res) => {
  if (!process.env.PAYPAL_CLIENT_ID) {
    res.status(503);
    return res.json({ message: "PayPal is not configured." });
  }
  return res.json({ clientId: process.env.PAYPAL_CLIENT_ID });
};

// POST /api/paypal/create-order
// Body: { items: [{ productId, qty }], shippingAddress, shippingMethod }
export const createPayPalOrderHandler = asyncHandler(async (req, res) => {
  const created = await createPayPalCheckout({ user: req.user, body: req.body });
  res.status(201).json(created);
});

paypalRoutes.post("/create-order", protectRoute, createPayPalOrderHandler);
paypalRoutes.get("/client-id", getPayPalClientIdHandler);

export default paypalRoutes;
export { __resetPayPalService, __setPayPalService };
