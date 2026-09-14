import User from "../models/User.js";
import Account from "../models/Account.js";
import OTP from "../models/OTP.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { sendOTPEmail } from "../utils/mailer.js";

const generateToken = (user) => {
  const secret = process.env.JWT_SECRET || "flowly_secret_key_12345";
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
    },
    secret,
    {
      expiresIn: "7d",
    }
  );
};

const BANK_PREFIX = 50100;
const START_SEQUENCE = 10001;
const BASE_ACCOUNT_NUMBER = Number(`${BANK_PREFIX}${START_SEQUENCE}`);

export const generateAccountNumber = async () => {
  // Find highest existing account number in bank sequence range
  const lastAccount = await Account.findOne({
    accountNumber: { $gte: BASE_ACCOUNT_NUMBER },
  }).sort({ accountNumber: -1 });

  if (!lastAccount || typeof lastAccount.accountNumber !== "number") {
    return BASE_ACCOUNT_NUMBER;
  }

  return lastAccount.accountNumber + 1;
};

/**
 * Creates and activates a bank account for a user once KYC is approved.
 * Retries on accountNumber collisions (duplicate key errors) and is safe
 * to call multiple times for the same user (idempotent).
 */
export const createBankAccountForUser = async (userId, options = {}) => {
  let existingAccount = await Account.findOne({ user: userId });
  if (existingAccount) {
    if (existingAccount.status !== "active") {
      existingAccount.status = "active";
      await existingAccount.save();
    }
    return existingAccount;
  }

  const MAX_ATTEMPTS = 5;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const accountNumber = await generateAccountNumber();
      const account = await Account.create({
        user: userId,
        accountNumber,
        accountType: options.accountType || "savings",
        balance: options.balance || 0,
        branch: options.branch || "Kochi Main Branch",
        ifscCode: options.ifscCode || "FLOW0001001",
        status: "active",
      });

      return account;
    } catch (error) {
      lastError = error;

      // 11000 = duplicate key error. This happens when two account
      // creations race and compute the same "next" accountNumber.
      // Retry with a freshly recomputed number instead of failing outright.
      if (error.code === 11000) {
        // Another request may have created this user's account in the
        // meantime (e.g. two KYC reviews fired concurrently) - reuse it.
        const raceAccount = await Account.findOne({ user: userId });
        if (raceAccount) {
          if (raceAccount.status !== "active") {
            raceAccount.status = "active";
            await raceAccount.save();
          }
          return raceAccount;
        }
        continue; // retry with a new accountNumber
      }

      throw error;
    }
  }

  throw new Error(
    `Failed to generate a unique account number after ${MAX_ATTEMPTS} attempts: ${lastError?.message}`,
  );
};



/**
 * Send OTP to user's email via SMTP
 */
