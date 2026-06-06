import Feedback, { IFeedback } from "../models/feedback.model.js";
import { ApiError } from "../utils/Apierror.js";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import mongoose, { HydratedDocument } from "mongoose";

// ─────────────────────────────────────────────────────────────
// Cloudinary config — lazy, same pattern as Google client in auth.service.ts
// ─────────────────────────────────────────────────────────────
let _cloudinaryConfigured = false;

const configureCloudinary = () => {
  if (_cloudinaryConfigured) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new ApiError(
      500,
      "Image upload service is not configured. Please contact support."
    );
  }

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
  _cloudinaryConfigured = true;
};

// ─────────────────────────────────────────────────────────────
// Upload a buffer to Cloudinary and return the secure URL
// ─────────────────────────────────────────────────────────────
const uploadScreenshot = (buffer: Buffer, mimetype: string): Promise<string> => {
  configureCloudinary();

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "feedback_screenshots",
        resource_type: "image",
        transformation: [{ quality: "auto", fetch_format: "auto" }],
      },
      (error, result) => {
        if (error || !result) {
          reject(new ApiError(502, "Failed to upload screenshot. Please try again."));
          return;
        }
        resolve(result.secure_url);
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// ─────────────────────────────────────────────────────────────
// Submit feedback
// ─────────────────────────────────────────────────────────────
export interface SubmitFeedbackInput {
  observationType: "suggestion" | "bug_report" | "complaint" | "question" | "other";
  importanceLevel?: "normal" | "urgent";
  details: string;
  screenshotBuffer?: Buffer;
  screenshotMimetype?: string;
  userId?: string; // raw string from JWT payload
}

export const submitFeedback = async (
  input: SubmitFeedbackInput
): Promise<HydratedDocument<IFeedback>> => {
  const {
    observationType,
    importanceLevel = "normal",
    details,
    screenshotBuffer,
    screenshotMimetype,
    userId,
  } = input;

  // Upload screenshot if one was provided
  let screenshotUrl: string | undefined;
  if (screenshotBuffer) {
    screenshotUrl = await uploadScreenshot(
      screenshotBuffer,
      screenshotMimetype ?? "image/jpeg"
    );
  }

  // Cast the plain string ID to ObjectId so it matches the IFeedback interface.
  // If there is no userId (guest), keep it null.
  const submittedBy = userId
    ? new mongoose.Types.ObjectId(userId)
    : null;

  const feedback = await Feedback.create({
    observationType,
    importanceLevel,
    details,
    screenshotUrl,
    submittedBy,
  });

  // Feedback.create() returns HydratedDocument<IFeedback> — cast explicitly
  // so the controller can safely access _id without a TypeScript error.
  return feedback as HydratedDocument<IFeedback>;
};