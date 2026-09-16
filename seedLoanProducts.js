/**
 * seedLoanProducts.js
 *
 * Populates the database with standard, active loan products so customers
 * can view catalog offerings (GET /api/loans/products) and apply for loans
 * (POST /api/loans/apply).
 *
 * Usage:
 *   node seedLoanProducts.js          # Seed default loan products if empty
 *   node seedLoanProducts.js --force  # Overwrite/re-seed existing loan products
 *   node seedLoanProducts.js --clean  # Remove all seeded loan products
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import LoanProduct from "./models/LoanProduct.js";

const DEFAULT_LOAN_PRODUCTS = [
  {
    productName: "Personal Loan",
    loanType: "Personal",
    interestRate: 12.0,
    minAmount: 10000,
    maxAmount: 500000,
    maxTenure: 24,
    tenure: 24,
    isActive: true,
  },
  {
    productName: "Vehicle Loan",
    loanType: "Vehicle",
    interestRate: 9.5,
    minAmount: 50000,
    maxAmount: 1500000,
    maxTenure: 36,
    tenure: 36,
    isActive: true,
  },
  {
    productName: "Business Loan",
    loanType: "Business",
    interestRate: 14.0,
    minAmount: 100000,
    maxAmount: 2000000,
    maxTenure: 48,
    tenure: 48,
    isActive: true,
  },
  {
    productName: "Education Loan",
    loanType: "Education",
    interestRate: 8.5,
    minAmount: 25000,
    maxAmount: 1000000,
    maxTenure: 60,
    tenure: 60,
    isActive: true,
  },
  {
    productName: "Emergency Micro-Loan",
    loanType: "Emergency",
    interestRate: 10.0,
    minAmount: 5000,
    maxAmount: 50000,
    maxTenure: 12,
    tenure: 12,
    isActive: true,
  },
];

async function seed() {
  await connectDB();

  const isForce = process.argv.includes("--force");
  const count = await LoanProduct.countDocuments();

  if (count > 0 && !isForce) {
    const existing = await LoanProduct.find().lean();
    console.log(`\nLoan products already exist (${existing.length} found):`);
    for (const p of existing) {
      console.log(`  - [${p.loanType}] ${p.productName} | ${p.interestRate}% APR | ₹${p.minAmount} - ₹${p.maxAmount} (${p.tenure} mo)`);
    }
    console.log("\nPass --force to overwrite/re-seed default loan products.");
    await mongoose.connection.close();
    return;
  }

  if (isForce) {
    await LoanProduct.deleteMany({});
    console.log("Cleared existing loan products (--force).");
  }

  const created = await LoanProduct.insertMany(DEFAULT_LOAN_PRODUCTS);
  console.log(`\nSeeded ${created.length} loan products successfully:`);
  for (const p of created) {
    console.log(`  - [${p.loanType}] ${p.productName} | ${p.interestRate}% APR | ₹${p.minAmount} - ₹${p.maxAmount} (${p.tenure} mo) [ID: ${p._id}]`);
  }

  await mongoose.connection.close();
}

async function clean() {
  await connectDB();
  const res = await LoanProduct.deleteMany({});
  console.log(`Removed ${res.deletedCount} loan products.`);
  await mongoose.connection.close();
}

const isClean = process.argv.includes("--clean");
(isClean ? clean() : seed()).catch((err) => {
  console.error("Seed loan products script failed:", err);
  process.exit(1);
});
