import mongoose, { Types } from "mongoose";
import Comment, { IComment } from "../models/comment.model.js";
import { Rating } from "../models/comment.model.js";
import Recipe from "../models/recipe.model.js";
import { ApiError } from "../utils/Apierror.js";

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
const assertRecipeExists = async (recipeId: string): Promise<void> => {
    // FIX: guard before constructing ObjectId — an invalid ID would throw
    // an ugly CastError inside the aggregation instead of a clean 400.
    if (!mongoose.isValidObjectId(recipeId)) {
        throw new ApiError(400, "Invalid recipe ID.");
    }
    const exists = await Recipe.exists({ _id: recipeId });
    if (!exists) throw new ApiError(404, "Recipe not found.");
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
    recipeId: string
): Promise<{ averageRating: number; ratingCount: number }> => {
    // assertRecipeExists already validated the ID before reaching here,
    // but guard again defensively in case this helper is called directly.
    if (!mongoose.isValidObjectId(recipeId)) {
        throw new ApiError(400, "Invalid recipe ID.");
    }

    const [stats] = await Rating.aggregate([
        { $match: { recipe: new Types.ObjectId(recipeId) } },
        {
            $group: {
                _id: null,
                avg: { $avg: "$value" },
                count: { $sum: 1 },
            },
        },
    ]);

    const averageRating = stats ? Math.round(stats.avg * 10) / 10 : 0;
    const ratingCount = stats ? stats.count : 0;

    await Recipe.findByIdAndUpdate(recipeId, { averageRating, ratingCount });

    return { averageRating, ratingCount };
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/:id/comments
// Commenting and rating are independent — a user can rate without
// commenting and can comment without rating.
// ─────────────────────────────────────────────────────────────
export const addComment = async (
    recipeId: string,
    userId: string,
    authorName: string,
    authorPhoto: string | null,
    body: string
): Promise<IComment> => {
    await assertRecipeExists(recipeId);

    const comment = await Comment.create({
        recipe: recipeId,
        author: userId,
        authorName,
        authorPhoto: authorPhoto ?? null,
        body,
    });

    await Recipe.findByIdAndUpdate(recipeId, { $inc: { commentCount: 1 } });

    return comment;
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/recipes/:id/comments
// Public — no auth required. Returns paginated top-level comments
// with their replies embedded. Each comment and reply includes the
// author's name and photo (null until the profile-photo feature lands).
// likedBy / dislikedBy are excluded; only the integer counts are visible.
// ─────────────────────────────────────────────────────────────
// export const getComments = async (
//     recipeId: string,
//     page = 1,
//     limit = 10
// ): Promise<{ comments: IComment[]; pagination: PaginationMeta }> => {
//     await assertRecipeExists(recipeId);

//     const skip = (page - 1) * limit;
//     const total = await Comment.countDocuments({ recipe: recipeId });

//     // likedBy / dislikedBy are already select:false at schema level so they
//     // are never returned. The explicit negation below is a belt-and-suspenders
//     // guard in case schema defaults are ever changed, and also covers the
//     // reply sub-document arrays which are only select:false within their schema.
//     const comments = await Comment
//         .find({ recipe: recipeId })
//         .select("-likedBy -dislikedBy -replies.likedBy -replies.dislikedBy")
//         .sort({ createdAt: -1 })
//         .skip(skip)
//         .limit(limit)
//         .lean();

//     return {
//         comments: comments as unknown as IComment[],
//         pagination: {
//             total,
//             page,
//             limit,
//             totalPages: Math.ceil(total / limit),
//             hasNextPage: skip + comments.length < total,
//         },
//     };
// };

export const getComments = async (
    recipeId: string,
    page = 1,
    limit = 10
): Promise<{ comments: IComment[]; pagination: PaginationMeta }> => {
    await assertRecipeExists(recipeId);
    const skip = (page - 1) * limit;
    const total = await Comment.countDocuments({ recipe: recipeId });
    const comments = await Comment
        .find({ recipe: recipeId })
        .populate([
            {
                path: "author",
                select: "name photo" // Fetches the latest name and photo from the User collection
            },
            {
                path: "replies.author",
                select: "name photo" // Fetches the latest name and photo for reply authors
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
    const comment = await assertCommentExists(commentId, recipeId);

    if (comment.author.toString() !== userId) {
        throw new ApiError(403, "You can only delete your own comments.");
    }

    await comment.deleteOne();

    // FIX: decrement with $inc, then clamp to 0 in a second query if needed.
    // (Previously used the aggregation-pipeline update form — `update` as an
    // array — which requires MongoDB 4.2+. On servers/drivers that don't
    // support it, Mongo throws here AFTER comment.deleteOne() already
    // succeeded, so the comment was really deleted but the request still
    // came back as a 500. This two-step $inc + clamp form works on every
    // MongoDB version and gives the same "never below 0" guarantee.)
    const updated = await Recipe.findByIdAndUpdate(
        recipeId,
        { $inc: { commentCount: -1 } },
        { new: true }
    );
    if (updated && updated.commentCount < 0) {
        await Recipe.findByIdAndUpdate(recipeId, { commentCount: 0 });
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
    // Fetch with hidden arrays so we can check membership.
    const comment = await Comment
        .findOne({ _id: commentId, recipe: recipeId })
        .select("+likedBy +dislikedBy");

    if (!comment) throw new ApiError(404, "Comment not found.");

    const alreadyLiked = comment.likedBy.includes(userId);
    const alreadyDisliked = comment.dislikedBy.includes(userId);

    if (reaction === "like") {
        if (alreadyLiked) {
            // Undo like
            comment.likedBy = comment.likedBy.filter((id) => id !== userId);
            comment.likes = Math.max(0, comment.likes - 1);
        } else {
            // Add like; remove dislike if present
            comment.likedBy.push(userId);
            comment.likes += 1;
            if (alreadyDisliked) {
                comment.dislikedBy = comment.dislikedBy.filter((id) => id !== userId);
                comment.dislikes = Math.max(0, comment.dislikes - 1);
            }
        }
    } else {
        if (alreadyDisliked) {
            // Undo dislike
            comment.dislikedBy = comment.dislikedBy.filter((id) => id !== userId);
            comment.dislikes = Math.max(0, comment.dislikes - 1);
        } else {
            // Add dislike; remove like if present
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
// ─────────────────────────────────────────────────────────────
export const addReply = async (
    recipeId: string,
    commentId: string,
    userId: string,
    authorName: string,
    authorPhoto: string | null,
    body: string
): Promise<IComment> => {
    const comment = await assertCommentExists(commentId, recipeId);

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
        // FIX: strip hidden arrays from BOTH the top-level comment AND from
        // every reply sub-document before returning the in-memory fallback.
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
//
// Rating (1–5 stars) and commenting are fully independent.
// A user can rate without leaving any comment.
// To remove a rating use DELETE /api/v1/recipes/:id/ratings.
// ─────────────────────────────────────────────────────────────
export const upsertRating = async (
    recipeId: string,
    userId: string,
    value: number
): Promise<{ averageRating: number; ratingCount: number; yourRating: number }> => {
    await assertRecipeExists(recipeId);

    await Rating.findOneAndUpdate(
        { recipe: recipeId, user: userId },
        { value },
        { upsert: true, new: true }
    );

    const stats = await syncRecipeRatingStats(recipeId);
    return { ...stats, yourRating: value };
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/recipes/:id/ratings
// Removes the authenticated user's rating for this recipe.
// This is the "undo rating / 0 stars" action. After deletion the
// recipe stats are recomputed so averageRating and ratingCount stay accurate.
// ─────────────────────────────────────────────────────────────
export const deleteRating = async (
    recipeId: string,
    userId: string
): Promise<{ averageRating: number; ratingCount: number }> => {
    await assertRecipeExists(recipeId);

    const existing = await Rating.findOne({ recipe: recipeId, user: userId });
    if (!existing) throw new ApiError(404, "You have not rated this recipe.");

    await existing.deleteOne();

    const stats = await syncRecipeRatingStats(recipeId);
    return stats;
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