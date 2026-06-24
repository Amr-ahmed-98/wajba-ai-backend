import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import validate from "../../../middlewares/validate.middleware.js";
import { authenticate, optionalAuth } from "../../../middlewares/Auth.middleware.js";
import * as userRecipeController from "./user-recipe.controller.js";
import {
  generateFromTextSchema,
  generateFromPhotoSchema,
  listCommunitySchema,
  listMyRecipesSchema,
  getUserRecipeByIdSchema,
  reactSchema,
  toggleVisibilitySchema,
  deleteUserRecipeSchema,
} from "./user-recipe.validation.js";

const router = Router();

// ── Multer setup ──────────────────────────────────────────────
// Store in memory so we can send the buffer directly to Groq.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WEBP or HEIC images are allowed."));
    }
  },
});

// ── Per-user AI generation rate limiter ───────────────────────
// Generation hits Groq + Cloudflare + Cloudinary — much more expensive
// than a normal read. Limit to 10 generations per hour per user/IP.
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  keyGenerator: (req) => (req as any).user?.id ?? req.ip ?? "unknown",
  message: { success: false, message: "Too many recipe generation requests. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─────────────────────────────────────────────────────────────
// RECipe Generation
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/generate-from-text:
 *   post:
 *     summary: Generate recipe(s) from typed ingredients
 *     tags: [User Recipes]
 *     description: >
 *       Provide a list of ingredients as plain strings; the AI will generate
 *       bilingual (EN + AR) recipe(s) complete with instructions,
 *       nutrition facts, and an AI-generated dish image.
 *       Optionally declare `missingIngredients` for items you are willing
 *       to buy but do not have on hand, and set `isPublic` to true if you
 *       want the recipe to appear on the community feed immediately.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ingredients]
 *             properties:
 *               ingredients:
 *                 type: array
 *                 items: { type: string }
 *                 example: ["chicken", "olive oil", "garlic"]
 *               missingIngredients:
 *                 type: array
 *                 items: { type: string }
 *                 example: ["fresh herbs", "lemon"]
 *                 default: []
 *               isPublic:
 *                 type: boolean
 *                 default: false
 *               count:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 default: 1
 *     responses:
 *       201:
 *         description: Recipe(s) generated successfully
 *       400:
 *         description: Validation error (e.g. empty ingredients)
 *       401:
 *         description: Authentication required
 */
router.post(
  "/generate-from-text",
  authenticate,
  generateLimiter,
  validate(generateFromTextSchema),
  userRecipeController.generateFromText
);

/**
 * @swagger
 * /api/v1/user-recipes/generate-from-photo:
 *   post:
 *     summary: Generate recipe(s) from an ingredient photo
 *     tags: [User Recipes]
 *     description: >
 *       Upload a photo of your ingredients. The AI vision model (Groq)
 *       analyses the image, extracts the ingredient names, then the
 *       text-generation pipeline creates bilingual recipe(s).
 *       `missingIngredients` is a JSON string of an array of strings.
 *     security:
 *       - bearer afterAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [photo]
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *               missingIngredients:
 *                 type: string
 *                 description: JSON-encoded array of strings (optional)
 *                 example: '["fresh herbs", "lemon"]'
 *               isPublic:
 *                 type: string
 *                 enum: ["true", "false"]
 *                 default: "false"
 *               count:
 *                 type: string
 *                 default: "1"
 *     responses:
 *       201:
 *         description: Recipe(s) generated successfully; includes detectedIngredients
 *       400:
 *         description: No image uploaded
 *       401:
 *         description: Authentication required
 *       422:
 *         description: Could not detect any ingredients from the photo
 */
router.post(
  "/generate-from-photo",
  authenticate,
  generateLimiter,
  upload.single("photo"),
  validate(generateFromPhotoSchema),
  userRecipeController.generateFromPhoto
);

// ─────────────────────────────────────────────────────────────
// Community Feed
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/community:
 *   get:
 *     summary: List public community recipes
 *     tags: [User Recipes — Community]
 *     description: >
 *       Public endpoint. Returns paginated community recipes
 *       sorted by newest, most liked, or top rated.
 *     parameters:
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [newest, most_liked, top_rated], default: newest }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12, maximum: 50 }
 *     responses:
 *       200:
 *         description: Community recipes returned
 */
router.get(
  "/community",
  validate(listCommunitySchema),
  userRecipeController.listCommunity
);

// ─────────────────────────────────────────────────────────────
// My Recipes (Owner)
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/my-recipes:
 *   get:
 *     summary: List current user's generated recipes
 *     tags: [User Recipes — My Recipes]
 *     description: >
 *       Returns both public and private recipes owned by the
 *       authenticated user, sorted by newest first.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12, maximum: 50 }
 *     responses:
 *       200:
 *         description: User's recipes returned
 *       401:
 *         description: Authentication required
 */
router.get(
  "/my-recipes",
  authenticate,
  validate(listMyRecipesSchema),
  userRecipeController.listMyRecipes
);

// ─────────────────────────────────────────────────────────────
// Single Recipe Detail
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}:
 *   get:
 *     summary: Get a single user recipe by ID
 *     tags: [User Recipes]
 *     description: >
 *       Public for community (isPublic=true) recipes.
 *       Private recipes require the owner to be authenticated.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: Accept-Language
 *         schema: { type: string, enum: [en, ar], default: en }
 *     responses:
 *       200:
 *         description: Recipe details returned
 *       403:
 *         description: Recipe is private and you are not the owner
 *       404:
 *         description: Recipe not found
 */
router.get(
  "/:id",
  optionalAuth,
  validate(getUserRecipeByIdSchema),
  userRecipeController.getUserRecipeById
);

// ─────────────────────────────────────────────────────────────
// Reaction (Like / Dislike)
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/react:
 *   post:
 *     summary: Like or dislike a community recipe (toggle)
 *     tags: [User Recipes — Community]
 *     description: >
 *       Toggle a like or dislike. Sending the same reaction again
 *       removes it. Like and dislike are mutually exclusive.
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
 *             required: [reaction]
 *             properties:
 *               reaction:
 *                 type: string
 *                 enum: [like, dislike]
 *     responses:
 *       200:
 *         description: Updated like/dislike counts returned
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Cannot react to a private recipe
 *       404:
 *         description: Recipe not found
 */
router.post(
  "/:id/react",
  authenticate,
  validate(reactSchema),
  userRecipeController.reactToRecipe
);

// ─────────────────────────────────────────────────────────────
// Visibility Toggle
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/visibility:
 *   patch:
 *     summary: Toggle recipe public/private visibility
 *     tags: [User Recipes — My Recipes]
 *     description: >
 *       Owner only. Flips `isPublic` between true and false.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: New visibility state returned
 *       403:
 *         description: Not the recipe owner
 *       404:
 *         description: Recipe not found
 */
router.patch(
  "/:id/visibility",
  authenticate,
  validate(toggleVisibilitySchema),
  userRecipeController.toggleVisibility
);

// ─────────────────────────────────────────────────────────────
// Delete Recipe
// ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}:
 *   delete:
 *     summary: Delete a user recipe (owner only)
 *     tags: [User Recipes — My Recipes]
 *     description: >
 *       Also removes the associated Cloudinary image.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Recipe deleted
 *       403:
 *         description: Not the recipe owner
 *       404:
 *         description: Recipe not found
 */
router.delete(
  "/:id",
  authenticate,
  validate(deleteUserRecipeSchema),
  userRecipeController.deleteUserRecipe
);

export default router;
