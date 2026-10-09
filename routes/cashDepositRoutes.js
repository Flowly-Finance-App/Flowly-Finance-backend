import express from "express";
import {
  getCashDepositConfig,
  searchAccounts,
  createDeposit,
  listDeposits,
  getDeposit,
} from "../controllers/cashDepositController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

// Static paths first so ":receiptNumber" doesn't swallow them.
router.get("/config", authorize("worker", "admin"), getCashDepositConfig);
router.get("/accounts/search", authorize("worker", "admin"), searchAccounts);
router.post("/", authorize("worker", "admin"), createDeposit);
router.get("/", authorize("worker", "admin"), listDeposits);
router.get("/:receiptNumber", getDeposit);

export default router;