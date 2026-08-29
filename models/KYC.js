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
      required: true,
    },

    extractedData: {
      type: String,
    },

    verificationStatus: {
      type: String,
      enum: ["pending", "under_verification", "verified", "rejected"],
      default: "pending",
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
