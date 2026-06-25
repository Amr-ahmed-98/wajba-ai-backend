import { Router, Request, Response, NextFunction } from "express";
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

/**
 * @swagger
 * components:
 *   schemas:
 *     LocalisedString:
 *       type: object
 *       required:
 *         - en
 *         - ar
 *       properties:
 *         en:
 *           type: string
 *           example: "English text"
 *         ar:
 *           type: string
 *           example: "العربية"
 *
 *     UserIngredient:
 *       type: object
 *       required:
 *         - name
 *         - amount
 *       properties:
 *         name:
 *           type: string
 *           example: "chicken breast"
 *         nameAr:
 *           type: string
 *           example: "صدور دجاج"
 *         amount:
 *           type: string
 *           example: "200g"
 *         optional:
 *           type: boolean
 *           example: false
 *
 *     UserNutrition:
 *       type: object
 *       required:
 *         - calories
 *         - protein
 *         - carbohydrates
 *         - fat
 *       properties:
 *         calories:
 *           type: number
 *           example: 350
 *         protein:
 *           type: number
 *           example: 30
 *         carbohydrates:
 *           type: number
 *           example: 10
 *         fat:
 *           type: number
 *           example: 12
 *
 *     UserRecipe:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "64f3c2a1b7e4d90012345678"
 *         owner:
 *           type: string
 *           example: "64f3c2a1b7e4d90012341111"
 *         ownerName:
 *           type: string
 *           example: "Amr Ahmed"
 *         ownerPhoto:
 *           type: string
 *           nullable: true
 *           example: "https://cloudinary.com/avatar.jpg"
 *         isPublic:
 *           type: boolean
 *           example: false
 *         title:
 *           $ref: '#/components/schemas/LocalisedString'
 *         description:
 *           $ref: '#/components/schemas/LocalisedString'
 *         cardTip:
 *           $ref: '#/components/schemas/LocalisedString'
 *         instructions:
 *           type: object
 *           properties:
 *             en:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Cut the chicken.", "Grill for 15 mins."]
 *             ar:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["قطع الدجاج", "اشوِ لمدة 15 دقيقة"]
 *         aiAdvice:
 *           type: object
 *           properties:
 *             en:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Use olive oil for better taste."]
 *             ar:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["استخدم زيت الزيتون لمذاق أفضل."]
 *         ingredients:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/UserIngredient'
 *         imageUrl:
 *           type: string
 *           example: "https://cloudinary.com/recipe.jpg"
 *         badge:
 *           type: string
 *           enum: [keto, vegan, high_protein, low_calorie, low_carb, muscle_gain, premium]
 *           example: "premium"
 *         nutrition:
 *           $ref: '#/components/schemas/UserNutrition'
 *         cuisine:
 *           type: string
 *           enum: [italian, egyptian, japanese, mexican, indian, arabic, french, asian]
 *           example: "italian"
 *         mealTypes:
 *           type: array
 *           items:
 *             type: string
 *             enum: [breakfast, lunch, dinner, snack, dessert]
 *           example: ["lunch", "dinner"]
 *         dishType:
 *           type: string
 *           enum: [pasta, seafood, soup, salad, pizza, grill, sandwich, bowl]
 *           example: "bowl"
 *         healthTags:
 *           type: array
 *           items:
 *             type: string
 *             enum: [keto, vegan, high_protein, low_calorie, low_carb, vegetarian, paleo]
 *           example: ["high_protein"]
 *         likes:
 *           type: integer
 *           example: 10
 *         dislikes:
 *           type: integer
 *           example: 1
 *         bookmarkCount:
 *           type: integer
 *           example: 5
 *         viewCount:
 *           type: integer
 *           example: 100
 *         averageRating:
 *           type: number
 *           example: 4.5
 *         ratingCount:
 *           type: integer
 *           example: 12
 *         commentCount:
 *           type: integer
 *           example: 3
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2026-06-25T16:46:51Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2026-06-25T16:46:51Z"
 *
 *     UserRecipeSummary:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "64f3c2a1b7e4d90012345678"
 *         ownerName:
 *           type: string
 *           example: "Amr Ahmed"
 *         ownerPhoto:
 *           type: string
 *           nullable: true
 *           example: "https://cloudinary.com/avatar.jpg"
 *         title:
 *           type: string
 *           example: "Grilled Lemon Chicken"
 *         description:
 *           type: string
 *           example: "A delicious, easy lemon-infused grilled chicken."
 *         imageUrl:
 *           type: string
 *           example: "https://cloudinary.com/recipe.jpg"
 *         badge:
 *           type: string
 *           example: "high_protein"
 *         likes:
 *           type: integer
 *           example: 24
 *         bookmarkCount:
 *           type: integer
 *           example: 5
 *         averageRating:
 *           type: number
 *           example: 4.8
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2026-06-25T16:46:51Z"
 *
 *     Pagination:
 *       type: object
 *       properties:
 *         total:
 *           type: integer
 *           example: 120
 *         page:
 *           type: integer
 *           example: 1
 *         limit:
 *           type: integer
 *           example: 12
 *         totalPages:
 *           type: integer
 *           example: 10
 */

