import { z } from "zod";

// ── Shared ID params ──────────────────────────────────────────
const recipeIdParam = z.object({ id: z.string().min(1, "Recipe ID is required") });
const commentIdParam = z.object({ commentId: z.string().min(1, "Comment ID is required") });
const replyIdParam = z.object({ replyId: z.string().min(1, "Reply ID is required") });

// ── GET /api/v1/recipes/:id/comments ─────────────────────────
export const getCommentsSchema = z.object({
    params: recipeIdParam,
    query: z.object({
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(50).optional().default(10),
    }),
});

// ── POST /api/v1/recipes/:id/comments ────────────────────────
export const addCommentSchema = z.object({
    params: recipeIdParam,
    body: z.object({
        body: z.string().trim().min(1, "Comment cannot be empty.").max(2000),
    }),
});

// ── DELETE /api/v1/recipes/:id/comments/:commentId ───────────
export const deleteCommentSchema = z.object({
    params: recipeIdParam.extend(commentIdParam.shape),
});

// ── POST /api/v1/recipes/:id/comments/:commentId/like|dislike ─
export const reactToCommentSchema = z.object({
    params: recipeIdParam.extend(commentIdParam.shape),
});

// ── POST /api/v1/recipes/:id/comments/:commentId/replies ─────
export const addReplySchema = z.object({
    params: recipeIdParam.extend(commentIdParam.shape),
    body: z.object({
        body: z.string().trim().min(1, "Reply cannot be empty.").max(1000),
    }),
});

// ── DELETE /api/v1/recipes/:id/comments/:commentId/replies/:replyId
export const deleteReplySchema = z.object({
    params: recipeIdParam.extend(commentIdParam.shape).extend(replyIdParam.shape),
});

// ── POST /api/v1/recipes/:id/comments/:commentId/replies/:replyId/like|dislike
export const reactToReplySchema = z.object({
    params: recipeIdParam.extend(commentIdParam.shape).extend(replyIdParam.shape),
});

// ── POST /api/v1/recipes/:id/ratings ─────────────────────────
export const upsertRatingSchema = z.object({
    params: recipeIdParam,
    body: z.object({
        // FIX: Zod uses `invalid_type_error` (not `error`) to customise the
        // message that fires when the received value is not a number at all.
        // The original `{ error: "..." }` key was silently ignored, causing
        // Zod's default type message to be shown instead of our custom one.
        value: z
            .number({
                invalid_type_error: "value must be a number between 1 and 5",
                required_error: "value is required",
            } as any)
            .int("Rating must be a whole number.")
            .min(1, "Minimum rating is 1 star.")
            .max(5, "Maximum rating is 5 stars."),
    }),
});

// ── GET /api/v1/recipes/:id/ratings/me  ──────────────────────
// ── DELETE /api/v1/recipes/:id/ratings  ──────────────────────
// Both only need the recipe ID param — share the same schema shape
// but exported under two names so route files stay self-documenting.
export const getMyRatingSchema = z.object({
    params: recipeIdParam,
});

// Alias: used for DELETE /ratings so the route import reads clearly.
export const deleteRatingSchema = getMyRatingSchema;