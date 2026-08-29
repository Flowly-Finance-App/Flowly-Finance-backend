import mongoose from "mongoose";
const { Schema } = mongoose;

/**
 * FIXED DEPOSIT — self-contained; nothing about an FD needs its own child
 * collection (no unbounded sub-list), so it stays a single flat document.
 */
const fixedDepositSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    account: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    principalAmount: { type: Number, required: true, min: 0 },
    interestRate: { type: Number, required: true },
    tenureMonths: { type: Number, required: true },
    startDate: { type: Date, required: true },
    maturityDate: { type: Date, required: true },
    maturityAmount: { type: Number, required: true },
    status: { type: String, enum: ["active", "matured", "closed_early", "cancelled"], default: "active", index: true },
    certificateUrl: String,
  },
  { timestamps: true }
);

fixedDepositSchema.index({ user: 1, status: 1 });
fixedDepositSchema.index({ maturityDate: 1, status: 1 }); // powers maturity-reminder job

export default mongoose.model("FixedDeposit", fixedDepositSchema);
