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
// Stores the file in memory (Buffer) so it can be forwarded
// directly to the Groq vision API without writing to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10 MB max, 1 file
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
// Each generation call hits Groq (vision + text) + Cloudflare AI
// + Cloudinary — far more expensive than a standard read.
// Cap: 10 generation requests per hour, keyed by authenticated user ID
// (falls back to IP for any unauthenticated hit that slips through).
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour sliding window
  max: 10,
  keyGenerator: (req) => (req as any).user?.id ?? req.ip ?? "unknown",
  message: { success: false, message: "Too many recipe generation requests. Please try again in an hour." },
  standardHeaders: true,  // Return RateLimit-* headers
  legacyHeaders: false,   // Suppress deprecated X-RateLimit-* headers
});

// ═══════════════════════════════════════════════════════════════
// RECIPE GENERATION
// ═══════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/user-recipes/generate-from-text:
 *   post:
 *     summary: Generate AI recipe(s) from a typed ingredient list
 *     tags: [User Recipes — Generation]
 *     description: >
 *       Authenticated users type their available ingredients as plain strings.
 *       The AI (Groq llama-3.3-70b) generates up to 5 bilingual (EN + AR) recipes,
 *       each with full instructions, ingredient list with amounts, nutrition facts,
 *       and an AI-generated dish image (Cloudflare flux-1-schnell → Cloudinary).
 *
 *       Rate limit: 10 requests per hour per user.
 *
 *       If `isPublic: true`, the recipe is immediately visible on the community feed.
 *       If `isPublic: false` (default), it is private — only the owner can retrieve it.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: header
 *         name: Accept-Language
 *         description: >
 *           Language for the flattened response fields (title, description, instructions, etc.).
 *           Stored bilingually; this header only controls which language is returned.
 *         required: false
 *         schema:
 *           type: string
 *           enum: [en, ar]
 *           default: en
 *         example: en
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ingredients
 *             properties:
 *               ingredients:
 *                 type: array
 *                 description: >
 *                   REQUIRED. Ingredients the user currently has on hand.
 *                   Each item is a plain English string. Minimum 1 item.
 *                 items:
 *                   type: string
 *                   minLength: 1
 *                 minItems: 1
 *                 example: ["chicken breast", "olive oil", "garlic", "lemon"]
 *
 *               missingIngredients:
 *                 type: array
 *                 description: >
 *                   OPTIONAL. Extra ingredients the user is willing to buy / add
 *                   but does not currently have. The AI treats these as optional
 *                   additions when building the recipe.
 *                 items:
 *                   type: string
 *                   minLength: 1
 *                 default: []
 *                 example: ["fresh herbs", "lemon zest"]
 *
 *               isPublic:
 *                 type: boolean
 *                 description: >
 *                   OPTIONAL. Whether the generated recipe(s) should be published
 *                   to the community feed immediately after generation.
 *                   false → recipe is private (visible only via GET /my-recipes or GET /:id as owner).
 *                   true  → recipe appears on GET /community.
 *                 default: false
 *                 example: false
 *
 *               count:
 *                 type: integer
 *                 description: >
 *                   OPTIONAL. Number of distinct recipes to generate from the same
 *                   ingredient list. Each recipe uses a different cooking style /
 *                   dish type to ensure variety. A 3-second pause is injected
 *                   between LLM calls to respect Groq's free-tier RPM limit.
 *                 minimum: 1
 *                 maximum: 5
 *                 default: 1
 *                 example: 2
 *
 *     responses:
 *       201:
 *         description: Recipe(s) generated and saved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     recipes:
 *                       type: array
 *                       description: Array of generated recipe objects (language-flattened).
 *                       items: { type: object }
 *                     errors:
 *                       type: array
 *                       description: >
 *                         Per-recipe error messages if some (but not all) generations
 *                         failed. An empty array means all recipes succeeded.
 *                       items: { type: string }
 *                       example: []
 *       400:
 *         description: >
 *           Validation error — e.g. `ingredients` array is empty or missing,
 *           `count` is outside 1–5, or a field has the wrong type.
 *       401:
 *         description: Missing or invalid Bearer token.
 *       429:
 *         description: Rate limit exceeded — more than 10 generation requests in the last hour.
 */
