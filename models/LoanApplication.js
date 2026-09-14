import mongoose from "mongoose";
const { Schema } = mongoose;

const gatewaySchema = new Schema(
  {
    provider: { type: String, enum: ["stripe", "razorpay", "manual", "bank_transfer"], required: true },
    transactionId: { type: String },
    paymentMethod: { type: String },
    status: { type: String, enum: ["initiated", "processing", "succeeded", "failed"], default: "initiated" },
    rawResponse: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const repaymentSchema = new Schema(
  {
    installmentNo: { type: Number, required: true },
    dueDate: { type: Date, required: true },
    emiAmount: { type: Number, required: true },
    principalComponent: { type: Number, required: true },
    interestComponent: { type: Number, required: true },
    outstandingBalance: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "paid", "overdue", "partially_paid"],
      default: "pending",
    },
    paidAmount: { type: Number, default: 0 },
    paidDate: { type: Date, default: null },
    lateFee: { type: Number, default: 0 },
    gateway: gatewaySchema,
  },
  { _id: false }
);

const loanApplicationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    product: { type: Schema.Types.ObjectId, ref: "LoanProduct" },
    account: { type: Schema.Types.ObjectId, ref: "Account" },
    productName: { type: String, default: "Personal Loan" },

    principal: { type: Number },
    requestedAmount: { type: Number },
    tenureMonths: { type: Number, required: true, min: 1 },
    interestRate: { type: Number, default: 12 },

    purpose: { type: String, default: "Personal Expenses" },

    status: {
      type: String,
      enum: [
        "pending",
        "under_review",
        "documents_required",
        "approved",
        "rejected",
        "disbursed",
        "closed",
        "defaulted",
      ],
      default: "pending",
      index: true,
    },

    rejectionReason: { type: String, default: "" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    disbursedAt: { type: Date, default: null },

    emiAmount: { type: Number, default: 0 },
    monthlyEMI: { type: Number, default: 0 },
    totalInterest: { type: Number, default: 0 },
    totalPayable: { type: Number, default: 0 },
    totalRepayment: { type: Number, default: 0 },
    outstandingAmount: { type: Number, default: 0 },
    nextDueDate: { type: Date, default: null },
    overdueInstallments: { type: Number, default: 0 },

    repayments: { type: [repaymentSchema], default: [] },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

loanApplicationSchema.pre("save", function (next) {
  if (this.principal && !this.requestedAmount) {
    this.requestedAmount = this.principal;
  } else if (this.requestedAmount && !this.principal) {
    this.principal = this.requestedAmount;
  }

  if (this.emiAmount && !this.monthlyEMI) {
    this.monthlyEMI = this.emiAmount;
  } else if (this.monthlyEMI && !this.emiAmount) {
    this.emiAmount = this.monthlyEMI;
  }

  if (this.totalRepayment && !this.totalPayable) {
    this.totalPayable = this.totalRepayment;
  } else if (this.totalPayable && !this.totalRepayment) {
    this.totalRepayment = this.totalPayable;
  }

  next();
});

export default mongoose.models.LoanApplication || mongoose.model("LoanApplication", loanApplicationSchema);
