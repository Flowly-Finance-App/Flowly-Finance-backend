import express from "express";
import {
  getLoanProducts,
  seedLoanProducts,
  applyLoan,
  getUserApplications,
  resubmitDocuments,
  acceptSanctionLetter,
  esignLoanAgreement,
  getAllApplications,
  getApplicationById,
  assignLoanWorker,
  updateWorkerReview,
  sanctionLoan,
  rejectLoan,
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
router.post("/applications/:id/resubmit-documents", protect, authorize("customer"), resubmitDocuments);
router.post("/applications/:id/accept-sanction", protect, authorize("customer"), acceptSanctionLetter);
router.post("/applications/:id/esign", protect, authorize("customer"), esignLoanAgreement);

// Worker / Admin loan review endpoints
router.get("/applications", protect, authorize("worker", "admin"), getAllApplications);
router.get("/applications/:id", protect, authorize("worker", "admin"), getApplicationById);
router.put("/applications/:id/assign", protect, authorize("worker", "admin"), assignLoanWorker);
router.put("/applications/:id/worker-review", protect, authorize("worker", "admin"), updateWorkerReview);
router.post("/applications/:id/sanction", protect, authorize("worker", "admin"), sanctionLoan);
router.post("/applications/:id/reject", protect, authorize("worker", "admin"), rejectLoan);
router.put("/applications/:id/review", protect, authorize("worker", "admin"), reviewLoanApplication);
router.post("/applications/:id/disburse", protect, authorize("worker", "admin"), disburseLoan);

export default router;
