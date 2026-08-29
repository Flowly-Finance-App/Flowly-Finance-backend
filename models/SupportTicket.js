import mongoose from "mongoose";
const { Schema } = mongoose;


const supportTicketSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    subject: { type: String, required: true },
    category: { type: String, enum: ["kyc", "loan", "account", "fd", "payment", "technical", "other"], default: "other" },
    status: { type: String, enum: ["open", "in_progress", "resolved", "closed"], default: "open", index: true },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    messages: [
      { sender: { type: Schema.Types.ObjectId, ref: "User" }, message: String, sentAt: { type: Date, default: Date.now } },
    ],
    resolvedAt: Date,
  },
  { timestamps: true }
);

supportTicketSchema.index({ status: 1, priority: -1, createdAt: 1 });
supportTicketSchema.index({ assignedTo: 1, status: 1 });

export default mongoose.model("SupportTicket", supportTicketSchema);
