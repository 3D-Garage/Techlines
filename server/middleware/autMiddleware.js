// JWT authentication middleware: validates Bearer token and attaches user
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../models/User.js";

// Guard protected routes; 401 on missing/invalid token
const protectRoute = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.TOKEN_SECRET);
      req.user = User.findById(decoded.id);
      next();
    } catch (error) {
      res.status(401);
      throw new Error("Not authorized, token failed.");
    }
  }

  if (!token) {
    res.status(401);
    throw new Error("No authorized,no token.");
  }
});

export default protectRoute;
