import dotenv from "dotenv";
import connectToDatabase from "./database.js";
import express from "express";
import rateLimit from "./middleware/rateLimit.js";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";

//Our Routes
import productRoutes from "./routes/productRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import paypalRoutes from "./routes/paypalRoutes.js";

dotenv.config();
connectToDatabase();
const app = express();

// Body parser with size limit
app.use(express.json({ limit: "100kb" }));

// Minimal security headers without external deps
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "0");
  next();
});

// Minimal CORS control (allow specific origin if provided)
app.use((req, res, next) => {
  const allowedOrigin = process.env.CORS_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Basic rate limits for sensitive routes
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const ordersLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

app.use("/api/users/login", loginLimiter);
app.use("/api/orders", ordersLimiter);

app.use("/api/products", productRoutes);
app.use("/api/users", userRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/paypal", paypalRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server runs on port ${port}.`);
});
