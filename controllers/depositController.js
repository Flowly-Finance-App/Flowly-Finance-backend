import Account from "../models/Account.js";
import FixedDeposit from "../models/FixedDeposit.js";
import TransactionBucket from "../models/Transaction.js";


const recordTransaction = async ({
  account,
  user,
  type,
  category,
  amount,
  balanceAfter,
  description,
  relatedFixedDeposit,
}) => {
  const date = new Date();
  const periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

  let bucket = await TransactionBucket.findOne({
    account: account._id,
    periodKey,
  });

  const entry = {
    type,
    category,
    amount,
    balanceAfter,
    description,
    referenceNumber: `TXN${Date.now()}${Math.floor(Math.random() * 1000)}`,
    relatedFixedDeposit,
    createdAt: date,
  };

  if (!bucket) {
    bucket = await TransactionBucket.create({
      account: account._id,
      user,
      periodKey,
      entryCount: 1,
      entries: [entry],
    });
  } else {
    bucket.entries.push(entry);
    bucket.entryCount += 1;
    await bucket.save();
  }

  return entry;
};


export const depositFunds = async (req, res) => {
  try {
    const { amount, description = "Account deposit" } = req.body;
    const depositAmount = Number(amount);

    if (!depositAmount || depositAmount <= 0) {
      return res.status(400).json({
        message: "Please provide a valid deposit amount greater than 0",
      });
    }

    const account = await Account.findOne({ user: req.user._id });

    if (!account) {
      return res.status(404).json({
        message: "Bank account not found for this user",
      });
    }

    account.balance += depositAmount;
    await account.save();

    const txn = await recordTransaction({
      account,
      user: req.user._id,
      type: "credit",
      category: "deposit",
      amount: depositAmount,
      balanceAfter: account.balance,
      description,
    });

    return res.status(200).json({
      message: `Successfully deposited ₹${depositAmount} into savings account`,
      accountBalance: account.balance,
      transaction: txn,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Deposit failed",
      error: error.message,
    });
  }
};

/**
 * Create Fixed Deposit (FD)
 * POST /api/deposits/fd/create
 */
export const createFixedDeposit = async (req, res) => {
  try {
    const { principalAmount, interestRate = 7.5, tenureMonths } = req.body;
    const principal = Number(principalAmount);
    const months = Number(tenureMonths);
    const rate = Number(interestRate);

    if (!principal || principal <= 0 || !months || months <= 0) {
      return res.status(400).json({
        message: "Please provide valid principal amount and tenure in months",
      });
    }

    const account = await Account.findOne({ user: req.user._id });

    if (!account) {
      return res.status(404).json({
        message: "Bank account not found for user",
      });
    }

    if (account.balance < principal) {
      return res.status(400).json({
        message: `Insufficient account balance (₹${account.balance}). Cannot create FD of ₹${principal}.`,
      });
    }

    // Calculate Maturity Amount
    const tYears = months / 12;
    const maturityAmount = Math.round(principal * Math.pow(1 + rate / 400, 4 * tYears) * 100) / 100;

    const startDate = new Date();
    const maturityDate = new Date();
    maturityDate.setMonth(maturityDate.getMonth() + months);

    // Deduct principal from savings balance
    account.balance -= principal;
    await account.save();

    const fixedDeposit = await FixedDeposit.create({
      user: req.user._id,
      account: account._id,
      principalAmount: principal,
      interestRate: rate,
      tenureMonths: months,
      startDate,
      maturityDate,
      maturityAmount,
      status: "active",
    });

    const txn = await recordTransaction({
      account,
      user: req.user._id,
      type: "debit",
      category: "fd_deposit",
      amount: principal,
      balanceAfter: account.balance,
      description: `Fixed Deposit creation (${months} months @ ${rate}%)`,
      relatedFixedDeposit: fixedDeposit._id,
    });

    return res.status(201).json({
      message: "Fixed Deposit created successfully",
      fixedDeposit,
      accountBalance: account.balance,
      transaction: txn,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Fixed Deposit creation failed",
      error: error.message,
    });
  }
};

/**
 * Get User's Account Balance and Fixed Deposits
 * GET /api/deposits/my-deposits
 */
export const getUserDeposits = async (req, res) => {
  try {
    const account = await Account.findOne({ user: req.user._id });
    const fixedDeposits = await FixedDeposit.find({ user: req.user._id }).sort({ createdAt: -1 });

    return res.status(200).json({
      accountBalance: account ? account.balance : 0,
      accountNumber: account ? account.accountNumber : null,
      fixedDepositsCount: fixedDeposits.length,
      fixedDeposits,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch deposits",
      error: error.message,
    });
  }
};