router.post(
  "/generate-from-text",
  authenticate,
  generateLimiter,
  validate(generateFromTextSchema),
  userRecipeController.generateFromText
);

// ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/generate-from-photo:
 *   post:
 *     summary: Generate AI recipe(s) from an uploaded ingredient photo
 *     tags: [User Recipes — Generation]
 *     description: >
 *       Upload a photo containing food ingredients. The Groq vision model
 *       (llama-4-scout-17b-16e-instruct) analyses the image and returns a
 *       deduplicated list of detected ingredient names. Those names are then
 *       fed into the same text-generation pipeline as `/generate-from-text`.
 *
 *       The response includes `detectedIngredients` — the list the AI found in
 *       the photo — so the client can display what was recognised.
 *
 *       This is a `multipart/form-data` request (not JSON). All non-file fields
 *       are sent as plain form strings.
 *
 *       Rate limit: 10 requests per hour per user.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: header
 *         name: Accept-Language
 *         description: >
 *           Language for flattened response text fields (title, description, etc.).
 *         required: false
 *         schema:
 *           type: string
 *           enum: [en, ar]
 *           default: en
 *
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - photo
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: >
 *                   REQUIRED. The ingredient photo to analyse.
 *                   Accepted MIME types: image/jpeg, image/png, image/webp, image/heic.
 *                   Maximum file size: 10 MB.
 *
 *               missingIngredients:
 *                 type: string
 *                 description: >
 *                   OPTIONAL. A JSON-encoded array of extra ingredient names the user
 *                   is willing to add. Must be valid JSON. Parsed server-side.
 *                   Falls back to [] if omitted or malformed.
 *                 example: '["fresh herbs", "lemon zest"]'
 *
 *               isPublic:
 *                 type: string
 *                 description: >
 *                   OPTIONAL. Send the string "true" to publish the recipe to the
 *                   community feed, or "false" (default) to keep it private.
 *                   Note: form-data sends all values as strings.
 *                 enum: ["true", "false"]
 *                 default: "false"
 *                 example: "false"
 *
 *               count:
 *                 type: string
 *                 description: >
 *                   OPTIONAL. Number of distinct recipes to generate (1–5).
 *                   Sent as a string; parsed with parseInt server-side.
 *                   Clamps to 1 if the value is not a valid integer.
 *                 default: "1"
 *                 example: "1"
 *
 *     responses:
 *       201:
 *         description: Recipe(s) generated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     detectedIngredients:
 *                       type: array
 *                       description: Ingredient names extracted from the photo by the AI vision model.
 *                       items: { type: string }
 *                       example: ["chicken breast", "olive oil", "garlic"]
 *                     recipes:
 *                       type: array
 *                       description: Generated recipe objects (language-flattened).
 *                       items: { type: object }
 *                     errors:
 *                       type: array
 *                       items: { type: string }
 *                       example: []
 *       400:
 *         description: No image file was attached to the request (field name must be `photo`).
 *       401:
 *         description: Missing or invalid Bearer token.
 *       422:
 *         description: >
 *           Image was received and processed, but the vision model could not
 *           identify any food ingredients in it.
 *       429:
 *         description: Rate limit exceeded.
 */
router.post(
  "/generate-from-photo",
  authenticate,
  generateLimiter,
  upload.single("photo"),
  validate(generateFromPhotoSchema),
  userRecipeController.generateFromPhoto
);

