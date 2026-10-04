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
    shippingMethod: { type: String },
    recipientPhone: { type: String, required: function () { return this.shippingMethod === "foxpost"; }, validate: { validator: function (value) { return this.shippingMethod !== "foxpost" || /^\+36(?:20|30|31|50|51|70)\d{7}$/.test(value); }, message: "Invalid recipient mobile phone" } },
    foxpostLocker: {
      type: new mongoose.Schema({
        place_id: { type: String, required: true },
        operator_id: { type: String, required: true },
        name: { type: String, required: true },
        type: { type: String, enum: ["A-BOX", "Z-BOX"], required: true },
        address: { type: String, required: true },
        street: { type: String, required: true },
        city: { type: String, required: true },
        postalCode: { type: String, required: true },
        country: { type: String, required: true },
      }, { _id: false }),
      required: function () { return this.shippingMethod === "foxpost"; },
    },
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
      orderId: { type: String },
      payerId: { type: String },
    },
    paypalOrderId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    paypalCaptureId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    checkoutId: { type: mongoose.Schema.Types.ObjectId, unique: true, sparse: true },
    archivedAt: { type: Date },
    paymentStatus: {
      type: String,
      default: "PENDING",
    },
    shippingPrice: {
      type: Number,
      default: 0.0,
    },
    totalPrice: { type: Number, default: 0.0 },
    paidAt: { type: Date },
    isDelivered: { type: Boolean, required: true, default: false },
    deliveredAt: { type: Date },
  },
  { timestamps: true, autoIndex: false },
);

const Order = mongoose.model("Order", orderSchema);
export default Order;
