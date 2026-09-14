import mongoose from "mongoose";

const loanProductSchema = new mongoose.Schema(
  {
    productName: {
      type: String,
      required: true,
      trim: true,
    },
    loanType: {
      type: String,
      enum: ["Personal", "Business", "Education", "Emergency", "Vehicle"],
      default: "Personal",
    },
    minAmount: { type: Number, required: true },
    maxAmount: { type: Number, required: true },
    interestRate: { type: Number, required: true },
    maxTenure: { type: Number },
    tenure: { type: Number },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.models.LoanProduct || mongoose.model("LoanProduct", loanProductSchema);
