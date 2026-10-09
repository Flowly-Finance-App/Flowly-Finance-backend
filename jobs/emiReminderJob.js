import LoanApplication from "../models/LoanApplication.js";
import Notification from "../models/Notification.js";
import { sendEmiReminderEmail } from "../utils/mailer.js";

// How many days before the due date a reminder goes out. Add more values (e.g. [5, 1]) for extra reminders.
export const REMINDER_DAYS = [5];

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/**
 * Sends EMI reminders (in-app notification + email) for pending installments
 * that are exactly REMINDER_DAYS away from their due date.
 *
 * Options (all optional, used for the demo / manual trigger):
 *  - asOf:          treat this date as "today"
 *  - loanId:        only process this loan
 *  - installmentNo: only process this installment
 *  - simulate:      skip the duplicate check and tag the notification as a simulation
 */
export async function sendEmiReminders({ asOf, loanId, installmentNo, simulate = false } = {}) {
  const today = startOfDay(asOf || new Date());

  const query = {
    status: { $in: ["disbursed", "active"] },
    "repayments.status": "pending",
  };
  if (loanId) query._id = loanId;

  const loans = await LoanApplication.find(query).populate("user", "name email");

  let remindersSent = 0;
  let emailsSent = 0;
  const sent = [];

  for (const loan of loans) {
    if (!loan.user) continue;

    for (const inst of loan.repayments) {
      if (inst.status !== "pending") continue;
      if (installmentNo && inst.installmentNo !== Number(installmentNo)) continue;

      const dueDate = startOfDay(inst.dueDate);
      const diffDays = Math.round((dueDate - today) / DAY_MS);
      if (!REMINDER_DAYS.includes(diffDays)) continue;

      const userId = loan.user._id || loan.user;
      const loanNumber = loan.applicationNumber || String(loan._id);

      // Skip if this exact reminder was already sent (so re-running the job never spams the customer)
      if (!simulate) {
        const existing = await Notification.findOne({
          user: userId,
          type: "emi",
          "meta.loanId": loan._id,
          "meta.installmentNo": inst.installmentNo,
          "meta.diffDays": diffDays,
          "meta.simulated": { $ne: true },
        });
        if (existing) continue;
      }

      const dueText = dueDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const title = diffDays === 1 ? "🚨 EMI Reminder: Due Tomorrow!" : `📅 EMI Reminder: Due in ${diffDays} Days`;
      const message = `Hello ${loan.user.name || "Customer"}, installment #${inst.installmentNo} of ₹${Number(inst.emiAmount).toLocaleString("en-IN")} for loan ${loanNumber} is due in ${diffDays} day(s) on ${dueText}.`;

      // 1) In-app notification
      await Notification.create({
        user: userId,
        type: "emi",
        title,
        message,
        meta: {
          loanId: loan._id,
          installmentNo: inst.installmentNo,
          diffDays,
          dueDate: inst.dueDate,
          simulated: simulate,
        },
      });
      remindersSent++;

      // 2) Email
      const email = loan.user.email || loan.personalInformation?.email;
      try {
        const r = await sendEmiReminderEmail(email, {
          userName: loan.user.name,
          loanNumber,
          installmentNo: inst.installmentNo,
          emiAmount: inst.emiAmount,
          dueDate: inst.dueDate,
          daysLeft: diffDays,
        });
        if (r?.success) emailsSent++;
      } catch (err) {
        console.error(`[emiReminderJob] Email error for loan ${loanNumber}:`, err.message);
      }

      sent.push({ loanId: loan._id, loanNumber, installmentNo: inst.installmentNo, dueDate: inst.dueDate, diffDays });
    }
  }

  return { processed: loans.length, remindersSent, emailsSent, sent };
}

const runAndLog = async () => {
  try {
    const res = await sendEmiReminders();
    console.log(`[emiReminderJob] Processed ${res.processed} loans, sent ${res.remindersSent} reminder(s), ${res.emailsSent} email(s).`);
  } catch (err) {
    console.error("[emiReminderJob] failed:", err.message);
  }
};

export function startEmiReminderJob() {
  // Catch-up run shortly after startup, in case the server was down at 8:00 AM.
  // Safe to repeat: already-sent reminders are skipped.
  setTimeout(runAndLog, 15 * 1000);

  try {
    import("node-cron")
      .then((cron) => {
        cron.default.schedule("0 8 * * *", runAndLog, { timezone: "Asia/Kolkata" });
        console.log("Daily EMI reminder job scheduled (8:00 AM IST).");
      })
      .catch(() => {
        setInterval(runAndLog, 24 * 60 * 60 * 1000);
        console.log("Daily EMI reminder job scheduled (setInterval fallback).");
      });
  } catch (err) {
    console.error("Failed to start EMI reminder job:", err);
  }
}