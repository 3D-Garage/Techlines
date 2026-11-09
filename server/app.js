import express from "express";
import rateLimit from "./middleware/rateLimit.js";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";
import { mountStorefront } from "./middleware/storefront.js";

import productRoutes from "./routes/productRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import paypalRoutes from "./routes/paypalRoutes.js";
import checkoutRoutes from "./routes/checkoutRoutes.js";
import shippingRoutes from "./routes/shippingRoutes.js";
import customOrderRoutes from "./routes/customOrderRoutes.js";

function corsOrigin() {
  const configured = process.env.CORS_ORIGIN?.trim();
  if (process.env.NODE_ENV !== "production") return configured || "*";

  try {
    const url = new URL(configured);
    if (url.protocol === "https:" && url.origin === configured && !url.hostname.includes("*")) return configured;
  } catch {
    // A missing or invalid origin fails startup in production.
  }
  throw new Error("CORS_ORIGIN must be an explicit HTTPS origin in production.");
}

export function createApp({ storefrontDirectory, cspMode = process.env.STOREFRONT_CSP_MODE || "enforce" } = {}) {
  const allowedOrigin = corsOrigin();
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-XSS-Protection", "0");
    next();
  });

  app.use("/api", (req, res, next) => {
    if (allowedOrigin !== "*") res.vary("Origin");
    if (allowedOrigin === "*" || req.get("Origin") === allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
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

  if (storefrontDirectory) {
    app.use("/api", notFound);
    mountStorefront(app, storefrontDirectory, cspMode);
  }
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
