import { z } from "zod";

// ── Submit feedback ───────────────────────────────────────────
// Works for guests AND registered users (no auth required).
// Screenshot is handled separately via multipart/form-data —
// the Zod schema only validates the text fields.
export const submitFeedbackSchema = z.object({
  body: z.object({
    observationType: z.enum(
      ["suggestion", "bug_report", "complaint", "question", "other"],
      { error: "Observation type must be one of: suggestion, bug_report, complaint, question, other" }
    ),
    importanceLevel: z
      .enum(["normal", "urgent"], {
        error: "Importance level must be either 'normal' or 'urgent'",
      })
      .optional()
      .default("normal"),
    details: z
      .string({ error: "Details are required" })
      .min(10, "Details must be at least 10 characters")
      .max(2000, "Details must not exceed 2000 characters")
      .trim(),
  }),
});