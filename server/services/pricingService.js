import mongoose from "mongoose";
import Product from "../models/Product.js";

export const SUPPORTED_SHIPPING_METHODS = new Set(["standard", "express"]);

const SHIPPING_FEE_BY_METHOD = {
  standard: (subtotal) => (subtotal >= 10000 ? 0 : 1490),
  express: () => 3990,
};

const validateProductId = (productId) => {
  if (typeof productId !== "string" || !productId.trim() || !mongoose.Types.ObjectId.isValid(productId)) {
    throw new Error("Invalid product ID");
  }

  return productId.trim();
};

const validateQuantity = (qty) => {
  const quantity = Number(qty);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Invalid quantity");
  }

  return quantity;
};

export async function calculateOrderPricing({ items = [], shippingMethod }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("No items provided");
  }

  if (!SUPPORTED_SHIPPING_METHODS.has(shippingMethod)) {
    throw new Error("Unsupported shipping method");
  }

  let subtotal = 0;
  const normalizedItems = [];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      throw new Error("Invalid item data");
    }

    const productId = validateProductId(item.productId);
    const qty = validateQuantity(item.qty);
    const product = await Product.findById(productId);

    if (!product) {
      throw new Error("Product not found");
    }

    const unitPrice = Number(product.price);
    const lineTotal = qty * unitPrice;
    subtotal += lineTotal;

    normalizedItems.push({
      productId,
      name: product.name,
      qty,
      unitPrice,
      lineTotal,
    });
  }

  const shippingPrice = SHIPPING_FEE_BY_METHOD[shippingMethod](subtotal);
  const total = subtotal + shippingPrice;

  return {
    items: normalizedItems,
    subtotal,
    shippingMethod,
    shippingPrice,
    total,
    currency: "HUF",
  };
}
