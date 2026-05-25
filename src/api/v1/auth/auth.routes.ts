import { Router } from "express";
import * as authController from "./auth.controller.js";
import validate from "../../../middlewares/validate.middleware.js";
import {
  registerSchema,
  googleRegisterSchema,
  loginSchema,
  googleLoginSchema,
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
} from "./auth.validation.js";

const router = Router();

// ── Allergies (public, no auth needed) ──────────────────────
/**
 * @swagger
 * /api/v1/auth/allergies:
 *   get:
 *     summary: Get the list of available allergies
 *     tags: [Auth]
 *     description: Returns a static list of allergy options (key + display label) used during registration onboarding.
 *     responses:
 *       200:
 *         description: List of allergies returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key:
 *                         type: string
 *                         example: peanuts
 *                       label:
 *                         type: string
 *                         example: Peanuts
 */
// GET /api/v1/auth/allergies
router.get("/allergies", authController.getAllergies);

// ── Standard auth ─────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, confirmPassword, cookingSkillLevel, familyType, primaryCookingGoal]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Amr Ahmed
 *               email:
 *                 type: string
 *                 example: amr@example.com
 *               password:
 *                 type: string
 *                 example: Password123
 *               confirmPassword:
 *                 type: string
 *                 example: Password123
 *               cookingSkillLevel:
 *                 type: string
 *                 enum: [Beginner, Intermediate, Professional]
 *               familyType:
 *                 type: string
 *                 enum: [Single person, Couple, Large family]
 *               primaryCookingGoal:
 *                 type: string
 *                 enum: [Save time, Healthy and nutritious eating, Learn new skills, Save money]
 *               dietaryPreferences:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [Vegan, Low Carb, Vegetarian, Paleo, Keto]
 *               favoriteCuisines:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [Arabic, Asian, Italian, French]
 *               allergies:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: [peanuts, dairy]
 *               availableKitchenTools:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [Oven, Air fryer, Blender, Pressure cooker, Coffee maker, Toaster, Slow cooker, Other]
 *     responses:
 *       201:
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Registration successful
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                     role:
 *                       type: string
 *                       example: user
 *       400:
 *         description: Validation failed
 *       409:
 *         description: Email already exists
 */
// POST /api/v1/auth/register  { name, email, password, confirmPassword, ...preferences }
router.post("/register", validate(registerSchema), authController.register);

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 example: amr@example.com
 *               password:
 *                 type: string
 *                 example: Password123
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Login successful
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                     role:
 *                       type: string
 *                       example: user
 *       401:
 *         description: Invalid credentials
 */
// POST /api/v1/auth/login  { email, password }  ← both required
router.post("/login", validate(loginSchema), authController.login);

// ── Google auth ───────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/auth/google/register:
 *   post:
 *     summary: Register a new user via Google Sign-In
 *     tags: [Auth]
 *     description: Accepts a Google ID token along with onboarding preferences. The user's name and email are extracted from the token automatically.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idToken, cookingSkillLevel, familyType, primaryCookingGoal]
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Google ID token obtained from Google Sign-In
 *                 example: eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...
 *               cookingSkillLevel:
 *                 type: string
 *                 enum: [Beginner, Intermediate, Professional]
 *               familyType:
 *                 type: string
 *                 enum: [Single person, Couple, Large family]
 *               primaryCookingGoal:
 *                 type: string
 *                 enum: [Save time, Healthy and nutritious eating, Learn new skills, Save money]
 *               dietaryPreferences:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [Vegan, Low Carb, Vegetarian, Paleo, Keto]
 *               favoriteCuisines:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [Arabic, Asian, Italian, French]
 *               allergies:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: [peanuts, dairy]
 *               availableKitchenTools:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [Oven, Air fryer, Blender, Pressure cooker, Coffee maker, Toaster, Slow cooker, Other]
 *     responses:
 *       201:
 *         description: Google registration successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Google registration successful
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                     role:
 *                       type: string
 *                       example: user
 *       400:
 *         description: Validation failed or invalid Google token
 *       409:
 *         description: Email already registered
 */
// POST /api/v1/auth/google/register  { idToken, ...preferences }
router.post("/google/register", validate(googleRegisterSchema), authController.googleRegister);

