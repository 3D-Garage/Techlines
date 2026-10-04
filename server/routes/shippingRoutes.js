import express from "express";
import asyncHandler from "express-async-handler";
import { getFoxpostLockers } from "../services/foxpostService.js";

const shippingRoutes = express.Router();
shippingRoutes.get("/foxpost/lockers", asyncHandler(async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ lockers: await getFoxpostLockers() });
}));
export default shippingRoutes;
