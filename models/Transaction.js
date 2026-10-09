import mongoose from "mongoose";

/**
 * One document per money movement on an account, with the balance before/after.
 * (The per-account monthly ledger in TransactionBucket is still written too, so the
 * customer dashboard / recent-transactions keep working.)
 */
export const TRANSACTION_TYPES = [
  "CASH_DEPOSIT",
  "ONLINE_DEPOSIT",
  "WITHDRAWAL",
  "FD_CREATION",
  "FD_CLOSURE",
  "FD_MATURITY",
  "TRANSFER",
  "INTEREST_CREDIT",
];

const transactionSchema = new mongoose.Schema(
  {
    transactionType: { type: String, enum: TRANSACTION_TYPES, required: true, index: true },

    // Customer-facing reference, e.g. FLWCD-20261002-A1B2C3D4
    receiptNumber: { type: String, required: true, unique: true },

    account: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // account holder

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "inr", lowercase: true },

    previousBalance: { type: Number },
    updatedBalance: { type: Number },

    paymentMethod: {
      type: String,
      enum: ["CASH", "CARD", "UPI", "NET_BANKING", "INTERNAL"],
      default: "CASH",
    },

    status: { type: String, enum: ["pending", "completed", "failed"], default: "pending" },
    failureReason: { type: String },

    // Staff member who handled the cash (worker/admin) and where.
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    branch: { type: String },
    remarks: { type: String, maxlength: 250 },

    // "<workerId>:<client key>" - makes a double-click / retry safe.
    idempotencyKey: { type: String, unique: true, sparse: true },

    // TransactionBucket entry _id created for this movement.
    ledgerEntryId: { type: mongoose.Schema.Types.ObjectId },

    completedAt: { type: Date },
  },
  { timestamps: true }
);

transactionSchema.index({ account: 1, createdAt: -1 });
transactionSchema.index({ processedBy: 1, createdAt: -1 });

export default mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);