// ═══════════════════════════════════════════════════════════════
// COMMUNITY FEED
// ═══════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/user-recipes/community:
 *   get:
 *     summary: List public community recipes (paginated)
 *     tags: [User Recipes — Community]
 *     description: >
 *       Fully public endpoint — no authentication required.
 *       Returns recipes that other users have generated and chosen to share
 *       (`isPublic: true`), paginated and sorted by the chosen strategy.
 *
 *       Each card includes: title, description, imageUrl, badge, cardTip,
 *       nutrition.calories, ownerName, ownerPhoto, likes, dislikes,
 *       averageRating, ratingCount, commentCount, cuisine, mealTypes,
 *       dishType, healthTags, createdAt.
 *
 *     parameters:
 *       - in: header
 *         name: Accept-Language
 *         description: Language for flattened text fields.
 *         required: false
 *         schema:
 *           type: string
 *           enum: [en, ar]
 *           default: en
 *
 *       - in: query
 *         name: sort
 *         description: >
 *           OPTIONAL. Sort strategy for the feed.
 *           newest     → sorted by createdAt DESC (default).
 *           most_liked → sorted by likes DESC.
 *           top_rated  → sorted by averageRating DESC.
 *         required: false
 *         schema:
 *           type: string
 *           enum: [newest, most_liked, top_rated]
 *           default: newest
 *         example: newest
 *
 *       - in: query
 *         name: page
 *         description: OPTIONAL. Page number (1-indexed).
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         example: 1
 *
 *       - in: query
 *         name: limit
 *         description: OPTIONAL. Number of recipes per page (max 50).
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 12
 *         example: 12
 *
 *     responses:
 *       200:
 *         description: Paginated community recipes returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items: { type: object }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total: { type: integer, description: "Total matching documents." }
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     totalPages: { type: integer }
 *                     hasNextPage: { type: boolean }
 *       400:
 *         description: Invalid query parameter (e.g. sort value not in enum, page < 1).
 */
router.get(
  "/community",
  validate(listCommunitySchema),
  userRecipeController.listCommunity
);

// ═══════════════════════════════════════════════════════════════
// MY RECIPES (OWNER)
// ═══════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/user-recipes/my-recipes:
 *   get:
 *     summary: List all recipes owned by the authenticated user
 *     tags: [User Recipes — My Recipes]
 *     description: >
 *       Returns both public AND private recipes that belong to the
 *       current user, sorted by newest first. Private recipes are excluded
 *       from the community feed but are always visible here.
 *
 *       Each item includes: title, description, imageUrl, badge, cardTip,
 *       isPublic, nutrition.calories, likes, dislikes, averageRating,
 *       ratingCount, commentCount, createdAt.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: header
 *         name: Accept-Language
 *         description: Language for flattened text fields.
 *         required: false
 *         schema:
 *           type: string
 *           enum: [en, ar]
 *           default: en
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
 *         description: OPTIONAL. Recipes per page (max 50).
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 12
 *
 *     responses:
 *       200:
 *         description: User's recipes returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items: { type: object }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total: { type: integer }
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     totalPages: { type: integer }
 *                     hasNextPage: { type: boolean }
 *       401:
 *         description: Missing or invalid Bearer token.
 */
router.get(
  "/my-recipes",
  authenticate,
  validate(listMyRecipesSchema),
  userRecipeController.listMyRecipes
);

// ═══════════════════════════════════════════════════════════════
// SINGLE RECIPE DETAIL
// ═══════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/user-recipes/{id}:
 *   get:
 *     summary: Get a single user-generated recipe by ID
 *     tags: [User Recipes]
 *     description: >
 *       Returns the full recipe document (all fields including instructions,
 *       aiAdvice, full ingredient list with amounts, nutrition, etc.).
 *
 *       Access rules:
 *         - isPublic=true  → anyone can access, no token needed.
 *         - isPublic=false → only the owner can access (send Bearer token);
 *                            returns 403 for any other caller.
 *
 *       The response text fields are flattened to the requested language
 *       via the Accept-Language header.
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: >
 *           REQUIRED. MongoDB ObjectId of the UserRecipe document.
 *           Must be a valid 24-character hex string.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *       - in: header
 *         name: Accept-Language
 *         description: Language for text fields in the response.
 *         required: false
 *         schema:
 *           type: string
 *           enum: [en, ar]
 *           default: en
 *
 *       - in: header
 *         name: Authorization
 *         description: >
 *           OPTIONAL for public recipes, REQUIRED for private recipes.
 *           Format: "Bearer <token>"
 *         required: false
 *         schema:
 *           type: string
 *           example: "Bearer eyJhbGciOiJIUzI1NiIsInR..."
 *
 *     responses:
 *       200:
 *         description: Full recipe document returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: object, description: "Full UserRecipe document (language-flattened)." }
 *       400:
 *         description: id is not a valid MongoDB ObjectId.
 *       403:
 *         description: Recipe exists but is private and you are not the owner.
 *       404:
 *         description: No recipe found with the given id.
 */
