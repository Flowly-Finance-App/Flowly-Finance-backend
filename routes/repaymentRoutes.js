import express from "express";
import {
  getSchedule,
  initiateRepayment,
  payAutoDebit,
  markPaidManually,
  getRepaymentHistory,
  getOverdueLoans,
  getNocCertificate,
  recordRecoveryFollowup,
} from "../controllers/repaymentController.js";
import { disburseLoan } from "../controllers/loanController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import LoanApplication from "../models/LoanApplication.js";
import { sendEmiReminders, REMINDER_DAYS } from "../jobs/emiReminderJob.js";

const router = express.Router();

router.use(protect);

router.get("/schedule/:loanId", getSchedule);

/**
 * POST /api/repayments/reminders/run
 * Manual trigger for the EMI reminder (email + in-app notification) - used for demo/testing.
 *  - body { loanId, installmentNo? }  -> simulates "today = 5 days before the due date" for that
 *    installment (defaults to the next pending one), so the reminder can be shown without waiting 5 days.
 *    Customers can do this for their own loans; workers/admins for any loan.
 *  - no body (worker/admin only)      -> runs the real daily job for all loans right now.
 */
router.post("/reminders/run", async (req, res) => {
  try {
    const isStaff = ["worker", "admin"].includes(req.user.role);
    const { loanId, installmentNo } = req.body || {};

    if (!loanId) {
      if (!isStaff) return res.status(400).json({ success: false, message: "loanId is required." });
      const result = await sendEmiReminders();
      return res.status(200).json({ success: true, mode: "daily-job", ...result });
    }

    const loan = await LoanApplication.findById(loanId);
    if (!loan) return res.status(404).json({ success: false, message: "Loan not found." });
    if (!isStaff && String(loan.user) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Not allowed for this loan." });
    }

    const pending = loan.repayments
      .filter((r) => r.status === "pending" && (!installmentNo || r.installmentNo === Number(installmentNo)))
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    if (!pending.length) {
      return res.status(404).json({ success: false, message: "No pending installment found." });
    }

    const target = pending[0];
    const daysBefore = REMINDER_DAYS[0];
    const asOf = new Date(new Date(target.dueDate).getTime() - daysBefore * 24 * 60 * 60 * 1000);

    const result = await sendEmiReminders({
      asOf,
      loanId: loan._id,
      installmentNo: target.installmentNo,
      simulate: true,
    });
    return res.status(200).json({ success: true, mode: "simulation", simulatedDaysBefore: daysBefore, ...result });
  } catch (err) {
    console.error("EMI reminder trigger error:", err);
    return res.status(500).json({ success: false, message: "Failed to run EMI reminder.", error: err.message });
  }
});
router.post("/initiate/:loanId/:installmentNo", initiateRepayment);
router.post("/pay-auto-debit/:loanId/:installmentNo", payAutoDebit);
router.get("/history/:loanId", getRepaymentHistory);
router.get("/noc/:loanId", getNocCertificate);

// Staff / Worker routes
router.get("/overdue", authorize("worker", "admin"), getOverdueLoans);
router.post("/mark-paid/:loanId/:installmentNo", authorize("worker", "admin"), markPaidManually);
router.post("/disburse/:loanId", authorize("worker", "admin"), disburseLoan);
router.put("/recovery-followup/:loanId", authorize("worker", "admin"), recordRecoveryFollowup);

export default router;