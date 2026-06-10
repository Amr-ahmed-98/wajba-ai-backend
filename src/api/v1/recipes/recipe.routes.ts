import { Router } from "express";
import validate from "../../../middlewares/validate.middleware.js";
import {
  listRecipesSchema,
  searchRecipesSchema,
  getRecipeByIdSchema,
  recordViewSchema,
} from "./recipe.validation.js";
import * as recipeController from "./recipe.controller.js";

const router = Router();

// ─────────────────────────────────────────────────────────────
// IMPORTANT — Route ordering
//
// Express matches routes top-to-bottom. Static path segments
// (/generate, /generate-debug, /filters, /search) MUST be
// registered before the dynamic /:id segment, otherwise Express
// will treat "filters" or "search" as an ID value and call the
// wrong controller.
// ─────────────────────────────────────────────────────────────

// ── POST /api/v1/recipes/generate ────────────────────────────
/**
 * @swagger
 * /api/v1/recipes/generate:
 *   post:
 *     summary: Trigger weekly bilingual recipe generation (admin only)
 *     tags: [Recipes]
 *     description: >
 *       Generates 30 unique recipes per run using Gemini 2.5 Pro (bilingual text — English + Arabic)
 *       and Cloudflare Workers AI flux-1-schnell (images). Images are uploaded to Cloudinary.
 *       All text is stored in both languages in MongoDB — no runtime translation needed.
 *       Protected by the x-admin-secret header. Returns 202 immediately;
 *       generation runs in the background (takes 2-4 minutes).
 *     parameters:
 *       - in: header
 *         name: x-admin-secret
 *         required: true
 *         schema: { type: string }
 *         description: Shared secret matching ADMIN_GENERATION_SECRET env var
 *     responses:
 *       202:
 *         description: Generation started — check server logs for progress
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Recipe generation started. Check server logs for progress." }
 *       403:
 *         description: Invalid or missing admin secret
 */
router.post("/generate", recipeController.generateRecipes);

// ── POST /api/v1/recipes/generate-debug ──────────────────────
/**
 * @swagger
 * /api/v1/recipes/generate-debug:
 *   post:
 *     summary: "[DEBUG] Generate exactly 1 recipe synchronously and return the result or error"
 *     tags: [Recipes]
 *     description: >
 *       TEMPORARY diagnostic endpoint. Runs the full pipeline (Gemini → Cloudflare AI → Cloudinary → MongoDB)
 *       for a single recipe and returns the result — or the full error message — directly in the HTTP response.
 *       DELETE once generation is confirmed working.
 *     parameters:
 *       - in: header
 *         name: x-admin-secret
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Debug recipe generated and saved successfully
 *       403:
 *         description: Invalid or missing admin secret
 *       500:
 *         description: Full error details
 */
router.post("/generate-debug", recipeController.generateRecipesDebug);

// ── GET /api/v1/recipes/filters ───────────────────────────────
/**
 * @swagger
 * /api/v1/recipes/filters:
 *   get:
 *     summary: Get all available filter option keys
 *     tags: [Recipes]
 *     description: >
 *       Returns the complete set of smart and basic filter keys for the explore
 *       page filter panel. These are enum keys (language-neutral) — the frontend
 *       is responsible for displaying their translated labels in the UI.
 *     responses:
 *       200:
 *         description: Filter options returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     smartFilters:
 *                       type: object
 *                       properties:
 *                         time:   { type: array, items: { type: string } }
 *                         desire: { type: array, items: { type: string } }
 *                         mood:   { type: array, items: { type: string } }
 *                     basicFilters:
 *                       type: object
 *                       properties:
 *                         cuisine:  { type: array, items: { type: string } }
 *                         mealType: { type: array, items: { type: string } }
 *                         dishType: { type: array, items: { type: string } }
 *                         occasion: { type: array, items: { type: string } }
 *                         health:   { type: array, items: { type: string } }
 */
router.get("/filters", recipeController.getFilterOptions);

