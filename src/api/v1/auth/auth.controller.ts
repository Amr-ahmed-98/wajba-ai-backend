import { Request, Response, NextFunction } from "express";
import * as authService from "../../../services/auth.service.js";
import User from "../../../models/user.model.js";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { ApiError } from "../../../utils/Apierror.js";

// ─────────────────────────────────────────────────────────────
// Cookie helpers
// ─────────────────────────────────────────────────────────────

const setRefreshCookie = (res: Response, token: string) => {
  res.cookie("refreshToken", token, {
    httpOnly: true,                                          // Not accessible via JS (XSS protection)
    secure: process.env.NODE_ENV === "production",           // HTTPS only in production
    sameSite: "strict",                                      // CSRF protection
    maxAge: 7 * 24 * 60 * 60 * 1000,                        // 7 days
  });
};

const clearRefreshCookie = (res: Response) => {
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });
};

// ─────────────────────────────────────────────────────────────
// Standard register
// POST /api/v1/auth/register
// Body: { name, email, password, confirmPassword, cookingSkillLevel,
//         familyType, primaryCookingGoal, dietaryPreferences?,
//         favoriteCuisines?, allergies?, availableKitchenTools? }
// ─────────────────────────────────────────────────────────────
export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user, accessToken, refreshToken } = await authService.registerUser(req.body);
    setRefreshCookie(res, refreshToken);
    res.status(201).json({
      success: true,
      message: "Registration successful",
      data: { accessToken, role: user.role },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// Google register
// POST /api/v1/auth/google/register
// Body: { idToken, cookingSkillLevel, familyType, primaryCookingGoal,
//         dietaryPreferences?, favoriteCuisines?, allergies?, availableKitchenTools? }
// ─────────────────────────────────────────────────────────────
export const googleRegister = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { idToken, ...preferences } = req.body;
    const { user, accessToken, refreshToken } = await authService.registerWithGoogle(
      idToken,
      preferences
    );
    setRefreshCookie(res, refreshToken);
    res.status(201).json({
      success: true,
      message: "Google registration successful",
      data: { accessToken, role: user.role },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// Standard login
// POST /api/v1/auth/login
// Body: { email, password }   ← both are required, no optional
// ─────────────────────────────────────────────────────────────
export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const { user, accessToken, refreshToken } = await authService.loginUser(email, password);
    setRefreshCookie(res, refreshToken);
    res.status(200).json({
      success: true,
      message: "Login successful",
      data: { accessToken, role: user.role },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// Google login (existing users only)
// POST /api/v1/auth/google/login
// Body: { idToken }
// ─────────────────────────────────────────────────────────────
export const googleLogin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { idToken } = req.body;
    const { user, accessToken, refreshToken } = await authService.loginWithGoogle(idToken);
    setRefreshCookie(res, refreshToken);
    res.status(200).json({
      success: true,
      message: "Google login successful",
      data: { accessToken, role: user.role },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// Get current authenticated user
// GET /api/v1/auth/me
// Lightweight identity payload for UI use (navbar, comment author, etc).
// NOT a profile endpoint — read-only, no update/delete here.
// ─────────────────────────────────────────────────────────────
export const getCurrentUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user?.id).select("name email photo role");

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    res.status(200).json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        photo: user.photo ?? null,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// Refresh access token
// POST /api/v1/auth/refresh-token
// Reads refreshToken from httpOnly cookie (no body needed)
// Returns a new accessToken + rotates the refresh token cookie
// ─────────────────────────────────────────────────────────────
export const refreshToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) {
      throw new ApiError(401, "No session found. Please login again.");
    }

    const { accessToken, newRefreshToken, role } = await authService.refreshAccessToken(token);
    setRefreshCookie(res, newRefreshToken);

    res.status(200).json({
      success: true,
      message: "Token refreshed successfully",
      data: { accessToken, role },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// Logout
// POST /api/v1/auth/logout
// Invalidates the DB refresh token and clears the cookie
// ─────────────────────────────────────────────────────────────
export const logout = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.refreshToken;
    if (token) {
      await authService.logoutUser(token); // Clears token from DB
    }
    clearRefreshCookie(res);
    res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// Forgot password
// POST /api/v1/auth/forgot-password
// Body: { email }
// Always returns 200 to prevent email enumeration
// ─────────────────────────────────────────────────────────────
export const forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await authService.handleForgotPassword(req.body.email);
    res.status(200).json({
      success: true,
      message: "If that email is registered, an OTP has been sent.",
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// Verify OTP
// POST /api/v1/auth/verify-otp
// Body: { email, otp }
// ─────────────────────────────────────────────────────────────
export const verifyOtp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, otp } = req.body;
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    const user = await User.findOne({
      email: email.toLowerCase(),
      otp: hashedOtp,
      otpExpires: { $gt: Date.now() },
    }).select("+otp +otpExpires");

    if (!user) {
      throw new ApiError(400, "Invalid or expired OTP. Please request a new one.");
    }

    res.status(200).json({ success: true, message: "OTP verified successfully" });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// Reset password
// POST /api/v1/auth/reset-password
// Body: { email, otp, newPassword, confirmPassword }
// ─────────────────────────────────────────────────────────────
export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, otp, newPassword } = req.body;
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    const user = await User.findOne({
      email: email.toLowerCase(),
      otp: hashedOtp,
      otpExpires: { $gt: Date.now() },
    }).select("+otp +otpExpires +password");

    if (!user) {
      throw new ApiError(400, "Invalid or expired OTP. Please request a new one.");
    }

    user.password = await bcrypt.hash(newPassword, 12);
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password reset successfully. You can now login with your new password.",
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// Get allergies
// GET /api/v1/auth/allergies
// Returns stable keys (for DB storage) + display labels (for UI)
// ─────────────────────────────────────────────────────────────
export const getAllergies = (_req: Request, res: Response) => {
  const allergies = [
    { key: "peanuts", label: "Peanuts" },
    { key: "tree_nuts", label: "Tree Nuts" },
    { key: "dairy", label: "Dairy" },
    { key: "eggs", label: "Eggs" },
    { key: "soy", label: "Soy" },
    { key: "wheat_gluten", label: "Wheat/Gluten" },
    { key: "fish", label: "Fish" },
    { key: "shellfish", label: "Shellfish" },
    { key: "sesame", label: "Sesame" },
  ];
  res.status(200).json({ success: true, data: allergies });
};