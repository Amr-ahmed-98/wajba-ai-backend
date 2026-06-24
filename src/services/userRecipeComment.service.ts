import mongoose, { Types } from "mongoose";
import Comment, { IComment } from "../models/comment.model.js";
import { Rating } from "../models/comment.model.js";
import UserRecipe from "../models/userRecipe.model.js";
import { ApiError } from "../utils/Apierror.js";

// ─────────────────────────────────────────────────────────────
// UserRecipe Comment & Rating Service
// Reuses the same Comment and Rating collections as curator
// recipes, but syncs stats to the UserRecipe model instead.
// ─────────────────────────────────────────────────────────────

interface PaginationMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
}

// ── Internal: assert UserRecipe exists ───────────────────────
const assertUserRecipeExists = async (id: string): Promise<void> => {
    if (!mongoose.isValidObjectId(id)) {
        throw new ApiError(400, "Invalid recipe ID.");
    }
    const exists = await UserRecipe.exists({ _id: id });
    if (!exists) throw new ApiError(404, "Recipe not found.");
};

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

// ── Sync UserRecipe rating stats ─────────────────────────────
const syncUserRecipeRatingStats = async (
    recipeId: string
): Promise<{ averageRating: number; ratingCount: number }> => {
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

    await UserRecipe.findByIdAndUpdate(recipeId, { averageRating, ratingCount });
    return { averageRating, ratingCount };
};

// ─────────────────────────────────────────────────────────────
// Comments
// ─────────────────────────────────────────────────────────────

export const addComment = async (
    recipeId: string,
    userId: string,
    authorName: string,
    authorPhoto: string | null,
    body: string
): Promise<IComment> => {
    await assertUserRecipeExists(recipeId);

    const comment = await Comment.create({
        recipe: recipeId,
        author: userId,
        authorName,
        authorPhoto: authorPhoto ?? null,
        body,
    });

    await UserRecipe.findByIdAndUpdate(recipeId, { $inc: { commentCount: 1 } });
    return comment;
};

export const getComments = async (
    recipeId: string,
    page = 1,
    limit = 10
): Promise<{ comments: IComment[]; pagination: PaginationMeta }> => {
    await assertUserRecipeExists(recipeId);
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

    const updated = await UserRecipe.findByIdAndUpdate(
        recipeId,
        { $inc: { commentCount: -1 } },
        { new: true }
    );
    if (updated && updated.commentCount < 0) {
        await UserRecipe.findByIdAndUpdate(recipeId, { commentCount: 0 });
    }
};

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

export const addReply = async (
    recipeId: string,
    commentId: string,
    userId: string,
    authorName: string,
    authorPhoto: string | null,
    body: string,
    replyTo?: string
): Promise<IComment> => {
    const comment = await assertCommentExists(commentId, recipeId);

    let replyToId: Types.ObjectId | null = null;
    let replyToName: string | null = null;

    if (replyTo) {
        if (!mongoose.isValidObjectId(replyTo)) {
            throw new ApiError(400, "Invalid replyTo ID.");
        }
        const targetReply = comment.replies.id(replyTo);
        if (!targetReply) {
            throw new ApiError(404, "The reply you are responding to was not found in this thread.");
        }
        replyToId = targetReply._id;
        replyToName = targetReply.authorName;
    }

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

    const updated = await Comment
        .findById(commentId)
        .select("-likedBy -dislikedBy -replies.likedBy -replies.dislikedBy")
        .lean();

    if (!updated) {
        const raw = comment.toObject();
        const { likedBy: _l, dislikedBy: _d, replies, ...safeTop } = raw;
        const safeReplies = replies.map(
            ({ likedBy: _rl, dislikedBy: _rd, ...safeReply }: any) => safeReply
        );
        return { ...safeTop, replies: safeReplies } as unknown as IComment;
    }

    return updated as unknown as IComment;
};

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
// Ratings
// ─────────────────────────────────────────────────────────────

export const upsertRating = async (
    recipeId: string,
    userId: string,
    value: number
): Promise<{ averageRating: number; ratingCount: number; yourRating: number }> => {
    await assertUserRecipeExists(recipeId);

    await Rating.findOneAndUpdate(
        { recipe: recipeId, user: userId },
        { value },
        { upsert: true, new: true }
    );

    const stats = await syncUserRecipeRatingStats(recipeId);
    return { ...stats, yourRating: value };
};

export const deleteRating = async (
    recipeId: string,
    userId: string
): Promise<{ averageRating: number; ratingCount: number }> => {
    await assertUserRecipeExists(recipeId);

    const existing = await Rating.findOne({ recipe: recipeId, user: userId });
    if (!existing) throw new ApiError(404, "You have not rated this recipe.");

    await existing.deleteOne();

    const stats = await syncUserRecipeRatingStats(recipeId);
    return stats;
};

export const getMyRating = async (
    recipeId: string,
    userId: string
): Promise<number | null> => {
    await assertUserRecipeExists(recipeId);
    const r = await Rating.findOne({ recipe: recipeId, user: userId });
    return r ? r.value : null;
};
