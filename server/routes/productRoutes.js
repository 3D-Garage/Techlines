import express from "express";
import Product from "../models/Product.js";
import asyncHandler from "express-async-handler";

const productRoutes = express.Router();

const getProducts = asyncHandler(async (req, res) => {
  const products = await Product.find({ available: true });
  res.json(products);
});

const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (product) {
    res.json(product);
  } else {
    res.status(404);
    throw new Error("Product not found");
  }
});

productRoutes.route("/").get(getProducts);
productRoutes.route("/:id").get(getProduct);

export default productRoutes;
