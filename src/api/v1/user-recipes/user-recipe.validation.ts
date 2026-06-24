import { z } from "zod";

// ── Shared ────────────────────────────────────────────────────
const recipeIdParam = z.object({
  id: z.string().min(1, "Recipe ID is required"),
});

// ── POST /api/v1/user-recipes/generate-from-text ─────────────
export const generateFromTextSchema = z.object({
  body: z.object({
    ingredients: z
      .array(z.string().min(1).trim())
      .min(1, "At least one ingredient is required."),
    missingIngredients: z.array(z.string().min(1).trim()).optional().default([]),
    isPublic: z.boolean().optional().default(false),
    count: z.number().int().min(1).max(5).optional().default(1),
  }),
});

// ── POST /api/v1/user-recipes/generate-from-photo ───────────
// Body is parsed via multer; validation runs after the controller
// extracts fields from req.body. We keep this schema for Swagger.
export const generateFromPhotoSchema = z.object({
  body: z.object({
    missingIngredients: z
      .union([z.array(z.string().min(1).trim()), z.string()])
      .optional(),
    isPublic: z.union([z.boolean(), z.string()]).optional(),
    count: z.union([z.number().int().min(1).max(5), z.string()]).optional(),
  }),
});

// ── GET /api/v1/user-recipes/community ──────────────────────
export const listCommunitySchema = z.object({
  query: z.object({
    sort: z
      .enum(["newest", "most_liked", "top_rated"])
      .optional()
      .default("newest"),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(12),
  }),
});

// ── GET /api/v1/user-recipes/my-recipes ─────────────────────
export const listMyRecipesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(12),
  }),
});

// ── GET /api/v1/user-recipes/:id ────────────────────────────
export const getUserRecipeByIdSchema = z.object({
  params: recipeIdParam,
});

// ── POST /api/v1/user-recipes/:id/react ─────────────────────
export const reactSchema = z.object({
  params: recipeIdParam,
  body: z.object({
    reaction: z.enum(["like", "dislike"]),
  }),
});

// ── PATCH /api/v1/user-recipes/:id/visibility ───────────────
export const toggleVisibilitySchema = z.object({
  params: recipeIdParam,
});

// ── DELETE /api/v1/user-recipes/:id ─────────────────────────
export const deleteUserRecipeSchema = z.object({
  params: recipeIdParam,
});
