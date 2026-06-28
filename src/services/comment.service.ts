import mongoose, { Types } from "mongoose";
import Comment, { IComment } from "../models/comment.model.js";
import { Rating } from "../models/comment.model.js";
import Recipe from "../models/recipe.model.js";
import { ApiError } from "../utils/Apierror.js";
import UserRecipe from "../models/userRecipe.model.js";
import { resolveRecipeSource, RecipeSource } from "./unified.service.js";

// ─────────────────────────────────────────────────────────────
// Pagination helper (shared shape)
// ─────────────────────────────────────────────────────────────
interface PaginationMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
}

// ─────────────────────────────────────────────────────────────
// Internal helper — assert recipe exists
// Throws 404 so callers don't need to repeat the check.
// ─────────────────────────────────────────────────────────────
const assertRecipeExists = async (recipeId: string): Promise<RecipeSource> => {
    const { source } = await resolveRecipeSource(recipeId); // throws 400/404
    return source;
};

// ─────────────────────────────────────────────────────────────
// Internal helper — assert comment exists and belongs to recipe
// ─────────────────────────────────────────────────────────────
const assertCommentExists = async (
    commentId: string,
    recipeId: string
): Promise<IComment> => {
    if (!mongoose.isValidObjectId(commentId)) {
        throw new ApiError(400, "Invalid comment ID.");
    }
    const comment = await Comment.findOne({ _id: commentId, recipe: recipeId });
    if (!comment) throw new ApiError(404, "Comment not found.");
    return comment;
};

