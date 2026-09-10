import express from "express";
import { calculateLoanEMI, calculateFD } from "../controllers/calculatorController.js";

const router = express.Router();

// Calculator endpoints (publicly accessible)
router.post("/loan", calculateLoanEMI);
router.post("/fd", calculateFD);

export default router;
