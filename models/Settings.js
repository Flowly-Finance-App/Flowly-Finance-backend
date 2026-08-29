import mongoose from "mongoose";
const { Schema } = mongoose;

/**
 * SETTINGS — singleton global platform config (feature flags, interest
 * bands, support contact info) so these aren't hardcoded in the app.
 */
const settingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "global" },
    values: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("Settings", settingsSchema);
