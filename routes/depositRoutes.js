import express from "express";
import {
  depositFunds,
  initiateAccountTopUp,
  confirmAccountTopUp,
  calculateFixedDeposit,
  createFixedDeposit,
  getUserDeposits,
  getFixedDepositById,
  closeFixedDepositEarly,
  triggerFDMaturityCheck,
  getFDWorkerQueue,
  getFDReviewDetails,
  approveFixedDeposit,
  rejectFixedDeposit,
  requestFDMoreInformation,
  submitFDAdditionalInfo,
} from "../controllers/depositController.js";
import {
  listActiveSchemes,
  listAllSchemes,
  getSchemeById,
  createScheme,
  updateScheme,
  toggleSchemeActive,
} from "../controllers/fdSchemeController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { uploadFDSupportingDoc } from "../middleware/uploadMiddleware.js";

const router = express.Router();

// /account/deposit credits a balance with no payment behind it. It is kept for local
// testing only; real money must come in through Stripe (/api/wallet/topup/intent).
const devOnly = (req, res, next) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ message: "Direct deposits are disabled. Use Add Money (card payment)." });
  }
  next();
};

// FD Scheme Catalog & Management Endpoints
router.get("/fd/schemes", protect, listActiveSchemes);
router.get("/fd/schemes/all", protect, authorize("worker", "admin"), listAllSchemes);
router.get("/fd/schemes/:id", protect, getSchemeById);
router.post("/fd/schemes", protect, authorize("worker", "admin"), createScheme);
router.put("/fd/schemes/:id", protect, authorize("worker", "admin"), updateScheme);
router.patch("/fd/schemes/:id/toggle", protect, authorize("worker", "admin"), toggleSchemeActive);

import { withdrawFunds } from "../controllers/walletController.js";

// Customer deposit endpoints
router.post("/account/deposit", protect, devOnly, depositFunds);
router.post("/account/withdraw", protect, authorize("customer"), withdrawFunds);
// "Add Money" step — Stripe top-up when the FD Balance Check comes up short
router.post("/account/topup/initiate", protect, authorize("customer"), initiateAccountTopUp);
router.post("/account/topup/confirm", protect, authorize("customer"), confirmAccountTopUp);
// "Enter FD Details" -> "System Calculates" preview (no money moves, nothing is created)
router.post("/fd/calculate", protect, authorize("customer"), calculateFixedDeposit);
router.post("/fd/create", protect, authorize("customer"), createFixedDeposit);
router.get("/my-deposits", protect, authorize("customer"), getUserDeposits);
// NOTE: worker's "/fd/queue" is registered further below but MUST resolve before this
// catch-all "/fd/:id" — Express matches routes in declaration order, so it's placed
// ahead of this line, not after it.
router.get("/fd/queue", protect, authorize("worker", "admin"), getFDWorkerQueue);
router.get("/fd/:id", protect, authorize("customer"), getFixedDepositById);
router.post("/fd/:id/close", protect, authorize("customer"), closeFixedDepositEarly);
// "Customer Uploads Information" — respond to a worker's info request; sends the FD back for re-review
router.post("/fd/:id/submit-info", protect, authorize("customer"), uploadFDSupportingDoc, submitFDAdditionalInfo);

// Worker/admin: manually run the maturity sweep on demand (also runs daily via cron)
router.post("/fd/process-maturity", protect, authorize("worker", "admin"), triggerFDMaturityCheck);

// Worker/admin: FD review & decision flow (Worker Review -> Decision). The queue
// endpoint itself is registered above, ahead of the customer's "/fd/:id" route.
router.get("/fd/:id/review", protect, authorize("worker", "admin"), getFDReviewDetails);
router.post("/fd/:id/approve", protect, authorize("worker", "admin"), approveFixedDeposit);
router.post("/fd/:id/reject", protect, authorize("worker", "admin"), rejectFixedDeposit);
router.post("/fd/:id/request-info", protect, authorize("worker", "admin"), requestFDMoreInformation);

export default router;