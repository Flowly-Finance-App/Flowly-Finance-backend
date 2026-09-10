import express from "express";
import {
  getLoanProducts,
  seedLoanProducts,
  applyLoan,
  getUserApplications,
  getAllApplications,
  reviewLoanApplication,
  disburseLoan,
} from "../controllers/loanController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// Catalog
router.get("/products", getLoanProducts);
router.post("/seed-products", protect, authorize("worker", "admin"), seedLoanProducts);

// Customer loan endpoints
router.post("/apply", protect, authorize("customer"), applyLoan);
router.get("/my-applications", protect, authorize("customer"), getUserApplications);

// Worker / Admin loan review endpoints
router.get("/applications", protect, authorize("worker", "admin"), getAllApplications);
router.put("/applications/:id/review", protect, authorize("worker", "admin"), reviewLoanApplication);
router.post("/applications/:id/disburse", protect, authorize("worker", "admin"), disburseLoan);

export default router;
