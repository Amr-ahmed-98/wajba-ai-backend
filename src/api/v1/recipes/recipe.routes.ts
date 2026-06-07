import { Router } from "express";
import validate from "../../../middlewares/validate.middleware.js";
import { listRecipesSchema, getRecipeByIdSchema } from "./recipe.validation.js";
import * as recipeController from "./recipe.controller.js";

const router = Router();

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
 *                         time:   { type: array, items: { type: string }, example: [quick_meal, under_20_min, on_budget, saves_time] }
 *                         desire: { type: array, items: { type: string }, example: [savoury, sweet, light, spicy] }
 *                         mood:   { type: array, items: { type: string }, example: [healthy, comfort_food, crispy, full_meal] }
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
 *                       title:        { type: string, example: "Grilled Chicken Bowl" }
 *                       description:  { type: string, example: "High-protein bowl with seasonal vegetables" }
 *                       imageUrl:     { type: string }
 *                       badge:        { type: string, example: "high_protein" }
 *                       cardTip:      { type: string, example: "Great for post-workout muscle gain" }
 *                       nutrition:
 *                         type: object
 *                         properties:
 *                           calories: { type: number, example: 420 }
 *                           protein:  { type: number, example: 38 }
 *                       views:         { type: number, example: 142 }
 *                       averageRating: { type: number, example: 4.8 }
 *                       ratingCount:   { type: number, example: 120 }
 *                       commentCount:  { type: number, example: 34 }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:       { type: number, example: 87 }
 *                     page:        { type: number, example: 1 }
 *                     limit:       { type: number, example: 12 }
 *                     totalPages:  { type: number, example: 8 }
 *                     hasNextPage: { type: boolean, example: true }
 */
router.get("/", validate(listRecipesSchema), recipeController.listRecipes);

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
 *       View count increments exactly once per unique viewer —
 *       authenticated users tracked by user ID, guests by a hashed IP+UA fingerprint.
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
 *                       example: ["Step 1: Season the salmon...", "Step 2: Heat the pan..."]
 *                     aiAdvice:
 *                       type: array
 *                       items: { type: string }
 *                       example: ["Add lemon zest for brightness", "Swap rice for cauliflower rice to cut carbs"]
 *                     views:         { type: number, example: 284 }
 *                     averageRating: { type: number, example: 4.8 }
 *                     ratingCount:   { type: number, example: 120 }
 *                     commentCount:  { type: number, example: 47 }
 *       404:
 *         description: Recipe not found
 */
router.get("/:id", validate(getRecipeByIdSchema), recipeController.getRecipeById);

export default router;