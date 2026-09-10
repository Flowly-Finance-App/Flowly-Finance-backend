import express from "express";
import {
  submitKYC,
  getKYCStatus,
  getPendingKYCs,
  reviewKYC,
} from "../controllers/kycController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// Customer KYC routes
router.post("/submit", protect, authorize("customer"), submitKYC);
router.get("/status", protect, authorize("customer"), getKYCStatus);

// Worker / Admin KYC review routes
router.get("/pending", protect, authorize("worker", "admin"), getPendingKYCs);
router.put("/review/:id", protect, authorize("worker", "admin"), reviewKYC);

export default router;
