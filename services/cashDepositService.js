import crypto from "crypto";
import mongoose from "mongoose";
import Account from "../models/Account.js";
import User from "../models/User.js";
import Transaction from "../models/Transaction.js";
import TransactionBucket from "../models/TransactionBucket.js";
import Notification from "../models/Notification.js";
import { sendCashDepositReceiptEmail } from "../utils/mailer.js";
import { emitToUser } from "../sockets/videoKycSocket.js";

/**
 * Offline cash deposit: a worker takes cash from a customer at the branch and credits
 * the customer's SAVINGS account.
 *
 *   searchSavingsAccounts()  - worker looks the customer up and sees if the account can take a deposit
 *   createCashDeposit()      - worker confirms cash receipt -> CASH_DEPOSIT transaction + balance update
 */

export const CASH_DEPOSIT_LIMITS = {
  min: Number(process.env.CASH_DEPOSIT_MIN_AMOUNT) || 1,
  max: Number(process.env.CASH_DEPOSIT_MAX_AMOUNT) || 200000,
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
  return `FLWCD-${date}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Returns a reason string if the account/customer can't take a cash deposit, else null. */
const ineligibleReason = (account, customer) => {
  if (!customer || customer.role !== "customer") return "Account holder is not a customer";
  if (account.accountType !== "savings") return "Cash deposit is only available for Savings accounts";
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
  description: "Cash deposit at branch",
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

/**
 * Find Savings accounts by account number, or by customer name / phone / email.
 * Balance is deliberately not returned - the worker only needs to identify the account.
 */
export const searchSavingsAccounts = async (rawQuery) => {
  const q = String(rawQuery || "").trim();
  if (q.length < 3) throw err(400, "Enter at least 3 characters to search", "QUERY_TOO_SHORT");

  const regex = new RegExp(escapeRegex(q), "i");
  const users = await User.find({
    role: "customer",
    $or: [{ name: regex }, { email: regex }, { phone: regex }],
  })
    .select("_id")
    .limit(20)
    .lean();

  const accounts = await Account.find({
    accountType: "savings",
    $or: [{ accountNumber: q }, { user: { $in: users.map((u) => u._id) } }],
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
    throw err(400, "Enter a valid deposit amount greater than 0", "INVALID_AMOUNT");
  }
  if (round2(amount) !== amount) throw err(400, "Amount can have at most 2 decimal places", "INVALID_AMOUNT");
  if (amount < CASH_DEPOSIT_LIMITS.min || amount > CASH_DEPOSIT_LIMITS.max) {
    throw err(
      400,
      `Cash deposit must be between ₹${CASH_DEPOSIT_LIMITS.min} and ₹${CASH_DEPOSIT_LIMITS.max} per transaction`,
      "AMOUNT_OUT_OF_RANGE"
    );
  }
  return amount;
};

const isNoTransactionSupport = (e) =>
  e?.code === 20 || /replica set|Transaction numbers are only allowed/i.test(e?.message || "");

/**
 * Create the transaction -> credit the balance -> post the ledger entry, atomically.
 * Uses a MongoDB transaction when available (Atlas / replica set); on a standalone local
 * MongoDB it runs the same steps and manually reverses the credit if a later step fails.
 */
const applyDeposit = async ({ account, customerId, worker, amount, remarks, branch, receiptNumber, idempotencyKey }) => {
  const steps = async (session) => {
    const opts = session ? { session } : {};
    let credited = false;
    let txnId;

    try {
      const [txn] = await Transaction.create(
        [
          {
            transactionType: "CASH_DEPOSIT",
            receiptNumber,
            account: account._id,
            user: customerId,
            amount,
            currency: CASH_DEPOSIT_LIMITS.currency,
            paymentMethod: "CASH",
            status: "pending",
            processedBy: worker._id,
            branch,
            remarks,
            ...(idempotencyKey ? { idempotencyKey } : {}),
          },
        ],
        opts
      );
      txnId = txn._id;

      // Guarded credit: only succeeds while the account is still an active savings account.
      const updated = await Account.findOneAndUpdate(
        { _id: account._id, accountType: "savings", status: "active" },
        { $inc: { balance: amount } },
        { new: true, ...opts }
      );
      if (!updated) throw err(409, "Account is no longer eligible for cash deposit", "ACCOUNT_NOT_ELIGIBLE");
      credited = true;

      const updatedBalance = round2(updated.balance);
      const previousBalance = round2(updatedBalance - amount);

      const entryId = new mongoose.Types.ObjectId();
      await TransactionBucket.postEntry({
        accountId: updated._id,
        userId: customerId,
        type: "credit",
        amount,
        description: "Cash deposit at branch",
        refType: "Account",
        refId: updated._id,
        entryId,
        session,
        meta: {
          category: "cash_deposit",
          transactionType: "CASH_DEPOSIT",
          receiptNumber,
          transactionId: txnId,
          balanceAfter: updatedBalance,
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
        // No DB transaction to roll back: undo what was done by hand.
        if (credited) await Account.updateOne({ _id: account._id }, { $inc: { balance: -amount } });
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

  const session = await mongoose.startSession();
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

/** Best-effort customer notification + email. Never throws. */
const notifyCustomer = async (txn, account, receipt) => {
  try {
    await Notification.create({
      user: txn.user,
      type: "deposit",
      title: "Cash deposit received",
      message: `₹${txn.amount.toFixed(2)} was deposited in cash to your savings account (${maskAccountNumber(
        account.accountNumber
      )}). New balance: ₹${txn.updatedBalance.toFixed(2)}. Ref: ${txn.receiptNumber}.`,
      meta: {
        receiptNumber: txn.receiptNumber,
        transactionId: txn._id,
        amount: txn.amount,
        balanceAfter: txn.updatedBalance,
      },
    });
  } catch (e) {
    console.error("Cash deposit notification failed:", e.message);
  }
  try {
    const customer = await User.findById(txn.user).select("name email");
    if (customer?.email) await sendCashDepositReceiptEmail(customer.email, receipt, customer.name);
  } catch (e) {
    console.error("Cash deposit receipt email failed:", e.message);
  }
};

const loadReceipt = async (txn) => {
  const [account, populated] = await Promise.all([
    Account.findById(txn.account),
    Transaction.findById(txn._id).populate("processedBy", "name"),
  ]);
  return { account, receipt: buildReceipt(populated, account) };
};

/**
 * @param {object} p
 * @param {object} p.worker               req.user (worker/admin)
 * @param {string} p.accountId            Account._id picked from the search results
 * @param {number|string} p.amount        rupees, max 2 decimals
 * @param {boolean} p.confirmCashReceived must be true - the worker confirms the cash is in hand
 * @param {string} [p.remarks]
 * @param {string} [p.branch]             defaults to the account's branch
 * @param {string} [p.idempotencyKey]     client-generated; resubmitting the same key returns the first result
 */
export const createCashDeposit = async ({ worker, accountId, amount: rawAmount, confirmCashReceived, remarks, branch, idempotencyKey }) => {
  if (!accountId || !mongoose.isValidObjectId(accountId)) throw err(400, "A valid accountId is required", "INVALID_ACCOUNT");
  const amount = validateAmount(rawAmount);
  if (confirmCashReceived !== true) {
    throw err(400, "Confirm that the cash has been received before depositing", "CASH_NOT_CONFIRMED");
  }

  const cleanRemarks = remarks ? String(remarks).trim().slice(0, 250) : undefined;
  const cleanBranch = branch ? String(branch).trim().slice(0, 100) : undefined;
  const scopedKey = idempotencyKey ? `${worker._id}:${String(idempotencyKey).trim().slice(0, 100)}` : undefined;

  // Resubmission of the same request (double click, retry after timeout)
  if (scopedKey) {
    const prior = await Transaction.findOne({ idempotencyKey: scopedKey });
    if (prior) return replay(prior, accountId, amount);
  }

  const account = await Account.findById(accountId);
  if (!account) throw err(404, "Account not found", "ACCOUNT_NOT_FOUND");
  const customer = await User.findById(account.user).select("name email role status kycStatus");

  const reason = ineligibleReason(account, customer);
  if (reason) throw err(403, reason, "ACCOUNT_NOT_ELIGIBLE");

  // Fraud control: staff can't credit cash into their own account.
  if (String(account.user) === String(worker._id)) {
    throw err(403, "Staff cannot deposit cash into their own account", "SELF_DEPOSIT_BLOCKED");
  }

  const receiptNumber = generateReceiptNumber();
  let applied;
  try {
    applied = await applyDeposit({
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
    // Lost a race with an identical in-flight request
    if (e?.code === 11000 && e.keyPattern?.idempotencyKey && scopedKey) {
      const prior = await Transaction.findOne({ idempotencyKey: scopedKey });
      if (prior) return replay(prior, accountId, amount);
    }
    throw e;
  }

  const { account: finalAccount, receipt } = await loadReceipt(applied.txn);
  await notifyCustomer(applied.txn, finalAccount, receipt);

  emitToUser(customer._id, "account:update", {
    type: "CASH_DEPOSIT",
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
    throw err(409, "This idempotency key was already used for a different deposit", "IDEMPOTENCY_CONFLICT");
  }
  if (prior.status !== "completed") {
    throw err(409, "This deposit is still being processed or did not complete", "DEPOSIT_NOT_COMPLETED");
  }
  const { receipt } = await loadReceipt(prior);
  return { alreadyProcessed: true, receipt };
};

export const getCashDepositByReceipt = async (receiptNumber, user) => {
  const txn = await Transaction.findOne({ receiptNumber });
  if (!txn) throw err(404, "Transaction receipt not found", "NOT_FOUND");
  if (user && user.role === "customer" && String(txn.user) !== String(user._id || user.id)) {
    throw err(403, "Access denied to this transaction receipt", "FORBIDDEN");
  }
  return (await loadReceipt(txn)).receipt;
};

/** Worker sees their own deposits; admin sees all. */
export const listCashDeposits = async ({ user, page = 1, limit = 20 }) => {
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const filter = { transactionType: "CASH_DEPOSIT" };
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
    deposits: txns.map((t) => buildReceipt(t, t.account)),
  };
};

export default { searchSavingsAccounts, createCashDeposit, getCashDepositByReceipt, listCashDeposits, CASH_DEPOSIT_LIMITS };