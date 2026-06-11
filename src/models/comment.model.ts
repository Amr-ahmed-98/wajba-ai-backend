import mongoose, { Schema, Document, Types } from "mongoose";

// ─────────────────────────────────────────────────────────────
// Reply sub-document
// Each top-level comment can have an array of replies.
// Replies are stored inside the comment document (embedded) to
// avoid an extra collection hop when rendering the comment thread.
// ─────────────────────────────────────────────────────────────
export interface IReply {
    _id: Types.ObjectId;
    author: Types.ObjectId;          // ref: "User"
    authorName: string;              // snapshot at write time
    authorPhoto: string | null;      // snapshot at write time — null until profile photos land
    body: string;
    likes: number;
    dislikes: number;
    likedBy: string[];               // user IDs — dedup; select: false
    dislikedBy: string[];            // user IDs — dedup; select: false
    createdAt: Date;
    updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────
// Top-level Comment document
// ─────────────────────────────────────────────────────────────
export interface IComment extends Document {
    recipe: Types.ObjectId;          // ref: "Recipe"
    author: Types.ObjectId;          // ref: "User"
    authorName: string;              // snapshot at write time
    authorPhoto: string | null;      // snapshot at write time — null until profile photos land
    body: string;
    likes: number;
    dislikes: number;
    likedBy: string[];               // select: false
    dislikedBy: string[];            // select: false
    replies: Types.DocumentArray<IReply>;
    createdAt: Date;
    updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────
// Reply schema (embedded — no separate collection)
// ─────────────────────────────────────────────────────────────
const replySchema = new Schema<IReply>(
    {
        author: { type: Schema.Types.ObjectId, ref: "User", required: true },
        authorName: { type: String, required: true },
        authorPhoto: { type: String, default: null },   // populated once profile photos land
        body: { type: String, required: true, trim: true, maxlength: 1000 },
        likes: { type: Number, default: 0 },
        dislikes: { type: Number, default: 0 },
        likedBy: { type: [String], default: [], select: false },
        dislikedBy: { type: [String], default: [], select: false },
    },
    { timestamps: true }
);

// ─────────────────────────────────────────────────────────────
// Comment schema
// ─────────────────────────────────────────────────────────────
const commentSchema = new Schema<IComment>(
    {
        // FIX: removed `index: true` from the recipe field — the compound
        // index below (recipe + createdAt) already has `recipe` as its
        // leading key, so a standalone single-field index on `recipe` is
        // redundant and adds unnecessary write overhead to every insert/delete.
        recipe: { type: Schema.Types.ObjectId, ref: "Recipe", required: true },
        author: { type: Schema.Types.ObjectId, ref: "User", required: true },
        authorName: { type: String, required: true },
        authorPhoto: { type: String, default: null },   // populated once profile photos land
        body: { type: String, required: true, trim: true, maxlength: 2000 },
        likes: { type: Number, default: 0 },
        dislikes: { type: Number, default: 0 },
        likedBy: { type: [String], default: [], select: false },
        dislikedBy: { type: [String], default: [], select: false },
        replies: { type: [replySchema], default: [] },
    },
    { timestamps: true }
);

// Compound index: covers "all comments for a recipe sorted by newest".
// The recipe field alone is already covered by this index as the leading key,
// so no separate single-field index on recipe is needed.
commentSchema.index({ recipe: 1, createdAt: -1 });

export default mongoose.model<IComment>("Comment", commentSchema);


// ─────────────────────────────────────────────────────────────
// Rating document
// One document per (user, recipe) pair — enforced by a unique
// compound index. Upserting on that pair is the write pattern.
//
// Rating range: 1–5 stars (integers only).
// "0 stars" is not stored — to undo a rating the client calls
// DELETE /api/v1/recipes/:id/ratings, which removes the document
// and triggers a full recalculation of the recipe's averageRating
// and ratingCount. Rating and commenting are fully independent:
// a user may rate without leaving a comment and vice-versa.
// ─────────────────────────────────────────────────────────────
export interface IRating extends Document {
    recipe: Types.ObjectId;
    user: Types.ObjectId;
    value: number;      // 1–5 integers only; use DELETE /ratings to remove
    createdAt: Date;
    updatedAt: Date;
}

const ratingSchema = new Schema<IRating>(
    {
        recipe: { type: Schema.Types.ObjectId, ref: "Recipe", required: true },
        user: { type: Schema.Types.ObjectId, ref: "User", required: true },
        value: { type: Number, required: true, min: 1, max: 5 },
    },
    { timestamps: true }
);

// One rating per (user, recipe) pair
ratingSchema.index({ recipe: 1, user: 1 }, { unique: true });

export const Rating = mongoose.model<IRating>("Rating", ratingSchema);