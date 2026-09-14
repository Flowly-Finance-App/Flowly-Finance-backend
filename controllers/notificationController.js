import Notification from "../models/Notification.js";

/**
 * GET /api/notifications/my
 * Access: any authenticated user
 */
export const getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const filter = { user: userId };

    if (req.query.unreadOnly === "true") filter.status = "unread";
    if (req.query.type) filter.type = req.query.type;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: userId, status: "unread" }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        notifications,
        unreadCount,
      },
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error("getMyNotifications error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
};

/**
 * PUT /api/notifications/:id/read
 */
export const markAsRead = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: userId },
      { status: "read" },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, data: notification });
  } catch (err) {
    console.error("markAsRead error:", err);
    return res.status(500).json({ success: false, message: "Failed to update notification" });
  }
};

/**
 * PUT /api/notifications/mark-all-read
 */
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const result = await Notification.updateMany(
      { user: userId, status: "unread" },
      { status: "read" }
    );

    return res.status(200).json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
    });
  } catch (err) {
    console.error("markAllAsRead error:", err);
    return res.status(500).json({ success: false, message: "Failed to update notifications" });
  }
};

/**
 * DELETE /api/notifications/:id
 */
export const deleteNotification = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      user: userId,
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    return res.status(200).json({ success: true, message: "Notification deleted" });
  } catch (err) {
    console.error("deleteNotification error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete notification" });
  }
};

/**
 * Helper function for internal code dispatch
 */
export const sendNotification = async ({ userId, type, title, message }) => {
  return Notification.create({
    user: userId,
    type,
    title,
    message,
  });
};

/**
 * POST /api/notifications/send
 * Access: worker, admin
 */
export const sendNotificationHandler = async (req, res) => {
  try {
    const { userId, type, title, message } = req.body;

    if (!userId || !type || !title || !message) {
      return res.status(422).json({
        success: false,
        message: "userId, type, title and message are required",
      });
    }

    const notification = await sendNotification({ userId, type, title, message });

    return res.status(201).json({ success: true, data: notification });
  } catch (err) {
    console.error("sendNotificationHandler error:", err);
    return res.status(500).json({ success: false, message: "Failed to send notification" });
  }
};
