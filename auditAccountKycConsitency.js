/**
 * auditAccountKycConsistency.js
 *
 * Scans all customers for mismatches between kycStatus and whether they
 * actually have a bank Account, and reports/fixes what it safely can.
 *
 *   Case A - kycStatus "verified" but NO Account:
 *     Safe to auto-heal (this is exactly what createBankAccountForUser is
 *     for). Pass --fix to actually create the missing accounts; without
 *     --fix it only reports them.
 *
 *   Case B - Account EXISTS but kycStatus is NOT "verified":
 *     Never auto-fixed. There is no code path in this app that produces
 *     this today, so it means the underlying data was created/edited
 *     directly (manual DB edit, leftover test record, etc). This script
 *     only lists these for you to review by hand - deciding whether to
 *     mark the KYC verified, or deactivate/remove the stray account,
 *     needs a human judgment call.
 *
 * Usage:
 *   node auditAccountKycConsistency.js          # report only
 *   node auditAccountKycConsistency.js --fix    # also heal Case A
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import User from "./models/User.js";
import Account from "./models/Account.js";
import { createBankAccountForUser } from "./controllers/authController.js";

const shouldFix = process.argv.includes("--fix");

async function run() {
  await connectDB();

  const customers = await User.find({ role: "customer" }).lean();
  const customerIds = customers.map((c) => c._id);
  const accounts = await Account.find({ user: { $in: customerIds } }).lean();
  const accountByUser = new Map(accounts.map((a) => [String(a.user), a]));

  const verifiedNoAccount = [];
  const accountNotVerified = [];

  for (const c of customers) {
    const account = accountByUser.get(String(c._id));
    if (c.kycStatus === "verified" && !account) {
      verifiedNoAccount.push(c);
    } else if (account && c.kycStatus !== "verified") {
      accountNotVerified.push({ user: c, account });
    }
  }

  console.log(`\nChecked ${customers.length} customers.\n`);

  console.log(`Case A - kycStatus "verified" but no bank account: ${verifiedNoAccount.length}`);
  for (const c of verifiedNoAccount) {
    console.log(`  - ${c.name} <${c.email}> (${c._id})`);
  }

  if (shouldFix && verifiedNoAccount.length) {
    console.log("\nFixing Case A records...");
    for (const c of verifiedNoAccount) {
      try {
        const account = await createBankAccountForUser(c._id);
        console.log(`  -> created account ${account.accountNumber} for ${c.name}`);
      } catch (error) {
        console.error(`  -> FAILED for ${c.name}: ${error.message}`);
      }
    }
  } else if (verifiedNoAccount.length) {
    console.log("  (run with --fix to create these missing accounts)");
  }

  console.log(`\nCase B - has a bank account but kycStatus is not "verified": ${accountNotVerified.length}`);
  console.log("  (never auto-fixed - review each by hand; this state can't be produced by current app logic)");
  for (const { user, account } of accountNotVerified) {
    console.log(
      `  - ${user.name} <${user.email}> (${user._id}) | kycStatus="${user.kycStatus}" | account ${account.accountNumber} status="${account.status}"`
    );
  }

  console.log("\nDone.");
  await mongoose.connection.close();
}

run().catch((err) => {
  console.error("Audit script failed:", err);
  process.exit(1);
});
