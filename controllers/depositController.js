import Account from "../models/Account.js";
import FixedDeposit from "../models/FixedDeposit.js";
import TransactionBucket from "../models/TransactionBucket.js";
import Notification from "../models/Notification.js";
import Settings from "../models/Settings.js";

const recordTransaction = async ({
  accountId,
  userId,
  type,
  amount,
  description,
  refType,
  refId,
  meta = {},
}) => {
  return TransactionBucket.postEntry({
    accountId,
    userId,
    type,
    amount,
    description,
    refType,
    refId,
    meta,
  });
};

const notify = async ({ userId, title, message, type = "deposit" }) => {
  try {
    return await Notification.create({ user: userId, title, message, type });
  } catch (err) {
    // Notification failures should never break the money-movement flow.
    console.error("notify() failed:", err.message);
    return null;
  }
};

const getFDSettings = async () => {
  const settings = await Settings.findOne({ key: "global" });
  const values = settings?.values || {};
  return {
    minLockInMonths: Number(values.fdMinLockInMonths ?? 1),
    earlyClosurePenaltyRate: Number(values.fdEarlyClosurePenaltyRate ?? 1), // percentage points
  };
};

const calculateMaturityAmount = (principal, rate, months) => {
  const tYears = months / 12;
  return Math.round(principal * Math.pow(1 + rate / 400, 4 * tYears) * 100) / 100;
};

const monthsElapsed = (from, to) => {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
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
      accountId: account._id,
      userId: req.user._id,
      type: "deposit",
      amount: depositAmount,
      description,
      meta: { category: "deposit", balanceAfter: account.balance },
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
    const { principalAmount, interestRate = 7.5, tenureMonths, autoRenew = false } = req.body;
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

    const maturityAmount = calculateMaturityAmount(principal, rate, months);

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
      autoRenew: Boolean(autoRenew),
    });

    const txn = await recordTransaction({
      accountId: account._id,
      userId: req.user._id,
      type: "debit",
      amount: principal,
      description: `Fixed Deposit creation (${months} months @ ${rate}%)`,
      refType: "FixedDeposit",
      refId: fixedDeposit._id,
      meta: { category: "fd_deposit", balanceAfter: account.balance },
    });

    await notify({
      userId: req.user._id,
      title: "Fixed Deposit created",
      message: `Your FD of ₹${principal} at ${rate}% for ${months} months is active. It matures on ${maturityDate.toDateString()} at ₹${maturityAmount}.`,
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
 * Get a single Fixed Deposit owned by the requesting user
 * GET /api/deposits/fd/:id
 */
export const getFixedDepositById = async (req, res) => {
  try {
    const fixedDeposit = await FixedDeposit.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!fixedDeposit) {
      return res.status(404).json({ message: "Fixed Deposit not found" });
    }

    return res.status(200).json({ fixedDeposit });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch Fixed Deposit",
      error: error.message,
    });
  }
};

/**
 * Close an active Fixed Deposit before its maturity date.
 * Applies a lock-in check and a penalty on the contracted rate, then pays
 * out principal + simple interest for the period actually held.
 * POST /api/deposits/fd/:id/close
 */
export const closeFixedDepositEarly = async (req, res) => {
  try {
    const fixedDeposit = await FixedDeposit.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!fixedDeposit) {
      return res.status(404).json({ message: "Fixed Deposit not found" });
    }

    if (fixedDeposit.status !== "active") {
      return res.status(400).json({
        message: `This Fixed Deposit is already ${fixedDeposit.status.replace("_", " ")} and cannot be closed again.`,
      });
    }

    const now = new Date();
    const elapsedMonths = monthsElapsed(fixedDeposit.startDate, now);
    const { minLockInMonths, earlyClosurePenaltyRate } = await getFDSettings();

    if (elapsedMonths < minLockInMonths) {
      return res.status(400).json({
        message: `This FD is within its lock-in period. Early closure is allowed only after ${minLockInMonths} month(s); ${elapsedMonths} month(s) have elapsed so far.`,
      });
    }

    const effectiveRate = Math.max(0, fixedDeposit.interestRate - earlyClosurePenaltyRate);
    const interestPaid = Math.round(
      fixedDeposit.principalAmount * (effectiveRate / 100) * (elapsedMonths / 12) * 100
    ) / 100;
    const payoutAmount = Math.round((fixedDeposit.principalAmount + interestPaid) * 100) / 100;

    // Atomically claim the FD so a concurrent maturity-job run can't also process it.
    const claimed = await FixedDeposit.findOneAndUpdate(
      { _id: fixedDeposit._id, status: "active" },
      {
        status: "closed_early",
        earlyClosure: {
          closedAt: now,
          elapsedMonths,
          penaltyRate: earlyClosurePenaltyRate,
          effectiveRate,
          interestPaid,
          payoutAmount,
        },
      },
      { new: true }
    );

    if (!claimed) {
      return res.status(409).json({
        message: "This Fixed Deposit was just processed (matured or closed) — please refresh and try again.",
      });
    }

    const account = await Account.findById(fixedDeposit.account);
    account.balance += payoutAmount;
    await account.save();

    const txn = await recordTransaction({
      accountId: account._id,
      userId: req.user._id,
      type: "credit",
      amount: payoutAmount,
      description: `Fixed Deposit closed early (${elapsedMonths} months held, ${effectiveRate}% effective rate)`,
      refType: "FixedDeposit",
      refId: claimed._id,
      meta: {
        category: "fd_early_closure",
        principal: fixedDeposit.principalAmount,
        interestPaid,
        penaltyRate: earlyClosurePenaltyRate,
        balanceAfter: account.balance,
      },
    });

    await notify({
      userId: req.user._id,
      title: "Fixed Deposit closed early",
      message: `Your FD of ₹${fixedDeposit.principalAmount} was closed early after ${elapsedMonths} month(s). ₹${payoutAmount} (incl. ₹${interestPaid} interest, after penalty) has been credited to your account.`,
    });

    return res.status(200).json({
      message: "Fixed Deposit closed successfully",
      fixedDeposit: claimed,
      accountBalance: account.balance,
      transaction: txn,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Fixed Deposit closure failed",
      error: error.message,
    });
  }
};

