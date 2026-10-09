import {
  searchWithdrawalAccounts,
  createWorkerCashWithdrawal,
  getCashWithdrawalByReceipt,
  getWithdrawalReceiptPDFBuffer,
  listCashWithdrawals,
  CASH_WITHDRAWAL_LIMITS,
} from "../services/cashWithdrawalService.js";

/**
 * Offline cash withdrawal (worker/admin)
 *
 *   GET  /api/cash-withdrawals/config                -> limits for the UI
 *   GET  /api/cash-withdrawals/accounts/search?q=    -> find + verify customer Savings/Current accounts
 *   POST /api/cash-withdrawals                       -> confirm cash handout -> WITHDRAWAL + balance debit
 *   GET  /api/cash-withdrawals                       -> withdrawals handled (worker: own, admin: all)
 *   GET  /api/cash-withdrawals/:receiptNumber        -> receipt
 *   GET  /api/cash-withdrawals/:receiptNumber/pdf    -> PDF receipt document
 */

const fail = (res, error, fallbackMessage) => {
  if (error.status) return res.status(error.status).json({ message: error.message, code: error.code });
  console.error(`${fallbackMessage}:`, error);
  return res.status(500).json({ message: fallbackMessage, error: error.message });
};

export const getCashWithdrawalConfig = (req, res) =>
  res.json({ minAmount: CASH_WITHDRAWAL_LIMITS.min, maxAmount: CASH_WITHDRAWAL_LIMITS.max, currency: CASH_WITHDRAWAL_LIMITS.currency });

export const searchAccounts = async (req, res) => {
  try {
    const accounts = await searchWithdrawalAccounts(req.query.q);
    return res.json({ count: accounts.length, accounts });
  } catch (error) {
    return fail(res, error, "Failed to search accounts for withdrawal");
  }
};

export const createWithdrawal = async (req, res) => {
  try {
    const { accountId, amount, confirmCashHandedOver, remarks, branch, idempotencyKey } = req.body;
    const result = await createWorkerCashWithdrawal({
      worker: req.user,
      accountId,
      amount,
      confirmCashHandedOver,
      remarks,
      branch,
      idempotencyKey: idempotencyKey || req.get("Idempotency-Key"),
    });
    return res.status(result.alreadyProcessed ? 200 : 201).json({
      message: result.alreadyProcessed
        ? "This cash withdrawal was already recorded"
        : "Cash withdrawal recorded and account debited successfully",
      alreadyProcessed: result.alreadyProcessed,
      receipt: result.receipt,
    });
  } catch (error) {
    return fail(res, error, "Failed to record cash withdrawal");
  }
};

export const getWithdrawal = async (req, res) => {
  try {
    return res.json({ receipt: await getCashWithdrawalByReceipt(req.params.receiptNumber, req.user) });
  } catch (error) {
    return fail(res, error, "Failed to fetch cash withdrawal receipt");
  }
};

export const downloadWithdrawalReceiptPDF = async (req, res) => {
  try {
    const { receiptNumber } = req.params;
    const { receipt, pdfBuffer } = await getWithdrawalReceiptPDFBuffer(receiptNumber, req.user);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Withdrawal_Receipt_${receiptNumber}.pdf"`
    );
    res.setHeader("Content-Length", pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (error) {
    return fail(res, error, "Failed to generate cash withdrawal receipt PDF");
  }
};

export const listWithdrawals = async (req, res) => {
  try {
    return res.json(await listCashWithdrawals({ user: req.user, page: req.query.page, limit: req.query.limit }));
  } catch (error) {
    return fail(res, error, "Failed to fetch cash withdrawals");
  }
};

