import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
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

    pinHash: {
      type: String,
      required: true,
      select: false,
    },

    role: {
      type: String,
      enum: ["customer", "worker", "admin"],
      default: "customer",
    },

    personalDetails: {
      type: String,
    },

    contactDetails: {
      type: String,
    },

    address: {
      type: String,
    },

    kycStatus: {
      type: String,
      enum: ["pending", "under_verification", "verified", "rejected"],
      default: "pending",
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
