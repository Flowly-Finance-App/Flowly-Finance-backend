import LoanApplication from "../models/LoanApplication.js";
import TransactionBucket from "../models/TransactionBucket.js";
import Notification from "../models/Notification.js";
import Account from "../models/Account.js";
import User from "../models/User.js";
import { generateSchedule, round2 } from "../utils/emiCalculator.js";
import paymentGateway from "../services/paymentGateway.js";
import { creditTopUpFromIntent, markTopUpFailed } from "../services/walletService.js";

export async function generateScheduleOnDisbursal(loanId) {
  const loan = await LoanApplication.findById(loanId);
  if (!loan) throw new Error("Loan not found");

  const principal = loan.principal || loan.requestedAmount || 0;
  const { emi, totalInterest, totalRepayment, schedule } = generateSchedule({
    principal,
    annualRatePercent: loan.interestRate || 12,
    tenureMonths: loan.tenureMonths || 12,
    startDate: loan.disbursedAt || new Date(),
  });

  loan.repayments = schedule.map((s) => ({
    ...s,
    status: s.status.toLowerCase(),
    lateFee: 0,
  }));
  loan.emiAmount = emi;
  loan.monthlyEMI = emi;
  loan.totalInterest = totalInterest;
  loan.totalRepayment = totalRepayment;
  loan.totalPayable = totalRepayment;
  loan.outstandingAmount = principal;
  loan.nextDueDate = schedule[0]?.dueDate || null;

  await loan.save();
  return loan;
}

export async function getSchedule(req, res) {
  try {
    const loanId = req.params.loanId || req.params.id;
    let loan = await LoanApplication.findById(loanId).select(
      "user principal requestedAmount interestRate tenureMonths emiAmount monthlyEMI totalInterest totalRepayment totalPayable outstandingAmount nextDueDate repayments status nocCertificate recoveryLogs applicationNumber productName"
    );
    if (!loan) return res.status(404).json({ message: "Loan not found" });

    const userId = (req.user.id || req.user._id).toString();
    const isOwner = loan.user.toString() === userId;
    const isStaff = ["worker", "admin"].includes(req.user.role?.toLowerCase());
    if (!isOwner && !isStaff) return res.status(403).json({ message: "Not authorized" });

    if (!loan.repayments || loan.repayments.length === 0) {
      try {
        await generateScheduleOnDisbursal(loan._id);
        loan = await LoanApplication.findById(loanId).select(
          "user principal requestedAmount interestRate tenureMonths emiAmount monthlyEMI totalInterest totalRepayment totalPayable outstandingAmount nextDueDate repayments status nocCertificate recoveryLogs applicationNumber productName"
        );
      } catch (e) {}
    }

    return res.json({ loan });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch schedule", error: err.message });
  }
}

