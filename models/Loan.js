import mongoose from "mongoose";

const loanProductSchema = new mongoose.Schema(
  {
    productName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    interestRate: {
      type: Number,
      required: true,
    },

    minimumAmount: {
      type: Number,
      required: true,
    },

    maximumAmount: {
      type: Number,
      required: true,
    },

    tenure: {
      type: Number,
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("LoanProduct", loanProductSchema);
