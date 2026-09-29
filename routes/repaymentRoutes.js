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

const router = express.Router();

router.use(protect);

router.get("/schedule/:loanId", getSchedule);
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
