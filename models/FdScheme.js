import mongoose from "mongoose";

const rateSlabSchema = new mongoose.Schema(
  {
    minMonths: { type: Number, required: true },
    maxMonths: { type: Number, required: true },
    rate: { type: Number, required: true },
  },
  { _id: false }
);

const fdSchemeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    description: { type: String, trim: true, default: "" },
    category: {
      type: String,
      enum: ["regular", "senior_citizen", "tax_saver", "special", "flexi"],
      default: "regular",
      index: true,
    },
    minTenureMonths: { type: Number, required: true, min: 1 },
    maxTenureMonths: { type: Number, required: true },
    interestRate: { type: Number, required: true, min: 0 },
    rateSlabs: { type: [rateSlabSchema], default: [] },
    minDeposit: { type: Number, default: 0 },
    maxDeposit: { type: Number, default: null },
    allowedPayoutOptions: {
      type: [String],
      enum: ["cumulative", "monthly", "quarterly", "annually"],
      default: ["cumulative"],
    },
    seniorCitizenOnly: { type: Boolean, default: false },
    seniorCitizenBonusRate: { type: Number, default: 0 },
    badge: { type: String, trim: true, default: "" },
    tags: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

fdSchemeSchema.index({ isActive: 1, sortOrder: 1, interestRate: -1 });

export default mongoose.model("FDScheme", fdSchemeSchema);
