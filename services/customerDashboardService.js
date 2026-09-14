import User from "../models/User.js";
import Account from "../models/Account.js";
import LoanApplication from "../models/LoanApplication.js";
import FixedDeposit from "../models/FixedDeposit.js";
import TransactionBucket from "../models/TransactionBucket.js";
import Notification from "../models/Notification.js";

class CustomerDashboardService {
  async getDashboardData(userId) {
    const user = await User.findById(userId).lean();

    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      throw err;
    }

    const [accounts, activeLoan, activeFDs, recentTransactions, notifications, financialOverview] =
      await Promise.all([
        this.getAccountSummary(userId),
        this.getActiveLoanAndEmi(userId),
        this.getActiveFDs(userId),
        this.getRecentTransactions(userId, 10),
        this.getNotifications(userId, 5),
        this.getFinancialOverview(userId),
      ]);

    return {
      user: {
        name: user.name,
        email: user.email,
        kycStatus: user.kycStatus,
        role: user.role,
      },
      totalBalance: financialOverview.totalBalance,
      accountSummary: accounts,
      activeLoan,
      upcomingEmi: activeLoan?.nextEmiAmount || 0,
      upcomingEmiDate: activeLoan?.nextEmiDate || null,
      activeFD: activeFDs,
      recentTransactions,
      notifications,
      financialOverview,
      timestamp: new Date(),
    };
  }

  async getAccountSummary(userId) {
    const accounts = await Account.find({ user: userId })
      .select("accountNumber balance status accountType branch")
      .lean();

    if (!accounts.length) {
      return { totalBalance: 0, accountCount: 0, accounts: [] };
    }

    const totalBalance = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);

    return {
      totalBalance,
      accountCount: accounts.length,
      accounts: accounts.map((acc) => ({
        id: acc._id,
        accountNumber: acc.accountNumber,
        balance: acc.balance,
        status: acc.status,
        type: acc.accountType,
        branch: acc.branch,
      })),
    };
  }

  async getActiveLoanAndEmi(userId) {
    try {
      const activeLoan = await LoanApplication.findOne({
        user: userId,
        status: { $in: ["approved", "disbursed"] },
      })
        .populate("product", "productName loanType")
        .lean();

      if (!activeLoan) return null;

      const repayments = activeLoan.repayments || [];

      const nextEmi = repayments
        .filter((r) => r.status === "pending" || r.status === "overdue")
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];

      const paidInstallments = repayments.filter((r) => r.status === "paid");
      const totalPaid = paidInstallments.reduce((sum, r) => sum + (r.paidAmount || 0), 0);
      const principal = activeLoan.principal || activeLoan.requestedAmount || 0;
      const emiAmount = activeLoan.emiAmount || activeLoan.monthlyEMI || 0;

      return {
        id: activeLoan._id,
        loanType: activeLoan.product?.loanType || activeLoan.productName || "Personal",
        productName: activeLoan.product?.productName || activeLoan.productName || "Personal Loan",
        loanAmount: principal,
        outstandingAmount: activeLoan.outstandingAmount || principal,
        status: activeLoan.status,
        emiAmount: emiAmount,
        tenure: activeLoan.tenureMonths,
        nextEmiAmount: nextEmi?.emiAmount ?? emiAmount,
        nextEmiDate: nextEmi?.dueDate ?? activeLoan.nextDueDate ?? null,
        interestRate: activeLoan.interestRate,
        disbursementDate: activeLoan.disbursedAt,
        emiPaidCount: paidInstallments.length,
        totalPaid,
        overdueInstallments: activeLoan.overdueInstallments || 0,
      };
    } catch (error) {
      console.error("Active Loan Error:", error);
      return null;
    }
  }

  async getActiveFDs(userId) {
    try {
      const fds = await FixedDeposit.find({
        user: userId,
        status: { $in: ["active", "matured"] },
      }).lean();

      return fds.map((fd) => {
        const depositAmount = fd.depositAmount || fd.principalAmount || 0;
        const interestEarned = this.calculateInterest(depositAmount, fd.interestRate || 0, fd.tenure || 1);
        return {
          id: fd._id,
          depositAmount: depositAmount,
          interestRate: fd.interestRate,
          tenure: fd.tenure,
          startDate: fd.startDate,
          maturityDate: fd.maturityDate,
          interestEarned,
          maturityAmount: depositAmount + interestEarned,
          status: fd.status,
          daysRemaining: this.calculateDaysRemaining(fd.maturityDate),
        };
      });
    } catch (error) {
      console.error("Active FDs Error:", error);
      return [];
    }
  }

  async getRecentTransactions(userId, limit = 10) {
    try {
      const accounts = await Account.find({ user: userId }).select("_id").lean();
      const accountIds = accounts.map((acc) => acc._id);

      const transactions = await TransactionBucket.aggregate([
        { $match: { account: { $in: accountIds } } },
        { $unwind: "$entries" },
        { $sort: { "entries.postedAt": -1 } },
        { $limit: limit },
        {
          $project: {
            _id: "$entries._id",
            type: "$entries.type",
            amount: "$entries.amount",
            date: "$entries.postedAt",
            description: "$entries.description",
            refType: "$entries.refType",
            refId: "$entries.refId",
          },
        },
      ]);

      return transactions.map((txn) => ({
        id: txn._id,
        type: txn.type,
        amount: txn.amount,
        date: txn.date,
        description: txn.description,
        refType: txn.refType,
        refId: txn.refId,
      }));
    } catch (error) {
      console.error("Recent Transactions Error:", error);
      return [];
    }
  }

  async getNotifications(userId, limit = 5) {
    try {
      const notifications = await Notification.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      return notifications.map((notif) => ({
        id: notif._id,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        date: notif.createdAt,
        read: notif.status === "read",
      }));
    } catch (error) {
      console.error("Notifications Error:", error);
      return [];
    }
  }

  async getFinancialOverview(userId) {
    const accountsData = await this.getAccountSummary(userId);

    const allLoans = await LoanApplication.find({ user: userId }).lean();
    const totalLoanAmount = allLoans.reduce((sum, loan) => sum + (loan.principal || loan.requestedAmount || 0), 0);
    const activeLoanCount = allLoans.filter((l) => ["approved", "disbursed"].includes(l.status)).length;

    const allFDs = await FixedDeposit.find({ user: userId }).lean();
    const totalFDAmount = allFDs.reduce((sum, fd) => sum + (fd.depositAmount || fd.principalAmount || 0), 0);
    const activeFDCount = allFDs.filter((fd) => fd.status === "active").length;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const accounts = await Account.find({ user: userId }).select("_id").lean();
    const accountIds = accounts.map((acc) => acc._id);

    const monthlyTxn = await TransactionBucket.aggregate([
      { $match: { account: { $in: accountIds } } },
      { $unwind: "$entries" },
      { $match: { "entries.postedAt": { $gte: thirtyDaysAgo } } },
      { $group: { _id: "$entries.type", total: { $sum: "$entries.amount" } } },
    ]);

    const monthlySummary = {};
    monthlyTxn.forEach((item) => {
      monthlySummary[item._id] = item.total;
    });

    return {
      totalBalance: accountsData.totalBalance,
      totalLoanAmount,
      activeLoanCount,
      totalFDAmount,
      activeFDCount,
      accountCount: accountsData.accountCount,
      monthlyTransactionSummary: {
        credit: monthlySummary.credit || 0,
        debit: monthlySummary.debit || 0,
        emi: monthlySummary.emi || 0,
        deposit: monthlySummary.deposit || 0,
        withdrawal: monthlySummary.withdrawal || 0,
      },
    };
  }

  calculateInterest(principal, rate, years) {
    return (principal * rate * years) / 100;
  }

  calculateDaysRemaining(maturityDate) {
    if (!maturityDate) return null;
    const diff = new Date(maturityDate) - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }
}

export default new CustomerDashboardService();
