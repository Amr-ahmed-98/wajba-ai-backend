import { z } from "zod";

// ── Shared ────────────────────────────────────────────────────
const recipeIdParam = z.object({ id: z.string().min(1, "Recipe ID is required") });
const commentIdParam = z.object({ commentId: z.string().min(1, "Comment ID is required") });
const replyIdParam = z.object({ replyId: z.string().min(1, "Reply ID is required") });

// ── GET /api/v1/user-recipes/:id/comments ───────────────────
export const getCommentsSchema = z.object({
    params: recipeIdParam,
    query: z.object({
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(50).optional().default(10),
    }),
});

// ── POST /api/v1/user-recipes/:id/comments ──────────────────
export const addCommentSchema = z.object({
    params: recipeIdParam,
    body: z.object({
        body: z.string().trim().min(1, "Comment cannot be empty.").max(2000),
    }),
});

// ── DELETE /api/v1/user-recipes/:id/comments/:commentId ─────
export const deleteCommentSchema = z.object({
    params: recipeIdParam.extend(commentIdParam.shape),
});

// ── POST /api/v1/user-recipes/:id/comments/:commentId/like|dislike
export const reactToCommentSchema = z.object({
    params: recipeIdParam.extend(commentIdParam.shape),
});

// ── POST /api/v1/user-recipes/:id/comments/:commentId/replies
export const addReplySchema = z.object({
    params: recipeIdParam.extend(commentIdParam.shape),
    body: z.object({
        body: z.string().trim().min(1, "Reply cannot be empty.").max(1000),
        replyTo: z.string().optional(),
    }),
});

// ── DELETE /api/v1/user-recipes/:id/.../replies/:replyId ────
export const deleteReplySchema = z.object({
    params: recipeIdParam.extend(commentIdParam.shape).extend(replyIdParam.shape),
});

// ── POST /api/v1/user-recipes/:id/.../replies/:replyId/like|dislike
export const reactToReplySchema = z.object({
    params: recipeIdParam.extend(commentIdParam.shape).extend(replyIdParam.shape),
});

// ── POST /api/v1/user-recipes/:id/ratings ───────────────────
export const upsertRatingSchema = z.object({
    params: recipeIdParam,
    body: z.object({
        value: z
            .number({ required_error: "value is required" } as any)
            .int("Rating must be a whole number.")
            .min(1, "Minimum rating is 1 star.")
            .max(5, "Maximum rating is 5 stars."),
    }),
});

// ── GET /api/v1/user-recipes/:id/ratings/me  ────────────────
// ── DELETE /api/v1/user-recipes/:id/ratings  ────────────────
export const getMyRatingSchema = z.object({
    params: recipeIdParam,
});

export const deleteRatingSchema = getMyRatingSchema;
