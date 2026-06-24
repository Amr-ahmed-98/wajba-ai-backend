import { Router } from "express";
import validate from "../../../middlewares/validate.middleware.js";
import { authenticate } from "../../../middlewares/Auth.middleware.js";
import * as userRecipeCommentController from "./user-recipe-comment.controller.js";
import {
    getCommentsSchema,
    addCommentSchema,
    deleteCommentSchema,
    reactToCommentSchema,
    addReplySchema,
    deleteReplySchema,
    reactToReplySchema,
    upsertRatingSchema,
    getMyRatingSchema,
    deleteRatingSchema,
} from "./user-recipe-comment.validation.js";

// mergeParams: true is REQUIRED — this router is mounted under
// /api/v1/user-recipes/:id and needs access to the `:id` param
// from the parent router (app.ts: app.use("/api/v1/user-recipes/:id", ...)).
const router = Router({ mergeParams: true });

// ═══════════════════════════════════════════════════════════════
// RATINGS
// All routes share the parent path param :id (the UserRecipe ID).
// ═══════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/user-recipes/{id}/ratings/me:
 *   get:
 *     summary: Get the authenticated user's own rating for a recipe
 *     tags: [User Recipes — Ratings]
 *     description: >
 *       Returns the star value (1–5) the current user has previously submitted
 *       for this recipe, or null if they have not rated it yet.
 *       Useful for pre-filling a star-rating UI component.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the UserRecipe.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *     responses:
 *       200:
 *         description: User's rating value returned (null if not yet rated).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     yourRating:
 *                       type: integer
 *                       nullable: true
 *                       minimum: 1
 *                       maximum: 5
 *                       example: 4
 *       401:
 *         description: Missing or invalid Bearer token.
 *       404:
 *         description: No recipe found with the given id.
 */
router.get(
    "/ratings/me",
    authenticate,
    validate(getMyRatingSchema),
    userRecipeCommentController.getMyRating
);

// ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/ratings:
 *   post:
 *     summary: Submit or update a star rating for a recipe (upsert)
 *     tags: [User Recipes — Ratings]
 *     description: >
 *       Creates a new rating or updates the existing one for the current user
 *       (one rating per user per recipe, enforced by a unique index).
 *       After saving, recalculates and updates `averageRating` and `ratingCount`
 *       on the parent UserRecipe document via aggregation.
 *
 *       To remove a rating entirely, use DELETE /ratings instead.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the UserRecipe to rate.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - value
 *             properties:
 *               value:
 *                 type: integer
 *                 description: >
 *                   REQUIRED. Star rating to submit. Must be a whole number between 1 and 5.
 *                   Fractional values (e.g. 3.5) are rejected with 400.
 *                 minimum: 1
 *                 maximum: 5
 *                 example: 4
 *
 *     responses:
 *       200:
 *         description: Rating saved. Updated stats and the submitted value returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     averageRating:
 *                       type: number
 *                       description: Recalculated average across all raters (rounded to 1 decimal).
 *                       example: 4.2
 *                     ratingCount:
 *                       type: integer
 *                       description: Total number of distinct raters.
 *                       example: 37
 *                     yourRating:
 *                       type: integer
 *                       description: The value just submitted.
 *                       example: 4
 *       400:
 *         description: value is missing, not an integer, or outside 1–5.
 *       401:
 *         description: Missing or invalid Bearer token.
 *       404:
 *         description: No recipe found with the given id.
 */
router.post(
    "/ratings",
    authenticate,
    validate(upsertRatingSchema),
    userRecipeCommentController.upsertRating
);

// ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/ratings:
 *   delete:
 *     summary: Remove the authenticated user's rating from a recipe
 *     tags: [User Recipes — Ratings]
 *     description: >
 *       Deletes the current user's Rating document for this recipe, then
 *       recalculates `averageRating` and `ratingCount` on the parent
 *       UserRecipe document. Returns 404 if the user has not yet rated.
 *       No request body is needed.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the UserRecipe.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *     responses:
 *       200:
 *         description: Rating deleted. Updated aggregate stats returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     averageRating: { type: number, example: 4.1 }
 *                     ratingCount: { type: integer, example: 36 }
 *       401:
 *         description: Missing or invalid Bearer token.
 *       404:
 *         description: Recipe not found, or you have not rated this recipe yet.
 */