export const sendOTP = async (req, res) => {
  try {
    const { email, purpose = "registration" } = req.body;

    if (!email) {
      return res.status(400).json({
        message: "Email address is required to send OTP",
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if user already exists for registration purpose
    if (purpose === "registration") {
      const existingUser = await User.findOne({ email: cleanEmail });
      if (existingUser) {
        return res.status(400).json({
          message: "User with this email already exists",
        });
      }
    }

    // Generate 6-digit random numeric OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Remove any previous unexpired OTPs for same email & purpose
    await OTP.deleteMany({ email: cleanEmail, purpose });

    // Store OTP in database with 5-minute expiry
    await OTP.create({
      email: cleanEmail,
      otp: otpCode,
      purpose,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    });

    // Send email using SMTP helper
    await sendOTPEmail(cleanEmail, otpCode, purpose);

    return res.status(200).json({
      message: `OTP verification code sent successfully to ${cleanEmail}`,
      email: cleanEmail,
      purpose,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to send OTP email",
      error: error.message,
    });
  }
};

/**
 * Verify OTP entered by user
 */
export const verifyOTP = async (req, res) => {
  try {
    const { email, otp, purpose = "registration" } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        message: "Email and OTP code are required",
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    const otpRecord = await OTP.findOne({
      email: cleanEmail,
      otp: otp.trim(),
      purpose,
      expiresAt: { $gt: new Date() },
    });

    if (!otpRecord) {
      return res.status(400).json({
        message: "Invalid or expired OTP verification code",
      });
    }

    // Mark OTP as verified
    otpRecord.isVerified = true;
    await otpRecord.save();

    return res.status(200).json({
      message: "OTP verified successfully",
      email: cleanEmail,
      verified: true,
    });
  } catch (error) {
    return res.status(500).json({
      message: "OTP verification failed",
      error: error.message,
    });
  }
};

/**
 * Customer Registration with MPIN setup & OTP verification
 */
export const registerUser = async (req, res) => {
  try {
    const { fullName, name, email, phone, mpin, password, otp } = req.body;
    const userName = name || fullName;
    const userMpin = mpin || password; // Fallback support if client sends password field as MPIN

    if (!userName || !email || !phone || !userMpin) {
      return res.status(400).json({
        message: "Please provide name, email, phone, and MPIN (4-6 digits)",
      });
    }

    const cleanMpin = String(userMpin).trim();
    if (!/^\d{4,6}$/.test(cleanMpin)) {
      return res.status(400).json({
        message: "MPIN must be a 4 to 6 digit numerical PIN",
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email: cleanEmail }, { phone }],
    });

    if (existingUser) {
      return res.status(400).json({
        message: "User with this email or phone already exists",
      });
    }

    // Verify OTP if provided or required
    if (otp) {
      const otpRecord = await OTP.findOne({
        email: cleanEmail,
        otp: otp.trim(),
        purpose: "registration",
      });

      if (!otpRecord) {
        return res.status(400).json({
          message: "Invalid OTP code provided for registration",
        });
      }
    }

    // Hash MPIN securely
    const hashedMpin = await bcrypt.hash(cleanMpin, 10);

    const user = await User.create({
      name: userName,
      email: cleanEmail,
      phone,
      mpinHash: hashedMpin,
      password: hashedMpin, // Save in password field too for compatibility
      role: "customer",
      kycStatus: "pending",
      isEmailVerified: true,
    });

    // Clean up OTP record
    await OTP.deleteMany({ email: cleanEmail, purpose: "registration" });

    const token = generateToken(user);

    return res.status(201).json({
      message: "User registered successfully. Please complete KYC verification to activate your bank account.",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        kycStatus: user.kycStatus,
        isEmailVerified: user.isEmailVerified,
      },
      account: null,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Registration failed",
      error: error.message,
    });
  }
};

/**
 * Customer Login via MPIN
 */
export const loginUser = async (req, res) => {
  try {
    const { email, phone, mpin, password } = req.body;
    const loginSecret = mpin || password;

    if ((!email && !phone) || !loginSecret) {
      return res.status(400).json({
        message: "Please provide email/phone and MPIN",
      });
    }

    const query = email ? { email: email.toLowerCase().trim() } : { phone };
    const user = await User.findOne(query).select("+mpinHash +password +failedLoginAttempts +lockUntil");

    if (!user || user.role !== "customer") {
      return res.status(401).json({
        message: "Invalid credentials or account does not exist",
      });
    }

    // Check if account is suspended due to 4 failed attempts
    if (user.lockUntil && user.lockUntil > new Date()) {
      const remainingMs = user.lockUntil.getTime() - Date.now();
      const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
      return res.status(403).json({
        message: `Account is temporarily suspended due to 4 consecutive failed login attempts. Please try again after ${remainingHours} hour(s).`,
        isLocked: true,
        lockUntil: user.lockUntil,
      });
    }

    // Reset lock if 24 hours have passed
    if (user.lockUntil && user.lockUntil <= new Date()) {
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
    }

    // Check MPIN first, fallback to password hash
    const storedHash = user.mpinHash || user.password;
    if (!storedHash) {
      return res.status(401).json({
        message: "Account authentication credentials not set",
      });
    }

    const isMatch = await bcrypt.compare(String(loginSecret).trim(), storedHash);

    if (!isMatch) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

      if (user.failedLoginAttempts >= 4) {
        user.lockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // Suspend for 24 hours
        await user.save();

        return res.status(403).json({
          message: "Account suspended for 24 hours due to 4 incorrect login attempts.",
          isLocked: true,
          lockUntil: user.lockUntil,
        });
      }

      await user.save();
      const attemptsLeft = 4 - user.failedLoginAttempts;

      return res.status(401).json({
        message: `Invalid MPIN or credentials. ${attemptsLeft} attempt(s) remaining before 24-hour account suspension.`,
        failedAttempts: user.failedLoginAttempts,
        attemptsLeft,
      });
    }

    // On successful login, reset failed attempts & lock
    if (user.failedLoginAttempts > 0 || user.lockUntil) {
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      await user.save();
    }

    let account = await Account.findOne({ user: user._id });
    if (!account && user.kycStatus === "verified") {
      account = await createBankAccountForUser(user._id);
    }
    const token = generateToken(user);

    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        kycStatus: user.kycStatus,
      },
      account: account
        ? {
            id: account._id,
            accountNumber: account.accountNumber,
            accountType: account.accountType,
            balance: account.balance,
            ifscCode: account.ifscCode,
          }
        : null,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Login failed",
      error: error.message,
    });
  }
};

