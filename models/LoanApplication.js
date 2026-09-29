import mongoose from "mongoose";
const { Schema } = mongoose;

const gatewaySchema = new Schema(
  {
    provider: { type: String, enum: ["stripe", "razorpay", "manual", "bank_transfer", "bank_account", "auto_debit"], required: true },
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

const additionalDocSchema = new Schema(
  {
    title: { type: String, required: true },
    docUrl: { type: String },
    status: { type: String, enum: ["requested", "uploaded", "verified", "rejected"], default: "requested" },
    requestedNote: { type: String, default: "" },
    uploadedAt: { type: Date, default: null },
  },
  { _id: true }
);

const loanApplicationSchema = new Schema(
  {
    applicationNumber: { type: String, sparse: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    product: { type: Schema.Types.ObjectId, ref: "LoanProduct" },
    account: { type: Schema.Types.ObjectId, ref: "Account" },
    productName: { type: String, default: "Personal Loan" },
    loanType: {
      type: String,
      enum: ["Personal", "Business", "Education", "Vehicle", "Emergency"],
      default: "Personal",
    },

    principal: { type: Number, required: true },
    requestedAmount: { type: Number },
    tenureMonths: { type: Number, required: true, min: 1 },
    interestRate: { type: Number, default: 12 },
    purpose: { type: String, default: "Personal Expenses" },

    // Financial calculations
    emiAmount: { type: Number, default: 0 },
    monthlyEMI: { type: Number, default: 0 },
    totalInterest: { type: Number, default: 0 },
    totalPayable: { type: Number, default: 0 },
    totalRepayment: { type: Number, default: 0 },
    outstandingAmount: { type: Number, default: 0 },

    // Step 1: Personal Information
    personalInformation: {
      fullName: { type: String, default: "" },
      dob: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      address: { type: String, default: "" },
      panNumber: { type: String, default: "" },
      aadhaarNumber: { type: String, default: "" },
    },

    // Step 2: Employment Details
    employmentDetails: {
      employmentType: {
        type: String,
        enum: ["salaried", "self_employed", "business_owner"],
        default: "salaried",
      },
      companyName: { type: String, default: "" },
      designation: { type: String, default: "" },
      workExperienceYears: { type: Number, default: 0 },
    },

    // Step 3: Income Details
    incomeDetails: {
      monthlyIncome: { type: Number, default: 0 },
      existingMonthlyEmi: { type: Number, default: 0 },
    },

    // Step 4: Bank Account Verification
    bankDetails: {
      accountNumber: { type: String, default: "" },
      bankName: { type: String, default: "" },
      ifscCode: { type: String, default: "" },
      accountHolderName: { type: String, default: "" },
      isVerified: { type: Boolean, default: true },
    },

    // Step 5 & OCR: Documents & Verification
    documents: {
      panCardUrl: { type: String, default: "" },
      aadhaarCardUrl: { type: String, default: "" },
      salarySlipUrl: { type: String, default: "" },
      bankStatementUrl: { type: String, default: "" },
      additionalDocs: { type: [additionalDocSchema], default: [] },
    },

    ocrVerification: {
      panVerified: { type: Boolean, default: true },
      aadhaarVerified: { type: Boolean, default: true },
      nameMatchScore: { type: Number, default: 98 },
      ocrStatus: { type: String, enum: ["passed", "flagged", "pending"], default: "passed" },
    },

    // Automated System Eligibility & Risk Assessment
    eligibilityCheck: {
      kycVerified: { type: Boolean, default: true },
      accountActive: { type: Boolean, default: true },
      incomeEligible: { type: Boolean, default: true },
      existingLoanCheck: { type: Boolean, default: true },
      emiCapacityCheck: { type: Boolean, default: true },
      riskAssessment: { type: String, enum: ["LOW_RISK", "MEDIUM_RISK", "HIGH_RISK"], default: "LOW_RISK" },
      riskScore: { type: Number, default: 85 },
      passedAutomatedChecks: { type: Boolean, default: true },
    },

    // Worker Review & Verification Checklist
    workerReview: {
      documentsVerified: { type: Boolean, default: false },
      incomeVerified: { type: Boolean, default: false },
      employmentVerified: { type: Boolean, default: false },
      bankStatementsVerified: { type: Boolean, default: false },
      existingLiabilitiesVerified: { type: Boolean, default: false },
      fieldVerificationRequired: { type: Boolean, default: false },
      fieldVerificationStatus: {
        type: String,
        enum: ["not_required", "pending", "completed", "failed"],
        default: "not_required",
      },
      workerNotes: { type: String, default: "" },
      requestedDocNote: { type: String, default: "" },
    },

    // Sanction Letter & Customer Acceptance
    sanctionDetails: {
      sanctionLetterNumber: { type: String, default: "" },
      sanctionedAmount: { type: Number, default: 0 },
      sanctionedInterestRate: { type: Number, default: 0 },
      sanctionedTenureMonths: { type: Number, default: 0 },
      sanctionedEmi: { type: Number, default: 0 },
      sanctionedAt: { type: Date, default: null },
      customerAccepted: { type: Boolean, default: false },
      customerAcceptedAt: { type: Date, default: null },
    },

    // Loan Agreement & e-Sign
    agreementDetails: {
      agreementNumber: { type: String, default: "" },
      generatedAt: { type: Date, default: null },
      eSigned: { type: Boolean, default: false },
      eSignedAt: { type: Date, default: null },
      digitalSignatureHash: { type: String, default: "" },
    },

    // Application Status Lifecycle
    status: {
      type: String,
      enum: [
        "submitted",
        "under_worker_review",
        "documents_requested",
        "field_verification",
        "credit_assessment",
        "sanctioned",
        "agreement_pending",
        "approved",
        "disbursed",
        "active",
        "rejected",
        "closed",
        "pending", // Backward compatibility
        "under_review", // Backward compatibility
      ],
      default: "submitted",
      index: true,
    },

    rejectionReason: { type: String, default: "" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    disbursedAt: { type: Date, default: null },

    nextDueDate: { type: Date, default: null },
    overdueInstallments: { type: Number, default: 0 },
    // No Due Certificate (NOC) details upon Loan Closure
    nocCertificate: {
      certificateNumber: { type: String, default: "" },
      generatedAt: { type: Date, default: null },
      customerName: { type: String, default: "" },
      loanAmount: { type: Number, default: 0 },
      fullyPaidAt: { type: Date, default: null },
      downloadUrl: { type: String, default: "" },
    },

    // Recovery Follow-Up logs for worker collections
    recoveryLogs: {
      type: [
        {
          loggedBy: { type: Schema.Types.ObjectId, ref: "User" },
          loggedAt: { type: Date, default: Date.now },
          followupType: {
            type: String,
            enum: ["call_made", "promise_to_pay", "field_visit", "legal_notice"],
            default: "call_made",
          },
          notes: { type: String, default: "" },
          promisedPaymentDate: { type: Date, default: null },
        },
      ],
      default: [],
    },
    // Repayment EMIs Schedule
    repayments: { type: [repaymentSchema], default: [] },
  },
  { timestamps: true }
);

loanApplicationSchema.pre("save", function () {
  if (!this.applicationNumber) {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    this.applicationNumber = `LN-${dateStr}-${randomSuffix}`;
  }

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
});

if (mongoose.models.LoanApplication) {
  delete mongoose.models.LoanApplication;
}

export default mongoose.model("LoanApplication", loanApplicationSchema);
