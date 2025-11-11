// Product API routes: list available products and fetch a product by id
import express from "express";
import asyncHandler from "express-async-handler";
import Product from "../models/Product.js";

const productRoutes = express.Router();

// GET /api/products - list available products
const getProducts = asyncHandler(async (req, res) => {
  const products = await Product.find({ available: true });
  res.json(products);
});

// GET /api/products/:id - fetch product by id, 404 if not found
const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (product) {
    res.json(product);
  } else {
    res.status(404);
    throw new Error("Product not found");
  }
});

// Wire routes
productRoutes.route("/").get(getProducts);
productRoutes.route("/:id").get(getProduct);

export default productRoutes;
