import HttpError from "../services/HttpError.js";
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../models/User.js";

const protectRoute = asyncHandler(async (req, _res, next) => {
  const authorization = req.headers.authorization;
  const token = typeof authorization === "string"
    ? /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(authorization)?.[1]
    : undefined;
  if (!token) {
    throw new HttpError("Not authorized, no valid Bearer token.", 401);
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.TOKEN_SECRET);
  } catch {
    throw new HttpError("Not authorized, token failed.", 401);
  }
  if (typeof decoded?.id !== "string" || !decoded.id) {
    throw new HttpError("Not authorized, token failed.", 401);
  }

  req.user = await User.findById(decoded.id).select("-password");
  if (!req.user) {
    throw new HttpError("Not authorized, user not found.", 401);
  }
  next();
});

const admin = (req, _res, next) => {
  if (req.user?.isAdmin === true) {
    return next();
  }

  throw new HttpError("Not authorized as an admin.", 403);
};

export { protectRoute, admin };
export default protectRoute;
