import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/Apierror.js";
// import { JsonWebTokenError, TokenExpiredError, NotBeforeError } from "jsonwebtoken";
import pkg from 'jsonwebtoken'
import mongoose from "mongoose";

const { JsonWebTokenError, TokenExpiredError, NotBeforeError } = pkg 

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // ── 1. Known operational errors (thrown intentionally) ──────
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ success: false, message: err.message });
    return;
  }

  // ── 2. Mongoose validation error (schema-level) ─────────────
  if (err instanceof mongoose.Error.ValidationError) {
    const messages = Object.values(err.errors).map((e: any) => e.message);
    res.status(422).json({ success: false, message: "Validation failed", errors: messages });
    return;
  }

  // ── 3. MongoDB duplicate key (e.g. unique email) ─────────────
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue ?? {})[0] ?? "field";
    const label = field.charAt(0).toUpperCase() + field.slice(1);
    res.status(409).json({ success: false, message: `${label} is already in use` });
    return;
  }

  // ── 4. Mongoose invalid ObjectId ─────────────────────────────
  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ success: false, message: `Invalid value for field: ${err.path}` });
    return;
  }

  // ── 5. JWT errors ─────────────────────────────────────────────
  if (err instanceof TokenExpiredError) {
    res.status(401).json({ success: false, message: "Token has expired. Please login again." });
    return;
  }
  if (err instanceof JsonWebTokenError || err instanceof NotBeforeError) {
    res.status(401).json({ success: false, message: "Invalid token." });
    return;
  }

  // ── 6. Unknown / programmer error ─────────────────────────────
  console.error("❌ Unhandled Error:", err);
  res.status(500).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Something went wrong, please try again later."
        : err.message ?? "Internal server error",
  });
};