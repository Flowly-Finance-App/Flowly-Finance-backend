import mongoose from "mongoose";

const accountSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    accountNumber: {
      type: Number,
      required: true,
      unique: true,
    },

    accountType: {
      type: String,
      enum: ["savings", "current"],
      default: "savings",
    },

    balance: {
      type: Number,
      default: 0,
    },

    branch: {
      type: String,
    },

    ifscCode: {
      type: String,
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("Account", accountSchema);
