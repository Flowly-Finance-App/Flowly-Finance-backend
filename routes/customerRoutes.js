import express from "express";
import {
  getCustomers,
  getCustomerById,
} from "../controllers/customerController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

// Worker / Admin customer management routes
router.get("/", protect, authorize("worker", "admin"), getCustomers);
router.get("/:id", protect, authorize("worker", "admin"), getCustomerById);

export default router;
