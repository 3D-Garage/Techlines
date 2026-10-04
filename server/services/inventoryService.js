import mongoose from "mongoose";
import Product from "../models/Product.js";

export class InventoryError extends Error {
  constructor(message, statusCode = 400, code = "INVENTORY_ERROR") {
    super(message);
    this.name = "InventoryError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const normalizeInventoryProductId = (productId) => {
  if (productId === undefined || productId === null) {
    throw new InventoryError("Missing product ID.", 400, "INVALID_PRODUCT_ID");
  }

  const normalizedId = typeof productId === "string" ? productId.trim() : String(productId);
  if (!/^[a-f\d]{24}$/i.test(normalizedId)) {
    throw new InventoryError("Invalid product ID.", 400, "INVALID_PRODUCT_ID");
  }

  return normalizedId.toLowerCase();
};

export const normalizeInventoryQuantity = (qty) => {
  const quantity = Number(qty);

  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new InventoryError("Invalid quantity.", 400, "INVALID_QUANTITY");
  }

  return quantity;
};

export function aggregateInventory(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new InventoryError("No inventory items provided.", 400, "EMPTY_INVENTORY");
  }

  const grouped = new Map();
  for (const item of items) {
    if (!item || typeof item !== "object") {
      throw new InventoryError("Invalid inventory item.", 400, "INVALID_ITEM");
    }

    const productId = normalizeInventoryProductId(item.productId ?? item.product_id ?? item.id);
    const qty = normalizeInventoryQuantity(item.qty);
    grouped.set(productId, normalizeInventoryQuantity((grouped.get(productId) || 0) + qty));
  }
  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([productId, qty]) => ({ productId, qty }));
}

export async function validateInventory(items = []) {
  const validatedItems = [];
  for (const { productId, qty } of aggregateInventory(items)) {
    const product = await Product.findById(productId);

    if (!product) {
      throw new InventoryError("Product not found.", 404, "PRODUCT_NOT_FOUND");
    }

    const available = product.available ?? true;
    if (available !== true || product.archivedAt) {
      throw new InventoryError("Product is unavailable.", 409, "PRODUCT_UNAVAILABLE");
    }

    const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : Number.POSITIVE_INFINITY;
    if (qty > stock) {
      throw new InventoryError(
        `Requested quantity exceeds available stock for product ${productId}.`,
        409,
        "INSUFFICIENT_STOCK",
      );
    }

    validatedItems.push({
      productId,
      qty,
      product,
    });
  }

  return validatedItems;
}

export async function decrementInventory(items = [], session) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const decremented = [];

  for (const item of items) {
    const productId = normalizeInventoryProductId(item.productId ?? item.product_id ?? item.id);
    const qty = normalizeInventoryQuantity(item.qty ?? item.quantity);

    let updatedProduct;

    if (mongoose.connection.readyState === 1 && typeof Product.findOneAndUpdate === "function") {
      updatedProduct = await Product.findOneAndUpdate(
        {
          _id: productId,
          available: true,
          archivedAt: { $exists: false },
          stock: { $gte: qty },
        },
        {
          $inc: { stock: -qty, inventoryVersion: 1 },
        },
        {
          session,
          new: true,
          runValidators: true,
        },
      );
    } else {
      const product = await Product.findById(productId);
      if (!product) {
        throw new InventoryError("Product not found.", 404, "PRODUCT_NOT_FOUND");
      }

      const available = product.available ?? true;
      if (available !== true) {
        throw new InventoryError("Product is unavailable.", 409, "PRODUCT_UNAVAILABLE");
      }

      const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : Number.POSITIVE_INFINITY;
      if (qty > stock) {
        throw new InventoryError(
          `Requested quantity exceeds available stock for product ${productId}.`,
          409,
          "INSUFFICIENT_STOCK",
        );
      }

      product.stock = stock - qty;
      if (typeof product.save === "function") {
        await product.save({ session });
      }
      updatedProduct = product;
    }

    if (!updatedProduct) {
      throw new InventoryError(
        `Requested quantity exceeds available stock for product ${productId}.`,
        409,
        "INSUFFICIENT_STOCK",
      );
    }

    decremented.push({
      productId,
      qty,
      product: updatedProduct,
    });
  }

  return decremented;
}
