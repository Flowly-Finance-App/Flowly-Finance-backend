import { markOverdueInstallments } from "../controllers/repaymentController.js";

export function startOverdueCheckJob() {
  try {
    import("node-cron").then((cron) => {
      cron.default.schedule("0 6 * * *", async () => {
        try {
          const result = await markOverdueInstallments();
          console.log(`[overdueCheckJob] processed ${result.processed} loan(s)`);
        } catch (err) {
          console.error("[overdueCheckJob] failed:", err.message);
        }
      });
      console.log("Daily overdue check job scheduled with node-cron.");
    }).catch(() => {
      // Fallback timer if node-cron package is not installed
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      setInterval(async () => {
        try {
          const result = await markOverdueInstallments();
          console.log(`[overdueCheckJob] processed ${result.processed} loan(s)`);
        } catch (err) {
          console.error("[overdueCheckJob] failed:", err.message);
        }
      }, TWENTY_FOUR_HOURS);
      console.log("Daily overdue check job scheduled with setInterval fallback.");
    });
  } catch (err) {
    console.error("Failed to start overdue check job:", err);
  }
}
