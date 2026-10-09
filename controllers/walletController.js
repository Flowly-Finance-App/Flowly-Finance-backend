import crypto from "crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import Account from "../models/Account.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import Transaction from "../models/Transaction.js";
import TransactionBucket from "../models/TransactionBucket.js";
import Notification from "../models/Notification.js";
import paymentGateway from "../services/paymentGateway.js";
import { creditTopUp, buildReceipt, maskAccountNumber, TOPUP_LIMITS } from "../services/walletService.js";

/**
 * Add Money to a savings / current account.
 *
 *   POST /api/wallet/topup/intent                 -> create Stripe PaymentIntent + pending Payment
 *   GET  /api/wallet/topups/:paymentIntentId/status -> poll after card payment (also verifies with Stripe)
 *   GET  /api/wallet/topups                       -> my top-up history
 *   GET  /api/wallet/transactions/:receiptNumber  -> transaction details / receipt
 *   GET  /api/wallet/config                       -> limits for the UI
 *
 * The balance is only ever credited by walletService.creditTopUp (called from the
 * Stripe webhook, or from the status endpoint after it re-verifies with Stripe).
 */

export const getWalletConfig = (req, res) =>
  res.json({ minAmount: TOPUP_LIMITS.min, maxAmount: TOPUP_LIMITS.max, currency: TOPUP_LIMITS.currency });

const resolveAccount = async (user, { accountId, accountType }) => {
  if (accountId) {
    if (!mongoose.isValidObjectId(accountId)) return { status: 400, message: "Invalid accountId" };
    const acc = await Account.findOne({ _id: accountId, user: user._id });
    return acc ? { account: acc } : { status: 404, message: "Account not found" };
  }

  const accounts = await Account.find({ user: user._id });
  if (!accounts.length) return { status: 404, message: "No bank account found for this user" };

  if (accountType) {
    if (!["savings", "current"].includes(accountType)) {
      return { status: 400, message: "accountType must be 'savings' or 'current'" };
    }
    const acc = accounts.find((a) => a.accountType === accountType);
    return acc ? { account: acc } : { status: 404, message: `You do not have a ${accountType} account` };
  }

  return { account: accounts.find((a) => a.accountType === "savings") || accounts[0] };
};

