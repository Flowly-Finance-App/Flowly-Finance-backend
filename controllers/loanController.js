import mongoose from "mongoose";
import LoanProduct from "../models/LoanProduct.js";
import LoanApplication from "../models/LoanApplication.js";
import User from "../models/User.js";
import Account from "../models/Account.js";
import Notification from "../models/Notification.js";
import { generateScheduleOnDisbursal } from "./repaymentController.js";

const calculateEMI = (principal, annualRate, tenureMonths) => {
  const r = annualRate / (12 * 100);
  if (r === 0) return principal / tenureMonths;
  const emi = (principal * r * Math.pow(1 + r, tenureMonths)) / (Math.pow(1 + r, tenureMonths) - 1);
  return Math.round(emi * 100) / 100;
};

export const getLoanProducts = async (req, res) => {
  try {
    const products = await LoanProduct.find({ isActive: true });
    return res.status(200).json({ products });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch loan products",
      error: error.message,
    });
  }
};

export const seedLoanProducts = async (req, res) => {
  try {
    const count = await LoanProduct.countDocuments();
    if (count > 0 && !req.query.force) {
      const existing = await LoanProduct.find();
      return res.status(200).json({
        message: "Loan products already exist",
        products: existing,
      });
    }

    if (req.query.force) {
      await LoanProduct.deleteMany({});
    }

    const defaultProducts = [
      {
        productName: "Personal Loan",
        loanType: "Personal",
        interestRate: 12.0,
        minAmount: 10000,
        maxAmount: 500000,
        maxTenure: 24,
        tenure: 24,
        isActive: true,
      },
      {
        productName: "Business Loan",
        loanType: "Business",
        interestRate: 14.0,
        minAmount: 100000,
        maxAmount: 2000000,
        maxTenure: 48,
        tenure: 48,
        isActive: true,
      },
      {
        productName: "Education Loan",
        loanType: "Education",
        interestRate: 8.5,
        minAmount: 25000,
        maxAmount: 1000000,
        maxTenure: 60,
        tenure: 60,
        isActive: true,
      },
      {
        productName: "Vehicle Loan",
        loanType: "Vehicle",
        interestRate: 9.5,
        minAmount: 50000,
        maxAmount: 1500000,
        maxTenure: 36,
        tenure: 36,
        isActive: true,
      },
      {
        productName: "Emergency Loan",
        loanType: "Emergency",
        interestRate: 10.0,
        minAmount: 5000,
        maxAmount: 50000,
        maxTenure: 12,
        tenure: 12,
        isActive: true,
      },
    ];

    const created = await LoanProduct.insertMany(defaultProducts);
    return res.status(201).json({
      message: "Default loan products seeded successfully",
      products: created,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to seed loan products",
      error: error.message,
    });
  }
};

/**
 * Customer submits loan application following the wizard flow:
 * Personal Info -> Employment Details -> Income Details -> Bank Verification -> Document Upload -> OCR -> Eligibility Check -> SUBMITTED
 */
