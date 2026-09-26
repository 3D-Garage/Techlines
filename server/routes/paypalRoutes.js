import express from "express";
import asyncHandler from "express-async-handler";
import protectRoute from "../middleware/autMiddleware.js";
import * as paypalSvcImport from "../services/paypalService.js";
import { calculateOrderPricing } from "../services/pricingService.js";

const paypalRoutes = express.Router();

export const getPayPalClientIdHandler = (_req, res) => {
  if (!process.env.PAYPAL_CLIENT_ID) {
    res.status(503);
    return res.json({ message: "PayPal is not configured." });
  }
  return res.json({ clientId: process.env.PAYPAL_CLIENT_ID });
};

// indirection to allow mocking in tests
let svc = paypalSvcImport;
export const __setPayPalService = (mock) => {
  svc = mock;
};

// POST /api/paypal/create-order
// Body: { items: [{ productId, qty }], shippingMethod }
export const createPayPalOrderHandler = asyncHandler(async (req, res) => {
  const { items = [], shippingMethod, shippingAddress } = req.body || {};
  const quote = await calculateOrderPricing({ items, shippingMethod });
  const created = await svc.createOrder({
    total: quote.total,
    currency: quote.currency,
    items: quote.items,
    shippingMethod: quote.shippingMethod,
    shippingAddress,
  });
  res.json({ id: created.id });
});

// POST /api/paypal/capture-order
// Body: { orderID }
export const capturePayPalOrderHandler = asyncHandler(async (req, res) => {
  const { orderID } = req.body || {};
  if (!orderID) {
    res.status(400);
    throw new Error("Missing orderID");
  }
  const captured = await svc.captureOrder(orderID);
  res.json(captured);
});

paypalRoutes.post("/create-order", protectRoute, createPayPalOrderHandler);
paypalRoutes.post("/capture-order", protectRoute, capturePayPalOrderHandler);
paypalRoutes.get("/client-id", getPayPalClientIdHandler);

export default paypalRoutes;
