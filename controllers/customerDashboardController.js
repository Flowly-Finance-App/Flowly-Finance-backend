import CustomerDashboardService from "../services/customerDashboardService.js";
import { successResponse, errorResponse } from "../utils/responseUtil.js";

class CustomerDashboardController {
  async getDashboard(req, res) {
    try {
      const userId = req.user.id || req.user._id;
      const dashboardData = await CustomerDashboardService.getDashboardData(userId);
      return successResponse(res, { data: dashboardData, message: "Dashboard data fetched successfully" });
    } catch (error) {
      console.error("Dashboard Controller Error:", error);
      return errorResponse(res, error.message, error.statusCode || 500);
    }
  }

  async getAccountSummary(req, res) {
    try {
      const userId = req.user.id || req.user._id;
      const summary = await CustomerDashboardService.getAccountSummary(userId);
      return successResponse(res, { data: summary });
    } catch (error) {
      return errorResponse(res, error.message, error.statusCode || 500);
    }
  }

  async getActiveLoanAndEmi(req, res) {
    try {
      const userId = req.user.id || req.user._id;
      const loanData = await CustomerDashboardService.getActiveLoanAndEmi(userId);
      return successResponse(res, { data: loanData });
    } catch (error) {
      return errorResponse(res, error.message, error.statusCode || 500);
    }
  }

  async getActiveFDs(req, res) {
    try {
      const userId = req.user.id || req.user._id;
      const fds = await CustomerDashboardService.getActiveFDs(userId);
      return successResponse(res, { data: fds });
    } catch (error) {
      return errorResponse(res, error.message, error.statusCode || 500);
    }
  }

  async getRecentTransactions(req, res) {
    try {
      const userId = req.user.id || req.user._id;
      const limit = parseInt(req.query.limit, 10) || 10;
      const transactions = await CustomerDashboardService.getRecentTransactions(userId, limit);
      return successResponse(res, { data: transactions });
    } catch (error) {
      return errorResponse(res, error.message, error.statusCode || 500);
    }
  }

  async getNotifications(req, res) {
    try {
      const userId = req.user.id || req.user._id;
      const limit = parseInt(req.query.limit, 10) || 5;
      const notifications = await CustomerDashboardService.getNotifications(userId, limit);
      return successResponse(res, { data: notifications });
    } catch (error) {
      return errorResponse(res, error.message, error.statusCode || 500);
    }
  }

  async getFinancialOverview(req, res) {
    try {
      const userId = req.user.id || req.user._id;
      const overview = await CustomerDashboardService.getFinancialOverview(userId);
      return successResponse(res, { data: overview });
    } catch (error) {
      return errorResponse(res, error.message, error.statusCode || 500);
    }
  }
}

export default new CustomerDashboardController();
