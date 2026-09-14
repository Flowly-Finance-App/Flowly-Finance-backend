import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        message: "Access denied. No token provided.",
      });
    }

    const secret = process.env.JWT_SECRET || "flowly_secret_key_12345";
    const decoded = jwt.verify(token, secret);

    const user = await User.findById(decoded.id).select("-password -pinHash");

    if (!user) {
      return res.status(401).json({
        message: "User not found or token invalid.",
      });
    }

    if (user.status === "blocked") {
      return res.status(403).json({
        message: "Your account has been blocked. Contact support.",
      });
    }

    if (user.lockUntil && user.lockUntil > new Date()) {
      const remainingMs = user.lockUntil - new Date();
      const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
      return res.status(403).json({
        message: `Your account is temporarily suspended for 24 hours. Please try again in ~${remainingHours} hours.`,
        lockUntil: user.lockUntil,
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token.",
      error: error.message,
    });
  }
};

/**
 * Authorize specified user roles (e.g. authorize("worker", "admin"))
 */
export const authorize = (...roles) => {
  const roleArray = Array.isArray(roles[0]) ? roles[0] : roles;
  return (req, res, next) => {
    if (!req.user || !roleArray.includes(req.user.role)) {
      return res.status(403).json({
        message: `Role (${req.user?.role || "guest"}) is not authorized to access this resource.`,
      });
    }
    next();
  };
};

export const requireAuth = protect;
export const requireRole = (roles) => authorize(roles);
