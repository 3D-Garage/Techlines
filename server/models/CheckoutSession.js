import mongoose from "mongoose";

const checkoutItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Product" },
    name: { type: String, required: true },
    image: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    qty: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const checkoutSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User", index: true },
    items: { type: [checkoutItemSchema], required: true },
    shippingAddress: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      postalCode: { type: String, required: true },
      country: { type: String, required: true },
    },
    shippingMethod: { type: String, required: true, enum: ["standard", "express"] },
    subtotal: { type: Number, required: true, min: 0 },
    shippingPrice: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: "HUF" },
    paypalOrderId: { type: String, trim: true },
    paypalCreateRequestId: { type: String, required: true, unique: true },
    paypalCaptureRequestId: { type: String, required: true, unique: true },
    captureId: { type: String, trim: true },
    status: {
      type: String,
      required: true,
      enum: ["CREATING", "CREATED", "CONFIRMING", "CAPTURED", "COMPLETED", "FAILED"],
      default: "CREATING",
    },
    confirmationStartedAt: { type: Date },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

checkoutSessionSchema.index({ paypalOrderId: 1 }, { unique: true, sparse: true });
checkoutSessionSchema.index({ captureId: 1 }, { unique: true, sparse: true });
checkoutSessionSchema.index({ order: 1 }, { unique: true, sparse: true });
checkoutSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const CheckoutSession = mongoose.model("CheckoutSession", checkoutSessionSchema);

export default CheckoutSession;
