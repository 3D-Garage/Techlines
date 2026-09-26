import express from "express";
import asyncHandler from "express-async-handler";
import { calculateOrderPricing } from "../services/pricingService.js";

const checkoutRoutes = express.Router();

export const createCheckoutQuoteHandler = asyncHandler(async (req, res) => {
  const { items = [], shippingMethod } = req.body || {};
  const quote = await calculateOrderPricing({ items, shippingMethod });
  res.json(quote);
});

checkoutRoutes.post("/quote", createCheckoutQuoteHandler);

export default checkoutRoutes;
