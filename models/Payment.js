import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    loan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LoanApplication",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    paymentDate: {
      type: Date,
      default: Date.now,
    },

    paymentStatus: {
      type: String,
      enum: ["success", "failed", "pending"],
      default: "pending",
    },

    transactionReference: {
      type: String,
      unique: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Payment", paymentSchema);