/**
 * Reset MPIN via OTP verification
 */
export const resetMPIN = async (req, res) => {
  try {
    const { email, otp, newMpin } = req.body;

    if (!email || !otp || !newMpin) {
      return res.status(400).json({
        message: "Email, OTP, and new MPIN are required",
      });
    }

    const cleanMpin = String(newMpin).trim();
    if (!/^\d{4,6}$/.test(cleanMpin)) {
      return res.status(400).json({
        message: "New MPIN must be a 4 to 6 digit numerical PIN",
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check OTP record
    const otpRecord = await OTP.findOne({
      email: cleanEmail,
      otp: otp.trim(),
      purpose: "reset_mpin",
    });

    if (!otpRecord) {
      return res.status(400).json({
        message: "Invalid or expired OTP code for MPIN reset",
      });
    }

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(404).json({
        message: "User account not found",
      });
    }

    const hashedMpin = await bcrypt.hash(cleanMpin, 10);
    user.mpinHash = hashedMpin;
    user.password = hashedMpin;
    await user.save();

    // Delete used OTP
    await OTP.deleteMany({ email: cleanEmail, purpose: "reset_mpin" });

    return res.status(200).json({
      message: "MPIN reset successfully. You can now login with your new MPIN.",
    });
  } catch (error) {
    return res.status(500).json({
      message: "Reset MPIN failed",
      error: error.message,
    });
  }
};

/**
 * Continue with Google OAuth authentication (Login & Registration for Flutter)
 */
export const googleAuth = async (req, res) => {
  try {
    const { idToken, email: bodyEmail, name: bodyName, googleId: bodyGoogleId, phone } = req.body;

    let userEmail = bodyEmail;
    let userName = bodyName;
    let userGoogleId = bodyGoogleId;

    // Verify Google ID Token if provided from Flutter Google Sign-In SDK
    if (idToken) {
      try {
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
          idToken,
          audience: process.env.GOOGLE_CLIENT_ID || undefined,
        });
        const payload = ticket.getPayload();
        if (payload) {
          userEmail = payload.email;
          userName = payload.name;
          userGoogleId = payload.sub;
        }
      } catch (tokenErr) {
        // Fallback for custom client payloads if verifyIdToken fails without GOOGLE_CLIENT_ID set
        if (!userEmail) {
          return res.status(401).json({
            message: "Invalid Google ID token",
            error: tokenErr.message,
          });
        }
      }
    }

    if (!userEmail) {
      return res.status(400).json({
        message: "Google email or idToken is required",
      });
    }

    const cleanEmail = userEmail.toLowerCase().trim();

    // Check if user exists by googleId or email
    let user = await User.findOne({
      $or: [
        ...(userGoogleId ? [{ googleId: userGoogleId }] : []),
        { email: cleanEmail },
      ],
    });

    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = await User.create({
        name: userName || cleanEmail.split("@")[0],
        email: cleanEmail,
        phone: phone || `+1${Math.floor(1000000000 + Math.random() * 9000000000)}`,
        googleId: userGoogleId || `google_${Date.now()}`,
        role: "customer",
        kycStatus: "pending",
        isEmailVerified: true,
      });

    } else if (userGoogleId && !user.googleId) {
      user.googleId = userGoogleId;
      await user.save();
    }

    const account = await Account.findOne({ user: user._id });
    const token = generateToken(user);

    return res.status(isNewUser ? 201 : 200).json({
      message: isNewUser
        ? "Registered and logged in with Google successfully"
        : "Logged in with Google successfully",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        kycStatus: user.kycStatus,
        isEmailVerified: user.isEmailVerified,
      },
      account: account
        ? {
            id: account._id,
            accountNumber: account.accountNumber,
            accountType: account.accountType,
            balance: account.balance,
            ifscCode: account.ifscCode,
          }
        : null,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Google authentication failed",
      error: error.message,
    });
  }
};