export const applyLoan = async (req, res) => {
  try {
    const {
      productId,
      productName,
      loanType,
      requestedAmount,
      amount: bodyAmount,
      tenureMonths,
      tenure: bodyTenure,
      purpose,
      personalInformation,
      employmentDetails,
      incomeDetails,
      bankDetails,
      documents,
    } = req.body;

    const amount = Number(requestedAmount || bodyAmount);
    const months = Number(tenureMonths || bodyTenure);

    if (!amount || amount <= 0 || !months || months <= 0) {
      return res.status(400).json({
        message: "Please provide valid requested amount and tenure in months",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check KYC status - Require verified KYC
    if (user.kycStatus !== "verified") {
      return res.status(403).json({
        message: `KYC verification is required before applying for a loan. Current KYC status: '${user.kycStatus}'. Please complete your KYC verification first.`,
      });
    }

    // Fetch account if exists
    const account = await Account.findOne({ user: user._id });

    // Fetch Product & Interest Rate
    let interestRate = 12.0;
    let selectedProductName = productName || "Personal Loan";
    let selectedLoanType = loanType || "Personal";
    let loanProduct = null;

    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      loanProduct = await LoanProduct.findById(productId).catch(() => null);
      if (loanProduct) {
        interestRate = loanProduct.interestRate;
        selectedProductName = loanProduct.productName;
        selectedLoanType = loanProduct.loanType || "Personal";
      }
    }

    // Calculations
    const monthlyEMI = calculateEMI(amount, interestRate, months);
    const totalPayable = Math.round(monthlyEMI * months * 100) / 100;
    const totalInterest = Math.round((totalPayable - amount) * 100) / 100;

    // Financial Eligibility Calculations
    const monthlyIncome = Number(incomeDetails?.monthlyIncome || 50000);
    const existingEmi = Number(incomeDetails?.existingMonthlyEmi || 0);
    const totalEmiObligation = existingEmi + monthlyEMI;
    const emiToIncomeRatio = monthlyIncome > 0 ? (totalEmiObligation / monthlyIncome) * 100 : 50;

    const incomeEligible = emiToIncomeRatio <= 50;
    const emiCapacityCheck = totalEmiObligation < monthlyIncome * 0.55;

    // Existing Loans check
    const existingActiveLoans = await LoanApplication.countDocuments({
      user: user._id,
      status: { $in: ["submitted", "under_worker_review", "approved", "disbursed", "active"] },
    });
    const existingLoanCheck = existingActiveLoans < 3;

    // Risk Assessment score (0 - 100)
    let riskScore = 85;
    if (emiToIncomeRatio > 40) riskScore -= 15;
    if (existingActiveLoans > 1) riskScore -= 10;
    if (!account) riskScore -= 5;
    const riskAssessment = riskScore >= 75 ? "LOW_RISK" : riskScore >= 55 ? "MEDIUM_RISK" : "HIGH_RISK";

    // OCR Verification Simulation
    const ocrVerification = {
      panVerified: true,
      aadhaarVerified: true,
      nameMatchScore: 98,
      ocrStatus: "passed",
    };

    // Automated Eligibility Check summary
    const eligibilityCheck = {
      kycVerified: true,
      accountActive: account ? account.status === "active" : true,
      incomeEligible,
      existingLoanCheck,
      emiCapacityCheck,
      riskAssessment,
      riskScore,
      passedAutomatedChecks: incomeEligible && existingLoanCheck && emiCapacityCheck,
    };

    // Application Number Generation
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const applicationNumber = `LN-${dateStr}-${randomSuffix}`;

    const application = await LoanApplication.create({
      applicationNumber,
      user: req.user._id,
      product: loanProduct ? loanProduct._id : undefined,
      account: account ? account._id : undefined,
      productName: selectedProductName,
      loanType: selectedLoanType,

      principal: amount,
      requestedAmount: amount,
      tenureMonths: months,
      interestRate,

      emiAmount: monthlyEMI,
      monthlyEMI,
      totalInterest,
      totalPayable,
      totalRepayment: totalPayable,
      outstandingAmount: amount,

      purpose: purpose || "Personal Expenses",

      personalInformation: {
        fullName: personalInformation?.fullName || user.name || "",
        dob: personalInformation?.dob || user.dob || "",
        email: personalInformation?.email || user.email || "",
        phone: personalInformation?.phone || user.phone || "",
        address: personalInformation?.address || user.address || "",
        panNumber: personalInformation?.panNumber || "ABCDE1234F",
        aadhaarNumber: personalInformation?.aadhaarNumber || "123456789012",
      },

      employmentDetails: {
        employmentType: employmentDetails?.employmentType || "salaried",
        companyName: employmentDetails?.companyName || "Acme Corp",
        designation: employmentDetails?.designation || "Executive",
        workExperienceYears: Number(employmentDetails?.workExperienceYears || 3),
      },

      incomeDetails: {
        monthlyIncome,
        existingMonthlyEmi: existingEmi,
      },

      bankDetails: {
        accountNumber: bankDetails?.accountNumber || account?.accountNumber || "1002345678",
        bankName: bankDetails?.bankName || "Flowly National Bank",
        ifscCode: bankDetails?.ifscCode || account?.ifscCode || "FLWL0001024",
        accountHolderName: bankDetails?.accountHolderName || user.name || "",
        isVerified: true,
      },

      documents: {
        panCardUrl: documents?.panCardUrl || "/uploads/sample_pan.pdf",
        aadhaarCardUrl: documents?.aadhaarCardUrl || "/uploads/sample_aadhaar.pdf",
        salarySlipUrl: documents?.salarySlipUrl || "/uploads/sample_salary.pdf",
        bankStatementUrl: documents?.bankStatementUrl || "/uploads/sample_statement.pdf",
        additionalDocs: [],
      },

      ocrVerification,
      eligibilityCheck,
      status: "submitted",
    });

    // Send Notification to user
    await Notification.create({
      user: req.user._id,
      type: "loan",
      title: "Loan Application Submitted",
      message: `Your loan application ${applicationNumber} for ₹${amount.toLocaleString("en-IN")} has been submitted successfully. Status: SUBMITTED.`,
      meta: { loanId: application._id, applicationNumber },
    }).catch(() => {});

    return res.status(201).json({
      message: "Loan application submitted successfully and assigned for worker review.",
      application,
    });
  } catch (error) {
    console.error("applyLoan server error:", error);
    return res.status(500).json({
      message: "Loan application submission failed",
      error: error.message,
    });
  }
};

export const getUserApplications = async (req, res) => {
  try {
    const applications = await LoanApplication.find({ user: req.user._id })
      .populate("product")
      .populate("account")
      .sort({ createdAt: -1 });

    return res.status(200).json({ applications });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch loan applications",
      error: error.message,
    });
  }
};