// ─────────────────────────────────────────────────────────────
// Internal helper — recompute and persist recipe rating stats
// Called after every rating write or delete to keep the recipe
// document accurate without drift.
// ─────────────────────────────────────────────────────────────
const syncRecipeRatingStats = async (
    recipeId: string,
    source: RecipeSource
): Promise<{ averageRating: number; ratingCount: number }> => {
    const [stats] = await Rating.aggregate([
        { $match: { recipe: new Types.ObjectId(recipeId) } },
        { $group: { _id: null, avg: { $avg: "$value" }, count: { $sum: 1 } } },
    ]);

    const averageRating = stats ? Math.round(stats.avg * 10) / 10 : 0;
    const ratingCount = stats ? stats.count : 0;

    if (source === "curator") {
        await Recipe.findByIdAndUpdate(recipeId, { averageRating, ratingCount });
    } else {
        await UserRecipe.findByIdAndUpdate(recipeId, { averageRating, ratingCount });
    }

    return { averageRating, ratingCount };
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/:id/comments
// ─────────────────────────────────────────────────────────────
export const addComment = async (
    recipeId: string,
    userId: string,
    authorName: string,
    authorPhoto: string | null,
    body: string
): Promise<IComment> => {
    const source = await assertRecipeExists(recipeId);
    const comment = await Comment.create({ recipe: recipeId, author: userId, authorName, authorPhoto: authorPhoto ?? null, body });
    if (source === "curator") {
        await Recipe.findByIdAndUpdate(recipeId, { $inc: { commentCount: 1 } });
    } else {
        await UserRecipe.findByIdAndUpdate(recipeId, { $inc: { commentCount: 1 } });
    }
    return comment;
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/recipes/:id/comments
// Public — no auth required. Returns paginated top-level comments
// with their replies embedded. Each comment and reply includes the
// author's name and photo (null until the profile-photo feature lands).
// likedBy / dislikedBy are excluded; only the integer counts are visible.
// ─────────────────────────────────────────────────────────────
export const getComments = async (
    recipeId: string,
    page = 1,
    limit = 10
) => {
    await assertRecipeExists(recipeId);
    const skip = (page - 1) * limit;
    const total = await Comment.countDocuments({ recipe: recipeId });
    const comments = await Comment
        .find({ recipe: recipeId })
        .populate([
            {
                path: "author",
                select: "name photo"
            },
            {
                path: "replies.author",
                select: "name photo"
            }
        ])
        .select("-likedBy -dislikedBy -replies.likedBy -replies.dislikedBy")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
    return {
        comments: comments as unknown as IComment[],
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: skip + comments.length < total,
        },
    };
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/recipes/:id/comments/:commentId
// Only the comment author can delete their own comment.
// ─────────────────────────────────────────────────────────────
export const deleteComment = async (
    recipeId: string,
    commentId: string,
    userId: string
): Promise<void> => {
    const source = await assertRecipeExists(recipeId);
    const comment = await assertCommentExists(commentId, recipeId);

    if (comment.author.toString() !== userId) {
        throw new ApiError(403, "You can only delete your own comments.");
    }

    await comment.deleteOne();

    if (source === "curator") {
        const updated = await Recipe.findByIdAndUpdate(
            recipeId, { $inc: { commentCount: -1 } }, { new: true }
        );
        if (updated && updated.commentCount < 0) {
            await Recipe.findByIdAndUpdate(recipeId, { commentCount: 0 });
        }
    } else {
        const updated = await UserRecipe.findByIdAndUpdate(
            recipeId, { $inc: { commentCount: -1 } }, { new: true }
        );
        if (updated && updated.commentCount < 0) {
            await UserRecipe.findByIdAndUpdate(recipeId, { commentCount: 0 });
        }
    }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/:id/comments/:commentId/like
// POST /api/v1/recipes/:id/comments/:commentId/dislike
//
// Toggle logic:
//   - If the user already has this reaction → remove it (undo)
//   - If the user has the opposite reaction → switch
//   - Otherwise → add the new reaction
// ─────────────────────────────────────────────────────────────
export const reactToComment = async (
    recipeId: string,
    commentId: string,
    userId: string,
    reaction: "like" | "dislike"
): Promise<{ likes: number; dislikes: number }> => {
    const comment = await Comment
        .findOne({ _id: commentId, recipe: recipeId })
        .select("+likedBy +dislikedBy");

    if (!comment) throw new ApiError(404, "Comment not found.");

    const alreadyLiked = comment.likedBy.includes(userId);
    const alreadyDisliked = comment.dislikedBy.includes(userId);

    if (reaction === "like") {
        if (alreadyLiked) {
            comment.likedBy = comment.likedBy.filter((id) => id !== userId);
            comment.likes = Math.max(0, comment.likes - 1);
        } else {
            comment.likedBy.push(userId);
            comment.likes += 1;
            if (alreadyDisliked) {
                comment.dislikedBy = comment.dislikedBy.filter((id) => id !== userId);
                comment.dislikes = Math.max(0, comment.dislikes - 1);
            }
        }
    } else {
        if (alreadyDisliked) {
            comment.dislikedBy = comment.dislikedBy.filter((id) => id !== userId);
            comment.dislikes = Math.max(0, comment.dislikes - 1);
        } else {
            comment.dislikedBy.push(userId);
            comment.dislikes += 1;
            if (alreadyLiked) {
                comment.likedBy = comment.likedBy.filter((id) => id !== userId);
                comment.likes = Math.max(0, comment.likes - 1);
            }
        }
    }

    await comment.save();
    return { likes: comment.likes, dislikes: comment.dislikes };
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/:id/comments/:commentId/replies
//
// Threading model — flat array + optional replyTo pointer:
//
//   All replies (whether direct or reply-to-reply) are pushed into
//   the same flat `comment.replies` array. A reply that responds to
//   another reply carries two extra fields:
//
//     replyTo     — ObjectId of the target reply in this same array.
//     replyToName — Author name of the target reply, snapshotted at
//                   write time. This preserves the "@mention" even if
//                   the target reply is later deleted.
//
//   If `replyTo` is omitted (or null) the new reply is treated as a
//   direct reply to the top-level comment — the existing behaviour.
//
//   Why not recursive sub-arrays?
//     MongoDB has no recursive query support; unbounded nesting would
//     make every read progressively more expensive and could blow past
//     the 16 MB document limit for very active threads. A flat array
//     with a parent pointer is O(1) for appends and keeps the comment
//     document bounded.
// ─────────────────────────────────────────────────────────────
export const addReply = async (
    recipeId: string,
    commentId: string,
    userId: string,
    authorName: string,
    authorPhoto: string | null,
    body: string,
    replyTo?: string   // optional: ObjectId of another reply in this thread
): Promise<IComment> => {
    const comment = await assertCommentExists(commentId, recipeId);

    // ── Resolve the replyTo target ────────────────────────────
    let replyToId: Types.ObjectId | null = null;
    let replyToName: string | null = null;

    if (replyTo) {
        if (!mongoose.isValidObjectId(replyTo)) {
            throw new ApiError(400, "Invalid replyTo ID.");
        }
        // The target must be a reply already in THIS comment's thread —
        // not a reply from a different comment or a fabricated ID.
        const targetReply = comment.replies.id(replyTo);
        if (!targetReply) {
            throw new ApiError(404, "The reply you are responding to was not found in this thread.");
        }
        replyToId = targetReply._id;
        // Snapshot the target author's name so "@mention" survives deletion.
        replyToName = targetReply.authorName;
    }

    // ── Push the new reply ────────────────────────────────────
    comment.replies.push({
        _id: new Types.ObjectId(),
        author: new Types.ObjectId(userId),
        authorName,
        authorPhoto: authorPhoto ?? null,
        body,
        likes: 0,
        dislikes: 0,
        likedBy: [],
        dislikedBy: [],
        replyTo: replyToId,
        replyToName,
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    await comment.save();

    // Re-fetch so the response is the canonical DB state (correct _ids,
    // timestamps, etc.) with all hidden arrays excluded.
    const updated = await Comment
        .findById(commentId)
        .select("-likedBy -dislikedBy -replies.likedBy -replies.dislikedBy")
        .lean();

    if (!updated) {
        // Extremely rare: comment deleted between save() and findById().
        // Strip hidden arrays from both top-level and every reply sub-doc.
        const raw = comment.toObject();
        const { likedBy: _l, dislikedBy: _d, replies, ...safeTop } = raw;
        const safeReplies = replies.map(
            ({ likedBy: _rl, dislikedBy: _rd, ...safeReply }: any) => safeReply
        );
        return { ...safeTop, replies: safeReplies } as unknown as IComment;
    }

    return updated as unknown as IComment;
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/recipes/:id/comments/:commentId/replies/:replyId
// Only the reply author can delete their own reply.
//
// Note on threading: deleting a reply does NOT cascade-delete its
// children. Child replies retain their `replyTo` ObjectId and
// `replyToName` snapshot, so the UI can still show "@username" even
// after the parent reply is gone. This mirrors how Twitter/YouTube
// handle deleted replies in a thread.
// ─────────────────────────────────────────────────────────────
export const deleteReply = async (
    recipeId: string,
    commentId: string,
    replyId: string,
    userId: string
): Promise<void> => {
    if (!mongoose.isValidObjectId(replyId)) {
        throw new ApiError(400, "Invalid reply ID.");
    }

    const comment = await assertCommentExists(commentId, recipeId);
    const reply = comment.replies.id(replyId);

    if (!reply) throw new ApiError(404, "Reply not found.");
    if (reply.author.toString() !== userId) {
        throw new ApiError(403, "You can only delete your own replies.");
    }

    reply.deleteOne();
    await comment.save();
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/:id/comments/:commentId/replies/:replyId/like
// POST /api/v1/recipes/:id/comments/:commentId/replies/:replyId/dislike
//
// Same toggle logic as reactToComment but targets a reply sub-doc.
// ─────────────────────────────────────────────────────────────
export const reactToReply = async (
    recipeId: string,
    commentId: string,
    replyId: string,
    userId: string,
    reaction: "like" | "dislike"
): Promise<{ likes: number; dislikes: number }> => {
    if (!mongoose.isValidObjectId(replyId)) {
        throw new ApiError(400, "Invalid reply ID.");
    }

    // FIX: Must opt-in to BOTH the top-level hidden arrays AND the reply
    // sub-document arrays. Without "+likedBy +dislikedBy" on the parent,
    // Mongoose's field-selection merging can strip the reply arrays even
    // when "+replies.likedBy +replies.dislikedBy" is specified, because
    // the parent exclusion takes precedence in lean/hydration logic.
    const comment = await Comment
        .findOne({ _id: commentId, recipe: recipeId })
        .select("+likedBy +dislikedBy +replies.likedBy +replies.dislikedBy");

    if (!comment) throw new ApiError(404, "Comment not found.");

    const reply = comment.replies.id(replyId);
    if (!reply) throw new ApiError(404, "Reply not found.");

    const alreadyLiked = reply.likedBy.includes(userId);
    const alreadyDisliked = reply.dislikedBy.includes(userId);

    if (reaction === "like") {
        if (alreadyLiked) {
            reply.likedBy = reply.likedBy.filter((id) => id !== userId);
            reply.likes = Math.max(0, reply.likes - 1);
        } else {
            reply.likedBy.push(userId);
            reply.likes += 1;
            if (alreadyDisliked) {
                reply.dislikedBy = reply.dislikedBy.filter((id) => id !== userId);
                reply.dislikes = Math.max(0, reply.dislikes - 1);
            }
        }
    } else {
        if (alreadyDisliked) {
            reply.dislikedBy = reply.dislikedBy.filter((id) => id !== userId);
            reply.dislikes = Math.max(0, reply.dislikes - 1);
        } else {
            reply.dislikedBy.push(userId);
            reply.dislikes += 1;
            if (alreadyLiked) {
                reply.likedBy = reply.likedBy.filter((id) => id !== userId);
                reply.likes = Math.max(0, reply.likes - 1);
            }
        }
    }

    await comment.save();
    return { likes: reply.likes, dislikes: reply.dislikes };
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/:id/ratings
// Upsert — one rating per (user, recipe). Uses findOneAndUpdate
// with upsert:true to avoid the race condition that a plain
// find + create approach has when two requests arrive simultaneously.
// ─────────────────────────────────────────────────────────────
export const upsertRating = async (
    recipeId: string,
    userId: string,
    value: number
): Promise<{ averageRating: number; ratingCount: number; yourRating: number }> => {
    const source = await assertRecipeExists(recipeId);
    await Rating.findOneAndUpdate(
        { recipe: recipeId, user: userId }, { value }, { upsert: true, new: true }
    );
    const stats = await syncRecipeRatingStats(recipeId, source);
    return { ...stats, yourRating: value };
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/recipes/:id/ratings
// Removes the authenticated user's rating for this recipe.
// ─────────────────────────────────────────────────────────────
export const deleteRating = async (
    recipeId: string,
    userId: string
): Promise<{ averageRating: number; ratingCount: number }> => {
    const source = await assertRecipeExists(recipeId);
    const existing = await Rating.findOne({ recipe: recipeId, user: userId });
    if (!existing) throw new ApiError(404, "You have not rated this recipe.");
    await existing.deleteOne();
    return syncRecipeRatingStats(recipeId, source);
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/recipes/:id/ratings/me
// Returns the authenticated user's rating for this recipe,
// or null if they have not rated it yet.
// ─────────────────────────────────────────────────────────────
export const getMyRating = async (
    recipeId: string,
    userId: string
): Promise<number | null> => {
    await assertRecipeExists(recipeId);
    const r = await Rating.findOne({ recipe: recipeId, user: userId });
    return r ? r.value : null;
};