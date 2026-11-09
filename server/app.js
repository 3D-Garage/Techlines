import express from "express";
import rateLimit from "./middleware/rateLimit.js";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";

import productRoutes from "./routes/productRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import paypalRoutes from "./routes/paypalRoutes.js";
import checkoutRoutes from "./routes/checkoutRoutes.js";
import shippingRoutes from "./routes/shippingRoutes.js";
import customOrderRoutes from "./routes/customOrderRoutes.js";

export function createApp() {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-XSS-Protection", "0");
    next();
  });

  app.use((req, res, next) => {
    const allowedOrigin = process.env.CORS_ORIGIN || "*";
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
  const ordersLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

  app.use("/api/users/login", loginLimiter);
  app.use("/api/orders", ordersLimiter);

  // This router applies its submission limiter before parsing either JSON or multipart.
  app.use("/api/custom-orders", customOrderRoutes);
  app.use(express.json({ limit: "100kb" }));

  app.use("/api/products", productRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/checkout", checkoutRoutes);
  app.use("/api/shipping", shippingRoutes);
  app.use("/api/paypal", paypalRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
