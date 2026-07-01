import { z } from "zod";

// ── GET /api/v1/profile/:identifier ──────────────────────────
export const getPublicProfileSchema = z.object({
    params: z.object({
        identifier: z.string().min(1, "Username or ID is required"),
    }),
    query: z.object({
        lang: z.enum(["en", "ar"]).optional().default("en"),
        recipesPage: z.coerce.number().int().min(1).optional().default(1),
        likesPage: z.coerce.number().int().min(1).optional().default(1),
        commentsPage: z.coerce.number().int().min(1).optional().default(1),
        ratingsPage: z.coerce.number().int().min(1).optional().default(1),
    }),
});

// ── PATCH /api/v1/profile/me ──────────────────────────────────
export const editProfileSchema = z.object({
    body: z.object({
        name: z
            .string()
            .regex(/^[\p{L}]+(?:\s[\p{L}]+)+$/u, "Full name must be at least two words")
            .optional(),
        username: z
            .string()
            .min(3, "Username must be at least 3 characters")
            .max(30, "Username cannot exceed 30 characters")
            .regex(/^[a-z0-9_]+$/, "Username can only contain lowercase letters, numbers, and underscores")
            .optional(),
        bio: z
            .string()
            .max(300, "Bio cannot exceed 300 characters")
            .nullable()
            .optional(),
        cookingSkillLevel: z
            .enum(["Beginner", "Intermediate", "Professional"])
            .optional(),
        dietaryPreferences: z
            .array(z.enum(["Vegan", "Low Carb", "Vegetarian", "Paleo", "Keto"]))
            .optional(),
        favoriteCuisines: z
            .array(z.enum(["Arabic", "Asian", "Italian", "French"]))
            .optional(),
    }),
});

// ── POST /api/v1/profile/me/photo ────────────────────────────
// File validated by multer — no body schema needed beyond params
export const uploadPhotoSchema = z.object({});

// ── POST /api/v1/profile/:id/follow ──────────────────────────
export const followSchema = z.object({
    params: z.object({
        id: z.string().min(1, "User ID is required"),
    }),
});

// ── GET /api/v1/profile/:id/followers ────────────────────────
// ── GET /api/v1/profile/:id/following ────────────────────────
export const followListSchema = z.object({
    params: z.object({
        id: z.string().min(1, "User ID is required"),
    }),
    query: z.object({
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(50).optional().default(20),
    }),
});