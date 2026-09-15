import mongoose from "mongoose";
import User from "../models/User.js";
import Account from "../models/Account.js";

/**
 * @desc    Get all customers (paginated, searchable, filterable)
 * @route   GET /api/customers
 * @access  Private (worker, admin)
 *
 * Query params:
 *   page        - page number (default 1)
 *   limit       - records per page (default 10, max 100)
 *   search      - matches name / email / phone (case-insensitive)
 *   kycStatus   - pending | under_verification | verified | rejected
 *   status      - active | inactive | blocked
 *   sortBy      - createdAt | name | email | kycStatus (default createdAt)
 *   order       - asc | desc (default desc)
 */
export const getCustomers = async (req, res) => {
  try {
    const {
      search = "",
      kycStatus,
      status,
      sortBy = "createdAt",
      order = "desc",
    } = req.query;

    // ---------- Pagination ----------
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const skip = (page - 1) * limit;

    // ---------- Filters ----------
    const filter = { role: "customer" };

    const allowedKycStatus = [
      "pending",
      "under_verification",
      "verified",
      "rejected",
    ];
    if (kycStatus) {
      if (!allowedKycStatus.includes(kycStatus)) {
        return res.status(400).json({
          message: `Invalid kycStatus. Allowed values: ${allowedKycStatus.join(", ")}`,
        });
      }
      filter.kycStatus = kycStatus;
    }

    const allowedStatus = ["active", "inactive", "blocked"];
    if (status) {
      if (!allowedStatus.includes(status)) {
        return res.status(400).json({
          message: `Invalid status. Allowed values: ${allowedStatus.join(", ")}`,
        });
      }
      filter.status = status;
    }

    const trimmedSearch = String(search).trim();
    if (trimmedSearch) {
      // Escape regex special characters so user input can't break the query
      const safe = trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(safe, "i");
      filter.$or = [{ name: regex }, { email: regex }, { phone: regex }];
    }

    // ---------- Sorting ----------
    const allowedSortFields = ["createdAt", "name", "email", "kycStatus", "status"];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
    const sortOrder = order === "asc" ? 1 : -1;

    // ---------- Query ----------
    const [customers, total] = await Promise.all([
      User.find(filter)
        .select("name email phone role kycStatus status address isEmailVerified createdAt updatedAt")
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    // ---------- Attach account summary (single extra query) ----------
    const customerIds = customers.map((c) => c._id);
    const accounts = await Account.find({ user: { $in: customerIds } })
      .select("user accountNumber accountType balance status")
      .lean();

    const accountMap = new Map();
    accounts.forEach((acc) => {
      accountMap.set(String(acc.user), {
        accountNumber: acc.accountNumber,
        accountType: acc.accountType,
        balance: acc.balance,
        status: acc.status,
      });
    });

    const data = customers.map((c) => ({
      ...c,
      account: accountMap.get(String(c._id)) || null,
    }));

    const totalPages = Math.ceil(total / limit) || 0;

    return res.status(200).json({
      message: "Customers fetched successfully",
      count: data.length,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      customers: data,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch customers",
      error: error.message,
    });
  }
};

/**
 * @desc    Get a single customer by id
 * @route   GET /api/customers/:id
 * @access  Private (worker, admin)
 */
export const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid customer id" });
    }

    const customer = await User.findOne({ _id: id, role: "customer" })
      .select("-password -mpinHash")
      .lean();

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const account = await Account.findOne({ user: id })
      .select("accountNumber accountType balance status branch ifscCode")
      .lean();

    return res.status(200).json({
      message: "Customer fetched successfully",
      customer: { ...customer, account: account || null },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch customer",
      error: error.message,
    });
  }
};
