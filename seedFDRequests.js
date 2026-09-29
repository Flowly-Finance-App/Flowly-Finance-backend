import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import connectDB from "./config/db.js";
import User from "./models/User.js";
import Account from "./models/Account.js";
import FixedDeposit from "./models/FixedDeposit.js";
import KYC from "./models/KYC.js";
import FDScheme from "./models/FdScheme.js";

const TEST_FD_USERS = [
  {
    name: "Rekha Suresh",
    email: "rekha.s@example.com",
    phone: "9847012345",
    depositAmount: 100000,
    fdAmount: 50000,
    tenure: 12,
    rate: 7.5,
    type: "regular",
    status: "pending",
    dob: "1991-03-14",
  },
  {
    name: "Manoj Jacob",
    email: "manoj.j@example.com",
    phone: "9048012345",
    depositAmount: 250000,
    fdAmount: 150000,
    tenure: 24,
    rate: 7.85,
    type: "senior_citizen",
    status: "pending",
    dob: "1958-07-02",
  },
  {
    name: "Priya Krishnan",
    email: "priya.k@example.com",
    phone: "8902012345",
    depositAmount: 150000,
    fdAmount: 100000,
    tenure: 60,
    rate: 7.4,
    type: "tax_saver",
    status: "info_requested",
    dob: "1995-09-19",
  },
  {
    name: "Sunil Varma",
    email: "sunil.v@example.com",
    phone: "9633012345",
    depositAmount: 300000,
    fdAmount: 200000,
    tenure: 15,
    rate: 8.1,
    type: "special",
    status: "active",
    dob: "1985-01-11",
  }
];

async function seed() {
  await connectDB();
  console.log("Seeding FD Test Requests & Core Accounts...");

  const passwordHash = await bcrypt.hash("Customer@123", 10);

  for (const u of TEST_FD_USERS) {
    let user = await User.findOne({ email: u.email });
    if (!user) {
      user = await User.create({
        name: u.name,
        email: u.email,
        phone: u.phone,
        password: passwordHash,
        isEmailVerified: true,
        role: "customer",
        kycStatus: "verified",
        status: "active",
      });
      console.log(`Created user: ${user.name} (${user.email})`);
    } else {
      user.kycStatus = "verified";
      user.status = "active";
      await user.save();
    }

    let kyc = await KYC.findOne({ user: user._id });
    if (!kyc) {
      kyc = await KYC.create({
        user: user._id,
        dob: u.dob,
        gender: "Female",
        address: "Panampilly Nagar, Kochi, Kerala",
        idType: "aadhaar",
        idNumber: "999988887777",
        verificationStatus: "verified",
      });
    }

    let account = await Account.findOne({ user: user._id });
    if (!account) {
      const accNo = `1029${Math.floor(10000 + Math.random() * 90000)}`;
      account = await Account.create({
        user: user._id,
        accountNumber: accNo,
        accountType: "savings",
        balance: u.depositAmount,
        status: "active",
        branch: "Kochi Main Branch",
        ifscCode: "FLWY0001029",
      });
      console.log(`  -> Created savings account ${accNo} with balance ₹${u.depositAmount}`);
    } else {
      if (account.balance < u.depositAmount) {
        account.balance = u.depositAmount;
        await account.save();
      }
    }

    // Create FD
    const startDate = new Date();
    const maturityDate = new Date(startDate);
    maturityDate.setMonth(maturityDate.getMonth() + u.tenure);

    const maturityAmount = Math.round(u.fdAmount * Math.pow(1 + u.rate / 400, 4 * (u.tenure / 12)) * 100) / 100;

    let fd = await FixedDeposit.findOne({ user: user._id, principalAmount: u.fdAmount, status: u.status });
    if (!fd) {
      fd = await FixedDeposit.create({
        user: user._id,
        account: account._id,
        principalAmount: u.fdAmount,
        interestRate: u.rate,
        tenureMonths: u.tenure,
        fdType: u.type,
        interestPayoutOption: "cumulative",
        maturityInstruction: "credit_to_savings",
        startDate,
        maturityDate,
        maturityAmount,
        status: u.status,
        fdNumber: u.status === "active" ? `FD${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}${Math.floor(1000 + Math.random() * 9000)}` : undefined,
        infoRequests: u.status === "info_requested" ? [{ message: "Please provide a clear copy of your Form 15G or latest salary slip." }] : [],
      });
      console.log(`  -> Created ${u.status} FD request of ₹${u.fdAmount} for ${u.name}`);
    }
  }

  console.log("\nFD Test Requests Seeding Completed Successfully! 🚀");
  await mongoose.connection.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error("FD seeding failed:", err);
  process.exit(1);
});
