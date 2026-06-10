import { z } from "zod";

// ─────────────────────────────────────────────────────────────
// Shared param — used by both add and remove
// ─────────────────────────────────────────────────────────────
const recipeIdParam = z.object({
    params: z.object({
        recipeId: z
            .string({ error: "Recipe ID is required" })
            .regex(/^[a-f\d]{24}$/i, "Invalid recipe ID format"),
    }),
});

// POST /api/v1/bookmarks/:recipeId
export const addBookmarkSchema = recipeIdParam;

// DELETE /api/v1/bookmarks/:recipeId
export const removeBookmarkSchema = recipeIdParam;

// GET /api/v1/bookmarks
export const getBookmarksSchema = z.object({
    query: z.object({
        page: z
            .string()
            .regex(/^\d+$/, "Page must be a positive integer")
            .optional(),
        limit: z
            .string()
            .regex(/^\d+$/, "Limit must be a positive integer")
            .refine((v) => !v || Number(v) <= 50, "Limit cannot exceed 50")
            .optional(),
    }),
});