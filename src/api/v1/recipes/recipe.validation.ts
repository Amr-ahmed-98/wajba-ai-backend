import { z } from "zod";

// ── Reusable filter enums ─────────────────────────────────────
const timeFilterEnum   = z.enum(["quick_meal","under_20_min","on_budget","saves_time"]);
const desireFilterEnum = z.enum(["savoury","sweet","light","spicy"]);
const moodFilterEnum   = z.enum(["healthy","comfort_food","crispy","full_meal"]);
const cuisineEnum      = z.enum(["italian","egyptian","japanese","mexican","indian","arabic","french","asian"]);
const mealTypeEnum     = z.enum(["breakfast","lunch","dinner","snack","dessert"]);
const dishTypeEnum     = z.enum(["pasta","seafood","soup","salad","pizza","grill","sandwich","bowl"]);
const occasionEnum     = z.enum(["quick_meal","family_dinner","romantic_dinner","healthy_meal_prep"]);
const healthTagEnum    = z.enum(["keto","vegan","high_protein","low_calorie","low_carb","vegetarian","paleo"]);
const sortEnum         = z.enum(["newest","most_viewed","top_rated"]);

// ── GET /api/v1/recipes ───────────────────────────────────────
export const listRecipesSchema = z.object({
  // Accept-Language header is read directly in the controller — not validated
  // here because validate.middleware only wraps body/query/params.
  query: z.object({
    time:     z.union([z.array(timeFilterEnum),   timeFilterEnum]).optional(),
    desire:   z.union([z.array(desireFilterEnum), desireFilterEnum]).optional(),
    mood:     z.union([z.array(moodFilterEnum),   moodFilterEnum]).optional(),
    cuisine:  cuisineEnum.optional(),
    mealType: z.union([z.array(mealTypeEnum), mealTypeEnum]).optional(),
    dishType: dishTypeEnum.optional(),
    occasion: z.union([z.array(occasionEnum), occasionEnum]).optional(),
    health:   z.union([z.array(healthTagEnum), healthTagEnum]).optional(),
    sort:     sortEnum.optional().default("newest"),
    page:     z.coerce.number().int().min(1).optional().default(1),
    limit:    z.coerce.number().int().min(1).max(50).optional().default(12),
  }),
});

// ── GET /api/v1/recipes/:id ───────────────────────────────────
export const getRecipeByIdSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Recipe ID is required"),
  }),
});

// ── POST /api/v1/recipes/generate ────────────────────────────
// Secret is validated in the controller, not here — it arrives
// as a header which validate.middleware doesn't inspect.
export const generateRecipesSchema = z.object({});