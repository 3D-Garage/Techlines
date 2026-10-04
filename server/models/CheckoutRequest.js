import mongoose from "mongoose";

// An immutable decision also fences requests rejected before a checkout exists.
// Do not expire these keys: a delayed request must never revive a rejection.
const checkoutRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, required: true },
  requestId: { type: String, required: true },
  status: { type: String, enum: ["CREATED", "REJECTED"], required: true },
  checkout: { type: mongoose.Schema.Types.ObjectId, required: function () { return this.status === "CREATED"; } },
  rejection: {
    type: new mongoose.Schema({
      message: { type: String, required: true },
      statusCode: { type: Number, required: true },
      code: String,
      quote: mongoose.Schema.Types.Mixed,
    }, { _id: false }),
    required: function () { return this.status === "REJECTED"; },
  },
}, { timestamps: true, autoIndex: false });
checkoutRequestSchema.index({ user: 1, requestId: 1 }, { unique: true });

export default mongoose.model("CheckoutRequest", checkoutRequestSchema);