/**
 * @swagger
 * /api/v1/auth/google/login:
 *   post:
 *     summary: Login an existing user via Google Sign-In
 *     tags: [Auth]
 *     description: Authenticates a previously registered user using a Google ID token. The user must have already completed Google registration.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idToken]
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Google ID token obtained from Google Sign-In
 *                 example: eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...
 *     responses:
 *       200:
 *         description: Google login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Google login successful
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                     role:
 *                       type: string
 *                       example: user
 *       400:
 *         description: Invalid or missing Google token
 *       404:
 *         description: No account found for this Google email
 */
// POST /api/v1/auth/google/login  { idToken }
router.post("/google/login", validate(googleLoginSchema), authController.googleLogin);

// ── Session management ────────────────────────────────────────
/**
 * @swagger
 * /api/v1/auth/refresh-token:
 *   post:
 *     summary: Refresh the access token
 *     tags: [Auth]
 *     description: >
 *       Reads the `refreshToken` from an httpOnly cookie set at login.
 *       Returns a new access token and rotates the refresh token cookie.
 *       No request body is needed.
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Token refreshed successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                     role:
 *                       type: string
 *                       example: user
 *       401:
 *         description: No session found — refresh token cookie is missing or invalid
 */
// POST /api/v1/auth/refresh-token  (no body — reads httpOnly cookie)
router.post("/refresh-token", authController.refreshToken);

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: Logout the current user
 *     tags: [Auth]
 *     description: >
 *       Invalidates the refresh token stored in the database and clears the
 *       `refreshToken` httpOnly cookie. No request body is needed.
 *       If the cookie is already missing the request still succeeds.
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Logged out successfully
 */
// POST /api/v1/auth/logout  (no body — reads httpOnly cookie)
router.post("/logout", authController.logout);

// ── Password recovery ─────────────────────────────────────────
/**
 * @swagger
 * /api/v1/auth/forgot-password:
 *   post:
 *     summary: Request a password-reset OTP
 *     tags: [Auth]
 *     description: >
 *       Sends a 6-digit OTP to the provided email address if it belongs to a
 *       registered account. Always returns 200 to prevent email enumeration.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 example: amr@example.com
 *     responses:
 *       200:
 *         description: OTP sent (or silently ignored if email is not registered)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: If that email is registered, an OTP has been sent.
 *       400:
 *         description: Validation failed (invalid email format)
 */
// POST /api/v1/auth/forgot-password  { email }
router.post("/forgot-password", validate(forgotPasswordSchema), authController.forgotPassword);

/**
 * @swagger
 * /api/v1/auth/verify-otp:
 *   post:
 *     summary: Verify a password-reset OTP
 *     tags: [Auth]
 *     description: >
 *       Validates the 6-digit OTP sent to the user's email. The OTP is
 *       hashed (SHA-256) before comparison and expires after a set period.
 *       Call this before /reset-password to confirm the OTP is valid.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email:
 *                 type: string
 *                 example: amr@example.com
 *               otp:
 *                 type: string
 *                 minLength: 6
 *                 maxLength: 6
 *                 example: "482931"
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: OTP verified successfully
 *       400:
 *         description: Invalid or expired OTP
 */
// POST /api/v1/auth/verify-otp  { email, otp }
router.post("/verify-otp", validate(verifyOtpSchema), authController.verifyOtp);

/**
 * @swagger
 * /api/v1/auth/reset-password:
 *   post:
 *     summary: Reset a user's password
 *     tags: [Auth]
 *     description: >
 *       Resets the user's password after verifying the OTP.
 *       The OTP must still be valid (not expired). Once reset, the OTP is
 *       cleared from the database and cannot be reused.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp, newPassword, confirmPassword]
 *             properties:
 *               email:
 *                 type: string
 *                 example: amr@example.com
 *               otp:
 *                 type: string
 *                 minLength: 6
 *                 maxLength: 6
 *                 example: "482931"
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *                 example: NewPassword123
 *               confirmPassword:
 *                 type: string
 *                 example: NewPassword123
 *     responses:
 *       200:
 *         description: Password reset successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Password reset successfully. You can now login with your new password.
 *       400:
 *         description: Invalid or expired OTP, or passwords do not match
 */
// POST /api/v1/auth/reset-password  { email, otp, newPassword, confirmPassword }
router.post("/reset-password", validate(resetPasswordSchema), authController.resetPassword);

export default router;