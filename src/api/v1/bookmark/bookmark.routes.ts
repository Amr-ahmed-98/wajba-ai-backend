import { Router } from "express";
import { authenticate } from "../../../middlewares/Auth.middleware.js";
import validate from "../../../middlewares/validate.middleware.js";
import * as bookmarkController from "./bookmark.controller.js";
import {
    addBookmarkSchema,
    removeBookmarkSchema,
    getBookmarksSchema,
} from "./bookmark.validation.js";

const router = Router();

// All bookmark routes require authentication
router.use(authenticate);

// ── GET /api/v1/bookmarks ─────────────────────────────────────
/**
 * @swagger
 * /api/v1/bookmarks:
 *   get:
 *     summary: Get the current user's bookmarked recipes
 *     tags: [Bookmarks]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Returns a paginated list of recipe cards the user has bookmarked,
 *       ordered by most recently bookmarked first.
 *       The response shape is identical to GET /api/v1/recipes so the
 *       frontend can reuse the same card components.
 *       Send Accept-Language: ar for Arabic responses.
 *     parameters:
 *       - in: header
 *         name: Accept-Language
 *         schema: { type: string, enum: [en, ar], default: en }
 *         description: Language for all text fields in the response
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12, maximum: 50 }
 *     responses:
 *       200:
 *         description: Bookmarked recipes returned successfully
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
 *                       title:       { type: string, example: "Grilled Salmon Bowl" }
 *                       description: { type: string }
 *                       imageUrl:    { type: string }
 *                       badge:       { type: string, example: "keto" }
 *                       cardTip:     { type: string }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:       { type: integer, example: 5 }
 *                     page:        { type: integer, example: 1 }
 *                     limit:       { type: integer, example: 12 }
 *                     totalPages:  { type: integer, example: 1 }
 *                     hasNextPage: { type: boolean, example: false }
 *       401:
 *         description: Authentication required
 */
router.get("/", validate(getBookmarksSchema), bookmarkController.getBookmarks);

// ── POST /api/v1/bookmarks/:recipeId ─────────────────────────
/**
 * @swagger
 * /api/v1/bookmarks/{recipeId}:
 *   post:
 *     summary: Bookmark a recipe
 *     tags: [Bookmarks]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Adds the recipe to the authenticated user's bookmarks.
 *       Idempotent — bookmarking the same recipe twice always returns 200.
 *     parameters:
 *       - in: path
 *         name: recipeId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the recipe to bookmark
 *     responses:
 *       200:
 *         description: Recipe bookmarked (or already was bookmarked)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Recipe bookmarked successfully." }
 *                 data:
 *                   type: object
 *                   properties:
 *                     bookmarkCount: { type: integer, example: 4 }
 *       400:
 *         description: Invalid recipe ID format
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Recipe not found
 */
router.post("/:recipeId", validate(addBookmarkSchema), bookmarkController.addBookmark);

// ── DELETE /api/v1/bookmarks/:recipeId ───────────────────────
/**
 * @swagger
 * /api/v1/bookmarks/{recipeId}:
 *   delete:
 *     summary: Remove a bookmark
 *     tags: [Bookmarks]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Removes the recipe from the authenticated user's bookmarks.
 *       Idempotent — removing a recipe that was never bookmarked returns 200.
 *     parameters:
 *       - in: path
 *         name: recipeId
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the recipe to remove from bookmarks
 *     responses:
 *       200:
 *         description: Bookmark removed (or recipe was never bookmarked)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Bookmark removed successfully." }
 *                 data:
 *                   type: object
 *                   properties:
 *                     bookmarkCount: { type: integer, example: 3 }
 *       400:
 *         description: Invalid recipe ID format
 *       401:
 *         description: Authentication required
 */
router.delete("/:recipeId", validate(removeBookmarkSchema), bookmarkController.removeBookmark);

export default router;