router.get(
  "/:id",
  optionalAuth,
  validate(getUserRecipeByIdSchema),
  userRecipeController.getUserRecipeById
);

// ═══════════════════════════════════════════════════════════════
// REACTIONS (LIKE / DISLIKE)
// ═══════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/user-recipes/{id}/react:
 *   post:
 *     summary: Like or dislike a community recipe (toggle)
 *     tags: [User Recipes — Community]
 *     description: >
 *       Toggle a like or dislike on a public community recipe.
 *
 *       Rules:
 *         - Like and dislike are mutually exclusive. Liking an already-disliked
 *           recipe removes the dislike first, and vice-versa.
 *         - Sending the SAME reaction a second time toggles it OFF (removes it).
 *         - Private recipes (isPublic=false) return 403 — reactions are only
 *           permitted on community-published recipes.
 *
 *       Returns the updated aggregate counts (not individual user states).
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the target UserRecipe.
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
 *               - reaction
 *             properties:
 *               reaction:
 *                 type: string
 *                 description: >
 *                   REQUIRED. The reaction to apply (or toggle off).
 *                   "like"    → increments likes, clears any dislike.
 *                   "dislike" → increments dislikes, clears any like.
 *                   Sending the same value again removes the reaction.
 *                 enum: [like, dislike]
 *                 example: "like"
 *
 *     responses:
 *       200:
 *         description: Reaction applied/removed. Updated counts returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     likes: { type: integer, example: 42 }
 *                     dislikes: { type: integer, example: 3 }
 *       400:
 *         description: reaction field is missing or not one of [like, dislike].
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: The recipe is private — only public recipes can receive reactions.
 *       404:
 *         description: No recipe found with the given id.
 */
router.post(
  "/:id/react",
  authenticate,
  validate(reactSchema),
  userRecipeController.reactToRecipe
);

// ═══════════════════════════════════════════════════════════════
// VISIBILITY TOGGLE
// ═══════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/user-recipes/{id}/visibility:
 *   patch:
 *     summary: Toggle a recipe between public and private (owner only)
 *     tags: [User Recipes — My Recipes]
 *     description: >
 *       Flips the `isPublic` flag on the recipe.
 *       true  → false : recipe is removed from the community feed.
 *       false → true  : recipe is published to the community feed.
 *
 *       Only the recipe owner can call this endpoint.
 *       No request body is needed — the server reads the current state
 *       and inverts it.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the UserRecipe to toggle.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *     responses:
 *       200:
 *         description: Visibility toggled. New state returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     isPublic:
 *                       type: boolean
 *                       description: The new visibility state after the toggle.
 *                       example: true
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: You are not the owner of this recipe.
 *       404:
 *         description: No recipe found with the given id.
 */
router.patch(
  "/:id/visibility",
  authenticate,
  validate(toggleVisibilitySchema),
  userRecipeController.toggleVisibility
);

// ═══════════════════════════════════════════════════════════════
// DELETE RECIPE
// ═══════════════════════════════════════════════════════════════

/**
 * @swagger
 * /api/v1/user-recipes/{id}:
 *   delete:
 *     summary: Permanently delete a user recipe (owner only)
 *     tags: [User Recipes — My Recipes]
 *     description: >
 *       Hard-deletes the UserRecipe document and cascades:
 *         1. Deletes the associated Cloudinary dish image.
 *         2. Deletes all Comment documents referencing this recipe.
 *         3. Deletes all Rating documents referencing this recipe.
 *
 *       This action is irreversible. Only the recipe owner can perform it.
 *       No request body is needed.
 *     security:
 *       - bearerAuth: []
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         description: REQUIRED. MongoDB ObjectId of the UserRecipe to delete.
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^[a-fA-F0-9]{24}$"
 *           example: "6672a1f4e3b45c0012abcdef"
 *
 *     responses:
 *       200:
 *         description: Recipe, image, comments, and ratings all deleted.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Recipe deleted." }
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: You are not the owner of this recipe.
 *       404:
 *         description: No recipe found with the given id.
 */
router.delete(
  "/:id",
  authenticate,
  validate(deleteUserRecipeSchema),
  userRecipeController.deleteUserRecipe
);

export default router;
