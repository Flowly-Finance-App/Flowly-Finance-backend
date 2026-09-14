import express from "express";
import {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  sendNotificationHandler,
} from "../controllers/notificationController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/my", getMyNotifications);
router.put("/mark-all-read", markAllAsRead);
router.put("/:id/read", markAsRead);
router.delete("/:id", deleteNotification);
router.post("/send", authorize("worker", "admin"), sendNotificationHandler);

export default router;
