import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: {
      type: String,
      required: true,
    },

    message: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      enum: ["loan", "kyc", "emi", "payment", "deposit", "system"],
      default: "system",
    },

    status: {
      type: String,
      enum: ["unread", "read"],
      default: "unread",
    },

    // Optional structured details (e.g. receipt number, amount, new balance)
    // so the UI can deep-link to the related transaction.
    meta: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Notification", notificationSchema);