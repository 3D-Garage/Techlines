// Express app entry: load env, connect DB, register middleware/routes,
// centralize error handling, and start the HTTP server.
import dotenv from "dotenv";
import connectToDatabase from "./database.js";
import express from "express";

//Our Routes
import productRoutes from "./routes/productRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";

// Load environment variables from .env
dotenv.config();
// Initialize MongoDB connection
connectToDatabase();
const app = express();

// Parse JSON request bodies
app.use(express.json());

// Server port (fallback to 5000 if not set)
const port = process.env.Port || 5000;

// REST API routes
app.use("/api/products", productRoutes);
app.use("/api/users", userRoutes);
app.use("/api/orders", orderRoutes);

// Centralized error handler to return consistent JSON errors
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  res.status(status).json({ message: err.message });
});

// Start HTTP server
app.listen(port, () => {
  console.log(`Server runs on port ${port}.`);
});
