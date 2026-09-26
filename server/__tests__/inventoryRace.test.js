import { test } from "node:test";
import assert from "node:assert/strict";
import Product from "../models/Product.js";

async function reserveOneItem(productId) {
  const updatedProduct = await Product.findOneAndUpdate(
    { _id: productId, stock: { $gte: 1 } },
    { $inc: { stock: -1 } },
    { new: true },
  );

  if (!updatedProduct) {
    throw new Error("Out of stock");
  }

  return updatedProduct;
}

test("two buyers cannot both reserve the last item", async () => {
  const productId = "507f1f77bcf86cd799439011";
  const initialStock = 1;
  let currentStock = initialStock;

  Product.findOneAndUpdate = async (filter, update) => {
    const canReserve = filter.stock && filter.stock.$gte === 1 && currentStock >= 1;
    if (!canReserve) return null;

    currentStock = Math.max(0, currentStock + update.$inc.stock);
    return { _id: productId, stock: currentStock };
  };

  const results = await Promise.allSettled([reserveOneItem(productId), reserveOneItem(productId)]);

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected").length;

  assert.equal(fulfilled, 1);
  assert.equal(rejected, 1);
  assert.equal(currentStock, 0);
});