router.delete(
    "/ratings",
    authenticate,
    validate(deleteRatingSchema),
    userRecipeCommentController.deleteRating
);

// ═══════════════════════════════════════════════════════════════
// COMMENTS
// ═══════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/user-recipes/{id}/comments:
 *   get:
 *     summary: List top-level comments for a recipe (paginated)
 *     tags: [User Recipes — Comments]
 *     description: >
 *       Public endpoint — no authentication required.
 *       Returns top-level comments sorted by newest first.
 *       Each comment includes its embedded replies array.
 *       likedBy / dislikedBy arrays are excluded from the response for privacy.
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the UserRecipe.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *       - in: query
 *         name: page
 *         description: OPTIONAL. Page number (1-indexed).
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *
 *       - in: query
 *         name: limit
 *         description: OPTIONAL. Comments per page (max 50).
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *
 *     responses:
 *       200:
 *         description: Paginated comment list returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id: { type: string }
 *                       author: { type: object, description: "Populated: { name, photo }" }
 *                       authorName: { type: string }
 *                       authorPhoto: { type: string, nullable: true }
 *                       body: { type: string }
 *                       likes: { type: integer }
 *                       dislikes: { type: integer }
 *                       replies: { type: array, items: { type: object } }
 *                       createdAt: { type: string, format: date-time }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total: { type: integer }
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     totalPages: { type: integer }
 *                     hasNextPage: { type: boolean }
 *       404:
 *         description: No recipe found with the given id.
 */
router.get(
    "/comments",
    validate(getCommentsSchema),
    userRecipeCommentController.getComments
);

// ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/comments:
 *   post:
 *     summary: Add a top-level comment to a recipe
 *     tags: [User Recipes — Comments]
 *     description: >
 *       Creates a new top-level comment on a recipe and increments
 *       `commentCount` on the parent UserRecipe document.
 *       The author's name and photo are snapshotted at write time so
 *       the comment remains readable even if the user later changes their profile.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the UserRecipe to comment on.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - body
 *             properties:
 *               body:
 *                 type: string
 *                 description: >
 *                   REQUIRED. The comment text. Cannot be empty or whitespace-only.
 *                   Maximum length: 2000 characters.
 *                 minLength: 1
 *                 maxLength: 2000
 *                 example: "Made this last night — incredible flavour! I added a pinch of sumac."
 *
 *     responses:
 *       201:
 *         description: Comment created. Full comment document returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: object, description: "Newly created Comment document." }
 *       400:
 *         description: body is empty, too long, or missing.
 *       401:
 *         description: Missing or invalid Bearer token.
 *       404:
 *         description: No recipe found with the given id.
 */
router.post(
    "/comments",
    authenticate,
    validate(addCommentSchema),
    userRecipeCommentController.addComment
);

// ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/comments/{commentId}:
 *   delete:
 *     summary: Delete a top-level comment (author only)
 *     tags: [User Recipes — Comments]
 *     description: >
 *       Hard-deletes the comment document (including all its embedded replies).
 *       Also decrements `commentCount` on the parent UserRecipe.
 *       Only the comment author can delete it.
 *       No request body is needed.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the parent UserRecipe.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *       - in: path
 *         name: commentId
 *         description: REQUIRED. MongoDB ObjectId of the Comment to delete.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6673b2c5d4e56f0023bcdef0"
 *
 *     responses:
 *       200:
 *         description: Comment deleted.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Comment deleted." }
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: You are not the author of this comment.
 *       404:
 *         description: Recipe or comment not found.
 */
router.delete(
    "/comments/:commentId",
    authenticate,
    validate(deleteCommentSchema),
    userRecipeCommentController.deleteComment
);

// ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/comments/{commentId}/like:
 *   post:
 *     summary: Like a comment (toggle)
 *     tags: [User Recipes — Comments]
 *     description: >
 *       Toggles a like on the specified comment.
 *       Liking a comment you already liked removes the like.
 *       Liking a comment you previously disliked removes the dislike first.
 *       No request body is needed.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the parent UserRecipe.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *       - in: path
 *         name: commentId
 *         description: REQUIRED. MongoDB ObjectId of the Comment to like.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6673b2c5d4e56f0023bcdef0"
 *
 *     responses:
 *       200:
 *         description: Updated like/dislike counts for the comment.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     likes: { type: integer, example: 8 }
 *                     dislikes: { type: integer, example: 1 }
 *       401:
 *         description: Missing or invalid Bearer token.
 *       404:
 *         description: Recipe or comment not found.
 */
router.post(
    "/comments/:commentId/like",
    authenticate,
    validate(reactToCommentSchema),
    userRecipeCommentController.likeComment
);

// ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/comments/{commentId}/dislike:
 *   post:
 *     summary: Dislike a comment (toggle)
 *     tags: [User Recipes — Comments]
 *     description: >
 *       Toggles a dislike on the specified comment.
 *       Disliking a comment you already disliked removes the dislike.
 *       Disliking a comment you previously liked removes the like first.
 *       No request body is needed.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the parent UserRecipe.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *       - in: path
 *         name: commentId
 *         description: REQUIRED. MongoDB ObjectId of the Comment to dislike.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6673b2c5d4e56f0023bcdef0"
 *
 *     responses:
 *       200:
 *         description: Updated like/dislike counts for the comment.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     likes: { type: integer, example: 8 }
 *                     dislikes: { type: integer, example: 2 }
 *       401:
 *         description: Missing or invalid Bearer token.
 *       404:
 *         description: Recipe or comment not found.
 */
router.post(
    "/comments/:commentId/dislike",
    authenticate,
    validate(reactToCommentSchema),
    userRecipeCommentController.dislikeComment
);

// ═══════════════════════════════════════════════════════════════
// REPLIES
// Replies are embedded inside the Comment document (flat array).
// Threading: a reply can optionally reference another reply via
// `replyTo` (ObjectId) — the server snapshots the target author's
// name as `replyToName` for persistent @mention display.
// ═══════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/user-recipes/{id}/comments/{commentId}/replies:
 *   post:
 *     summary: Add a reply to a comment (or to another reply)
 *     tags: [User Recipes — Replies]
 *     description: >
 *       Appends a reply to the flat `replies` array inside the Comment document.
 *
 *       Threading model (flat, not recursive):
 *         - A direct reply to the comment: omit `replyTo`.
 *         - A reply to another reply: send `replyTo` with that reply's ObjectId.
 *           The server resolves the target reply's author name and stores it as
 *           `replyToName` — this "@mention" is preserved even if the target reply
 *           is later deleted.
 *
 *       The comment's full updated document (including all replies, minus
 *       likedBy/dislikedBy arrays) is returned so the client can re-render
 *       the thread in one go.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the parent UserRecipe.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *       - in: path
 *         name: commentId
 *         description: REQUIRED. MongoDB ObjectId of the Comment to reply to.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6673b2c5d4e56f0023bcdef0"
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - body
 *             properties:
 *               body:
 *                 type: string
 *                 description: >
 *                   REQUIRED. The reply text. Cannot be empty or whitespace-only.
 *                   Maximum length: 1000 characters.
 *                 minLength: 1
 *                 maxLength: 1000
 *                 example: "Totally agree! I also used sumac and it was amazing."
 *
 *               replyTo:
 *                 type: string
 *                 description: >
 *                   OPTIONAL. ObjectId of the specific reply inside this comment
 *                   that you are responding to. Omit for a direct reply to the comment.
 *                   If provided, must be a valid ObjectId that exists in the replies array;
 *                   returns 404 if not found.
 *                 pattern: "^[a-fA-F0-9]{24}$"
 *                 example: "6674c3d6e5f67g0034cdef01"
 *
 *     responses:
 *       201:
 *         description: Reply added. Full updated comment document (with all replies) returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: object, description: "Updated Comment document including the new reply." }
 *       400:
 *         description: body is empty/too long, or replyTo is not a valid ObjectId.
 *       401:
 *         description: Missing or invalid Bearer token.
 *       404:
 *         description: Recipe, comment, or the referenced replyTo reply not found.
 */