const router = Router();

// ── Multer setup ──────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    // HEIC removed — not supported as a base64 data URI by Groq vision
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, or WEBP images are allowed."));
    }
  },
});

// ── Multer error handler ──────────────────────────────────────
// Must sit immediately after upload.single() on every multipart route.
// Without this, multer errors (wrong mimetype, file too large, wrong field
// name) bubble up as unhandled exceptions and produce the generic 500.
const handleMulterError = (
  err: any,
  _req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (err instanceof multer.MulterError || err?.message) {
    // Re-shape as a proper 400 ApiError-style response
    _res.status(400).json({ success: false, message: err.message ?? "File upload error." });
    return;
  }
  next(err);
};

// ── Per-user AI generation rate limiter ───────────────────────
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req as any).user?.id ?? req.ip ?? "unknown",
  message: { success: false, message: "Too many recipe generation requests. Please try again in an hour." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── GENERATION ────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/generate-from-text:
 *   post:
 *     summary: Generate AI recipes from a list of ingredients (text)
 *     tags: [User Recipes]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Uses an AI model to generate one or more recipes based on the
 *       ingredients provided by the authenticated user. Results are saved
 *       to the database and optionally published to the community feed.
 *       Rate-limited to **10 requests per hour** per user.
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
 *                 minItems: 1
 *                 description: Ingredients the user currently has available.
 *                 items:
 *                   type: string
 *                   minLength: 1
 *                 example: ["chicken breast", "garlic", "olive oil", "lemon"]
 *               missingIngredients:
 *                 type: array
 *                 description: Ingredients the user does NOT have but would like the AI to include anyway.
 *                 items:
 *                   type: string
 *                 default: []
 *                 example: ["parsley", "paprika"]
 *               isPublic:
 *                 type: boolean
 *                 description: Whether to publish the generated recipes to the community feed.
 *                 default: false
 *                 example: true
 *               count:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 description: Number of recipe variations to generate (1–5).
 *                 default: 1
 *                 example: 3
 *     responses:
 *       201:
 *         description: Recipes generated and saved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     recipes:
 *                       type: array
 *                       description: Successfully generated and saved recipe objects.
 *                       items:
 *                         $ref: '#/components/schemas/UserRecipe'
 *                     errors:
 *                       type: array
 *                       description: Any partial errors that occurred during generation (e.g., one recipe out of three failed).
 *                       items:
 *                         type: string
 *                       example: []
 *       400:
 *         description: Validation error (e.g., empty ingredients array).
 *       401:
 *         description: Authentication required.
 *       429:
 *         description: Rate limit exceeded — too many generation requests in the past hour.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Too many recipe generation requests. Please try again in an hour."
 *       502:
 *         description: AI service failed to generate any recipes.
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
 *     summary: Generate AI recipes by uploading a photo of ingredients
 *     tags: [User Recipes]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Upload an image (JPEG, PNG, or WEBP, max 10 MB) containing ingredients.
 *       The AI first detects the visible ingredients in the photo and then
 *       generates recipes from them. Results are saved and optionally published
 *       to the community feed.
 *       Rate-limited to **10 requests per hour** per user.
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
 *                 description: "The ingredient photo. Accepted formats: JPEG, PNG, WEBP. Max size: 10 MB."
 *               missingIngredients:
 *                 type: string
 *                 description: >
 *                   JSON-encoded array of ingredient strings the user lacks but wants
 *                   included (e.g., `["salt","pepper"]`).
 *                 example: '["parsley","cumin"]'
 *               isPublic:
 *                 type: string
 *                 enum: ["true", "false"]
 *                 description: Set to "true" to publish the generated recipes to the community feed.
 *                 default: "false"
 *               count:
 *                 type: string
 *                 description: Number of recipe variations to generate (1–5, parsed as integer).
 *                 default: "1"
 *                 example: "2"
 *     responses:
 *       201:
 *         description: Ingredients detected and recipes generated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     detectedIngredients:
 *                       type: array
 *                       description: List of ingredient names the AI identified in the photo.
 *                       items:
 *                         type: string
 *                       example: ["tomatoes", "onion", "garlic"]
 *                     recipes:
 *                       type: array
 *                       description: Generated and saved recipe objects.
 *                       items:
 *                         $ref: '#/components/schemas/UserRecipe'
 *                     errors:
 *                       type: array
 *                       description: Partial generation errors, if any.
 *                       items:
 *                         type: string
 *                       example: []
 *       400:
 *         description: >
 *           No image file uploaded, wrong field name, unsupported MIME type
 *           (not JPEG/PNG/WEBP), or file size exceeds 10 MB.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Only JPEG, PNG, or WEBP images are allowed."
 *       401:
 *         description: Authentication required.
 *       422:
 *         description: No ingredients could be detected in the uploaded photo.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Could not detect any ingredients from the uploaded photo."
 *       429:
 *         description: Rate limit exceeded — too many generation requests in the past hour.
 *       502:
 *         description: AI service failed to generate any recipes.
 */
router.post(
  "/generate-from-photo",
  authenticate,
  generateLimiter,
  upload.single("photo"),
  handleMulterError,           // ← catches multer errors BEFORE controller runs
  validate(generateFromPhotoSchema),
  userRecipeController.generateFromPhoto
);

// ── COMMUNITY FEED ────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/community:
 *   get:
 *     summary: List publicly shared community recipes
 *     tags: [User Recipes]
 *     description: >
 *       Returns a paginated list of all recipes that users have set to public.
 *       This endpoint is **public** — no authentication required.
 *       The response language is determined by the `Accept-Language` header.
 *     parameters:
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [newest, most_liked, top_rated]
 *           default: newest
 *         description: Sort order for the recipes feed.
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number (1-indexed).
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 12
 *         description: Number of recipes per page (max 50).
 *     responses:
 *       200:
 *         description: Community recipes returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserRecipeSummary'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       400:
 *         description: Invalid query parameters.
 */
router.get(
  "/community",
  validate(listCommunitySchema),
  userRecipeController.listCommunity
);

// ── MY RECIPES ────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/my-recipes:
 *   get:
 *     summary: List the authenticated user's own generated recipes
 *     tags: [User Recipes]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Returns a paginated list of all recipes (public and private) that belong
 *       to the currently authenticated user. The response language is determined
 *       by the `Accept-Language` header.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number (1-indexed).
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 12
 *         description: Number of recipes per page (max 50).
 *     responses:
 *       200:
 *         description: User's recipes returned successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserRecipeSummary'
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       401:
 *         description: Authentication required.
 */
router.get(
  "/my-recipes",
  authenticate,
  validate(listMyRecipesSchema),
  userRecipeController.listMyRecipes
);

// ── SINGLE RECIPE ─────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}:
 *   get:
 *     summary: Get a single user recipe by ID
 *     tags: [User Recipes]
 *     description: >
 *       Fetches full details of a user-generated recipe. Each access increments
 *       the recipe's `viewCount`. Authentication is **optional** — if a valid
 *       Bearer token is supplied the user's bookmark/reaction state is included
 *       in the response. Private recipes are only accessible by their owner.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the user recipe.
 *         example: "64f3c2a1b7e4d90012345678"
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     responses:
 *       200:
 *         description: Recipe fetched successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/UserRecipe'
 *       403:
 *         description: Recipe is private and the requester is not the owner.
 *       404:
 *         description: Recipe not found.
 */
router.get(
  "/:id",
  optionalAuth,
  validate(getUserRecipeByIdSchema),
  userRecipeController.getUserRecipeById
);

// ── REACTIONS ────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/react:
 *   post:
 *     summary: Like or dislike a user recipe
 *     tags: [User Recipes]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Toggles a reaction (like or dislike) on a recipe. If the user has
 *       already reacted with the **same** reaction it is removed (un-react).
 *       If the user switches from like to dislike (or vice-versa), the old
 *       reaction is replaced. Returns the updated like/dislike counts.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the user recipe to react to.
 *         example: "64f3c2a1b7e4d90012345678"
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
 *                 enum: [like, dislike]
 *                 description: The reaction type to apply.
 *                 example: "like"
 *     responses:
 *       200:
 *         description: Reaction recorded and updated counts returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     likes:
 *                       type: integer
 *                       example: 42
 *                     dislikes:
 *                       type: integer
 *                       example: 3
 *       400:
 *         description: Invalid reaction value.
 *       401:
 *         description: Authentication required.
 *       404:
 *         description: Recipe not found.
 */
router.post(
  "/:id/react",
  authenticate,
  validate(reactSchema),
  userRecipeController.reactToRecipe
);

// ── BOOKMARK ─────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/bookmark:
 *   post:
 *     summary: Toggle bookmark on a user recipe
 *     tags: [User Recipes]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Bookmarks the specified recipe for the authenticated user. If the recipe
 *       is already bookmarked, this call removes the bookmark (toggle behaviour).
 *       Returns the updated bookmark state.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the user recipe to bookmark.
 *         example: "64f3c2a1b7e4d90012345678"
 *     responses:
 *       200:
 *         description: Bookmark state toggled successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     bookmarked:
 *                       type: boolean
 *                       description: true if the recipe is now bookmarked, false if removed.
 *                       example: true
 *       401:
 *         description: Authentication required.
 *       404:
 *         description: Recipe not found.
 */
router.post(
  "/:id/bookmark",
  authenticate,
  validate(toggleVisibilitySchema), // reuses recipeIdParam shape
  userRecipeController.bookmarkRecipe
);

// ── VISIBILITY ────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}/visibility:
 *   patch:
 *     summary: Toggle user recipe visibility
 *     tags: [User Recipes]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Toggles the visibility of the recipe between public (visible in the community feed)
 *       and private (only visible to the owner). Only the recipe owner can perform this action.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the user recipe.
 *         example: "64f3c2a1b7e4d90012345678"
 *     responses:
 *       200:
 *         description: Visibility toggled successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: "64f3c2a1b7e4d90012345678"
 *                     isPublic:
 *                       type: boolean
 *                       example: true
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Only the owner is allowed to change the visibility of this recipe.
 *       404:
 *         description: Recipe not found.
 */
router.patch(
  "/:id/visibility",
  authenticate,
  validate(toggleVisibilitySchema),
  userRecipeController.toggleVisibility
);

// ── DELETE ────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/user-recipes/{id}:
 *   delete:
 *     summary: Delete a user recipe by ID
 *     tags: [User Recipes]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Deletes a user-generated recipe. Only the owner of the recipe can delete it.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The unique ID of the user recipe to delete.
 *         example: "64f3c2a1b7e4d90012345678"
 *     responses:
 *       200:
 *         description: Recipe deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Recipe deleted."
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Only the owner is allowed to delete this recipe.
 *       404:
 *         description: Recipe not found.
 */
router.delete(
  "/:id",
  authenticate,
  validate(deleteUserRecipeSchema),
  userRecipeController.deleteUserRecipe
);

export default router;