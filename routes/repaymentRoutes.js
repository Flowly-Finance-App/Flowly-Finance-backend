import express from "express";
import {
  getSchedule,
  initiateRepayment,
  markPaidManually,
  getRepaymentHistory,
  getOverdueLoans,
  disburseLoan,
} from "../controllers/repaymentController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/schedule/:loanId", getSchedule);
router.post("/initiate/:loanId/:installmentNo", initiateRepayment);
router.get("/history/:loanId", getRepaymentHistory);

router.get("/overdue", authorize("worker", "admin"), getOverdueLoans);
router.post("/mark-paid/:loanId/:installmentNo", authorize("worker", "admin"), markPaidManually);
router.post("/disburse/:loanId", authorize("worker", "admin"), disburseLoan);

export default router;
