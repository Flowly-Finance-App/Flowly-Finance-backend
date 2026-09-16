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

    // Renewal chain — set when this FD was opened by auto/manual renewal of a matured FD,
    // and on the parent once it spawns a renewal.
    autoRenew: { type: Boolean, default: false },
    renewedFrom: { type: Schema.Types.ObjectId, ref: "FixedDeposit" },
    renewedTo: { type: Schema.Types.ObjectId, ref: "FixedDeposit" },

    // Set once the maturity job actually pays this FD out, so re-runs are idempotent.
    maturityProcessedAt: { type: Date },

    // Present only when status === "closed_early".
    earlyClosure: {
      closedAt: Date,
      elapsedMonths: Number,
      penaltyRate: Number, // percentage points shaved off the contracted rate
      effectiveRate: Number,
      interestPaid: Number,
      payoutAmount: Number,
    },
  },
  { timestamps: true }
);

fixedDepositSchema.index({ user: 1, status: 1 });
fixedDepositSchema.index({ maturityDate: 1, status: 1 }); // powers maturity-reminder job

export default mongoose.model("FixedDeposit", fixedDepositSchema);
