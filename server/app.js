import express from "express";
import rateLimit from "./middleware/rateLimit.js";
import { errorHandler, notFound } from "./middleware/errorMiddleware.js";
import orderRoutes from "./routes/orderRoutes.js";
import paypalRoutes from "./routes/paypalRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import userRoutes from "./routes/userRoutes.js";

export const createApp = () => {
  const app = express();

  app.use(express.json({ limit: "100kb" }));

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
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
  const ordersLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
  const checkoutCreationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

  app.use("/api/users/login", loginLimiter);
  app.use("/api/orders", ordersLimiter);
  app.use("/api/paypal/create-order", checkoutCreationLimiter);

  app.use("/api/products", productRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/paypal", paypalRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
};

export default createApp;
