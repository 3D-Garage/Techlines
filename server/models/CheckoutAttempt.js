import mongoose from "mongoose";
import Order from "./Order.js";

// Reuse the complete order schema so the future order is validated before capture.
const checkoutSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  requestId: { type: String, required: true },
  fingerprint: { type: String, required: true },
  snapshot: { type: Order.schema, required: true, excludeIndexes: true },
  quote: { type: mongoose.Schema.Types.Mixed, required: true },
  merchantId: { type: String, required: true },
  createRequestId: { type: String, required: true },
  captureRequestId: { type: String, required: true },
  paypalOrderId: { type: String },
  paypalCaptureId: { type: String },
  order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
  status: { type: String, enum: ["CREATING", "READY", "PROCESSING", "REVIEW", "COMPLETED", "FAILED", "EXPIRED"], default: "CREATING" },
  expiresAt: { type: Date, required: true },
  processingStartedAt: Date,
  captureAttemptedAt: Date,
  reservation: { type: String, enum: ["NONE", "HELD", "CONSUMED", "RELEASED"], default: "NONE" },
  lockToken: String,
  lockUntil: Date,
  nextCheckAt: { type: Date, default: Date.now },
  issue: String,
}, { timestamps: true, autoIndex: false });

checkoutSchema.index({ user: 1, requestId: 1 }, { unique: true });
checkoutSchema.index({ paypalOrderId: 1 }, { unique: true, sparse: true });
checkoutSchema.index({ paypalCaptureId: 1 }, { unique: true, sparse: true });
checkoutSchema.index({ status: 1, nextCheckAt: 1 });

export default mongoose.model("CheckoutAttempt", checkoutSchema);
