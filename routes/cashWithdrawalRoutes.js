import express from "express";
import {
  getCashWithdrawalConfig,
  searchAccounts,
  createWithdrawal,
  listWithdrawals,
  getWithdrawal,
  downloadWithdrawalReceiptPDF,
} from "../controllers/cashWithdrawalController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

// Static paths first so ":receiptNumber" doesn't swallow them.
router.get("/config", authorize("worker", "admin"), getCashWithdrawalConfig);
router.get("/accounts/search", authorize("worker", "admin"), searchAccounts);
router.post("/", authorize("worker", "admin"), createWithdrawal);
router.get("/", authorize("worker", "admin"), listWithdrawals);
router.get("/:receiptNumber/pdf", downloadWithdrawalReceiptPDF);
router.get("/:receiptNumber", getWithdrawal);

export default router;