/**
 * Customer uploads requested additional documents when status is 'documents_requested'
 */
export const resubmitDocuments = async (req, res) => {
  try {
    const { id } = req.params;
    const { docTitle, docUrl } = req.body;

    const application = await LoanApplication.findOne({ _id: id, user: req.user._id });
    if (!application) {
      return res.status(404).json({ message: "Loan application not found" });
    }

    if (application.status !== "documents_requested") {
      return res.status(400).json({ message: `Cannot upload documents when status is '${application.status}'` });
    }

    // Add to additional docs list
    application.documents.additionalDocs.push({
      title: docTitle || "Requested Document",
      docUrl: docUrl || "/uploads/additional_doc.pdf",
      status: "uploaded",
      requestedNote: application.workerReview?.requestedDocNote || "",
      uploadedAt: new Date(),
    });

    // Update application status back to under_worker_review for re-review
    application.status = "under_worker_review";
    await application.save();

    await Notification.create({
      user: req.user._id,
      type: "loan",
      title: "Additional Document Uploaded",
      message: `You re-submitted requested document '${docTitle || "Requested Document"}' for application ${application.applicationNumber}. Re-review in progress.`,
      meta: { loanId: application._id },
    }).catch(() => {});

    return res.status(200).json({
      message: "Document uploaded successfully and application moved to Re-Review.",
      application,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to upload document", error: error.message });
  }
};

/**
 * Customer accepts sanction letter terms
 */
export const acceptSanctionLetter = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await LoanApplication.findOne({ _id: id, user: req.user._id });

    if (!application) {
      return res.status(404).json({ message: "Loan application not found" });
    }

    if (application.status !== "sanctioned") {
      return res.status(400).json({ message: `Cannot accept sanction letter when status is '${application.status}'` });
    }

    application.sanctionDetails.customerAccepted = true;
    application.sanctionDetails.customerAcceptedAt = new Date();

    // Generate Loan Agreement number
    const agreementNum = `AGR-${Date.now().toString().slice(-6)}`;
    application.agreementDetails = {
      agreementNumber: agreementNum,
      generatedAt: new Date(),
      eSigned: false,
    };

    application.status = "agreement_pending";
    await application.save();

    await Notification.create({
      user: req.user._id,
      type: "loan",
      title: "Sanction Letter Accepted",
      message: `You accepted the loan sanction letter for ${application.applicationNumber}. Loan agreement generated. Please complete digital e-Sign.`,
      meta: { loanId: application._id },
    }).catch(() => {});

    return res.status(200).json({
      message: "Sanction letter accepted successfully. Loan Agreement generated for e-Sign.",
      application,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to accept sanction letter", error: error.message });
  }
};

/**
 * Customer digital e-Sign of Loan Agreement
 */
export const esignLoanAgreement = async (req, res) => {
  try {
    const { id } = req.params;
    const { signatureHash } = req.body;

    const application = await LoanApplication.findOne({ _id: id, user: req.user._id });
    if (!application) {
      return res.status(404).json({ message: "Loan application not found" });
    }

    if (application.status !== "agreement_pending") {
      return res.status(400).json({ message: `Cannot e-sign agreement when status is '${application.status}'` });
    }

    const mockHash = signatureHash || `SIG-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    application.agreementDetails.eSigned = true;
    application.agreementDetails.eSignedAt = new Date();
    application.agreementDetails.digitalSignatureHash = mockHash;

    // Moves to 'approved' status ready for final disbursement by bank worker
    application.status = "approved";
    await application.save();

    await Notification.create({
      user: req.user._id,
      type: "loan",
      title: "Loan Agreement Signed",
      message: `Loan agreement for ${application.applicationNumber} has been e-signed. Status updated to APPROVED. Pending disbursement.`,
      meta: { loanId: application._id },
    }).catch(() => {});

    return res.status(200).json({
      message: "Loan agreement e-signed successfully! Loan approved and ready for disbursement.",
      application,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to e-sign agreement", error: error.message });
  }
};

// -----------------------------------------------------------------------------
// WORKER / ADMIN API ENDPOINTS
// -----------------------------------------------------------------------------

export const getAllApplications = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};

    if (status) {
      filter.status = status;
    }

    let query = LoanApplication.find(filter)
      .populate("user", "name email phone kycStatus")
      .populate("assignedTo", "name email")
      .sort({ createdAt: -1 });

    const applications = await query;

    let filtered = applications;
    if (search) {
      const term = search.toLowerCase();
      filtered = applications.filter(
        (app) =>
          app.applicationNumber?.toLowerCase().includes(term) ||
          app.user?.name?.toLowerCase().includes(term) ||
          app.productName?.toLowerCase().includes(term) ||
          app.status?.toLowerCase().includes(term)
      );
    }

    return res.status(200).json({
      count: filtered.length,
      applications: filtered,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch loan applications",
      error: error.message,
    });
  }
};

export const getApplicationById = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await LoanApplication.findById(id)
      .populate("user", "name email phone kycStatus address dob")
      .populate("assignedTo", "name email")
      .populate("account");

    if (!application) {
      return res.status(404).json({ message: "Loan application not found" });
    }

    return res.status(200).json({ application });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch application", error: error.message });
  }
};

export const assignLoanWorker = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await LoanApplication.findById(id);

    if (!application) {
      return res.status(404).json({ message: "Loan application not found" });
    }

    application.assignedTo = req.user._id;
    if (["submitted", "pending"].includes(application.status)) {
      application.status = "under_worker_review";
    }
    await application.save();

    return res.status(200).json({
      message: "Loan application assigned to worker",
      application,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to assign worker", error: error.message });
  }
};

/**
 * Worker performs review checklists, requests additional docs, or updates field verification status
 */
export const updateWorkerReview = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      documentsVerified,
      incomeVerified,
      employmentVerified,
      bankStatementsVerified,
      existingLiabilitiesVerified,
      requestAdditionalDocs,
      requestedDocNote,
      fieldVerificationRequired,
      fieldVerificationStatus,
      workerNotes,
      status,
    } = req.body;

    const application = await LoanApplication.findById(id);
    if (!application) {
      return res.status(404).json({ message: "Loan application not found" });
    }

    application.workerReview = {
      documentsVerified: documentsVerified ?? application.workerReview?.documentsVerified ?? false,
      incomeVerified: incomeVerified ?? application.workerReview?.incomeVerified ?? false,
      employmentVerified: employmentVerified ?? application.workerReview?.employmentVerified ?? false,
      bankStatementsVerified: bankStatementsVerified ?? application.workerReview?.bankStatementsVerified ?? false,
      existingLiabilitiesVerified: existingLiabilitiesVerified ?? application.workerReview?.existingLiabilitiesVerified ?? false,
      fieldVerificationRequired: fieldVerificationRequired ?? application.workerReview?.fieldVerificationRequired ?? false,
      fieldVerificationStatus: fieldVerificationStatus || application.workerReview?.fieldVerificationStatus || "not_required",
      workerNotes: workerNotes || application.workerReview?.workerNotes || "",
      requestedDocNote: requestedDocNote || application.workerReview?.requestedDocNote || "",
    };

    if (requestAdditionalDocs && requestedDocNote) {
      application.status = "documents_requested";
      await Notification.create({
        user: application.user,
        type: "loan",
        title: "Additional Documents Requested",
        message: `Worker reviewing application ${application.applicationNumber} requested additional documents: ${requestedDocNote}`,
        meta: { loanId: application._id },
      }).catch(() => {});
    } else if (status) {
      application.status = status;
    } else if (fieldVerificationStatus === "pending") {
      application.status = "field_verification";
    } else if (
      documentsVerified &&
      incomeVerified &&
      employmentVerified &&
      bankStatementsVerified &&
      existingLiabilitiesVerified
    ) {
      application.status = "credit_assessment";
    }

    application.reviewedBy = req.user._id;
    application.reviewedAt = new Date();
    await application.save();

    return res.status(200).json({
      message: "Worker review updated successfully",
      application,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update worker review", error: error.message });
  }
};

/**
 * Worker sanctions & approves loan application -> Generates Sanction Letter
 */
export const sanctionLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const { sanctionedAmount, sanctionedInterestRate, sanctionedTenureMonths } = req.body;

    const application = await LoanApplication.findById(id);
    if (!application) {
      return res.status(404).json({ message: "Loan application not found" });
    }

    const sAmount = Number(sanctionedAmount || application.requestedAmount || application.principal);
    const sRate = Number(sanctionedInterestRate || application.interestRate);
    const sTenure = Number(sanctionedTenureMonths || application.tenureMonths);

    const sEmi = calculateEMI(sAmount, sRate, sTenure);
    const sanctionLetterNum = `SNC-${Date.now().toString().slice(-6)}`;

    application.principal = sAmount;
    application.requestedAmount = sAmount;
    application.interestRate = sRate;
    application.tenureMonths = sTenure;
    application.monthlyEMI = sEmi;
    application.emiAmount = sEmi;
    application.totalPayable = Math.round(sEmi * sTenure * 100) / 100;
    application.totalRepayment = application.totalPayable;

    application.sanctionDetails = {
      sanctionLetterNumber: sanctionLetterNum,
      sanctionedAmount: sAmount,
      sanctionedInterestRate: sRate,
      sanctionedTenureMonths: sTenure,
      sanctionedEmi: sEmi,
      sanctionedAt: new Date(),
      customerAccepted: false,
    };

    application.status = "sanctioned";
    application.reviewedBy = req.user._id;
    application.reviewedAt = new Date();

    await application.save();

    await Notification.create({
      user: application.user,
      type: "loan",
      title: "Loan Sanctioned!",
      message: `Congratulations! Your loan application ${application.applicationNumber} has been sanctioned for ₹${sAmount.toLocaleString("en-IN")}. Please review and accept your Sanction Letter.`,
      meta: { loanId: application._id },
    }).catch(() => {});

    return res.status(200).json({
      message: `Loan sanctioned successfully for ₹${sAmount}. Sanction Letter ${sanctionLetterNum} generated.`,
      application,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to sanction loan", error: error.message });
  }
};

/**
 * Worker rejects loan application & records reason
 */
export const rejectLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({ message: "Please provide a rejection reason." });
    }

    const application = await LoanApplication.findById(id);
    if (!application) {
      return res.status(404).json({ message: "Loan application not found" });
    }

    application.status = "rejected";
    application.rejectionReason = rejectionReason;
    application.reviewedBy = req.user._id;
    application.reviewedAt = new Date();

    await application.save();

    await Notification.create({
      user: application.user,
      type: "loan",
      title: "Loan Application Rejected",
      message: `Your loan application ${application.applicationNumber} was rejected. Reason: ${rejectionReason}`,
      meta: { loanId: application._id },
    }).catch(() => {});

    return res.status(200).json({
      message: "Loan application rejected",
      application,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to reject loan application", error: error.message });
  }
};

export const reviewLoanApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;
    const normalizedStatus = status ? status.toLowerCase() : "";

    if (normalizedStatus === "rejected") {
      return rejectLoan(req, res);
    }

    if (normalizedStatus === "sanctioned" || normalizedStatus === "approved") {
      return sanctionLoan(req, res);
    }

    const application = await LoanApplication.findById(id);
    if (!application) {
      return res.status(404).json({ message: "Loan application not found" });
    }

    application.status = normalizedStatus || application.status;
    application.reviewedBy = req.user._id;
    application.reviewedAt = new Date();
    await application.save();

    return res.status(200).json({
      message: `Loan application updated to '${application.status}'`,
      application,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to review loan", error: error.message });
  }
};

/**
 * Worker disburses approved loan -> credits customer account balance and triggers EMI schedule generation
 */
export const disburseLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await LoanApplication.findById(id);

    if (!application) {
      return res.status(404).json({ message: "Loan application not found" });
    }

    if (!["approved", "sanctioned", "agreement_pending"].includes(application.status)) {
      return res.status(400).json({
        message: `Cannot disburse loan with status '${application.status}'. Application must be approved first.`,
      });
    }

    application.status = "disbursed";
    application.disbursedAt = new Date();
    await application.save();

    // Credit user's bank account
    if (application.account || application.user) {
      const account = application.account
        ? await Account.findById(application.account)
        : await Account.findOne({ user: application.user });

      if (account) {
        const disburseAmt = application.principal || application.requestedAmount || 0;
        account.balance += disburseAmt;
        await account.save();
      }
    }

    // Generate EMI repayment schedule
    await generateScheduleOnDisbursal(application._id);

    await Notification.create({
      user: application.user,
      type: "loan",
      title: "🎉 Loan Disbursed!",
      message: `Your loan ${application.applicationNumber} of ₹${(application.principal || application.requestedAmount).toLocaleString(
        "en-IN"
      )} has been disbursed to your account.`,
      meta: { loanId: application._id },
    }).catch(() => {});

    const updatedApp = await LoanApplication.findById(id).populate("repayments");

    return res.status(200).json({
      message: "Loan disbursed successfully and EMI schedule generated.",
      application: updatedApp,
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to disburse loan", error: error.message });
  }
};
