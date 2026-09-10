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
    },

    productName: {
      type: String,
      default: "Personal Loan",
    },

    requestedAmount: {
      type: Number,
      required: true,
      min: 1000,
    },

    tenureMonths: {
      type: Number,
      required: true,
      min: 1,
    },

    interestRate: {
      type: Number,
      default: 12,
    },

    monthlyEMI: {
      type: Number,
    },

    totalPayable: {
      type: Number,
    },

    purpose: {
      type: String,
      default: "Personal Expenses",
    },

    status: {
      type: String,
      enum: ["pending", "under_review", "approved", "rejected", "disbursed"],
      default: "pending",
    },

    rejectionReason: {
      type: String,
      default: "",
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    reviewedAt: {
      type: Date,
    },

    disbursedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("LoanApplication", loanApplicationSchema);
