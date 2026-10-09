import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // What this payment is for. Only one of `loan` / `account` is populated,
    // matching `purpose`.
    purpose: {
      type: String,
      enum: ["loan_repayment", "account_topup"],
      default: "loan_repayment",
    },

    loan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LoanApplication",
    },

    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
    },

    // Amount in rupees (Stripe is charged in paise = amount * 100).
    amount: {
      type: Number,
      required: true,
    },

    currency: {
      type: String,
      default: "inr",
      lowercase: true,
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

    // Stripe PaymentIntent id (pi_...). Unique per payment.
    transactionReference: {
      type: String,
      unique: true,
    },

    // ---- Add Money (account top-up) details, filled in by walletService ----

    // Customer-facing reference number shown on the receipt, e.g. FLWTXN-20261002-A1B2C3
    receiptNumber: {
      type: String,
      unique: true,
      sparse: true,
    },

    // Why the payment failed (Stripe's decline message, or a verification problem).
    failureReason: { type: String },

    // Card used, as reported by Stripe (never the full card number).
    paymentMethod: {
      type: { type: String },
      brand: { type: String },
      last4: { type: String },
    },

    // Account balance right after this payment was credited.
    balanceAfter: { type: Number },

    // The ledger entry (TransactionBucket entry _id) created for this credit.
    ledgerEntryId: { type: mongoose.Schema.Types.ObjectId },

    completedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

paymentSchema.index({ user: 1, purpose: 1, createdAt: -1 });

export default mongoose.model("Payment", paymentSchema);