import { Request, Response, NextFunction } from "express";
import * as feedbackService from "../../../services/feedback.service.js";
import { IFeedback } from "../../../models/feedback.model.js";
import { HydratedDocument } from "mongoose";
import jwt from "jsonwebtoken";

// ─────────────────────────────────────────────────────────────
// Helper — silently extract user ID from the Authorization header.
// This endpoint is PUBLIC — we never throw if the token is missing
// or invalid. We only attach a userId if the token is fully valid.
// ─────────────────────────────────────────────────────────────
const extractOptionalUserId = (req: Request): string | undefined => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return undefined;

    const token = authHeader.split(" ")[1];
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) return undefined;

    const payload = jwt.verify(token, secret) as { id: string };
    return payload.id;
  } catch {
    // Expired / invalid token — treat as guest submission, never throw
    return undefined;
  }
};

// ─────────────────────────────────────────────────────────────
// Submit feedback
// POST /api/v1/feedback
// Content-Type: multipart/form-data
// Fields: observationType, importanceLevel (optional), details
// File:   screenshot (optional, image only, max 5 MB)
// Auth:   optional Bearer token — logged-in users get their ID stored
// ─────────────────────────────────────────────────────────────
export const submitFeedback = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = extractOptionalUserId(req);

    const screenshotBuffer   = req.file?.buffer;
    const screenshotMimetype = req.file?.mimetype;

    const feedback: HydratedDocument<IFeedback> = await feedbackService.submitFeedback({
      observationType:  req.body.observationType,
      importanceLevel:  req.body.importanceLevel,
      details:          req.body.details,
      screenshotBuffer,
      screenshotMimetype,
      userId,
    });

    res.status(201).json({
      success: true,
      message: "Feedback submitted successfully. Thank you for helping us improve!",
      data: { feedbackId: feedback._id },
    });
  } catch (error) {
    next(error);
  }
};