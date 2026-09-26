import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Product from "../models/Product.js";
import { validateInventory, decrementInventory } from "../services/inventoryService.js";

const PRODUCT_ID = "507f1f77bcf86cd799439011";

const mockValidProduct = (overrides = {}) => ({
  _id: PRODUCT_ID,
  name: "Sample product",
  price: 2000,
  stock: 5,
  available: true,
  ...overrides,
});

test("validateInventory rejects qty = 0", async () => {
  Product.findById = async () => mockValidProduct();

  await assert.rejects(() => validateInventory([{ productId: PRODUCT_ID, qty: 0 }]), /quantity/i);
});

test("validateInventory rejects negative quantity", async () => {
  Product.findById = async () => mockValidProduct();

  await assert.rejects(() => validateInventory([{ productId: PRODUCT_ID, qty: -1 }]), /quantity/i);
});

test("validateInventory rejects non-integer quantity", async () => {
  Product.findById = async () => mockValidProduct();

  await assert.rejects(() => validateInventory([{ productId: PRODUCT_ID, qty: 1.5 }]), /quantity/i);
});

test("validateInventory rejects malformed product IDs", async () => {
  Product.findById = async () => mockValidProduct();

  await assert.rejects(
    () => validateInventory([{ productId: "bad-id", qty: 1 }]),
    /invalid product id|malformed/i,
  );
});

test("validateInventory rejects unavailable products", async () => {
  Product.findById = async () => mockValidProduct({ available: false });

  await assert.rejects(
    () => validateInventory([{ productId: PRODUCT_ID, qty: 1 }]),
    /unavailable|not available/i,
  );
});

test("validateInventory rejects qty greater than stock", async () => {
  Product.findById = async () => mockValidProduct({ stock: 1 });

  await assert.rejects(() => validateInventory([{ productId: PRODUCT_ID, qty: 2 }]), /stock|insufficient/i);
});

test("decrementInventory prevents overselling the last unit", async () => {
  const originalReadyState = mongoose.connection.readyState;
  const productId = PRODUCT_ID;
  let currentStock = 1;

  mongoose.connection.readyState = 1;
  Product.findOneAndUpdate = async (filter, update) => {
    if (filter.stock && filter.stock.$gte && currentStock < filter.stock.$gte) {
      return null;
    }
    currentStock += update.$inc.stock;
    return { _id: productId, stock: currentStock, available: true };
  };

  try {
    const results = await Promise.allSettled([
      decrementInventory([{ productId, qty: 1 }]),
      decrementInventory([{ productId, qty: 1 }]),
    ]);

    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(currentStock, 0);
  } finally {
    mongoose.connection.readyState = originalReadyState;
  }
});
