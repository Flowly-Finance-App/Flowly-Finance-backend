import mongoose from "mongoose";
const { Schema } = mongoose;

/**
 * TRANSACTION — the account ledger, using the MongoDB Bucket Pattern.
 *
 * An account can accumulate tens of thousands of transactions over its
 * life, so a plain array on Account would eventually break the 16MB
 * document limit, and one-document-per-transaction (fully un-embedded)
 * needs a write for every single entry. The bucket pattern keeps entries
 * embedded but grouped into small monthly documents (~200 entries each,
 * enforced by the app), so it stays fast to write AND scales indefinitely —
 * a new bucket just opens automatically next month.
 */
const transactionEntrySchema = new Schema(
  {
    type: { type: String, enum: ["credit", "debit"], required: true },
    category: {
      type: String,
      enum: ["deposit", "withdrawal", "emi", "fd_deposit", "fd_maturity", "fee", "adjustment", "transfer"],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true },
    relatedLoan: { type: Schema.Types.ObjectId, ref: "LoanApplication" },
    relatedFixedDeposit: { type: Schema.Types.ObjectId, ref: "FixedDeposit" },
    referenceNumber: String,
    description: String,
    status: { type: String, enum: ["success", "failed", "pending"], default: "success" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const transactionBucketSchema = new Schema({
  account: { type: Schema.Types.ObjectId, ref: "Account", required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  periodKey: { type: String, required: true }, // e.g. "2026-08" — one bucket per account per month
  entryCount: { type: Number, default: 0 },
  entries: [transactionEntrySchema],
});

transactionBucketSchema.index({ account: 1, periodKey: 1 }, { unique: true });

export default mongoose.model("TransactionBucket", transactionBucketSchema);
