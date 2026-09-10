import mongoose from "mongoose";

const kycSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    document: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
    },

    dob: {
      type: String,
    },

    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
    },

    address: {
      type: String,
    },

    idType: {
      type: String,
      enum: ["aadhaar", "pan", "passport", "voter_id"],
      default: "aadhaar",
    },

    idNumber: {
      type: String,
    },

    documentUrl: {
      type: String,
    },

    extractedData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    verificationStatus: {
      type: String,
      enum: ["pending", "under_verification", "verified", "rejected"],
      default: "pending",
    },

    rejectionReason: {
      type: String,
      default: "",
    },

    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    verifiedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("KYC", kycSchema);
