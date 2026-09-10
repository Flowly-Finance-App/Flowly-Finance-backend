import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/db.js";

import authRoutes from "./routes/authRoutes.js";
import kycRoutes from "./routes/kycRoutes.js";
import calculatorRoutes from "./routes/calculatorRoutes.js";
import depositRoutes from "./routes/depositRoutes.js";
import loanRoutes from "./routes/loanRoutes.js";

dotenv.config();

connectDB();

const app = express();

app.use(cors());
app.use(express.json());

// Health Check
app.get("/", (req, res) => {
  res.json({
    message: "Flowly Finance Backend API is running 🚀",
    version: "1.0.0",
    modules: [
      "User & Worker Authentication",
      "KYC Verification Workflow",
      "Loan EMI & FD Calculators",
      "Savings & Fixed Deposit Management",
      "Loan Products, Applications, Worker Approvals & Disbursement",
    ],
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/kyc", kycRoutes);
app.use("/api/calculator", calculatorRoutes);
app.use("/api/deposits", depositRoutes);
app.use("/api/loans", loanRoutes);

// Global 404 Handler
app.use((req, res) => {
  res.status(404).json({
    message: `Route '${req.originalUrl}' not found.`,
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Unhandled Server Error:", err);
  res.status(500).json({
    message: "Internal server error",
    error: err.message,
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port http://localhost:${PORT}`);
});

export default app;