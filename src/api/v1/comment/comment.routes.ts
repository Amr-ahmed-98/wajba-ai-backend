import { Router } from "express";
import validate from "../../../middlewares/validate.middleware.js";
import { authenticate } from "../../../middlewares/Auth.middleware.js";
import * as commentController from "./comment.controller.js";
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
} from "./comment.validation.js";

const router = Router({ mergeParams: true });
// ⚠️  This router is mounted with mergeParams: true so it inherits
//     the :id param from the parent recipe router.

// ─────────────────────────────────────────────────────────────
// RATINGS
// Registered before comment routes — no route conflict risk but
// keeping them grouped at the top makes the ordering explicit.
//
// Design: "0 stars" is not a stored value. To remove a rating the
// client calls DELETE /ratings. The minimum stored value is 1.
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/recipes/{id}/ratings/me:
 *   get:
 *     summary: Get the authenticated user's rating for this recipe
 *     tags: [Ratings]
 *     description: >
 *       Returns the authenticated user's rating for this recipe (null if not yet rated).
 *       Works for both curator and public user-generated recipes.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Recipe ID
 *     responses:
 *       200:
 *         description: User's rating returned (null if not yet rated)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     yourRating: { type: integer, nullable: true, example: 4 }
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Recipe not found
 */
router.get(
    "/ratings/me",
    authenticate,
    validate(getMyRatingSchema),
    commentController.getMyRating
);

/**
 * @swagger
 * /api/v1/recipes/{id}/ratings:
 *   post:
 *     summary: Rate a recipe (1–5 stars). Creates or updates the user's rating.
 *     tags: [Ratings]
 *     description: >
 *       Rate a recipe 1–5 stars. Works for both curator and public user-generated recipes.
 *       Private user recipes return 403. One rating per user per recipe — calling again updates it.
 *       averageRating and ratingCount on the recipe document are recalculated automatically.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Recipe ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 example: 4
 *     responses:
 *       200:
 *         description: Rating saved; updated recipe stats returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     averageRating: { type: number, example: 4.3 }
 *                     ratingCount:   { type: integer, example: 87 }
 *                     yourRating:    { type: integer, example: 4 }
 *       400:
 *         description: Invalid value (must be integer 1–5)
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Recipe not found
 */
router.post(
    "/ratings",
    authenticate,
    validate(upsertRatingSchema),
    commentController.upsertRating
);

/**
 * @swagger
 * /api/v1/recipes/{id}/ratings:
 *   delete:
 *     summary: Remove the authenticated user's rating (equivalent to 0 stars)
 *     tags: [Ratings]
 *     description: >
 *       Deletes the user's rating for this recipe. The recipe's averageRating
 *       and ratingCount are recalculated automatically. If the user has not
 *       rated this recipe a 404 is returned.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Recipe ID
 *     responses:
 *       200:
 *         description: Rating removed; updated recipe stats returned
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
 *                     ratingCount:   { type: integer, example: 86 }
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Recipe not found, or user has not rated this recipe
 */
// FIX: this route was completely missing — DELETE /ratings returned 404 always.
router.delete(
    "/ratings",
    authenticate,
    validate(getMyRatingSchema),  // only needs recipeId param validation
    commentController.deleteRating
);

// ─────────────────────────────────────────────────────────────
// COMMENTS
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/recipes/{id}/comments:
 *   get:
 *     summary: List comments for a recipe (newest first, paginated)
 *     tags: [Comments]
 *     description: >
 *       Public endpoint. Returns paginated top-level comments with embedded replies.
 *       Works for both curator recipes (/api/v1/recipes/:id) and user-generated
 *       community recipes. Private user recipes return 403.
 *       Like/dislike arrays never exposed — integer counts only.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Recipe ID
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 50 }
 *     responses:
 *       200:
 *         description: Comment list returned successfully
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
 *                       _id:         { type: string }
 *                       author:      { type: string, description: "User ObjectId" }
 *                       authorName:  { type: string, example: "Amr Ahmed" }
 *                       authorPhoto: { type: string, nullable: true, example: null }
 *                       body:        { type: string }
 *                       likes:       { type: integer, example: 12 }
 *                       dislikes:    { type: integer, example: 1 }
 *                       replies:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             _id:         { type: string }
 *                             author:      { type: string }
 *                             authorName:  { type: string }
 *                             authorPhoto: { type: string, nullable: true }
 *                             body:        { type: string }
 *                             likes:       { type: integer }
 *                             dislikes:    { type: integer }
 *                             createdAt:   { type: string, format: date-time }
 *                       createdAt: { type: string, format: date-time }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:       { type: integer }
 *                     page:        { type: integer }
 *                     limit:       { type: integer }
 *                     totalPages:  { type: integer }
 *                     hasNextPage: { type: boolean }
 *       404:
 *         description: Recipe not found
 */
