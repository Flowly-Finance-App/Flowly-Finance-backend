import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    password: {
      type: String,
      required: false,
      select: false,
    },

    mpinHash: {
      type: String,
      select: false,
    },

    mpinHistory: {
      type: [String],
      default: [],
      select: false,
    },

    isMpinSet: {
      type: Boolean,
      default: false,
    },

    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    role: {
      type: String,
      enum: ["customer", "worker", "admin"],
      default: "customer",
    },

    personalDetails: {
      type: Object,
      default: {},
    },

    contactDetails: {
      type: Object,
      default: {},
    },

    address: {
      type: String,
      default: "",
    },

    kycStatus: {
      type: String,
      enum: ["pending", "under_verification", "verified", "rejected"],
      default: "pending",
    },

    failedLoginAttempts: {
      type: Number,
      default: 0,
    },

    lockUntil: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: ["active", "inactive", "blocked"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("User", userSchema);