export const listMyAccounts = async (req, res) => {
  try {
    const accounts = await Account.find({ user: req.user._id }).sort({ createdAt: 1 });
    return res.json({
      accounts: accounts.map((a) => ({
        id: a._id,
        accountNumber: a.accountNumber,
        maskedAccountNumber: maskAccountNumber(a.accountNumber),
        accountType: a.accountType,
        balance: a.balance,
        status: a.status,
        branch: a.branch,
        ifscCode: a.ifscCode,
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch accounts", error: error.message });
  }
};

export const createTopUpIntent = async (req, res) => {
  try {
    const user = req.user;

    if (user.kycStatus !== "verified") {
      return res.status(403).json({ message: `KYC verification is required before adding money. Current KYC status: '${user.kycStatus}'.` });
    }
    if (user.status !== "active") {
      return res.status(403).json({ message: `Your profile status is '${user.status}'. Only active customers can add money.` });
    }

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Please provide a valid amount greater than 0" });
    }
    if (Math.round(amount * 100) / 100 !== amount) {
      return res.status(400).json({ message: "Amount can have at most 2 decimal places" });
    }
    if (amount < TOPUP_LIMITS.min || amount > TOPUP_LIMITS.max) {
      return res.status(400).json({
        message: `Amount must be between ₹${TOPUP_LIMITS.min} and ₹${TOPUP_LIMITS.max} per transaction`,
      });
    }

    const resolved = await resolveAccount(user, req.body);
    if (!resolved.account) return res.status(resolved.status).json({ message: resolved.message });
    const { account } = resolved;

    if (account.status !== "active") {
      return res.status(403).json({ message: `Your ${account.accountType} account is '${account.status}'. Money can only be added to active accounts.` });
    }

    // Generate the id up front so it can travel in Stripe metadata and be verified on the webhook.
    const paymentId = new mongoose.Types.ObjectId();

    const intent = await paymentGateway.createPaymentIntent({
      amountInRupees: amount,
      currency: TOPUP_LIMITS.currency,
      description: `Flowly add money - ${account.accountType} account`,
      metadata: {
        purpose: "account_topup",
        userId: user._id.toString(),
        accountId: account._id.toString(),
        paymentId: paymentId.toString(),
      },
    });

    await Payment.create({
      _id: paymentId,
      user: user._id,
      account: account._id,
      purpose: "account_topup",
      amount,
      currency: TOPUP_LIMITS.currency,
      paymentStatus: "pending",
      transactionReference: intent.transactionId,
    });

    return res.status(201).json({
      message: "Payment initiated. Complete the card payment to add money.",
      clientSecret: intent.clientSecret,
      paymentIntentId: intent.transactionId,
      paymentId,
      amount,
      currency: TOPUP_LIMITS.currency,
      account: { id: account._id, accountNumber: maskAccountNumber(account.accountNumber), accountType: account.accountType },
    });
  } catch (error) {
    console.error("createTopUpIntent error:", error);
    return res.status(500).json({ message: "Failed to initiate payment", error: error.message });
  }
};

export const getTopUpStatus = async (req, res) => {
  try {
    const { paymentIntentId } = req.params;
    let payment = await Payment.findOne({
      transactionReference: paymentIntentId,
      user: req.user._id,
      purpose: "account_topup",
    });
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    // Safety net if the webhook is delayed (or not configured locally): ask Stripe directly,
    // then credit through the same idempotent, verified path the webhook uses.
    if (payment.paymentStatus === "pending" || payment.paymentStatus === "failed") {
      try {
        const intent = await paymentGateway.retrievePaymentIntent(paymentIntentId);
        if (intent.status === "succeeded") {
          await creditTopUp(payment._id, intent);
          payment = await Payment.findById(payment._id);
        }
      } catch (e) {
        if (e.code === "VERIFY_FAILED") {
          console.error(`Top-up verification failed for ${paymentIntentId}: ${e.message}`);
          payment = await Payment.findById(payment._id);
        } else if (e.code) {
          throw e;
        } else {
          console.warn("Could not verify with Stripe yet:", e.message);
        }
      }
    }

    const account = await Account.findById(payment.account);
    const receipt = buildReceipt(payment, account);

    return res.json({
      status: payment.paymentStatus, // pending | success | failed
      receipt,
      accountBalance: payment.paymentStatus === "success" ? account?.balance : undefined,
      currentBalance: account?.balance,
    });
  } catch (error) {
    console.error("getTopUpStatus error:", error);
    return res.status(500).json({ message: "Failed to fetch payment status", error: error.message });
  }
};

export const listTopUps = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const filter = { user: req.user._id, purpose: "account_topup" };

    const [payments, total] = await Promise.all([
      Payment.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Payment.countDocuments(filter),
    ]);

    const accounts = await Account.find({ _id: { $in: payments.map((p) => p.account) } });
    const byId = new Map(accounts.map((a) => [a._id.toString(), a]));

    return res.json({
      total,
      page,
      limit,
      topups: payments.map((p) => buildReceipt(p, byId.get(p.account?.toString()))),
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch top-ups", error: error.message });
  }
};

export const getTransactionDetails = async (req, res) => {
  try {
    const { receiptNumber } = req.params;

    const payment = await Payment.findOne({
      receiptNumber,
      user: req.user._id,
    });

    if (payment) {
      const account = await Account.findById(payment.account);
      return res.json({ receipt: buildReceipt(payment, account) });
    }

    const txn = await Transaction.findOne({
      receiptNumber,
      user: req.user._id,
    });

    if (txn) {
      const account = await Account.findById(txn.account);
      const receipt = {
        receiptNumber: txn.receiptNumber,
        transactionId: txn._id,
        transactionType: txn.transactionType,
        type: txn.transactionType === "WITHDRAWAL" ? "withdrawal" : "credit",
        category: txn.transactionType === "WITHDRAWAL" ? "withdrawal" : "cash_deposit",
        status: txn.status,
        amount: txn.amount,
        currency: txn.currency,
        description: txn.remarks || `${txn.transactionType} on ${account?.accountType || "bank"} account`,
        account: account
          ? { id: account._id, accountNumber: maskAccountNumber(account.accountNumber), accountType: account.accountType, branch: account.branch }
          : null,
        accountNumber: account?.accountNumber || null,
        customerName: req.user.name,
        previousBalance: txn.previousBalance,
        updatedBalance: txn.updatedBalance,
        balanceAfter: txn.updatedBalance,
        remarks: txn.remarks || null,
        timestamp: txn.completedAt || txn.createdAt,
        completedAt: txn.completedAt || null,
      };
      return res.json({ receipt });
    }

    return res.status(404).json({ message: "Transaction not found" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch transaction details", error: error.message });
  }
};

export const withdrawFunds = async (req, res) => {
  return res.status(403).json({
    message: "Direct online withdrawal by customer is disabled. Cash withdrawals must be processed in-person by a bank worker at the branch counter.",
    code: "CUSTOMER_WITHDRAWAL_DISABLED",
  });
};