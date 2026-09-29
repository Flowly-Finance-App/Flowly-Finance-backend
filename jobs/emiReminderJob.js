import LoanApplication from "../models/LoanApplication.js";
import Notification from "../models/Notification.js";

/**
 * Checks all active/disbursed loans for upcoming EMI due dates:
 * - 7 Days Before
 * - 3 Days Before
 * - 1 Day Before
 * Sends reminder notifications to the customer.
 */
export async function sendEmiReminders() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const loans = await LoanApplication.find({
    status: { $in: ["disbursed", "active"] },
    "repayments.status": "pending",
  }).populate("user", "name email");

  let remindersSent = 0;

  for (const loan of loans) {
    for (const inst of loan.repayments) {
      if (inst.status !== "pending") continue;

      const dueDate = new Date(inst.dueDate);
      dueDate.setHours(0, 0, 0, 0);

      const diffDays = Math.round((dueDate - today) / (1000 * 60 * 60 * 24));

      if (diffDays === 7 || diffDays === 3 || diffDays === 1) {
        const title =
          diffDays === 1
            ? "🚨 Urgent EMI Reminder: Due Tomorrow!"
            : diffDays === 3
            ? "⚠️ EMI Reminder: Due in 3 Days"
            : "📅 EMI Reminder: Due in 7 Days";

        const message = `Hello ${loan.user?.name || "Customer"}, installment #${inst.installmentNo} of ₹${inst.emiAmount.toLocaleString("en-IN")} for loan ${loan.applicationNumber || loan._id} is due in ${diffDays} day(s) on ${dueDate.toLocaleDateString()}.`;

        // Avoid duplicate notification if already sent today
        const existing = await Notification.findOne({
          user: loan.user._id || loan.user,
          type: "emi",
          title,
          createdAt: { $gte: today },
        });

        if (!existing) {
          await Notification.create({
            user: loan.user._id || loan.user,
            type: "emi",
            title,
            message,
            meta: { loanId: loan._id, installmentNo: inst.installmentNo, diffDays },
          });
          remindersSent++;
        }
      }
    }
  }

  return { processed: loans.length, remindersSent };
}

export function startEmiReminderJob() {
  try {
    import("node-cron")
      .then((cron) => {
        cron.default.schedule("0 8 * * *", async () => {
          try {
            const res = await sendEmiReminders();
            console.log(`[emiReminderJob] Processed ${res.processed} loans, sent ${res.remindersSent} reminder(s).`);
          } catch (err) {
            console.error("[emiReminderJob] failed:", err.message);
          }
        });
        console.log("Daily EMI reminder job scheduled (8:00 AM).");
      })
      .catch(() => {
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
        setInterval(async () => {
          try {
            const res = await sendEmiReminders();
            console.log(`[emiReminderJob] Processed ${res.processed} loans, sent ${res.remindersSent} reminder(s).`);
          } catch (err) {
            console.error("[emiReminderJob] failed:", err.message);
          }
        }, TWENTY_FOUR_HOURS);
        console.log("Daily EMI reminder job scheduled (setInterval fallback).");
      });
  } catch (err) {
    console.error("Failed to start EMI reminder job:", err);
  }
}
