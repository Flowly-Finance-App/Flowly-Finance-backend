import VideoKycSession from "../models/VideoKycSession.js";
import User from "../models/User.js";
import Notification from "../models/Notification.js";
import { sendVideoKycReminderEmail } from "../utils/mailer.js";

const formatIst = (date) =>
  new Date(date).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

/**
 * Checks scheduled Video KYC sessions and sends email reminders
 * for upcoming calls starting within 15 minutes.
 */
export async function sendVideoKycReminders() {
  const now = new Date();
  // Upcoming calls starting between 5 mins ago (grace) and 15 mins into the future
  const fifteenMinsLater = new Date(now.getTime() + 15 * 60 * 1000);
  const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000);

  const upcomingSessions = await VideoKycSession.find({
    status: "scheduled",
    reminderSent: { $ne: true },
    scheduledAt: { $gte: fiveMinsAgo, $lte: fifteenMinsLater },
  })
    .populate("customer", "name email")
    .populate("officer", "name email");

  let remindersSent = 0;

  for (const session of upcomingSessions) {
    if (!session.customer || !session.customer.email) continue;

    // Send email reminder
    await sendVideoKycReminderEmail(session.customer.email, {
      userName: session.customer.name || "Customer",
      scheduledAt: session.scheduledAt,
      durationMinutes: session.durationMinutes,
      officerName: session.officer?.name || "Flowly Officer",
    }).catch((err) => {
      console.error(`[videoKycReminderJob] Email error for session ${session._id}:`, err);
    });

    // Send in-app notification reminder
    await Notification.create({
      user: session.customer._id || session.customer,
      type: "kyc",
      title: "⏰ Video KYC Call Starting Soon",
      message: `Your Video KYC call starts at ${formatIst(session.scheduledAt)} (IST) in less than 15 minutes. Please be ready with your PAN & Aadhaar cards.`,
      meta: { sessionId: session._id },
    }).catch((err) => console.error("[videoKycReminderJob] Notification error:", err));

    // Mark reminder as sent
    session.reminderSent = true;
    session.reminderSentAt = new Date();
    await session.save();
    remindersSent++;
  }

  return { processed: upcomingSessions.length, remindersSent };
}

/**
 * Starts the background worker for Video KYC email reminders.
 */
export function startVideoKycReminderJob() {
  try {
    import("node-cron")
      .then((cron) => {
        // Run every 1 minute
        cron.default.schedule("* * * * *", async () => {
          try {
            const res = await sendVideoKycReminders();
            if (res.remindersSent > 0) {
              console.log(`[videoKycReminderJob] Sent ${res.remindersSent} video KYC email reminder(s).`);
            }
          } catch (err) {
            console.error("[videoKycReminderJob] Job error:", err.message);
          }
        });
        console.log("Video KYC email reminder job scheduled (every minute).");
      })
      .catch(() => {
        const ONE_MINUTE = 60 * 1000;
        setInterval(async () => {
          try {
            const res = await sendVideoKycReminders();
            if (res.remindersSent > 0) {
              console.log(`[videoKycReminderJob] Sent ${res.remindersSent} video KYC email reminder(s).`);
            }
          } catch (err) {
            console.error("[videoKycReminderJob] Job error:", err.message);
          }
        }, ONE_MINUTE);
        console.log("Video KYC email reminder job scheduled (setInterval 60s fallback).");
      });
  } catch (err) {
    console.error("Failed to start Video KYC reminder job:", err);
  }
}
