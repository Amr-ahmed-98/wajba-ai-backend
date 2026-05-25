import { z } from "zod";

// ── Shared preference fields (used in both register schemas) ─
const preferencesSchema = z.object({
  dietaryPreferences: z
    .array(z.enum(["Vegan", "Low Carb", "Vegetarian", "Paleo", "Keto"]))
    .optional(),
  favoriteCuisines: z
    .array(z.enum(["Arabic", "Asian", "Italian", "French"]))
    .optional(),
  allergies: z.array(z.string()).optional(),
  cookingSkillLevel: z.enum(["Beginner", "Intermediate", "Professional"], {
    error: "Cooking skill level is required",
  }),
  familyType: z.enum(["Single person", "Couple", "Large family"], {
    error: "Family type is required",
  }),
  primaryCookingGoal: z.enum(
    ["Save time", "Healthy and nutritious eating", "Learn new skills", "Save money"],
    {
      error: "Primary cooking goal is required",
    }
  ),
  availableKitchenTools: z
    .array(
      z.enum([
        "Oven",
        "Air fryer",
        "Blender",
        "Pressure cooker",
        "Coffee maker",
        "Toaster",
        "Slow cooker",
        "Other",
      ])
    )
    .optional(),
});

// ── Standard registration ─────────────────────────────────────
// All 3 phases of the UI send their data together in the final submit.
export const registerSchema = z.object({
  body: z
    .object({
      name: z.string().regex(/^[\p{L}]+(?:\s[\p{L}]+)+$/u, {
        message: "Full name must be at least two words (e.g. Amr Ahmed)",
      }),
      email: z.email("Invalid email format"),
      password: z.string().min(8, "Password must be at least 8 characters"),
      confirmPassword: z.string({ error: "Confirm password is required" }),
      ...preferencesSchema.shape,
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: "Passwords do not match",
      path: ["confirmPassword"],
    }),
});

// ── Google registration ───────────────────────────────────────
// Frontend gets idToken from Google Sign-In, sends it with all preferences.
// Google registration does NOT skip the onboarding data.
export const googleRegisterSchema = z.object({
  body: z.object({
    idToken: z.string({ error: "Google ID token is required" }).min(1),
    ...preferencesSchema.shape,
  }),
});

// ── Standard login ────────────────────────────────────────────
// Both email AND password are required — no optional password.
export const loginSchema = z.object({
  body: z.object({
    email: z.email("Invalid email format"),
    password: z
      .string({ error: "Password is required" })
      .min(1, "Password is required"),
  }),
});

// ── Google login ──────────────────────────────────────────────
export const googleLoginSchema = z.object({
  body: z.object({
    idToken: z.string({ error: "Google ID token is required" }).min(1),
  }),
});

// ── Password recovery ─────────────────────────────────────────
export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.email("Invalid email format"),
  }),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    email: z.email("Invalid email format"),
    otp: z.string().length(6, "OTP must be exactly 6 digits"),
  }),
});

export const resetPasswordSchema = z.object({
  body: z
    .object({
      email: z.email("Invalid email format"),
      otp: z.string().length(6, "OTP must be exactly 6 digits"),
      newPassword: z.string().min(8, "Password must be at least 8 characters"),
      confirmPassword: z.string({ error: "Confirm password is required" }),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: "Passwords do not match",
      path: ["confirmPassword"],
    }),
});