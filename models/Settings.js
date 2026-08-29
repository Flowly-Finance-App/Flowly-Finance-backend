import mongoose from "mongoose";
const { Schema } = mongoose;


const settingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "global" },
    values: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("Settings", settingsSchema);
