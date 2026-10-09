import {
  searchSavingsAccounts,
  createCashDeposit,
  getCashDepositByReceipt,
  listCashDeposits,
  CASH_DEPOSIT_LIMITS,
} from "../services/cashDepositService.js";

/**
 * Offline cash deposit (worker/admin)
 *
 *   GET  /api/cash-deposits/config                -> limits for the UI
 *   GET  /api/cash-deposits/accounts/search?q=    -> find + verify the customer's Savings account
 *   POST /api/cash-deposits                       -> confirm cash receipt -> CASH_DEPOSIT + balance update
 *   GET  /api/cash-deposits                       -> deposits handled (worker: own, admin: all)
 *   GET  /api/cash-deposits/:receiptNumber        -> receipt
 */

const fail = (res, error, fallbackMessage) => {
  if (error.status) return res.status(error.status).json({ message: error.message, code: error.code });
  console.error(`${fallbackMessage}:`, error);
  return res.status(500).json({ message: fallbackMessage, error: error.message });
};

export const getCashDepositConfig = (req, res) =>
  res.json({ minAmount: CASH_DEPOSIT_LIMITS.min, maxAmount: CASH_DEPOSIT_LIMITS.max, currency: CASH_DEPOSIT_LIMITS.currency });

export const searchAccounts = async (req, res) => {
  try {
    const accounts = await searchSavingsAccounts(req.query.q);
    return res.json({ count: accounts.length, accounts });
  } catch (error) {
    return fail(res, error, "Failed to search accounts");
  }
};

export const createDeposit = async (req, res) => {
  try {
    const { accountId, amount, confirmCashReceived, remarks, branch, idempotencyKey } = req.body;
    const result = await createCashDeposit({
      worker: req.user,
      accountId,
      amount,
      confirmCashReceived,
      remarks,
      branch,
      idempotencyKey: idempotencyKey || req.get("Idempotency-Key"),
    });
    return res.status(result.alreadyProcessed ? 200 : 201).json({
      message: result.alreadyProcessed
        ? "This deposit was already recorded"
        : "Cash deposit recorded and account balance updated",
      alreadyProcessed: result.alreadyProcessed,
      receipt: result.receipt,
    });
  } catch (error) {
    return fail(res, error, "Failed to record cash deposit");
  }
};

export const getDeposit = async (req, res) => {
  try {
    return res.json({ receipt: await getCashDepositByReceipt(req.params.receiptNumber, req.user) });
  } catch (error) {
    return fail(res, error, "Failed to fetch cash deposit");
  }
};

export const listDeposits = async (req, res) => {
  try {
    return res.json(await listCashDeposits({ user: req.user, page: req.query.page, limit: req.query.limit }));
  } catch (error) {
    return fail(res, error, "Failed to fetch cash deposits");
  }
};