// ── GET /api/v1/recipes/search ────────────────────────────────
/**
 * @swagger
 * /api/v1/recipes/search:
 *   get:
 *     summary: Full-text search recipes (bilingual, with filters)
 *     tags: [Recipes]
 *     description: >
 *       Free-text search across recipe titles and descriptions in both English and Arabic.
 *       The query string `q` is matched against a compound MongoDB text index — you do NOT
 *       need to know which language the content is stored in; a single query works for both.
 *       All filter, sort, and pagination parameters from the list endpoint are supported
 *       so the frontend can keep the same filter panel open while searching.
 *       Results are sorted by text relevance score by default; pass `sort` to override.
 *       Send Accept-Language: ar for Arabic responses, en (or omit) for English.
 *     parameters:
 *       - in: header
 *         name: Accept-Language
 *         schema: { type: string, enum: [en, ar], default: en }
 *         description: Language for all text fields in the response
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 1, maxLength: 100 }
 *         description: Search text — works in English or Arabic
 *         example: "grilled salmon"
 *       - in: query
 *         name: time
 *         schema: { type: string, enum: [quick_meal, under_20_min, on_budget, saves_time] }
 *       - in: query
 *         name: desire
 *         schema: { type: string, enum: [savoury, sweet, light, spicy] }
 *       - in: query
 *         name: mood
 *         schema: { type: string, enum: [healthy, comfort_food, crispy, full_meal] }
 *       - in: query
 *         name: cuisine
 *         schema: { type: string, enum: [italian, egyptian, japanese, mexican, indian, arabic, french, asian] }
 *       - in: query
 *         name: mealType
 *         schema: { type: string, enum: [breakfast, lunch, dinner, snack, dessert] }
 *       - in: query
 *         name: dishType
 *         schema: { type: string, enum: [pasta, seafood, soup, salad, pizza, grill, sandwich, bowl] }
 *       - in: query
 *         name: occasion
 *         schema: { type: string, enum: [quick_meal, family_dinner, romantic_dinner, healthy_meal_prep] }
 *       - in: query
 *         name: health
 *         schema: { type: string, enum: [keto, vegan, high_protein, low_calorie, low_carb, vegetarian, paleo] }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [newest, most_viewed, top_rated], default: newest }
 *         description: >
 *           Sort order. When omitted, results are ordered by text relevance score
 *           (most relevant first). Pass an explicit value to override relevance sorting.
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12, maximum: 50 }
 *     responses:
 *       200:
 *         description: Search results returned successfully
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
 *                       _id:          { type: string }
 *                       title:        { type: string }
 *                       description:  { type: string }
 *                       imageUrl:     { type: string }
 *                       badge:        { type: string }
 *                       cardTip:      { type: string }
 *                       nutrition:
 *                         type: object
 *                         properties:
 *                           calories: { type: number }
 *                           protein:  { type: number }
 *                       views:         { type: number }
 *                       averageRating: { type: number }
 *                       ratingCount:   { type: number }
 *                       commentCount:  { type: number }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:       { type: number }
 *                     page:        { type: number }
 *                     limit:       { type: number }
 *                     totalPages:  { type: number }
 *                     hasNextPage: { type: boolean }
 *       400:
 *         description: Missing or invalid `q` parameter
 */
router.get("/search", validate(searchRecipesSchema), recipeController.searchRecipes);

// ── GET /api/v1/recipes ───────────────────────────────────────
/**
 * @swagger
 * /api/v1/recipes:
 *   get:
 *     summary: List recipes with filters and pagination
 *     tags: [Recipes]
 *     description: >
 *       Public endpoint. Returns paginated recipe cards.
 *       Send Accept-Language: ar for Arabic responses, Accept-Language: en (or omit) for English.
 *       The response always contains plain strings — the { en, ar } structure is never exposed.
 *       Multiple values for array filters: ?health=keto&health=vegan
 *     parameters:
 *       - in: header
 *         name: Accept-Language
 *         schema: { type: string, enum: [en, ar], default: en }
 *         description: Language for all text fields in the response
 *       - in: query
 *         name: time
 *         schema: { type: string, enum: [quick_meal, under_20_min, on_budget, saves_time] }
 *       - in: query
 *         name: desire
 *         schema: { type: string, enum: [savoury, sweet, light, spicy] }
 *       - in: query
 *         name: mood
 *         schema: { type: string, enum: [healthy, comfort_food, crispy, full_meal] }
 *       - in: query
 *         name: cuisine
 *         schema: { type: string, enum: [italian, egyptian, japanese, mexican, indian, arabic, french, asian] }
 *       - in: query
 *         name: mealType
 *         schema: { type: string, enum: [breakfast, lunch, dinner, snack, dessert] }
 *       - in: query
 *         name: dishType
 *         schema: { type: string, enum: [pasta, seafood, soup, salad, pizza, grill, sandwich, bowl] }
 *       - in: query
 *         name: occasion
 *         schema: { type: string, enum: [quick_meal, family_dinner, romantic_dinner, healthy_meal_prep] }
 *       - in: query
 *         name: health
 *         schema: { type: string, enum: [keto, vegan, high_protein, low_calorie, low_carb, vegetarian, paleo] }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [newest, most_viewed, top_rated], default: newest }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12, maximum: 50 }
 *     responses:
 *       200:
 *         description: Recipe list returned successfully
 */
