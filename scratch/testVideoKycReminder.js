import dotenv from "dotenv";
dotenv.config();

import {
  sendVideoKycScheduleEmail,
  sendVideoKycReminderEmail,
  sendVideoKycCancelledEmail,
} from "../utils/mailer.js";

async function runTest() {
  console.log("=== Testing Video KYC Email Reminders ===");

  const testEmail = "testuser@example.com";
  const now = new Date();
  const scheduledTime = new Date(now.getTime() + 15 * 60 * 1000);

  console.log("\n1. Testing Schedule Assignment Email:");
  const res1 = await sendVideoKycScheduleEmail(testEmail, {
    userName: "John Doe",
    scheduledAt: scheduledTime,
    durationMinutes: 30,
    officerName: "Officer Alex",
    notes: "Please have PAN card ready",
    isRescheduled: false,
  });
  console.log("Result 1:", res1);

  console.log("\n2. Testing 15-Minute Reminder Email:");
  const res2 = await sendVideoKycReminderEmail(testEmail, {
    userName: "John Doe",
    scheduledAt: scheduledTime,
    durationMinutes: 30,
    officerName: "Officer Alex",
  });
  console.log("Result 2:", res2);

  console.log("\n3. Testing Cancellation Email:");
  const res3 = await sendVideoKycCancelledEmail(testEmail, {
    userName: "John Doe",
    reason: "Requested by customer",
  });
  console.log("Result 3:", res3);

  console.log("\n=== Test Finished Successfully! ===");
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
