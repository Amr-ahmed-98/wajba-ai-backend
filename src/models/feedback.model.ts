import mongoose, { Schema, Document, Types } from "mongoose";

// ── Types ─────────────────────────────────────────────────────
export type ObservationType =
  | "suggestion"
  | "bug_report"
  | "complaint"
  | "question"
  | "other";

export type ImportanceLevel = "normal" | "urgent";

export interface IFeedback extends Document {
  observationType: ObservationType;
  importanceLevel: ImportanceLevel;
  details: string;
  screenshotUrl?: string;
  // null  → guest submission (no account)
  // ObjectId → linked to a registered user
  submittedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Schema ────────────────────────────────────────────────────
const feedbackSchema = new Schema<IFeedback>(
  {
    observationType: {
      type: String,
      enum: ["suggestion", "bug_report", "complaint", "question", "other"],
      required: [true, "Observation type is required"],
    },
    importanceLevel: {
      type: String,
      enum: ["normal", "urgent"],
      default: "normal",
    },
    details: {
      type: String,
      required: [true, "Observation details are required"],
      minlength: [10, "Details must be at least 10 characters"],
      maxlength: [2000, "Details must not exceed 2000 characters"],
      trim: true,
    },
    screenshotUrl: {
      type: String,
      default: undefined,
    },
    // Optional — populated if the request carries a valid access token,
    // left null for guests (the route is public and does NOT require auth).
    submittedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model<IFeedback>("Feedback", feedbackSchema);