/**
 * Process every Fixed Deposit that has reached its maturity date and is
 * still "active". For each one: pay out principal + interest to the linked
 * savings account (or roll it into a fresh FD when autoRenew is set),
 * record the ledger entry, and notify the customer.
 *
 * Idempotent and safe to run concurrently / repeatedly — each FD is claimed
 * with an atomic status-guarded update before anything else touches it.
 * Called by the daily fdMaturityJob, and exposed to admins/workers via
 * POST /api/deposits/fd/process-maturity for manual/on-demand runs.
 */
export const processMaturedDeposits = async () => {
  const now = new Date();
  const dueDeposits = await FixedDeposit.find({
    status: "active",
    maturityDate: { $lte: now },
  });

  let processed = 0;
  let renewed = 0;
  const errors = [];

  for (const fd of dueDeposits) {
    try {
      const claimed = await FixedDeposit.findOneAndUpdate(
        { _id: fd._id, status: "active" },
        { status: "matured", maturityProcessedAt: now },
        { new: true }
      );

      if (!claimed) continue; // already handled by another run

      const account = await Account.findById(claimed.account);
      if (!account) {
        errors.push({ fixedDepositId: claimed._id, error: "Linked account not found" });
        continue;
      }

      if (claimed.autoRenew) {
        // Reinvest the payout into a brand-new FD instead of crediting the
        // savings balance, so the customer keeps compounding automatically.
        const newStartDate = now;
        const newMaturityDate = new Date(now);
        newMaturityDate.setMonth(newMaturityDate.getMonth() + claimed.tenureMonths);
        const newMaturityAmount = calculateMaturityAmount(
          claimed.maturityAmount,
          claimed.interestRate,
          claimed.tenureMonths
        );

        const renewedFD = await FixedDeposit.create({
          user: claimed.user,
          account: claimed.account,
          principalAmount: claimed.maturityAmount,
          interestRate: claimed.interestRate,
          tenureMonths: claimed.tenureMonths,
          startDate: newStartDate,
          maturityDate: newMaturityDate,
          maturityAmount: newMaturityAmount,
          status: "active",
          autoRenew: true,
          renewedFrom: claimed._id,
        });

        claimed.renewedTo = renewedFD._id;
        await claimed.save();

        await recordTransaction({
          accountId: account._id,
          userId: claimed.user,
          type: "credit",
          amount: claimed.maturityAmount,
          description: `Fixed Deposit matured and auto-renewed for ${claimed.tenureMonths} months`,
          refType: "FixedDeposit",
          refId: renewedFD._id,
          meta: { category: "fd_renewal", balanceAffected: false, renewedFrom: claimed._id },
        });

        await notify({
          userId: claimed.user,
          title: "Fixed Deposit renewed",
          message: `Your FD of ₹${claimed.principalAmount} matured at ₹${claimed.maturityAmount} and has been auto-renewed for ${claimed.tenureMonths} more months, maturing ${newMaturityDate.toDateString()}.`,
        });

        renewed += 1;
      } else {
        account.balance += claimed.maturityAmount;
        await account.save();

        await recordTransaction({
          accountId: account._id,
          userId: claimed.user,
          type: "credit",
          amount: claimed.maturityAmount,
          description: `Fixed Deposit matured (${claimed.tenureMonths} months @ ${claimed.interestRate}%)`,
          refType: "FixedDeposit",
          refId: claimed._id,
          meta: { category: "fd_maturity", balanceAfter: account.balance },
        });

        await notify({
          userId: claimed.user,
          title: "Fixed Deposit matured",
          message: `Your FD of ₹${claimed.principalAmount} has matured. ₹${claimed.maturityAmount} has been credited to your account.`,
        });
      }

      processed += 1;
    } catch (err) {
      errors.push({ fixedDepositId: fd._id, error: err.message });
    }
  }

  return { checked: dueDeposits.length, processed, renewed, errors };
};

/**
 * Manually trigger the maturity sweep on demand.
 * POST /api/deposits/fd/process-maturity
 * Access: worker, admin
 */
export const triggerFDMaturityCheck = async (req, res) => {
  try {
    const result = await processMaturedDeposits();
    return res.status(200).json({
      message: "Fixed Deposit maturity check completed",
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Fixed Deposit maturity check failed",
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