router.get(
    "/comments",
    validate(getCommentsSchema),
    commentController.getComments
);

/**
 * @swagger
 * /api/v1/recipes/{id}/comments:
 *   post:
 *     summary: Add a comment to a recipe
 *     tags: [Comments]
 *      description: >
 *       Add a comment to a recipe. Works for both curator and public user-generated recipes.
 *       Private user recipes return 403. Authentication required.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 2000
 *                 example: "Made this last night — absolutely delicious!"
 *     responses:
 *       201:
 *         description: Comment created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Recipe not found
 */
router.post(
    "/comments",
    authenticate,
    validate(addCommentSchema),
    commentController.addComment
);

/**
 * @swagger
 * /api/v1/recipes/{id}/comments/{commentId}:
 *   delete:
 *     summary: Delete a comment (author only)
 *     tags: [Comments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Comment deleted
 *       403:
 *         description: Not the comment author
 *       404:
 *         description: Comment or recipe not found
 */
router.delete(
    "/comments/:commentId",
    authenticate,
    validate(deleteCommentSchema),
    commentController.deleteComment
);

/**
 * @swagger
 * /api/v1/recipes/{id}/comments/{commentId}/like:
 *   post:
 *     summary: Like a comment (toggle — calling again removes the like)
 *     tags: [Comments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated like/dislike counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     likes:    { type: integer }
 *                     dislikes: { type: integer }
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Comment not found
 */
router.post(
    "/comments/:commentId/like",
    authenticate,
    validate(reactToCommentSchema),
    commentController.likeComment
);

/**
 * @swagger
 * /api/v1/recipes/{id}/comments/{commentId}/dislike:
 *   post:
 *     summary: Dislike a comment (toggle)
 *     tags: [Comments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated like/dislike counts
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Comment not found
 */
router.post(
    "/comments/:commentId/dislike",
    authenticate,
    validate(reactToCommentSchema),
    commentController.dislikeComment
);

// ─────────────────────────────────────────────────────────────
// REPLIES
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/recipes/{id}/comments/{commentId}/replies:
 *   post:
 *     summary: Reply to a comment
 *     tags: [Comments]
 *     description: >
 *       Adds a reply to a top-level comment. The reply is embedded inside
 *       the comment document. The response returns the full updated comment
 *       including all replies, with the author's name attached.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               body:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 1000
 *                 example: "I agree, the sauce was perfect!"
 *     responses:
 *       201:
 *         description: Reply added; full comment with all replies returned
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Comment or recipe not found
 */
router.post(
    "/comments/:commentId/replies",
    authenticate,
    validate(addReplySchema),
    commentController.addReply
);

/**
 * @swagger
 * /api/v1/recipes/{id}/comments/{commentId}/replies/{replyId}:
 *   delete:
 *     summary: Delete a reply (author only)
 *     tags: [Comments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: replyId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Reply deleted
 *       403:
 *         description: Not the reply author
 *       404:
 *         description: Reply not found
 */
router.delete(
    "/comments/:commentId/replies/:replyId",
    authenticate,
    validate(deleteReplySchema),
    commentController.deleteReply
);

/**
 * @swagger
 * /api/v1/recipes/{id}/comments/{commentId}/replies/{replyId}/like:
 *   post:
 *     summary: Like a reply (toggle)
 *     tags: [Comments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: replyId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated like/dislike counts for the reply
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Reply not found
 */
router.post(
    "/comments/:commentId/replies/:replyId/like",
    authenticate,
    validate(reactToReplySchema),
    commentController.likeReply
);

/**
 * @swagger
 * /api/v1/recipes/{id}/comments/{commentId}/replies/{replyId}/dislike:
 *   post:
 *     summary: Dislike a reply (toggle)
 *     tags: [Comments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: replyId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated like/dislike counts for the reply
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Reply not found
 */
router.post(
    "/comments/:commentId/replies/:replyId/dislike",
    authenticate,
    validate(reactToReplySchema),
    commentController.dislikeReply
);

export default router;