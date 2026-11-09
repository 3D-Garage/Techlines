import HttpError from "../services/HttpError.js";
import express from "express";
import User from "../models/User.js";
import asyncHandler from "express-async-handler";
import jwt from "jsonwebtoken";
import validator from "validator";
import protectRoute from "../middleware/autMiddleware.js";
import { admin } from "../middleware/autMiddleware.js";
import Order from "../models/Order.js";

const userRoutes = express.Router();

//TODO? redefine expiresIn
// Generates a JWT token with a 60-day expiration using the provided user ID and secret key
const genToken = (id) => {
  return jwt.sign({ id }, process.env.TOKEN_SECRET, { expiresIn: "60d" });
};

// Async function for handling user login, including user and password validation. Sends a JSON response with user data and a generated token if the credentials are valid, otherwise throws an error.
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    throw new HttpError("Email and password are required", 400);
  }
  const user = await User.findOne({ email });
  if (user && (await user.matchPasswords(password))) {
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      token: genToken(user._id),
      createdAt: user.createdAt,
    });
  } else {
    throw new HttpError("Invalid email or password", 401);
  }
});

function readAccountFields(body, required = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError("Invalid account data.", 400);
  }

  const fields = {};
  if (required || Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string" || !body.name.trim() || /[\x00-\x1f\x7f]/.test(body.name)) {
      throw new HttpError("A valid name is required.", 400);
    }
    fields.name = body.name.trim();
  }
  if (required || Object.hasOwn(body, "email")) {
    if (typeof body.email !== "string" || !validator.isEmail(body.email.trim())) {
      throw new HttpError("A valid email is required.", 400);
    }
    fields.email = body.email.trim();
  }
  if (required || Object.hasOwn(body, "password")) {
    if (typeof body.password !== "string" || body.password.length < 6 || !body.password.trim()) {
      throw new HttpError("Password must be at least 6 characters.", 400);
    }
    fields.password = body.password;
  }
  return fields;
}

const duplicateEmail = () => new HttpError("We already have an account with that email address.", 400);

const registerUser = asyncHandler(async (req, res) => {
  const fields = readAccountFields(req.body, true);
  if (await User.findOne({ email: fields.email })) throw duplicateEmail();
  let user;
  try {
    user = await User.create(fields);
  } catch (error) {
    if (error.code === 11000) throw duplicateEmail();
    throw error;
  }

  res.status(201).json({
    _id: user._id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    token: genToken(user._id),
  });
});

const updateUserProfile = asyncHandler(async (req, res) => {
  if (req.user._id.toString() !== req.params.id && !req.user.isAdmin) {
    throw new HttpError("Forbidden", 403);
  }

  const fields = readAccountFields(req.body);
  const user = await User.findById(req.params.id);
  if (!user) {
    throw new HttpError("User not found.", 404);
  }

  Object.assign(user, fields);
  let updatedUser;
  try {
    updatedUser = await user.save();
  } catch (error) {
    if (error.code === 11000) throw duplicateEmail();
    throw error;
  }

  res.json({
    _id: updatedUser._id,
    name: updatedUser.name,
    email: updatedUser.email,
    isAdmin: updatedUser.isAdmin,
    token: genToken(updatedUser._id),
    createdAt: updatedUser.createdAt,
  });
});

const getUserOrders = asyncHandler(async (req, res) => {
  if (req.user._id.toString() !== req.params.id && !req.user.isAdmin) {
    throw new HttpError("Orders not found.", 404);
  }

  const orders = await Order.find({ user: req.params.id, archivedAt: { $exists: false } }).sort({ createdAt: -1 });
  res.json(orders);
});

const getUsers = asyncHandler(async (_req, res) => {
  const users = await User.find({}).select("-password").sort({ createdAt: -1 });
  res.json(users);
});

const deleteUser = asyncHandler(async (req, res) => {
  if (req.user._id.toString() === req.params.id) {
    throw new HttpError("You cannot remove your own admin account.", 400);
  }

  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) {
    throw new HttpError("User not found.", 404);
  }
  res.json({ _id: user._id });
});

userRoutes.route("/login").post(loginUser);
userRoutes.route("/register").post(registerUser);
userRoutes.route("/profile/:id").put(protectRoute, updateUserProfile);
userRoutes.route("/").get(protectRoute, admin, getUsers);
userRoutes.route("/:id").get(protectRoute, getUserOrders).delete(protectRoute, admin, deleteUser);

export default userRoutes;
export { loginUser, registerUser, updateUserProfile, getUserOrders, getUsers, deleteUser, genToken };
