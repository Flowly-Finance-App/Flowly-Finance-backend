import { processMaturedDeposits } from "../controllers/depositController.js";

export function startFDMaturityJob() {
  try {
    import("node-cron").then((cron) => {
      // Runs daily at 7am, after the overdue-loan check at 6am.
      cron.default.schedule("0 7 * * *", async () => {
        try {
          const result = await processMaturedDeposits();
          console.log(
            `[fdMaturityJob] checked ${result.checked}, processed ${result.processed} (renewed ${result.renewed})${
              result.errors.length ? `, ${result.errors.length} error(s)` : ""
            }`
          );
        } catch (err) {
          console.error("[fdMaturityJob] failed:", err.message);
        }
      });
      console.log("Daily FD maturity job scheduled with node-cron.");
    }).catch(() => {
      // Fallback timer if node-cron package is not installed
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
      setInterval(async () => {
        try {
          const result = await processMaturedDeposits();
          console.log(
            `[fdMaturityJob] checked ${result.checked}, processed ${result.processed} (renewed ${result.renewed})`
          );
        } catch (err) {
          console.error("[fdMaturityJob] failed:", err.message);
        }
      }, TWENTY_FOUR_HOURS);
      console.log("Daily FD maturity job scheduled with setInterval fallback.");
    });
  } catch (err) {
    console.error("Failed to start FD maturity job:", err);
  }
}
