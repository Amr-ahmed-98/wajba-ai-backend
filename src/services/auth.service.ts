import User from "../models/user.model.js";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { ApiError } from "../utils/Apierror.js";
import { generateTokens, verifyRefreshToken } from "../services/token.service.js";
import { sendOtpEmail } from "../services/email.service.js";
import { OAuth2Client } from "google-auth-library";

// ⚠️  Do NOT create the client at module-level.
// Because this file is an ES-module import, it is evaluated BEFORE
// dotenv.config() runs in server.ts (ESM hoisting), so
// process.env.GOOGLE_CLIENT_ID would be undefined at init time.
// We create the client lazily inside verifyGoogleToken instead.
let _googleClient: OAuth2Client | null = null;
const getGoogleClient = (): OAuth2Client => {
  if (!_googleClient) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error("GOOGLE_CLIENT_ID is not set in environment variables.");
    }
    _googleClient = new OAuth2Client(clientId);
  }
  return _googleClient;
};

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

/** Verify a Google idToken and extract the user's identity */
const verifyGoogleToken = async (idToken: string) => {
  try {
    const ticket = await getGoogleClient().verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new ApiError(401, "Invalid Google token: missing user info");
    }
    return {
      googleId: payload.sub,          // unique Google user ID
      email: payload.email,
      name: payload.name ?? "User",
      photo: payload.picture ?? null,
    };
  } catch (error: any) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, "Invalid or expired Google token");
  }
};

/** Persist the refresh token to the user document */
const saveRefreshToken = async (userId: string, refreshToken: string) => {
  await User.findByIdAndUpdate(userId, { refreshToken });
};

// ─────────────────────────────────────────────────────────────
// Standard registration
// ─────────────────────────────────────────────────────────────
export const registerUser = async (userData: any) => {
  const existing = await User.findOne({ email: userData.email.toLowerCase() });
  if (existing) {
    throw new ApiError(409, "An account with this email already exists");
  }

  // Strip confirmPassword — it's a UI-only field, not stored in the DB
  const { confirmPassword: _ignored, ...cleanData } = userData;

  const hashedPassword = await bcrypt.hash(cleanData.password, 12);

  const user = await User.create({
    ...cleanData,
    email: cleanData.email.toLowerCase(),
    password: hashedPassword,
  });

  const { accessToken, refreshToken } = generateTokens(user.id, user.role);
  await saveRefreshToken(user.id, refreshToken);

  return { user, accessToken, refreshToken };
};

// ─────────────────────────────────────────────────────────────
// Google registration
// Note: Google registration does NOT skip onboarding preferences.
// The frontend sends idToken + all preference fields together.
// ─────────────────────────────────────────────────────────────
export const registerWithGoogle = async (idToken: string, preferences: any) => {
  const { googleId, email, name, photo } = await verifyGoogleToken(idToken);

  const existing = await User.findOne({ email });
  if (existing) {
    throw new ApiError(
      409,
      "An account with this Google email already exists. Please login instead."
    );
  }

  const user = await User.create({
    name,
    email,
    googleId,
    photo,
    ...preferences,
  });

  const { accessToken, refreshToken } = generateTokens(user.id, user.role);
  await saveRefreshToken(user.id, refreshToken);

  return { user, accessToken, refreshToken };
};

// ─────────────────────────────────────────────────────────────
// Standard login (email + password only — password is required)
// ─────────────────────────────────────────────────────────────
export const loginUser = async (email: string, password: string) => {
  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+password +refreshToken"
  );

  // Generic message to avoid revealing whether the email exists
  if (!user) throw new ApiError(401, "Invalid email or password");

  if (!user.password) {
    // Account was created via Google — has no password
    throw new ApiError(
      401,
      "This account uses Google Sign-In. Please use the 'Login with Google' option."
    );
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new ApiError(401, "Invalid email or password");

  const { accessToken, refreshToken } = generateTokens(user.id, user.role);
  await saveRefreshToken(user.id, refreshToken);

  return { user, accessToken, refreshToken };
};

// ─────────────────────────────────────────────────────────────
// Google login (existing users only — new users must register)
// ─────────────────────────────────────────────────────────────
export const loginWithGoogle = async (idToken: string) => {
  const { googleId, email } = await verifyGoogleToken(idToken);

  const user = await User.findOne({ email }).select("+refreshToken");
  if (!user) {
    throw new ApiError(
      404,
      "No account found for this Google account. Please register first."
    );
  }

  // If the user registered with email/password, link their Google account on first Google login
  if (!user.googleId) {
    user.googleId = googleId;
    await user.save();
  } else if (user.googleId !== googleId) {
    // Someone else's Google account tried to log in as this user
    throw new ApiError(401, "Google account mismatch. Please use the correct Google account.");
  }

  const { accessToken, refreshToken } = generateTokens(user.id, user.role);
  await saveRefreshToken(user.id, refreshToken);

  return { user, accessToken, refreshToken };
};

// ─────────────────────────────────────────────────────────────
// Refresh access token (reads refresh token from cookie)
// Uses refresh token rotation: each call issues a new refresh token
// ─────────────────────────────────────────────────────────────
export const refreshAccessToken = async (refreshToken: string) => {
  let payload: { id: string };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, "Invalid or expired session. Please login again.");
  }

  // Validate the token against the one stored in DB (prevents replay after logout)
  const user = await User.findById(payload.id).select("+refreshToken");
  if (!user || user.refreshToken !== refreshToken) {
    throw new ApiError(401, "Session expired or already logged out. Please login again.");
  }

  const { accessToken, refreshToken: newRefreshToken } = generateTokens(user.id, user.role);
  await saveRefreshToken(user.id, newRefreshToken);

  return { accessToken, newRefreshToken, role: user.role };
};

// ─────────────────────────────────────────────────────────────
// Logout — invalidates stored refresh token
// ─────────────────────────────────────────────────────────────
export const logoutUser = async (refreshToken: string) => {
  try {
    const payload = verifyRefreshToken(refreshToken);
    await User.findByIdAndUpdate(payload.id, { $unset: { refreshToken: "" } });
  } catch {
    // Token may be expired or invalid — still clear the cookie in controller
  }
};

// ─────────────────────────────────────────────────────────────
// Forgot password
// ─────────────────────────────────────────────────────────────
export const handleForgotPassword = async (email: string) => {
  const user = await User.findOne({ email: email.toLowerCase() });

  // Silent return — prevents email enumeration attacks
  if (!user) return;

  // Google-only users have no password to reset — silently return
  if (!user.password && user.googleId) return;

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

  user.otp = hashedOtp;
  user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // Valid for 10 minutes
  await user.save();

  // sendOtpEmail now throws ApiError(502) on SMTP failure — let it propagate
  // so the controller returns the real error instead of a generic 500.
  await sendOtpEmail(user.email, otp);
};