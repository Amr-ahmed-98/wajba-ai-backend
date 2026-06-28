import { Request, Response, NextFunction } from "express";
import * as commentService from "../../../services/comment.service.js";
import { ApiError } from "../../../utils/Apierror.js";
import { resolveRecipeSource, assertUserRecipeIsPublic } from "../../../services/unified.service.js";

// ─────────────────────────────────────────────────────────────
// Typed helper — extract authenticated user from request.
// Auth middleware sets req.user = { id, name, photo }.
// ─────────────────────────────────────────────────────────────
const requireUser = (req: Request): { id: string; name: string; photo: string | null } => {
    const user = (req as any).user;

    // FIX: previously threw a plain `Error` with a manually-attached `statusCode`
    // property. The central errorHandler may not read ad-hoc properties from
    // plain Error objects, causing the response to fall through as a 500
    // instead of the intended 401. Using ApiError keeps it consistent with
    // every other error in the codebase.
    if (!user?.id) throw new ApiError(401, "Authentication required.");

    return {
        id: user.id as string,
        name: (user.name ?? "User") as string,
        photo: (user.photo ?? null) as string | null,
    };
};



// Helper — enforces community-only access for user recipes
const assertSocialAllowed = async (recipeId: string) => {
    const { source } = await resolveRecipeSource(recipeId);
    if (source === "user") await assertUserRecipeIsPublic(recipeId);
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/recipes/:id/comments
// Public — anyone can read comments.
// ─────────────────────────────────────────────────────────────
// public user recipes show comments, private don't. Add check there too.
export const getComments = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        if (req.params.id as string) {
            await assertSocialAllowed(req.params.id as string);
        }
        const result = await commentService.getComments(
            req.params.id as string,
            req.query.page ? Number(req.query.page) : 1,
            req.query.limit ? Number(req.query.limit) : 10
        );
        res.status(200).json({ success: true, data: result.comments, pagination: result.pagination });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/:id/comments
// Authenticated users only.
// Commenting and rating are independent — a user can rate without
// leaving any comment, and can comment without rating.
// ─────────────────────────────────────────────────────────────
export const addComment = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        await assertSocialAllowed(req.params.id as string);
        const { id: userId, name, photo } = requireUser(req);
        const comment = await commentService.addComment(
            req.params.id as string,
            userId,
            name,
            photo,
            req.body.body
        );
        res.status(201).json({ success: true, data: comment });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/recipes/:id/comments/:commentId
// Authenticated — author only.
// ─────────────────────────────────────────────────────────────
export const deleteComment = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const { id: userId } = requireUser(req);
        await commentService.deleteComment(req.params.id as string, req.params.commentId as string, userId);
        res.status(200).json({ success: true, message: "Comment deleted." });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/:id/comments/:commentId/like
// POST /api/v1/recipes/:id/comments/:commentId/dislike
// Authenticated — toggles the reaction.
// ─────────────────────────────────────────────────────────────
export const likeComment = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        await assertSocialAllowed(req.params.id as string);
        const { id: userId } = requireUser(req);
        const counts = await commentService.reactToComment(
            req.params.id as string, req.params.commentId as string, userId, "like"
        );
        res.status(200).json({ success: true, data: counts });
    } catch (error) { next(error); }
};

export const dislikeComment = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        await assertSocialAllowed(req.params.id as string);
        const { id: userId } = requireUser(req);
        const counts = await commentService.reactToComment(
            req.params.id as string, req.params.commentId as string, userId, "dislike"
        );
        res.status(200).json({ success: true, data: counts });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/:id/comments/:commentId/replies
//
// `replyTo` (optional body field) enables reply-to-reply threading.
// When present, the service validates that the target reply exists
// in this comment thread and snapshots the author name as `replyToName`
// so the frontend can render "@username" mentions.
//
// Omitting `replyTo` produces a plain reply to the top-level comment —
// identical to the old behaviour, so existing clients are unaffected.
// ─────────────────────────────────────────────────────────────
export const addReply = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        await assertSocialAllowed(req.params.id as string);
        const { id: userId, name, photo } = requireUser(req);
        const comment = await commentService.addReply(
            req.params.id as string,
            req.params.commentId as string,
            userId,
            name,
            photo,
            req.body.body,
            req.body.replyTo   // optional — undefined when not supplied by client
        );
        res.status(201).json({ success: true, data: comment });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/recipes/:id/comments/:commentId/replies/:replyId
// ─────────────────────────────────────────────────────────────
export const deleteReply = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const { id: userId } = requireUser(req);
        await commentService.deleteReply(
            req.params.id as string, req.params.commentId as string, req.params.replyId as string, userId
        );
        res.status(200).json({ success: true, message: "Reply deleted." });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/:id/comments/:commentId/replies/:replyId/like
// POST /api/v1/recipes/:id/comments/:commentId/replies/:replyId/dislike
// ─────────────────────────────────────────────────────────────
export const likeReply = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        await assertSocialAllowed(req.params.id as string);
        const { id: userId } = requireUser(req);
        const counts = await commentService.reactToReply(
            req.params.id as string, req.params.commentId as string, req.params.replyId as string, userId, "like"
        );
        res.status(200).json({ success: true, data: counts });
    } catch (error) { next(error); }
};

export const dislikeReply = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        await assertSocialAllowed(req.params.id as string);
        const { id: userId } = requireUser(req);
        const counts = await commentService.reactToReply(
            req.params.id as string, req.params.commentId as string, req.params.replyId as string, userId, "dislike"
        );
        res.status(200).json({ success: true, data: counts });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/:id/ratings
// Authenticated — creates or updates the user's star rating (1–5).
// ─────────────────────────────────────────────────────────────
export const upsertRating = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        await assertSocialAllowed(req.params.id as string);
        const { id: userId } = requireUser(req);
        const stats = await commentService.upsertRating(
            req.params.id as string, userId, Number(req.body.value)
        );
        res.status(200).json({ success: true, data: stats });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/recipes/:id/ratings
// ─────────────────────────────────────────────────────────────
export const deleteRating = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        await assertSocialAllowed(req.params.id as string);
        const { id: userId } = requireUser(req);
        const stats = await commentService.deleteRating(req.params.id as string, userId);
        res.status(200).json({ success: true, data: stats });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/recipes/:id/ratings/me
// ─────────────────────────────────────────────────────────────
export const getMyRating = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        await assertSocialAllowed(req.params.id as string);
        const { id: userId } = requireUser(req);
        const value = await commentService.getMyRating(req.params.id as string, userId);
        res.status(200).json({ success: true, data: { yourRating: value } });
    } catch (error) { next(error); }
};