/**
 * Worker / Internal Staff Registration
 */
export const registerWorker = async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;

    if (!name || !email || !password || !phone) {
      return res.status(400).json({
        message: "Please provide name, email, phone, and password",
      });
    }

    const workerRole = role && ["worker", "admin"].includes(role) ? role : "worker";

    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }],
    });

    if (existingUser) {
      return res.status(400).json({
        message: "Worker with this email or phone already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const worker = await User.create({
      name,
      email: email.toLowerCase(),
      phone,
      password: hashedPassword,
      role: workerRole,
      kycStatus: "verified",
    });

    const token = generateToken(worker);

    return res.status(201).json({
      message: "Worker account created successfully",
      token,
      worker: {
        id: worker._id,
        name: worker.name,
        email: worker.email,
        phone: worker.phone,
        role: worker.role,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Worker registration failed",
      error: error.message,
    });
  }
};

/**
 * Worker Login
 */
export const loginWorker = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Please provide email and password",
      });
    }

    const worker = await User.findOne({ email: email.toLowerCase() }).select("+password +failedLoginAttempts +lockUntil");

    if (!worker || !["worker", "admin"].includes(worker.role)) {
      return res.status(401).json({
        message: "Invalid worker credentials or account unauthorized",
      });
    }

    // Check if account is suspended due to 4 failed attempts
    if (worker.lockUntil && worker.lockUntil > new Date()) {
      const remainingMs = worker.lockUntil.getTime() - Date.now();
      const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
      return res.status(403).json({
        message: `Worker account is temporarily suspended due to 4 consecutive failed login attempts. Please try again after ${remainingHours} hour(s).`,
        isLocked: true,
        lockUntil: worker.lockUntil,
      });
    }

    // Reset lock if 24 hours have passed
    if (worker.lockUntil && worker.lockUntil <= new Date()) {
      worker.failedLoginAttempts = 0;
      worker.lockUntil = null;
    }

    const isMatch = await bcrypt.compare(password, worker.password);

    if (!isMatch) {
      worker.failedLoginAttempts = (worker.failedLoginAttempts || 0) + 1;

      if (worker.failedLoginAttempts >= 4) {
        worker.lockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // Suspend for 24 hours
        await worker.save();

        return res.status(403).json({
          message: "Worker account suspended for 24 hours due to 4 incorrect login attempts.",
          isLocked: true,
          lockUntil: worker.lockUntil,
        });
      }

      await worker.save();
      const attemptsLeft = 4 - worker.failedLoginAttempts;

      return res.status(401).json({
        message: `Invalid email or password. ${attemptsLeft} attempt(s) remaining before 24-hour account suspension.`,
        failedAttempts: worker.failedLoginAttempts,
        attemptsLeft,
      });
    }

    // On successful login, reset failed attempts & lock
    if (worker.failedLoginAttempts > 0 || worker.lockUntil) {
      worker.failedLoginAttempts = 0;
      worker.lockUntil = null;
      await worker.save();
    }

    const token = generateToken(worker);

    return res.status(200).json({
      message: "Worker login successful",
      token,
      worker: {
        id: worker._id,
        name: worker.name,
        email: worker.email,
        phone: worker.phone,
        role: worker.role,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Worker login failed",
      error: error.message,
    });
  }
};

/**
 * Fetch Current Authenticated User Profile
 */
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    let account = await Account.findOne({ user: req.user._id });
    if (!account && user.kycStatus === "verified") {
      account = await createBankAccountForUser(req.user._id);
    }

    return res.status(200).json({
      user,
      account: account || null,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to fetch user profile",
      error: error.message,
    });
  }
};
