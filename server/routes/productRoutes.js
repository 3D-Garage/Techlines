import express from "express";
import Product from "../models/Product.js";
import asyncHandler from "express-async-handler";
import protectRoute, { admin } from "../middleware/autMiddleware.js";

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

const createProductReview = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error("Product not found.");
  }

  const alreadyReviewed = product.reviews.some(
    (review) => review.user.toString() === req.user._id.toString()
  );
  if (alreadyReviewed) {
    res.status(400);
    throw new Error("You have already reviewed this product.");
  }

  const rating = Number(req.body.rating);
  const comment = String(req.body.comment || "").trim();
  const title = String(req.body.title || "Review").trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !comment) {
    res.status(400);
    throw new Error("A rating from 1 to 5 and a comment are required.");
  }

  product.reviews.push({ name: req.user.name, rating, comment, title, user: req.user._id });
  product.numberOfReviews = product.reviews.length;
  product.rating = product.reviews.reduce((sum, review) => sum + review.rating, 0) / product.reviews.length;
  await product.save();
  res.status(201).json(product);
});

const createProduct = asyncHandler(async (req, res) => {
  const product = await Product.create({
    name: req.body.name,
    image: req.body.image,
    brand: req.body.brand,
    category: req.body.category,
    description: req.body.description,
    price: Number(req.body.price),
    stock: Number(req.body.stock),
    productIsNew: Boolean(req.body.productIsNew),
  });
  res.status(201).json(product);
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error("Product not found.");
  }

  for (const field of ["name", "image", "brand", "category", "description"]) {
    if (req.body[field] !== undefined) product[field] = req.body[field];
  }
  if (req.body.price !== undefined) product.price = Number(req.body.price);
  if (req.body.stock !== undefined) product.stock = Number(req.body.stock);
  if (req.body.productIsNew !== undefined) product.productIsNew = Boolean(req.body.productIsNew);
  const updatedProduct = await product.save();
  res.json(updatedProduct);
});

const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error("Product not found.");
  }
  res.json({ _id: product._id });
});

const removeProductReview = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId);
  if (!product) {
    res.status(404);
    throw new Error("Product not found.");
  }

  const previousCount = product.reviews.length;
  product.reviews = product.reviews.filter(
    (review) => review._id.toString() !== req.params.reviewId
  );
  if (product.reviews.length === previousCount) {
    res.status(404);
    throw new Error("Review not found.");
  }
  product.numberOfReviews = product.reviews.length;
  product.rating = product.reviews.length
    ? product.reviews.reduce((sum, review) => sum + review.rating, 0) / product.reviews.length
    : 0;
  await product.save();
  res.json(product);
});

productRoutes.route("/").get(getProducts).post(protectRoute, admin, createProduct);
productRoutes.route("/reviews/:id").post(protectRoute, createProductReview);
productRoutes.route("/:productId/reviews/:reviewId").delete(protectRoute, admin, removeProductReview);
productRoutes.route("/:id").get(getProduct).put(protectRoute, admin, updateProduct).delete(protectRoute, admin, deleteProduct);

export default productRoutes;
export { getProducts, getProduct, createProductReview, createProduct, updateProduct, deleteProduct, removeProductReview };
