import express from "express";
import Product from "../models/Product.js";

const productRotes = express.Router();

const getProducts = async (req, res) => {
  const products = await Product.find({ available: true });
  res.json(products);
};

const getProduct = async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (product) {
    res.json(product);
  } else {
    res.status(404);
    throw new Error("Product not found");
  }
};

productRotes.route("/").get(getProducts);
productRotes.route("/:id").get(getProduct);

export default productRotes;
