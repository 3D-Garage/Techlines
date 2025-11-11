import express from "express";
import asyncHandler from "express-async-handler";
import Order from "../models/Order.js";
import protectRoute from "../middleware/autMiddleware.js";

const orderRoutes = express.Router();

const createOrder = asyncHandler(async (req, res) => {
  const { orderItems, shippingAddress, paymentMethod, shippingPrice, totalPrice, paymentDetails } = req.body;
  if (orderItems && orderItems.length === 0) {
    res.status(400);
    throw new Error("No order items.");
  } else {
    // Prefer authenticated user from token over client-provided data
    const userFromToken = req.user;
    const order = new Order({
      orderItems,
      user: userFromToken?._id,
      username: userFromToken?.name,
      email: userFromToken?.email,
      shippingAddress,
      paymentMethod,
      paymentDetails,
      shippingPrice,
      totalPrice,
    });

    const createdOrder = await order.save();
    res.status(201).json(createdOrder);
  }
});

orderRoutes.route("/").post(protectRoute, createOrder);

export default orderRoutes;
export { createOrder };
