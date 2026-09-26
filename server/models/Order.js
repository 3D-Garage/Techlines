import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    username: { type: String, required: true, ref: "User" },
    email: { type: String, required: true, ref: "User" },
    orderItems: [
      {
        name: { type: String, required: true },
        qty: { type: Number, required: true },
        image: { type: String, required: true },
        price: { type: Number, required: true },
        product_id: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "Product" },
      },
    ],
    shippingAddress: {
      address: { type: String, required: true },
      city: { type: String, required: true },
      postalCode: { type: String, required: true },
      country: { type: String, required: true },
    },
    paymentMethod: {
      type: String,
      default: "PayPal",
    },
    paymentDetails: {
      provider: { type: String, required: true, default: "PayPal" },
      orderId: { type: String, required: true },
      captureId: { type: String, required: true },
      status: { type: String, required: true, enum: ["COMPLETED"] },
      amount: { type: Number, required: true, min: 0 },
      currency: { type: String, required: true },
      payerId: { type: String },
    },
    shippingPrice: {
      type: Number,
      default: 0.0,
    },
    totalPrice: { type: Number, default: 0.0 },
    paidAt: { type: Date, required: true },
    checkoutSession: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "CheckoutSession",
    },
    isDelivered: { type: Boolean, required: true, default: false },
    deliveredAt: { type: Date },
  },
  { timestamps: true }
);

orderSchema.index(
  { "paymentDetails.orderId": 1 },
  {
    unique: true,
    partialFilterExpression: { "paymentDetails.orderId": { $type: "string" } },
  }
);
orderSchema.index(
  { "paymentDetails.captureId": 1 },
  {
    unique: true,
    partialFilterExpression: { "paymentDetails.captureId": { $type: "string" } },
  }
);
orderSchema.index(
  { checkoutSession: 1 },
  {
    unique: true,
    partialFilterExpression: { checkoutSession: { $type: "objectId" } },
  }
);

const Order = mongoose.model("Order", orderSchema);
export default Order;
