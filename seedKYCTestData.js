/**
 * seedKYCTestData.js
 *
 * Creates a handful of TEST customer users, each with a KYC record sitting
 * in "under_verification" status, so you can exercise the admin/worker
 * verify + reject flow (PUT /api/kyc/review/:id) without touching real data.
 *
 * All names, addresses, and ID numbers below are synthetic/dummy values
 * (obviously-fake Aadhaar/PAN patterns) — not real PII.
 *
 * Usage:
 *   node seedKYCTestData.js          # create test records
 *   node seedKYCTestData.js --clean  # remove previously seeded test records
 */

import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import connectDB from "./config/db.js";
import User from "./models/User.js";
import KYC from "./models/KYC.js";
import Document from "./models/Document.js";

// All seeded users share the "test.kyc." email prefix below, which is what
// the --clean flow uses to find and remove them again.
const TEST_USERS = [
  {
    name: "Test Verify Ravi",
    email: "test.kyc.verify.ravi@example.test",
    phone: "9000000001",
    dob: "1995-04-12",
    gender: "Male",
    address: "12 Test Layout, MG Road, Bengaluru, KA 560001",
    idType: "aadhaar",
    idNumber: "234123412340", // dummy Aadhaar-format number (test only)
  },
  {
    name: "Test Verify Sneha",
    email: "test.kyc.verify.sneha@example.test",
    phone: "9000000002",
    dob: "1998-09-23",
    gender: "Female",
    address: "45 Sample Nagar, Andheri West, Mumbai, MH 400058",
    idType: "pan",
    idNumber: "ABCDE1234F", // dummy PAN-format number (test only)
  },
  {
    name: "Test Reject Arjun",
    email: "test.kyc.reject.arjun@example.test",
    phone: "9000000003",
    dob: "1990-01-05",
    gender: "Male",
    address: "78 Demo Colony, Salt Lake, Kolkata, WB 700064",
    idType: "voter_id",
    idNumber: "TEST1234567", // dummy voter-id-format number (test only)
  },
  {
    name: "Test Reject Priya",
    email: "test.kyc.reject.priya@example.test",
    phone: "9000000004",
    dob: "2000-11-30",
    gender: "Female",
    address: "3 Placeholder Street, Anna Nagar, Chennai, TN 600040",
    idType: "passport",
    idNumber: "T1234567", // dummy passport-format number (test only)
  },
  {
    name: "Test Pending Kabir",
    email: "test.kyc.pending.kabir@example.test",
    phone: "9000000005",
    dob: "1993-06-18",
    gender: "Male",
    address: "9 Fixture Road, Sector 21, Noida, UP 201301",
    idType: "aadhaar",
    idNumber: "876587658760", // dummy Aadhaar-format number (test only)
  },
];

async function seed() {
  await connectDB();

  const dummyPasswordHash = await bcrypt.hash("Test@1234", 10);

  for (const t of TEST_USERS) {
    let user = await User.findOne({ email: t.email });

    if (!user) {
      user = await User.create({
        name: t.name,
        email: t.email,
        phone: t.phone,
        password: dummyPasswordHash,
        isEmailVerified: true,
        role: "customer",
        kycStatus: "under_verification",
        address: t.address,
      });
      console.log(`Created user: ${t.email}`);
    } else {
      user.kycStatus = "under_verification";
      user.address = t.address;
      await user.save();
      console.log(`Reused existing user: ${t.email}`);
    }

    const documentRecord = await Document.create({
      user: user._id,
      documentType: t.idType === "pan" ? "pan" : "aadhaar",
      fileUrl: `https://example.test/dummy-docs/${t.idType}-${t.phone}.jpg`,
      verificationStatus: "pending",
    });

    let kyc = await KYC.findOne({ user: user._id });
    const kycFields = {
      dob: t.dob,
      gender: t.gender,
      address: t.address,
      idType: t.idType,
      idNumber: t.idNumber,
      documentUrl: documentRecord.fileUrl,
      document: documentRecord._id,
      verificationStatus: "under_verification",
      rejectionReason: "",
    };

    if (kyc) {
      Object.assign(kyc, kycFields);
      await kyc.save();
    } else {
      kyc = await KYC.create({ user: user._id, ...kycFields });
    }

    console.log(`  -> KYC record ready: ${kyc._id} (status: ${kyc.verificationStatus})`);
  }

  console.log("\nDone. Test KYC records are in 'under_verification' status.");
  console.log("Fetch them with: GET /api/kyc/queue  (worker/admin token)");
  console.log("Then test approve/reject with: PUT /api/kyc/:id/approve or PUT /api/kyc/:id/reject");

  await mongoose.connection.close();
}

async function clean() {
  await connectDB();

  const emails = TEST_USERS.map((t) => t.email);
  const users = await User.find({ email: { $in: emails } });
  const userIds = users.map((u) => u._id);

  const kycRes = await KYC.deleteMany({ user: { $in: userIds } });
  const docRes = await Document.deleteMany({ user: { $in: userIds } });
  const userRes = await User.deleteMany({ email: { $in: emails } });

  console.log(`Removed ${userRes.deletedCount} users, ${kycRes.deletedCount} KYC records, ${docRes.deletedCount} documents.`);

  await mongoose.connection.close();
}

const isClean = process.argv.includes("--clean");
(isClean ? clean() : seed()).catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
