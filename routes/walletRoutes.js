import express from "express";
import {
  getWalletConfig,
  listMyAccounts,
  createTopUpIntent,
  getTopUpStatus,
  listTopUps,
  getTransactionDetails,
  withdrawFunds,
} from "../controllers/walletController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect, authorize("customer"));

router.get("/config", getWalletConfig);
router.get("/accounts", listMyAccounts);
router.post("/topup/intent", createTopUpIntent);
router.post("/withdraw", withdrawFunds);
router.get("/topups", listTopUps);
router.get("/topups/:paymentIntentId/status", getTopUpStatus);
router.get("/transactions/:receiptNumber", getTransactionDetails);

export default router;