export async function initiateRepayment(req, res) {
  try {
    const { loanId, installmentNo } = req.params;
    let loan = await LoanApplication.findById(loanId);
    if (!loan) return res.status(404).json({ message: "Loan not found" });

    const userId = (req.user.id || req.user._id).toString();
    if (loan.user.toString() !== userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (!loan.repayments || loan.repayments.length === 0) {
      try {
        await generateScheduleOnDisbursal(loan._id);
        loan = await LoanApplication.findById(loanId);
      } catch (e) {}
    }

    const repayments = loan.repayments || [];
    const installment = repayments.find((r) => r.installmentNo === Number(installmentNo));
    if (!installment) return res.status(404).json({ message: "Installment not found" });
    if (installment.status === "paid") {
      return res.status(400).json({ message: "Installment already paid" });
    }

    const amountDue = round2(installment.emiAmount + (installment.lateFee || 0) - (installment.paidAmount || 0));

    const intent = await paymentGateway.createPaymentIntent({
      amountInRupees: amountDue,
      metadata: {
        loanId: loan._id.toString(),
        installmentNo: String(installmentNo),
        userId,
      },
    });

    installment.gateway = {
      provider: "stripe",
      transactionId: intent.transactionId,
      status: "initiated",
    };
    await loan.save();

    return res.json({
      clientSecret: intent.clientSecret,
      transactionId: intent.transactionId,
      amountDue,
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to initiate payment", error: err.message });
  }
}

/**
 * Auto-Debit EMI payment directly from customer's Flowly bank account balance
 */
export async function payAutoDebit(req, res) {
  try {
    const { loanId, installmentNo } = req.params;
    let loan = await LoanApplication.findById(loanId);
    if (!loan) return res.status(404).json({ message: "Loan not found" });

    const account = await Account.findOne({ user: req.user._id });
    if (!account) return res.status(404).json({ message: "Customer bank account not found for auto-debit" });

    if (!loan.repayments || loan.repayments.length === 0) {
      try {
        await generateScheduleOnDisbursal(loan._id);
        loan = await LoanApplication.findById(loanId);
      } catch (e) {}
    }

    const repayments = loan.repayments || [];
    const installment = repayments.find((r) => r.installmentNo === Number(installmentNo));
    if (!installment) return res.status(404).json({ message: "Installment not found" });
    if (installment.status === "paid") return res.status(400).json({ message: "Installment already paid" });

    const totalAmountDue = round2(installment.emiAmount + (installment.lateFee || 0) - (installment.paidAmount || 0));

    if (account.balance < totalAmountDue) {
      return res.status(400).json({
        message: `Insufficient bank balance for Auto-Debit. Required: ₹${totalAmountDue}, Available Balance: ₹${account.balance}`,
      });
    }

    account.balance -= totalAmountDue;
    await account.save();

    const updatedLoan = await markInstallmentPaid({
      loanId,
      installmentNo: Number(installmentNo),
      amountPaid: totalAmountDue,
      transactionId: `AUTODEBIT-${Date.now()}`,
      paymentMethod: "auto_debit",
      provider: "bank_account",
      note: "Auto-debit from customer Flowly bank balance",
    });

    return res.json({
      message: `Auto-Debit of ₹${totalAmountDue} successful! Installment #${installmentNo} marked as paid.`,
      loan: updatedLoan,
      accountBalance: account.balance,
    });
  } catch (err) {
    return res.status(500).json({ message: "Auto-debit payment failed", error: err.message });
  }
}

export async function handlePaymentWebhook(req, res) {
  let event;
  try {
    event = await paymentGateway.constructWebhookEvent(req.body, req.headers["stripe-signature"]);
  } catch (err) {
    return res.status(400).json({ message: `Webhook signature verification failed: ${err.message}` });
  }

  const intent = event.data ? event.data.object : event;

  // ---- Add Money (account top-up) events ----
  if (intent?.metadata?.purpose === "account_topup") {
    try {
      switch (event.type) {
        case undefined: // mock gateway sends the bare intent
        case "payment_intent.succeeded":
          await creditTopUpFromIntent(intent);
          break;
        case "payment_intent.payment_failed":
          await markTopUpFailed(intent, "Payment failed");
          break;
        case "payment_intent.canceled":
          await markTopUpFailed(intent, "Payment was cancelled");
          break;
        default:
          break; // other event types are ignored
      }
      return res.status(200).json({ received: true });
    } catch (err) {
      if (err.code === "VERIFY_FAILED") {
        // Retrying cannot fix a mismatch; log for investigation and acknowledge.
        console.error(`[STRIPE WEBHOOK] Top-up verification failed for ${intent.id}: ${err.message}`);
        return res.status(200).json({ received: true, verified: false });
      }
      // Anything else (DB hiccup, payment record not written yet): non-2xx so Stripe retries.
      console.error(`[STRIPE WEBHOOK] Top-up handling error for ${intent.id}:`, err.message);
      return res.status(err.code === "TOPUP_NOT_FOUND" ? 404 : 500).json({ message: err.message });
    }
  }

  // ---- Loan EMI repayments: only successful payments matter ----
  if (event.type && event.type !== "payment_intent.succeeded") {
    return res.status(200).json({ received: true });
  }

  const { loanId, installmentNo } = intent.metadata || {};
  if (!loanId || !installmentNo) {
    return res.status(400).json({ message: "Missing loan metadata on payment intent" });
  }

  try {
    await markInstallmentPaid({
      loanId,
      installmentNo: Number(installmentNo),
      amountPaid: (intent.amount_received || (intent.amount ? intent.amount : 0)) / 100,
      transactionId: intent.id || intent.transactionId,
      paymentMethod: intent.payment_method_types?.[0] || "card",
      provider: "stripe",
    });
    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

export async function markPaidManually(req, res) {
  try {
    const { loanId, installmentNo } = req.params;
    const { amountPaid, note } = req.body;

    const loan = await markInstallmentPaid({
      loanId,
      installmentNo: Number(installmentNo),
      amountPaid: Number(amountPaid),
      transactionId: `manual-${Date.now()}`,
      paymentMethod: "offline",
      provider: "manual",
      note,
    });

    return res.json({ message: "Installment marked paid", loan });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}

async function markInstallmentPaid({
  loanId,
  installmentNo,
  amountPaid,
  transactionId,
  paymentMethod,
  provider,
  note,
}) {
  const loan = await LoanApplication.findById(loanId);
  if (!loan) throw new Error("Loan not found");

  const installment = loan.repayments.find((r) => r.installmentNo === installmentNo);
  if (!installment) throw new Error("Installment not found");
  if (installment.status === "paid") return loan;

  const totalPaid = round2((installment.paidAmount || 0) + amountPaid);
  installment.paidAmount = totalPaid;
  installment.paidDate = new Date();
  installment.status = totalPaid >= (installment.emiAmount + (installment.lateFee || 0)) ? "paid" : "partially_paid";
  installment.gateway = {
    provider,
    transactionId,
    paymentMethod,
    status: "succeeded",
    rawResponse: note ? { note } : undefined,
  };

  loan.outstandingAmount = round2(
    loan.repayments
      .filter((r) => r.status !== "paid")
      .reduce((sum, r) => sum + (r.emiAmount + (r.lateFee || 0) - (r.paidAmount || 0)), 0)
  );

  const nextPending = loan.repayments.find((r) => ["pending", "partially_paid", "overdue"].includes(r.status));
  loan.nextDueDate = nextPending ? nextPending.dueDate : null;
  loan.overdueInstallments = loan.repayments.filter((r) => r.status === "overdue").length;

  // LOAN CLOSURE & NO DUE CERTIFICATE (NOC) GENERATION
  if (!nextPending) {
    loan.status = "closed";
    const userObj = await User.findById(loan.user);
    const nocNum = `NOC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`;

    loan.nocCertificate = {
      certificateNumber: nocNum,
      generatedAt: new Date(),
      customerName: userObj?.name || loan.personalInformation?.fullName || "Valued Customer",
      loanAmount: loan.principal || loan.requestedAmount || 0,
      fullyPaidAt: new Date(),
      downloadUrl: `/api/repayments/noc/${loan._id}`,
    };

    await Notification.create({
      user: loan.user,
      type: "loan",
      title: "🎉 Loan Fully Closed — No Due Certificate (NOC) Ready!",
      message: `Congratulations! All EMIs for loan ${loan.applicationNumber || loan._id} have been fully paid. Your No Due Certificate (${nocNum}) is generated and ready to download.`,
      meta: { loanId: loan._id, nocCertificateNumber: nocNum },
    }).catch(() => {});
  }

  await loan.save();

  if (loan.account) {
    await TransactionBucket.postEntry({
      accountId: loan.account,
      userId: loan.user,
      type: "emi",
      amount: amountPaid,
      description: `EMI installment #${installmentNo} for loan ${loan.applicationNumber || loan._id}`,
      refType: "LoanApplication",
      refId: loan._id,
      meta: { category: "emi" },
    }).catch(() => {});
  }

  await Notification.create({
    user: loan.user,
    type: "emi",
    title: "EMI Payment Successful",
    message: `Your EMI payment of ₹${amountPaid} for installment #${installmentNo} was processed. Remaining outstanding balance: ₹${loan.outstandingAmount}.`,
    meta: { loanId: loan._id, installmentNo },
  }).catch(() => {});

  return loan;
}

export async function getRepaymentHistory(req, res) {
  try {
    const loanId = req.params.loanId || req.params.id;
    const loan = await LoanApplication.findById(loanId).select("user repayments");
    if (!loan) return res.status(404).json({ message: "Loan not found" });

    const userId = (req.user.id || req.user._id).toString();
    const isOwner = loan.user.toString() === userId;
    const isStaff = ["worker", "admin"].includes(req.user.role?.toLowerCase());
    if (!isOwner && !isStaff) return res.status(403).json({ message: "Not authorized" });

    const paidOnly = loan.repayments.filter((r) => ["paid", "partially_paid"].includes(r.status));
    return res.json({ repayments: paidOnly });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch repayment history", error: err.message });
  }
}

export async function getOverdueLoans(req, res) {
  try {
    const loans = await LoanApplication.find({
      $or: [{ overdueInstallments: { $gt: 0 } }, { "repayments.status": "overdue" }],
    })
      .populate("user", "name email phone")
      .populate("assignedTo", "name email")
      .sort({ updatedAt: -1 });

    return res.json({ count: loans.length, loans });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch overdue loans", error: err.message });
  }
}

/**
 * Daily job to flag overdue EMIs and add Late Fee penalty
 */
export async function markOverdueInstallments() {
  const today = new Date();
  const loans = await LoanApplication.find({
    status: { $in: ["disbursed", "active"] },
    "repayments.status": { $in: ["pending", "partially_paid"] },
    "repayments.dueDate": { $lt: today },
  });

  for (const loan of loans) {
    let changed = false;
    for (const installment of loan.repayments) {
      if (
        installment.dueDate < today &&
        ["pending", "partially_paid"].includes(installment.status)
      ) {
        installment.status = "overdue";
        // Calculate penalty (₹500 or 2% of EMI)
        const penalty = Math.max(500, Math.round(installment.emiAmount * 0.02));
        installment.lateFee = penalty;
        changed = true;

        await Notification.create({
          user: loan.user,
          type: "emi",
          title: "🚨 Missed EMI — Penalty Applied",
          message: `Installment #${installment.installmentNo} of ₹${installment.emiAmount} is overdue. A late fee penalty of ₹${penalty} has been added.`,
          meta: { loanId: loan._id, installmentNo: installment.installmentNo, lateFee: penalty },
        }).catch(() => {});
      }
    }

    if (changed) {
      loan.overdueInstallments = loan.repayments.filter((r) => r.status === "overdue").length;
      await loan.save();
    }
  }

  return { processed: loans.length };
}

/**
 * Retrieve No Due Certificate (NOC)
 */
export async function getNocCertificate(req, res) {
  try {
    const loanId = req.params.loanId || req.params.id;
    const loan = await LoanApplication.findById(loanId).populate("user", "name email phone");

    if (!loan) return res.status(404).json({ message: "Loan not found" });

    if (loan.status !== "closed" && !loan.nocCertificate?.certificateNumber) {
      return res.status(400).json({ message: "No Due Certificate is available only when all loan EMIs are fully paid." });
    }

    return res.json({
      noc: loan.nocCertificate,
      loan,
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch NOC certificate", error: err.message });
  }
}

/**
 * Worker records Recovery Follow-Up log for overdue collections
 */
export async function recordRecoveryFollowup(req, res) {
  try {
    const loanId = req.params.loanId || req.params.id;
    const { followupType, notes, promisedPaymentDate } = req.body;

    const loan = await LoanApplication.findById(loanId);
    if (!loan) return res.status(404).json({ message: "Loan not found" });

    loan.recoveryLogs.push({
      loggedBy: req.user._id,
      loggedAt: new Date(),
      followupType: followupType || "call_made",
      notes: notes || "",
      promisedPaymentDate: promisedPaymentDate ? new Date(promisedPaymentDate) : null,
    });

    await loan.save();

    return res.json({
      message: "Recovery follow-up logged successfully",
      loan,
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to log recovery follow-up", error: err.message });
  }
}