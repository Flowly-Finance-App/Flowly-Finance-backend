import crypto from "crypto";
import mongoose from "mongoose";
import Account from "../models/Account.js";
import User from "../models/User.js";
import Transaction from "../models/Transaction.js";
import TransactionBucket from "../models/TransactionBucket.js";
import Notification from "../models/Notification.js";
import { emitToUser } from "../sockets/videoKycSocket.js";
import { generateWithdrawalReceiptPDF } from "../utils/withdrawalReceiptGenerator.js";
import { sendWithdrawalReceiptEmail } from "../utils/mailer.js";

export const CASH_WITHDRAWAL_LIMITS = {
  min: Number(process.env.CASH_WITHDRAWAL_MIN_AMOUNT) || 1,
  max: Number(process.env.CASH_WITHDRAWAL_MAX_AMOUNT) || 200000,
  currency: "inr",
};

const err = (status, message, code) => Object.assign(new Error(message), { status, code });

const round2 = (n) => Math.round(n * 100) / 100;

export const maskAccountNumber = (n = "") => {
  const s = String(n);
  return s.length > 4 ? `${"X".repeat(s.length - 4)}${s.slice(-4)}` : s;
};

const generateReceiptNumber = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `FLWWD-${date}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ineligibleReason = (account, customer) => {
  if (!customer || customer.role !== "customer") return "Account holder is not a customer";
  if (!["savings", "current"].includes(account.accountType)) return "Cash withdrawal is only available for Savings or Current accounts";
  if (account.status !== "active") return `Account is ${account.status}`;
  if (customer.status !== "active") return `Customer profile is ${customer.status}`;
  if (customer.kycStatus !== "verified") return `Customer KYC is not verified (status: ${customer.kycStatus})`;
  return null;
};

export const buildReceipt = (txn, account) => ({
  receiptNumber: txn.receiptNumber,
  transactionId: txn._id,
  transactionType: txn.transactionType,
  status: txn.status,
  amount: txn.amount,
  currency: txn.currency,
  paymentMethod: txn.paymentMethod,
  description: txn.remarks || "Cash withdrawal at branch counter",
  account: account
    ? {
        id: account._id,
        accountNumber: account.accountNumber,
        maskedAccountNumber: maskAccountNumber(account.accountNumber),
        accountType: account.accountType,
        branch: account.branch,
      }
    : null,
  accountNumber: account?.accountNumber || null,
  customerName: txn.user?.name || account?.user?.name || null,
  customerEmail: txn.user?.email || account?.user?.email || null,
  branch: txn.branch || account?.branch || null,
  previousBalance: txn.previousBalance ?? null,
  updatedBalance: txn.updatedBalance ?? null,
  remarks: txn.remarks || null,
  workerId: txn.processedBy?._id || txn.processedBy || null,
  processedBy: txn.processedBy?.name
    ? { id: txn.processedBy._id, name: txn.processedBy.name }
    : txn.processedBy
      ? { id: txn.processedBy }
      : null,
  failureReason: txn.failureReason || null,
  timestamp: txn.completedAt || txn.createdAt,
  initiatedAt: txn.createdAt,
  completedAt: txn.completedAt || null,
});

export const searchWithdrawalAccounts = async (rawQuery) => {
  const raw = String(rawQuery || "").trim();
  if (raw.length < 3) throw err(400, "Enter at least 3 characters to search", "QUERY_TOO_SHORT");

  const cleanQuery = raw.replace(/^AC-/i, "");
  const regex = new RegExp(escapeRegex(raw), "i");
  const cleanRegex = new RegExp(escapeRegex(cleanQuery), "i");

  const users = await User.find({
    role: "customer",
    $or: [{ name: regex }, { email: regex }, { phone: regex }],
  })
    .select("_id")
    .limit(20)
    .lean();

  const accounts = await Account.find({
    accountType: { $in: ["savings", "current"] },
    $or: [
      { accountNumber: cleanQuery },
      { accountNumber: cleanRegex },
      { user: { $in: users.map((u) => u._id) } },
    ],
  })
    .populate("user", "name phone email role status kycStatus")
    .limit(10)
    .lean();

  return accounts
    .filter((a) => a.user)
    .map((a) => {
      const reason = ineligibleReason(a, a.user);
      return {
        accountId: a._id,
        accountNumber: a.accountNumber,
        accountType: a.accountType,
        branch: a.branch,
        ifscCode: a.ifscCode,
        status: a.status,
        balance: a.balance || 0,
        holder: {
          id: a.user._id,
          name: a.user.name,
          phone: a.user.phone,
          email: a.user.email,
          kycStatus: a.user.kycStatus,
        },
        eligible: !reason,
        ineligibleReason: reason,
      };
    });
};

const validateAmount = (raw) => {
  const amount = Number(raw);
  if (raw === "" || raw === null || raw === undefined || !Number.isFinite(amount) || amount <= 0) {
    throw err(400, "Enter a valid withdrawal amount greater than 0", "INVALID_AMOUNT");
  }
  if (round2(amount) !== amount) throw err(400, "Amount can have at most 2 decimal places", "INVALID_AMOUNT");
  if (amount < CASH_WITHDRAWAL_LIMITS.min || amount > CASH_WITHDRAWAL_LIMITS.max) {
    throw err(
      400,
      `Cash withdrawal must be between ₹${CASH_WITHDRAWAL_LIMITS.min} and ₹${CASH_WITHDRAWAL_LIMITS.max} per transaction`,
      "AMOUNT_OUT_OF_RANGE"
    );
  }
  return amount;
};

const isNoTransactionSupport = (e) =>
  e?.code === 20 || /replica set|Transaction numbers are only allowed/i.test(e?.message || "");

const applyWithdrawal = async ({ account, customerId, worker, amount, remarks, branch, receiptNumber, idempotencyKey }) => {
  const steps = async (session) => {
    const opts = session ? { session } : {};
    let debited = false;
    let txnId;

    try {
      const [txn] = await Transaction.create(
        [
          {
            transactionType: "WITHDRAWAL",
            receiptNumber,
            account: account._id,
            user: customerId,
            amount,
            currency: CASH_WITHDRAWAL_LIMITS.currency,
            paymentMethod: "CASH",
            status: "pending",
            processedBy: worker._id,
            branch,
            remarks: remarks || "Branch counter cash withdrawal",
            ...(idempotencyKey ? { idempotencyKey } : {}),
          },
        ],
        opts
      );
      txnId = txn._id;

      // Guarded atomic debit: balance must be >= amount and account active
      const updated = await Account.findOneAndUpdate(
        {
          _id: account._id,
          accountType: { $in: ["savings", "current"] },
          status: "active",
          balance: { $gte: amount },
        },
        { $inc: { balance: -amount } },
        { new: true, ...opts }
      );

      if (!updated) {
        const fresh = await Account.findById(account._id).session(session || null);
        if (!fresh || fresh.status !== "active") {
          throw err(409, "Account is no longer eligible for cash withdrawal", "ACCOUNT_NOT_ELIGIBLE");
        }
        if (fresh.balance < amount) {
          throw err(
            400,
            `Insufficient available balance in ${fresh.accountType} account. Available: ₹${fresh.balance.toFixed(
              2
            )}, Requested withdrawal: ₹${amount.toFixed(2)}.`,
            "INSUFFICIENT_BALANCE"
          );
        }
        throw err(409, "Withdrawal failed due to balance update conflict", "BALANCE_UPDATE_FAILED");
      }
      debited = true;

      const updatedBalance = round2(updated.balance);
      const previousBalance = round2(updatedBalance + amount);

      const entryId = new mongoose.Types.ObjectId();
      await TransactionBucket.postEntry({
        accountId: updated._id,
        userId: customerId,
        type: "withdrawal",
        amount,
        description: remarks || "Branch counter cash withdrawal",
        refType: "Account",
        refId: updated._id,
        entryId,
        session,
        meta: {
          category: "withdrawal",
          transactionType: "WITHDRAWAL",
          receiptNumber,
          transactionId: txnId,
          balanceAfter: updatedBalance,
          previousBalance,
          processedBy: worker._id,
        },
      });

      const finalTxn = await Transaction.findByIdAndUpdate(
        txnId,
        {
          $set: {
            status: "completed",
            previousBalance,
            updatedBalance,
            ledgerEntryId: entryId,
            completedAt: new Date(),
          },
        },
        { new: true, ...opts }
      );
      return { txn: finalTxn, account: updated };
    } catch (e) {
      if (!session) {
        if (debited) await Account.updateOne({ _id: account._id }, { $inc: { balance: amount } });
        if (txnId) {
          await Transaction.updateOne(
            { _id: txnId },
            { $set: { status: "failed", failureReason: e.message } }
          ).catch(() => {});
        }
      }
      throw e;
    }
  };

  const session = await mongoose.startSession().catch(() => null);
  if (!session) return steps(null);

  try {
    let result;
    await session.withTransaction(async () => {
      result = await steps(session);
    });
    return result;
  } catch (e) {
    if (isNoTransactionSupport(e)) return steps(null);
    throw e;
  } finally {
    await session.endSession();
  }
};

const notifyCustomer = async (txn, account, receipt) => {
  try {
    await Notification.create({
      user: txn.user,
      type: "payment",
      title: "Cash withdrawal processed at branch",
      message: `₹${txn.amount.toFixed(2)} was withdrawn in cash from your ${account.accountType} account (${maskAccountNumber(
        account.accountNumber
      )}) at branch counter. New balance: ₹${txn.updatedBalance.toFixed(2)}. Ref: ${txn.receiptNumber}.`,
      meta: {
        receiptNumber: txn.receiptNumber,
        transactionId: txn._id,
        amount: txn.amount,
        balanceAfter: txn.updatedBalance,
      },
    });

    if (receipt?.customerEmail) {
      try {
        const pdfBuffer = await generateWithdrawalReceiptPDF(receipt);
        await sendWithdrawalReceiptEmail(receipt.customerEmail, receipt, pdfBuffer);
      } catch (err) {
        console.error("Cash withdrawal receipt email failed:", err.message);
      }
    }
  } catch (e) {
    console.error("Cash withdrawal notification failed:", e.message);
  }
};

export const createWorkerCashWithdrawal = async ({
  worker,
  accountId,
  amount: rawAmount,
  confirmCashHandedOver,
  remarks,
  branch,
  idempotencyKey,
}) => {
  if (!accountId || !mongoose.isValidObjectId(accountId)) throw err(400, "A valid accountId is required", "INVALID_ACCOUNT");
  const amount = validateAmount(rawAmount);

  if (confirmCashHandedOver !== true) {
    throw err(400, "Confirm that the cash has been handed over to the customer before processing", "CASH_NOT_CONFIRMED");
  }

  const cleanRemarks = remarks ? String(remarks).trim().slice(0, 250) : undefined;
  const cleanBranch = branch ? String(branch).trim().slice(0, 100) : undefined;
  const scopedKey = idempotencyKey ? `${worker._id}:${String(idempotencyKey).trim().slice(0, 100)}` : undefined;

  if (scopedKey) {
    const prior = await Transaction.findOne({ idempotencyKey: scopedKey });
    if (prior) return replay(prior, accountId, amount);
  }

  const account = await Account.findById(accountId);
  if (!account) throw err(404, "Account not found", "ACCOUNT_NOT_FOUND");
  const customer = await User.findById(account.user).select("name email role status kycStatus");

  const reason = ineligibleReason(account, customer);
  if (reason) throw err(403, reason, "ACCOUNT_NOT_ELIGIBLE");

  if (String(account.user) === String(worker._id)) {
    throw err(403, "Staff cannot process cash withdrawal from their own account", "SELF_WITHDRAWAL_BLOCKED");
  }

  if (account.balance < amount) {
    throw err(
      400,
      `Insufficient available balance in ${account.accountType} account. Available: ₹${account.balance.toFixed(
        2
      )}, Requested withdrawal: ₹${amount.toFixed(2)}.`,
      "INSUFFICIENT_BALANCE"
    );
  }

  const receiptNumber = generateReceiptNumber();
  let applied;
  try {
    applied = await applyWithdrawal({
      account,
      customerId: customer._id,
      worker,
      amount,
      remarks: cleanRemarks,
      branch: cleanBranch || account.branch,
      receiptNumber,
      idempotencyKey: scopedKey,
    });
  } catch (e) {
    if (e?.code === 11000 && e.keyPattern?.idempotencyKey && scopedKey) {
      const prior = await Transaction.findOne({ idempotencyKey: scopedKey });
      if (prior) return replay(prior, accountId, amount);
    }
    throw e;
  }

  const { account: finalAccount, receipt } = await loadReceipt(applied.txn);
  await notifyCustomer(applied.txn, finalAccount, receipt);

  // Instantly notify customer dashboard via socket
  emitToUser(customer._id, "account:update", {
    type: "WITHDRAWAL",
    accountId: finalAccount._id,
    previousBalance: receipt.previousBalance,
    updatedBalance: receipt.updatedBalance,
    amount,
    receiptNumber: receipt.receiptNumber,
  });

  return { alreadyProcessed: false, receipt };
};

const replay = async (prior, accountId, amount) => {
  if (String(prior.account) !== String(accountId) || prior.amount !== amount) {
    throw err(409, "This idempotency key was already used for a different withdrawal", "IDEMPOTENCY_CONFLICT");
  }
  if (prior.status !== "completed") {
    throw err(409, "This withdrawal is still being processed or did not complete", "WITHDRAWAL_NOT_COMPLETED");
  }
  const { receipt } = await loadReceipt(prior);
  return { alreadyProcessed: true, receipt };
};

const loadReceipt = async (txn) => {
  const [account, populated] = await Promise.all([
    Account.findById(txn.account).populate("user", "name email"),
    Transaction.findById(txn._id).populate("processedBy", "name").populate("user", "name email"),
  ]);
  return { account, receipt: buildReceipt(populated, account) };
};

export const getCashWithdrawalByReceipt = async (receiptNumber, user) => {
  const txn = await Transaction.findOne({ receiptNumber, transactionType: "WITHDRAWAL" });
  if (!txn) throw err(404, "Cash withdrawal receipt not found", "NOT_FOUND");
  if (user && user.role === "customer" && String(txn.user) !== String(user._id || user.id)) {
    throw err(403, "Access denied to this withdrawal receipt", "FORBIDDEN");
  }
  return (await loadReceipt(txn)).receipt;
};

export const getWithdrawalReceiptPDFBuffer = async (receiptNumber, user) => {
  const receipt = await getCashWithdrawalByReceipt(receiptNumber, user);
  const pdfBuffer = await generateWithdrawalReceiptPDF(receipt);
  return { receipt, pdfBuffer };
};

export const listCashWithdrawals = async ({ user, page = 1, limit = 20 }) => {
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const filter = { transactionType: "WITHDRAWAL", paymentMethod: "CASH" };
  if (user.role !== "admin") filter.processedBy = user._id;

  const [txns, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .populate("processedBy", "name")
      .populate("account", "accountNumber accountType branch"),
    Transaction.countDocuments(filter),
  ]);

  return {
    total,
    page: p,
    limit: l,
    withdrawals: txns.map((t) => buildReceipt(t, t.account)),
  };
};

export default {
  searchWithdrawalAccounts,
  createWorkerCashWithdrawal,
  getCashWithdrawalByReceipt,
  getWithdrawalReceiptPDFBuffer,
  listCashWithdrawals,
  CASH_WITHDRAWAL_LIMITS,
};
