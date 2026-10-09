import crypto from "crypto";
import mongoose from "mongoose";
import Account from "../models/Account.js";
import Payment from "../models/Payment.js";
import TransactionBucket from "../models/TransactionBucket.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import paymentGateway from "./paymentGateway.js";
import { sendTopUpReceiptEmail } from "../utils/mailer.js";

/**
 * Add Money (account top-up) — shared by the webhook, the status endpoint and the
 * legacy FD top-up confirm endpoint, so a payment is verified and credited in exactly
 * one place and can never be credited twice.
 */

export const TOPUP_LIMITS = {
  min: Number(process.env.TOPUP_MIN_AMOUNT) || 10,
  max: Number(process.env.TOPUP_MAX_AMOUNT) || 100000,
  currency: "inr",
};

const err = (code, message) => Object.assign(new Error(message), { code });

export const maskAccountNumber = (n = "") => (n.length > 4 ? `${"X".repeat(n.length - 4)}${n.slice(-4)}` : n);

const generateReceiptNumber = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `FLWTXN-${date}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
};

/** Transaction details shown on screen / in the email. */
export const buildReceipt = (payment, account) => ({
  receiptNumber: payment.receiptNumber || null,
  paymentIntentId: payment.transactionReference,
  type: "credit",
  category: "account_topup",
  status: payment.paymentStatus,
  amount: payment.amount,
  currency: payment.currency,
  description: `Add money to ${account?.accountType || "bank"} account via card`,
  account: account
    ? { id: account._id, accountNumber: maskAccountNumber(account.accountNumber), accountType: account.accountType }
    : null,
  paymentMethod: payment.paymentMethod?.last4
    ? { type: "card", brand: payment.paymentMethod.brand, last4: payment.paymentMethod.last4 }
    : { type: "card" },
  balanceAfter: payment.balanceAfter ?? null,
  failureReason: payment.failureReason || null,
  initiatedAt: payment.createdAt,
  completedAt: payment.completedAt || null,
});

/** Confirms Stripe's data matches what we stored when the intent was created. */
const verifyIntent = (intent, payment) => {
  if (!intent || intent.id !== payment.transactionReference) return "PaymentIntent id mismatch";
  const expectedMinor = Math.round(payment.amount * 100);
  const paidMinor = intent.amount_received ?? intent.amount;
  if (paidMinor !== expectedMinor) return `Amount mismatch (expected ${expectedMinor}, Stripe has ${paidMinor})`;
  const expectedCurrency = (payment.currency || TOPUP_LIMITS.currency).toLowerCase();
  if ((intent.currency || expectedCurrency).toLowerCase() !== expectedCurrency) return "Currency mismatch";
  const md = intent.metadata || {};
  if (md.paymentId && md.paymentId !== payment._id.toString()) return "Payment id metadata mismatch";
  if (md.userId && md.userId !== payment.user.toString()) return "User metadata mismatch";
  if (md.accountId && payment.account && md.accountId !== payment.account.toString()) return "Account metadata mismatch";
  return null;
};

/** Best-effort card brand/last4 for the receipt; never blocks crediting. */
const fetchCardDetails = async (intentId) => {
  try {
    const full = await paymentGateway.retrievePaymentIntent(intentId, { expand: ["latest_charge"] });
    const card = full?.latest_charge?.payment_method_details?.card;
    return card ? { type: "card", brand: card.brand, last4: card.last4 } : undefined;
  } catch {
    return undefined;
  }
};

const isNoTransactionSupport = (e) =>
  e?.code === 20 || /replica set|Transaction numbers are only allowed/i.test(e?.message || "");

/**
 * Claim -> credit -> ledger, atomically. Uses a MongoDB transaction when the
 * deployment supports it (Atlas does); falls back to the same steps with a manual
 * rollback of the claim on a standalone MongoDB used for local dev.
 */
const applyCredit = async (payment, extra) => {
  const receiptNumber = payment.receiptNumber || generateReceiptNumber();

  const steps = async (session) => {
    const opts = session ? { session } : {};

    // Idempotency guard: only one caller can flip pending/failed -> success.
    const claimed = await Payment.findOneAndUpdate(
      { _id: payment._id, paymentStatus: { $in: ["pending", "failed"] } },
      {
        $set: { paymentStatus: "success", completedAt: new Date(), receiptNumber, ...extra },
        $unset: { failureReason: "" },
      },
      { new: true, ...opts }
    );
    if (!claimed) return null;

    try {
      const account = await Account.findOneAndUpdate(
        { _id: claimed.account },
        { $inc: { balance: claimed.amount } },
        { new: true, ...opts }
      );
      if (!account) throw err("ACCOUNT_NOT_FOUND", "Linked account not found for top-up payment");

      const entryId = new mongoose.Types.ObjectId();
      await TransactionBucket.postEntry({
        accountId: account._id,
        userId: claimed.user,
        type: "credit",
        amount: claimed.amount,
        description: `Add money to ${account.accountType} account via card`,
        refType: "Account",
        refId: account._id,
        entryId,
        session,
        meta: {
          category: "account_topup",
          receiptNumber,
          balanceAfter: account.balance,
          paymentId: claimed._id,
          gatewayTransactionId: claimed.transactionReference,
        },
      });

      const finalPayment = await Payment.findByIdAndUpdate(
        claimed._id,
        { $set: { balanceAfter: account.balance, ledgerEntryId: entryId } },
        { new: true, ...opts }
      );
      return { payment: finalPayment, account };
    } catch (e) {
      if (!session) {
        // No transaction to roll back: release the claim so a retry can succeed.
        await Payment.updateOne({ _id: payment._id }, { $set: { paymentStatus: "pending" }, $unset: { completedAt: "" } });
      }
      throw e;
    }
  };

  let result;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      result = await steps(session);
    });
  } catch (e) {
    if (isNoTransactionSupport(e)) {
      result = await steps(null);
    } else {
      throw e;
    }
  } finally {
    await session.endSession();
  }
  return result;
};

/** Notification + email after a successful credit. Best-effort: never throws. */
const sendSuccessNotifications = async (payment, account, receipt) => {
  try {
    await Notification.create({
      user: payment.user,
      type: "payment",
      title: "Money added to your account",
      message: `₹${payment.amount.toFixed(2)} has been added to your ${account.accountType} account (${maskAccountNumber(
        account.accountNumber
      )}). New balance: ₹${account.balance.toFixed(2)}. Ref: ${payment.receiptNumber}.`,
      meta: { receiptNumber: payment.receiptNumber, paymentId: payment._id, amount: payment.amount, balanceAfter: account.balance },
    });
  } catch (e) {
    console.error("Top-up notification failed:", e.message);
  }
  try {
    const user = await User.findById(payment.user).select("name email");
    if (user?.email) await sendTopUpReceiptEmail(user.email, receipt, user.name);
  } catch (e) {
    console.error("Top-up receipt email failed:", e.message);
  }
};

/**
 * Verifies the Stripe PaymentIntent against the stored payment and credits the
 * account once. Safe to call repeatedly (webhook retries, status polling, confirm).
 *
 * @param {string|ObjectId} paymentId  Payment._id
 * @param {object} intent              Stripe PaymentIntent (from webhook or retrieve)
 * @returns {{alreadyProcessed:boolean, payment, account, receipt}}
 */
export const creditTopUp = async (paymentId, intent) => {
  const payment = await Payment.findById(paymentId);
  if (!payment || payment.purpose !== "account_topup") throw err("TOPUP_NOT_FOUND", "Top-up payment not found");

  if (payment.paymentStatus === "success") {
    const account = await Account.findById(payment.account);
    return { alreadyProcessed: true, payment, account, receipt: buildReceipt(payment, account) };
  }

  if (!intent || intent.status !== "succeeded") {
    throw err("NOT_SUCCEEDED", `Payment has not succeeded (status: ${intent?.status || "unknown"})`);
  }

  const problem = verifyIntent(intent, payment);
  if (problem) {
    await Payment.updateOne(
      { _id: payment._id, paymentStatus: { $ne: "success" } },
      { $set: { paymentStatus: "failed", failureReason: `Verification failed: ${problem}` } }
    );
    throw err("VERIFY_FAILED", problem);
  }

  const card = await fetchCardDetails(intent.id);
  const applied = await applyCredit(payment, card ? { paymentMethod: card } : {});

  if (!applied) {
    // Lost the race to another request that already credited it.
    const fresh = await Payment.findById(payment._id);
    const account = await Account.findById(fresh.account);
    return { alreadyProcessed: true, payment: fresh, account, receipt: buildReceipt(fresh, account) };
  }

  const receipt = buildReceipt(applied.payment, applied.account);
  await sendSuccessNotifications(applied.payment, applied.account, receipt);
  return { alreadyProcessed: false, payment: applied.payment, account: applied.account, receipt };
};

/** Webhook entry: payment_intent.succeeded for an account top-up. */
export const creditTopUpFromIntent = async (intent) => {
  const payment = await Payment.findOne({ transactionReference: intent.id, purpose: "account_topup" });
  if (!payment) throw err("TOPUP_NOT_FOUND", `No top-up payment found for PaymentIntent ${intent.id}`);
  return creditTopUp(payment._id, intent);
};

/** Webhook entry: payment_intent.payment_failed / payment_intent.canceled. */
export const markTopUpFailed = async (intent, fallbackReason = "Payment failed") => {
  const reason = intent.last_payment_error?.message || fallbackReason;
  const payment = await Payment.findOneAndUpdate(
    { transactionReference: intent.id, purpose: "account_topup", paymentStatus: { $ne: "success" } },
    { $set: { paymentStatus: "failed", failureReason: reason } },
    { new: true }
  );
  if (!payment) return null;

  try {
    await Notification.create({
      user: payment.user,
      type: "payment",
      title: "Add money failed",
      message: `Your payment of ₹${payment.amount.toFixed(2)} could not be completed (${reason}). No money was added to your account.`,
      meta: { paymentId: payment._id, amount: payment.amount },
    });
  } catch (e) {
    console.error("Top-up failure notification failed:", e.message);
  }
  return payment;
};

export default { creditTopUp, creditTopUpFromIntent, markTopUpFailed, buildReceipt, maskAccountNumber, TOPUP_LIMITS };