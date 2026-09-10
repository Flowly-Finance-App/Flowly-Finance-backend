import express from "express";
import {
  depositFunds,
  createFixedDeposit,
  getUserDeposits,
} from "../controllers/depositController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// Customer deposit endpoints
router.post("/account/deposit", protect, depositFunds);
router.post("/fd/create", protect, authorize("customer"), createFixedDeposit);
router.get("/my-deposits", protect, authorize("customer"), getUserDeposits);

export default router;
