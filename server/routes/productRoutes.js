import express from "express";
import Product from "../models/Product.js";

const productRotes = express.Router();

const getProducts = async (req, res) => {
  const products = await Product.find({});
  res.json(products);
};

productRotes.route("/").get(getProducts);

export default productRotes;