router.post(
    "/comments/:commentId/replies",
    authenticate,
    validate(addReplySchema),
    userRecipeCommentController.addReply
);

// ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/comments/{commentId}/replies/{replyId}:
 *   delete:
 *     summary: Delete a reply (author only)
 *     tags: [User Recipes — Replies]
 *     description: >
 *       Removes the reply from the Comment's embedded replies array.
 *       Child replies that referenced this reply via `replyTo` are NOT
 *       deleted — their `replyToName` snapshot is preserved so the UI
 *       can still render the "@mention" context for orphaned replies.
 *       Only the reply author can delete it.
 *       No request body is needed.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the parent UserRecipe.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *       - in: path
 *         name: commentId
 *         description: REQUIRED. MongoDB ObjectId of the parent Comment.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6673b2c5d4e56f0023bcdef0"
 *
 *       - in: path
 *         name: replyId
 *         description: REQUIRED. ObjectId of the reply (sub-document) to delete.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6674c3d6e5f67g0034cdef01"
 *
 *     responses:
 *       200:
 *         description: Reply deleted.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Reply deleted." }
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: You are not the author of this reply.
 *       404:
 *         description: Recipe, comment, or reply not found.
 */
router.delete(
    "/comments/:commentId/replies/:replyId",
    authenticate,
    validate(deleteReplySchema),
    userRecipeCommentController.deleteReply
);

// ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/comments/{commentId}/replies/{replyId}/like:
 *   post:
 *     summary: Like a reply (toggle)
 *     tags: [User Recipes — Replies]
 *     description: >
 *       Toggles a like on the specified reply (embedded sub-document).
 *       Like and dislike are mutually exclusive and both support toggle-off
 *       (sending the same reaction twice removes it).
 *       No request body is needed.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the parent UserRecipe.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *       - in: path
 *         name: commentId
 *         description: REQUIRED. MongoDB ObjectId of the parent Comment.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6673b2c5d4e56f0023bcdef0"
 *
 *       - in: path
 *         name: replyId
 *         description: REQUIRED. ObjectId of the reply sub-document to like.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6674c3d6e5f67g0034cdef01"
 *
 *     responses:
 *       200:
 *         description: Updated like/dislike counts for the reply.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     likes: { type: integer, example: 5 }
 *                     dislikes: { type: integer, example: 0 }
 *       401:
 *         description: Missing or invalid Bearer token.
 *       404:
 *         description: Recipe, comment, or reply not found.
 */
router.post(
    "/comments/:commentId/replies/:replyId/like",
    authenticate,
    validate(reactToReplySchema),
    userRecipeCommentController.likeReply
);

// ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/comments/{commentId}/replies/{replyId}/dislike:
 *   post:
 *     summary: Dislike a reply (toggle)
 *     tags: [User Recipes — Replies]
 *     description: >
 *       Toggles a dislike on the specified reply (embedded sub-document).
 *       Like and dislike are mutually exclusive and both support toggle-off.
 *       No request body is needed.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the parent UserRecipe.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *       - in: path
 *         name: commentId
 *         description: REQUIRED. MongoDB ObjectId of the parent Comment.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6673b2c5d4e56f0023bcdef0"
 *
 *       - in: path
 *         name: replyId
 *         description: REQUIRED. ObjectId of the reply sub-document to dislike.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6674c3d6e5f67g0034cdef01"
 *
 *     responses:
 *       200:
 *         description: Updated like/dislike counts for the reply.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     likes: { type: integer, example: 5 }
 *                     dislikes: { type: integer, example: 1 }
 *       401:
 *         description: Missing or invalid Bearer token.
 *       404:
 *         description: Recipe, comment, or reply not found.
 */
router.post(
    "/comments/:commentId/replies/:replyId/dislike",
    authenticate,
    validate(reactToReplySchema),
    userRecipeCommentController.dislikeReply
);

export default router;
