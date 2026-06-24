import { Request, Response, NextFunction } from "express";
import * as userRecipeCommentService from "../../../services/userRecipeComment.service.js";
import { ApiError } from "../../../utils/Apierror.js";

// ─────────────────────────────────────────────────────────────
// Typed helper — extract authenticated user from request.
// ─────────────────────────────────────────────────────────────
const requireUser = (req: Request): { id: string; name: string; photo: string | null } => {
    const user = (req as any).user;
    if (!user?.id) throw new ApiError(401, "Authentication required.");
    return {
        id: user.id as string,
        name: (user.name ?? "User") as string,
        photo: (user.photo ?? null) as string | null,
    };
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/user-recipes/:id/comments
// ─────────────────────────────────────────────────────────────
export const getComments = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const result = await userRecipeCommentService.getComments(
            req.params.id as string,
            req.query.page ? Number(req.query.page) : 1,
            req.query.limit ? Number(req.query.limit) : 10
        );
        res.status(200).json({ success: true, data: result.comments, pagination: result.pagination });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/user-recipes/:id/comments
// ─────────────────────────────────────────────────────────────
export const addComment = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const { id: userId, name, photo } = requireUser(req);
        const comment = await userRecipeCommentService.addComment(
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
// DELETE /api/v1/user-recipes/:id/comments/:commentId
// ─────────────────────────────────────────────────────────────
export const deleteComment = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const { id: userId } = requireUser(req);
        await userRecipeCommentService.deleteComment(
            req.params.id as string,
            req.params.commentId as string,
            userId
        );
        res.status(200).json({ success: true, message: "Comment deleted." });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/user-recipes/:id/comments/:commentId/like
// POST /api/v1/user-recipes/:id/comments/:commentId/dislike
// ─────────────────────────────────────────────────────────────
export const likeComment = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const { id: userId } = requireUser(req);
        const counts = await userRecipeCommentService.reactToComment(
            req.params.id as string, req.params.commentId as string, userId, "like"
        );
        res.status(200).json({ success: true, data: counts });
    } catch (error) { next(error); }
};

export const dislikeComment = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const { id: userId } = requireUser(req);
        const counts = await userRecipeCommentService.reactToComment(
            req.params.id as string, req.params.commentId as string, userId, "dislike"
        );
        res.status(200).json({ success: true, data: counts });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/user-recipes/:id/comments/:commentId/replies
// ─────────────────────────────────────────────────────────────
export const addReply = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const { id: userId, name, photo } = requireUser(req);
        const comment = await userRecipeCommentService.addReply(
            req.params.id as string,
            req.params.commentId as string,
            userId,
            name,
            photo,
            req.body.body,
            req.body.replyTo
        );
        res.status(201).json({ success: true, data: comment });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/user-recipes/:id/comments/:commentId/replies/:replyId
// ─────────────────────────────────────────────────────────────
export const deleteReply = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const { id: userId } = requireUser(req);
        await userRecipeCommentService.deleteReply(
            req.params.id as string, req.params.commentId as string, req.params.replyId as string, userId
        );
        res.status(200).json({ success: true, message: "Reply deleted." });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/user-recipes/:id/comments/:commentId/replies/:replyId/like
// POST /api/v1/user-recipes/:id/comments/:commentId/replies/:replyId/dislike
// ─────────────────────────────────────────────────────────────
export const likeReply = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const { id: userId } = requireUser(req);
        const counts = await userRecipeCommentService.reactToReply(
            req.params.id as string, req.params.commentId as string, req.params.replyId as string, userId, "like"
        );
        res.status(200).json({ success: true, data: counts });
    } catch (error) { next(error); }
};

export const dislikeReply = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const { id: userId } = requireUser(req);
        const counts = await userRecipeCommentService.reactToReply(
            req.params.id as string, req.params.commentId as string, req.params.replyId as string, userId, "dislike"
        );
        res.status(200).json({ success: true, data: counts });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/user-recipes/:id/ratings
// ─────────────────────────────────────────────────────────────
export const upsertRating = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const { id: userId } = requireUser(req);
        const stats = await userRecipeCommentService.upsertRating(
            req.params.id as string, userId, Number(req.body.value)
        );
        res.status(200).json({ success: true, data: stats });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/user-recipes/:id/ratings
// ─────────────────────────────────────────────────────────────
export const deleteRating = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const { id: userId } = requireUser(req);
        const stats = await userRecipeCommentService.deleteRating(req.params.id as string, userId);
        res.status(200).json({ success: true, data: stats });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/user-recipes/:id/ratings/me
// ─────────────────────────────────────────────────────────────
export const getMyRating = async (
    req: Request, res: Response, next: NextFunction
) => {
    try {
        const { id: userId } = requireUser(req);
        const value = await userRecipeCommentService.getMyRating(req.params.id as string, userId);
        res.status(200).json({ success: true, data: { yourRating: value } });
    } catch (error) { next(error); }
};