router.get("/", validate(listRecipesSchema), recipeController.listRecipes);

// ─────────────────────────────────────────────────────────────
// Dynamic /:id routes — registered LAST so static segments above
// are never shadowed by the param wildcard.
// ─────────────────────────────────────────────────────────────

// ── GET /api/v1/recipes/:id ───────────────────────────────────
/**
 * @swagger
 * /api/v1/recipes/{id}:
 *   get:
 *     summary: Get full recipe details
 *     tags: [Recipes]
 *     description: >
 *       Public endpoint. Returns the complete recipe for the detail page.
 *       Send Accept-Language: ar for Arabic, Accept-Language: en (or omit) for English.
 *       All text fields are returned as plain strings in the requested language.
 *       This endpoint is a pure read — it does NOT increment the view counter.
 *       To register a view call POST /api/v1/recipes/{id}/view separately.
 *     parameters:
 *       - in: header
 *         name: Accept-Language
 *         schema: { type: string, enum: [en, ar], default: en }
 *         description: Language for all text fields in the response
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the recipe
 *     responses:
 *       200:
 *         description: Recipe detail returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id:         { type: string }
 *                     title:       { type: string, example: "Grilled Salmon Bowl" }
 *                     description: { type: string }
 *                     imageUrl:    { type: string }
 *                     badge:       { type: string, example: "keto" }
 *                     cardTip:     { type: string }
 *                     nutrition:
 *                       type: object
 *                       properties:
 *                         calories:      { type: number, example: 510 }
 *                         protein:       { type: number, example: 42 }
 *                         carbohydrates: { type: number, example: 18 }
 *                         fat:           { type: number, example: 22 }
 *                     ingredients:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:     { type: string, example: "Salmon fillet" }
 *                           amount:   { type: string, example: "200g" }
 *                           optional: { type: boolean, example: false }
 *                     instructions:
 *                       type: array
 *                       items: { type: string }
 *                       example: ["Season the salmon...", "Heat the pan..."]
 *                     aiAdvice:
 *                       type: array
 *                       items: { type: string }
 *                       example: ["Add lemon zest for brightness"]
 *                     views:         { type: number, example: 284 }
 *                     averageRating: { type: number, example: 4.8 }
 *                     ratingCount:   { type: number, example: 120 }
 *                     commentCount:  { type: number, example: 47 }
 *       404:
 *         description: Recipe not found
 */
router.get("/:id", validate(getRecipeByIdSchema), recipeController.getRecipeById);

// ── POST /api/v1/recipes/:id/view ────────────────────────────
/**
 * @swagger
 * /api/v1/recipes/{id}/view:
 *   post:
 *     summary: Register a view for a recipe (registered users only, deduplicated)
 *     tags: [Recipes]
 *     description: >
 *       Call this once when a registered user lands on the recipe detail page.
 *       Requires authentication — unauthenticated / guest requests return 401.
 *
 *       The server deduplicates views so the counter never increments
 *       twice for the same user: the user ID is stored in the recipe's
 *       `viewedBy` array via a single atomic `$addToSet` + `$inc` operation
 *       that only fires when the key is not already present. Reloading the
 *       page any number of times will never double-count, and concurrent
 *       requests are safe without application-level locking.
 *
 *       Returns the updated view count so the client can update the UI
 *       immediately without a follow-up GET request.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the recipe
 *     responses:
 *       200:
 *         description: View registered (or silently ignored if already counted)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     views: { type: number, example: 285 }
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Recipe not found
 */
router.post("/:id/view", validate(recordViewSchema), recipeController.recordView);

export default router;