import mongoose from "mongoose";
const { Schema } = mongoose;

const entrySchema = new Schema(
  {
    type: {
      type: String,
      enum: ["credit", "debit", "emi", "deposit", "withdrawal"],
      required: true,
    },
    amount: { type: Number, required: true },
    description: { type: String },
    refType: { type: String, enum: ["LoanApplication", "FixedDeposit", "Account"] },
    refId: { type: Schema.Types.ObjectId },
    meta: { type: Schema.Types.Mixed },
    postedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const transactionBucketSchema = new Schema(
  {
    account: { type: Schema.Types.ObjectId, ref: "Account", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    periodKey: { type: String, required: true },
    entries: { type: [entrySchema], default: [] },
  },
  { timestamps: true }
);

transactionBucketSchema.index({ account: 1, periodKey: 1 }, { unique: true });

transactionBucketSchema.statics.postEntry = async function ({
  accountId,
  userId,
  type,
  amount,
  description,
  refType,
  refId,
  meta,
}) {
  const periodKey = new Date().toISOString().slice(0, 7);

  return this.findOneAndUpdate(
    { account: accountId, periodKey },
    {
      $setOnInsert: { user: userId, account: accountId, periodKey },
      $push: {
        entries: { type, amount, description, refType, refId, meta, postedAt: new Date() },
      },
    },
    { upsert: true, new: true }
  );
};

export default mongoose.models.TransactionBucket || mongoose.model("TransactionBucket", transactionBucketSchema);
