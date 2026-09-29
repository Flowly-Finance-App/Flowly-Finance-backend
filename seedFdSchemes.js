import mongoose from "mongoose";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import FDScheme from "./models/FdScheme.js";

dotenv.config();

const sampleSchemes = [
  {
    name: "Flowly High Yield Regular FD",
    code: "FD-REG-01",
    description: "Our flagship compound growth fixed deposit designed for high annual returns and flexible tenure options.",
    category: "regular",
    minTenureMonths: 12,
    maxTenureMonths: 60,
    interestRate: 7.5,
    minDeposit: 5000,
    maxDeposit: 10000000,
    allowedPayoutOptions: ["cumulative", "quarterly", "annually"],
    seniorCitizenOnly: false,
    seniorCitizenBonusRate: 0.5,
    badge: "Popular",
    tags: ["High Returns", "Flexible Tenure", "Quarterly Compounding"],
    isActive: true,
    sortOrder: 1,
    rateSlabs: [
      { minMonths: 12, maxMonths: 23, rate: 7.0 },
      { minMonths: 24, maxMonths: 35, rate: 7.25 },
      { minMonths: 36, maxMonths: 60, rate: 7.5 },
    ],
  },
  {
    name: "Golden Senior Citizen Growth FD",
    code: "FD-SNR-01",
    description: "Exclusive fixed deposit for senior citizens aged 60+ featuring an extra 0.50% interest bonus and monthly interest payout options.",
    category: "senior_citizen",
    minTenureMonths: 12,
    maxTenureMonths: 120,
    interestRate: 8.0,
    minDeposit: 10000,
    maxDeposit: 15000000,
    allowedPayoutOptions: ["cumulative", "monthly", "quarterly", "annually"],
    seniorCitizenOnly: true,
    seniorCitizenBonusRate: 0.5,
    badge: "Senior Special",
    tags: ["0.5% Extra Rate", "Monthly Payout Option", "High Yield"],
    isActive: true,
    sortOrder: 2,
    rateSlabs: [
      { minMonths: 12, maxMonths: 24, rate: 7.5 },
      { minMonths: 25, maxMonths: 60, rate: 7.85 },
      { minMonths: 61, maxMonths: 120, rate: 8.0 },
    ],
  },
  {
    name: "Tax Saver 5-Year Lock-In FD",
    code: "FD-TAX-80C",
    description: "Save income tax under Section 80C with a mandatory 5-year lock-in period and guaranteed returns.",
    category: "tax_saver",
    minTenureMonths: 60,
    maxTenureMonths: 60,
    interestRate: 7.4,
    minDeposit: 1000,
    maxDeposit: 150000,
    allowedPayoutOptions: ["cumulative", "annually"],
    seniorCitizenOnly: false,
    seniorCitizenBonusRate: 0.5,
    badge: "Tax Saver",
    tags: ["Section 80C Tax Deduction", "5-Year Lock-in", "Guaranteed Yield"],
    isActive: true,
    sortOrder: 3,
    rateSlabs: [
      { minMonths: 60, maxMonths: 60, rate: 7.4 },
    ],
  },
  {
    name: "Festive 444-Days Special FD",
    code: "FD-SPC-444",
    description: "Limited time special duration fixed deposit offering maximum return of 8.10% per annum for exactly 15 months (444 days).",
    category: "special",
    minTenureMonths: 15,
    maxTenureMonths: 15,
    interestRate: 8.1,
    minDeposit: 25000,
    maxDeposit: 5000000,
    allowedPayoutOptions: ["cumulative", "quarterly"],
    seniorCitizenOnly: false,
    seniorCitizenBonusRate: 0.5,
    badge: "Highest Rate",
    tags: ["Super Special 444 Days", "Peak Interest Rate", "Limited Period"],
    isActive: true,
    sortOrder: 0,
    rateSlabs: [
      { minMonths: 15, maxMonths: 15, rate: 8.1 },
    ],
  },
  {
    name: "Flowly Liquid Flexi Deposit",
    code: "FD-FLX-01",
    description: "Short term liquid deposit with low minimum tenure starting from 3 months, ideal for short-term savings goals.",
    category: "flexi",
    minTenureMonths: 3,
    maxTenureMonths: 11,
    interestRate: 6.5,
    minDeposit: 1000,
    maxDeposit: 2000000,
    allowedPayoutOptions: ["cumulative", "monthly"],
    seniorCitizenOnly: false,
    seniorCitizenBonusRate: 0.25,
    badge: "Short Term",
    tags: ["Low Lock-in", "Liquid Cash", "Easy Withdrawal"],
    isActive: true,
    sortOrder: 4,
    rateSlabs: [
      { minMonths: 3, maxMonths: 5, rate: 5.75 },
      { minMonths: 6, maxMonths: 11, rate: 6.5 },
    ],
  },
];

const seedFD = async () => {
  try {
    await connectDB();
    console.log("Connected to MongoDB for FD Scheme Seeding...");

    for (const schemeData of sampleSchemes) {
      await FDScheme.findOneAndUpdate(
        { code: schemeData.code },
        schemeData,
        { upsert: true, new: true, runValidators: true }
      );
      console.log(`Seeded FD Scheme: ${schemeData.name} (${schemeData.code})`);
    }

    console.log("FD Scheme Seeding Completed Successfully! 🚀");
    process.exit(0);
  } catch (error) {
    console.error("Seeding failed:", error);
    process.exit(1);
  }
};

seedFD();
