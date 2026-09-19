import LoanProduct from "../models/LoanProduct.js";
import LoanApplication from "../models/LoanApplication.js";
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
        loanType: "Personal",
        interestRate: 12.0,
        minAmount: 10000,
        maxAmount: 500000,
        maxTenure: 24,
        tenure: 24,
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
    const { productId, productName, requestedAmount, amount: bodyAmount, tenureMonths, tenure: bodyTenure, purpose } = req.body;
    const amount = Number(requestedAmount || bodyAmount);
    const months = Number(tenureMonths || bodyTenure);

    if (!amount || amount <= 0 || !months || months <= 0) {
      return res.status(400).json({
        message: "Please provide valid requested amount and tenure in months",
      });
    }

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
      principal: amount,
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
    const filter = status ? { status: status.toLowerCase() } : {};

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
    const { status, rejectionReason } = req.body;
    const normalizedStatus = status ? status.toLowerCase() : "";

    if (!["approved", "rejected", "under_review"].includes(normalizedStatus)) {
      return res.status(400).json({
        message: "Invalid status. Must be 'approved', 'rejected', or 'under_review'.",
      });
    }

    if (normalizedStatus === "rejected" && !rejectionReason) {
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

    application.status = normalizedStatus;
    application.reviewedBy = req.user._id;
    application.reviewedAt = new Date();
    if (normalizedStatus === "rejected") {
      application.rejectionReason = rejectionReason;
    }

    await application.save();

    return res.status(200).json({
      message: `Loan application ${normalizedStatus} successfully`,
      application,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to review loan application",
      error: error.message,
    });
  }
};
