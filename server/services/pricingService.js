import HttpError from "./HttpError.js";
import { validateInventory } from "./inventoryService.js";

export const SUPPORTED_SHIPPING_METHODS = new Set(["standard", "express", "foxpost"]);

const SHIPPING_FEE_BY_METHOD = {
  standard: (subtotal) => (subtotal >= 10000 ? 0 : 1490),
  foxpost: (subtotal) => (subtotal >= 10000 ? 0 : 1490),
  express: () => 3990,
};

export async function calculateOrderPricing({ items = [], shippingMethod }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError("No items provided", 400);
  }

  if (!SUPPORTED_SHIPPING_METHODS.has(shippingMethod)) {
    throw new HttpError("Unsupported shipping method", 400);
  }

  const validatedItems = await validateInventory(items);

  let subtotal = 0;
  const normalizedItems = [];

  for (const item of validatedItems) {
    const { productId, qty, product } = item;

    const unitPrice = Number(product.price);
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) {
      throw new HttpError("Product price must be an integer HUF amount", 422);
    }
    const lineTotal = qty * unitPrice;
    subtotal += lineTotal;

    normalizedItems.push({
      productId,
      name: product.name,
      image: product.image,
      qty,
      unitPrice,
      lineTotal,
    });
  }

  const shippingPrice = SHIPPING_FEE_BY_METHOD[shippingMethod](subtotal);
  const total = subtotal + shippingPrice;
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new HttpError("Invalid order total", 422);
  }

  return {
    items: normalizedItems,
    subtotal,
    shippingMethod,
    shippingPrice,
    total,
    currency: "HUF",
  };
}
