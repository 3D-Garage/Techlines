import express from "express";
import asyncHandler from "express-async-handler";
import protectRoute from "../middleware/autMiddleware.js";
import Product from "../models/Product.js";
import * as paypalSvcImport from "../services/paypalService.js";

const paypalRoutes = express.Router();

// indirection to allow mocking in tests
let svc = paypalSvcImport;
export const __setPayPalService = (mock) => {
  svc = mock;
};

// Computes total from items using DB prices
async function computeTotalFromItems(items = []) {
  let subtotal = 0;
  for (const it of items) {
    const product = await Product.findById(it.productId);
    if (!product) throw new Error("Invalid product in order items");
    const qty = Number(it.qty || 0);
    subtotal += qty * Number(product.price);
  }
  return subtotal;
}

// POST /api/paypal/create-order
// Body: { items: [{ productId, qty }], shippingPrice }
export const createPayPalOrderHandler = asyncHandler(async (req, res) => {
  const { items = [], shippingPrice = 0 } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400);
    throw new Error("No items provided");
  }
  const subtotal = await computeTotalFromItems(items);
  const total = Math.round(Number(subtotal) + Number(shippingPrice)); // HUF integer
  const created = await svc.createOrder({ total, currency: "HUF" });
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

export default paypalRoutes;

