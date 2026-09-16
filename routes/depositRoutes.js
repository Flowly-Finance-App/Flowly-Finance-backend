import express from "express";
import {
  depositFunds,
  createFixedDeposit,
  getUserDeposits,
  getFixedDepositById,
  closeFixedDepositEarly,
  triggerFDMaturityCheck,
} from "../controllers/depositController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// Customer deposit endpoints
router.post("/account/deposit", protect, depositFunds);
router.post("/fd/create", protect, authorize("customer"), createFixedDeposit);
router.get("/my-deposits", protect, authorize("customer"), getUserDeposits);
router.get("/fd/:id", protect, authorize("customer"), getFixedDepositById);
router.post("/fd/:id/close", protect, authorize("customer"), closeFixedDepositEarly);

// Worker/admin: manually run the maturity sweep on demand (also runs daily via cron)
router.post("/fd/process-maturity", protect, authorize("worker", "admin"), triggerFDMaturityCheck);

export default router;
