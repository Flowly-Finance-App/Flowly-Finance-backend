import express from "express";
import CustomerDashboardController from "../controllers/customerDashboardController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(authorize("customer"));

router.get("/", CustomerDashboardController.getDashboard);
router.get("/account-summary", CustomerDashboardController.getAccountSummary);
router.get("/active-loan", CustomerDashboardController.getActiveLoanAndEmi);
router.get("/active-fds", CustomerDashboardController.getActiveFDs);
router.get("/recent-transactions", CustomerDashboardController.getRecentTransactions);
router.get("/notifications", CustomerDashboardController.getNotifications);
router.get("/financial-overview", CustomerDashboardController.getFinancialOverview);

export default router;
