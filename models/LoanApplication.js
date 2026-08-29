import mongoose from "mongoose";

const loanApplicationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LoanProduct",
      required: true,
    },

    requestedAmount: {
      type: Number,
      required: true,
    },

    tenure: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "under_review", "approved", "rejected", "disbursed"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("LoanApplication", loanApplicationSchema);
