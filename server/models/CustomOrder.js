import mongoose from "mongoose";
import { CUSTOM_ORDER_STATUSES } from "../services/customOrderValidation.js";

const modelFileSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    originalName: { type: String, required: true, maxlength: 255 },
    size: { type: Number, required: true, min: 1 },
    mimeType: { type: String, required: true, maxlength: 120 },
    extension: { type: String, required: true, enum: [".stl", ".obj", ".step", ".stp"] },
    uploadedAt: Date,
  },
  { _id: false },
);

const notificationSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["pending", "sent", "failed"], default: "pending", required: true },
    attemptedAt: Date,
    sentAt: Date,
  },
  { _id: false },
);

const customOrderSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true, trim: true, maxlength: 120 },
    customerEmail: { type: String, required: true, trim: true, maxlength: 254 },
    customerPhone: { type: String, required: true, trim: true, maxlength: 40 },
    description: {
      type: String,
      trim: true,
      maxlength: 10000,
      required() {
        return !this.modelFile;
      },
    },
    material: { type: String, maxlength: 120 },
    dimensions: { type: String, maxlength: 200 },
    quantity: { type: Number, min: 1, max: 10000, validate: Number.isInteger },
    modelFile: { type: modelFileSchema, default: undefined },
    status: { type: String, enum: CUSTOM_ORDER_STATUSES, default: "new", required: true },
    adminNotes: { type: String, maxlength: 10000, default: "" },
    notification: { type: notificationSchema, default: () => ({ status: "pending" }) },
  },
  { timestamps: true },
);

customOrderSchema.index({ createdAt: -1, _id: -1 });
customOrderSchema.index({ status: 1, createdAt: -1 });

const CustomOrder = mongoose.model("CustomOrder", customOrderSchema);
export default CustomOrder;
