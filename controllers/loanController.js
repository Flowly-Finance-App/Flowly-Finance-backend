import LoanProduct from "../models/Loan.js";
import LoanApplication from "../models/LoanApplication.js";
import Account from "../models/Account.js";
import TransactionBucket from "../models/Transaction.js";
import User from "../models/User.js";


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
    if (count > 0) {
      const existing = await LoanProduct.find();
      return res.status(200).json({
        message: "Loan products already exist",
        products: existing,
      });
    }

    const defaultProducts = [
      {
        productName: "Personal Loan",
        interestRate: 12.0,
        minimumAmount: 10000,
        maximumAmount: 500000,
        tenure: 24,
        isActive: true,
      },
      {
        productName: "Vehicle Loan",
        interestRate: 9.5,
        minimumAmount: 50000,
        maximumAmount: 1500000,
        tenure: 36,
        isActive: true,
      },
      {
        productName: "Business Loan",
        interestRate: 14.0,
        minimumAmount: 100000,
        maximumAmount: 2000000,
        tenure: 48,
        isActive: true,
      },
      {
        productName: "Education Loan",
        interestRate: 8.5,
        minimumAmount: 25000,
        maximumAmount: 1000000,
        tenure: 60,
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


export const applyLoan = async (req, res) => {
  try {
    const { productId, productName, requestedAmount, tenureMonths, purpose } = req.body;
    const amount = Number(requestedAmount);
    const months = Number(tenureMonths);

    if (!amount || amount <= 0 || !months || months <= 0) {
      return res.status(400).json({
        message: "Please provide valid requested amount and tenure in months",
      });
    }

    //  KYC status cheking
    const user = await User.findById(req.user._id);
    if (user.kycStatus !== "verified") {
      return res.status(403).json({
        message: `KYC verification is required before applying for a loan. Current KYC status: '${user.kycStatus}'.`,
      });
    }

    let interestRate = 12.0;
    let selectedProductName = productName || "Personal Loan";
    let loanProduct = null;

    if (productId) {
      loanProduct = await LoanProduct.findById(productId);
      if (loanProduct) {
        interestRate = loanProduct.interestRate;
        selectedProductName = loanProduct.productName;
      }
    }

    const monthlyEMI = calculateEMI(amount, interestRate, months);
    const totalPayable = Math.round(monthlyEMI * months * 100) / 100;

    const application = await LoanApplication.create({
      user: req.user._id,
      product: loanProduct ? loanProduct._id : undefined,
      productName: selectedProductName,
      requestedAmount: amount,
      tenureMonths: months,
      interestRate,
      monthlyEMI,
      totalPayable,
      purpose: purpose || "Personal Expenses",
      status: "pending",
    });

    return res.status(201).json({
      message: "Loan application submitted successfully and is pending review",
      application,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Loan application failed",
      error: error.message,
    });
  }
};


export const getUserApplications = async (req, res) => {
  try {
    const applications = await LoanApplication.find({ user: req.user._id }).sort({
      createdAt: -1,
    });
    return res.status(200).json({ applications });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch loan applications",
      error: error.message,
    });
  }
};


export const getAllApplications = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};

    const applications = await LoanApplication.find(filter)
      .populate("user", "name email phone kycStatus")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      count: applications.length,
      applications,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch loan applications",
      error: error.message,
    });
  }
};


export const reviewLoanApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body; // "approved" | "rejected" | "under_review"

    if (!["approved", "rejected", "under_review"].includes(status)) {
      return res.status(400).json({
        message: "Invalid status. Must be 'approved', 'rejected', or 'under_review'.",
      });
    }

    if (status === "rejected" && !rejectionReason) {
      return res.status(400).json({
        message: "Please provide a rejection reason when rejecting a loan.",
      });
    }

    const application = await LoanApplication.findById(id);

    if (!application) {
      return res.status(404).json({
        message: "Loan application not found",
      });
    }

    application.status = status;
    application.reviewedBy = req.user._id;
    application.reviewedAt = new Date();
    if (status === "rejected") {
      application.rejectionReason = rejectionReason;
    }

    await application.save();

    return res.status(200).json({
      message: `Loan application ${status} successfully`,
      application,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to review loan application",
      error: error.message,
    });
  }
};


export const disburseLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await LoanApplication.findById(id);

    if (!application) {
      return res.status(404).json({
        message: "Loan application not found",
      });
    }

    if (application.status !== "approved") {
      return res.status(400).json({
        message: `Loan cannot be disbursed because current status is '${application.status}'. Only 'approved' loans can be disbursed.`,
      });
    }

    const account = await Account.findOne({ user: application.user });
    if (!account) {
      return res.status(404).json({
        message: "Customer bank account not found for disbursement",
      });
    }

    // Credit loan amount to customer account
    account.balance += application.requestedAmount;
    await account.save();

    // Log transaction entry
    const date = new Date();
    const periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

    let bucket = await TransactionBucket.findOne({
      account: account._id,
      periodKey,
    });

    const entry = {
      type: "credit",
      category: "withdrawal", // disbursement
      amount: application.requestedAmount,
      balanceAfter: account.balance,
      relatedLoan: application._id,
      description: `Loan Disbursement: ${application.productName} (App ID: ${application._id})`,
      referenceNumber: `DISB${Date.now()}`,
      createdAt: date,
    };

    if (!bucket) {
      await TransactionBucket.create({
        account: account._id,
        user: application.user,
        periodKey,
        entryCount: 1,
        entries: [entry],
      });
    } else {
      bucket.entries.push(entry);
      bucket.entryCount += 1;
      await bucket.save();
    }

    application.status = "disbursed";
    application.disbursedAt = date;
    await application.save();

    return res.status(200).json({
      message: `Loan of ₹${application.requestedAmount} successfully disbursed to customer account`,
      application,
      customerAccountBalance: account.balance,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Loan disbursement failed",
      error: error.message,
    });
  }
};
