import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    documentType: {
      type: String,
      enum: ["aadhaar", "pan", "salary_slip", "bank_statement"],
      required: true,
    },

    fileUrl: {
      type: String,
      required: true,
    },

    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
  },
  {
    timestamps: { createdAt: "uploadedAt", updatedAt: false },
  },
);

export default mongoose.model("Document", documentSchema);
