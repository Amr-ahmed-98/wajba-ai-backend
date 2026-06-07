import mongoose, { Schema, Document } from "mongoose";

// ─────────────────────────────────────────────────────────────
// Localised string helper type
// Every human-readable text field is stored in both languages.
// Numbers, enums, and image URLs are language-neutral — they stay flat.
// ─────────────────────────────────────────────────────────────
export interface LocalisedString {
  en: string;
  ar: string;
}

// ─────────────────────────────────────────────────────────────
// Filter enums — single source of truth shared by validation,
// the Gemini prompt, and the model.
// ─────────────────────────────────────────────────────────────
export type TimeFilter   = "quick_meal" | "under_20_min" | "on_budget" | "saves_time";
export type DesireFilter = "savoury" | "sweet" | "light" | "spicy";
export type MoodFilter   = "healthy" | "comfort_food" | "crispy" | "full_meal";

export type CuisineType  = "italian" | "egyptian" | "japanese" | "mexican" | "indian" | "arabic" | "french" | "asian";
export type MealType     = "breakfast" | "lunch" | "dinner" | "snack" | "dessert";
export type DishType     = "pasta" | "seafood" | "soup" | "salad" | "pizza" | "grill" | "sandwich" | "bowl";
export type OccasionType = "quick_meal" | "family_dinner" | "romantic_dinner" | "healthy_meal_prep";
export type HealthTag    = "keto" | "vegan" | "high_protein" | "low_calorie" | "low_carb" | "vegetarian" | "paleo";
export type RecipeBadge  = "keto" | "vegan" | "high_protein" | "low_calorie" | "low_carb" | "muscle_gain" | "premium";

// ─────────────────────────────────────────────────────────────
// Sub-document interfaces
// ─────────────────────────────────────────────────────────────
interface INutrition {
  calories:      number; // kcal
  protein:       number; // g
  carbohydrates: number; // g
  fat:           number; // g
}

interface IIngredient {
  name:     LocalisedString; // "Chicken breast" / "صدر دجاج"
  amount:   string;          // "200g" — numbers are universal, stays flat
  optional: boolean;
}

// ─────────────────────────────────────────────────────────────
// Main Recipe interface
// ─────────────────────────────────────────────────────────────
export interface IRecipe extends Document {
  // ── Localised content (human-readable text) ──────────────────
  title:        LocalisedString;
  description:  LocalisedString; // short teaser shown on recipe card
  cardTip:      LocalisedString; // one-liner AI tip on the card
  instructions: { en: string[]; ar: string[] };
  aiAdvice:     { en: string[]; ar: string[] };
  ingredients:  IIngredient[];

  // ── Language-neutral fields ───────────────────────────────────
  imageUrl: string;       // Cloudinary URL
  badge:    RecipeBadge;  // corner badge on the card
  nutrition: INutrition;

  // ── Filters ──────────────────────────────────────────────────
  timeFilters:   TimeFilter[];
  desireFilters: DesireFilter[];
  moodFilters:   MoodFilter[];
  cuisine:       CuisineType;
  mealTypes:     MealType[];
  dishType:      DishType;
  occasionTags:  OccasionType[];
  healthTags:    HealthTag[];

  // ── Stats ─────────────────────────────────────────────────────
  views:         number;
  averageRating: number;
  ratingCount:   number;
  commentCount:  number; // incremented/decremented by comment service

  // ── View deduplication (hidden from API responses) ────────────
  viewedBy: string[];

  // ── Generation metadata ───────────────────────────────────────
  generationBatch: number; // increments each weekly run
  generatedAt:     Date;

  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────
// Reusable localised string schema (no _id needed)
// ─────────────────────────────────────────────────────────────
const localisedStringSchema = new Schema<LocalisedString>(
  {
    en: { type: String, required: true, trim: true },
    ar: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const nutritionSchema = new Schema<INutrition>(
  {
    calories:      { type: Number, required: true, min: 0 },
    protein:       { type: Number, required: true, min: 0 },
    carbohydrates: { type: Number, required: true, min: 0 },
    fat:           { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const ingredientSchema = new Schema<IIngredient>(
  {
    name:     { type: localisedStringSchema, required: true },
    amount:   { type: String, required: true, trim: true },
    optional: { type: Boolean, default: false },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────
// Recipe schema
// ─────────────────────────────────────────────────────────────
const recipeSchema = new Schema<IRecipe>(
  {
    // Localised text fields
    title:       { type: localisedStringSchema, required: true },
    description: { type: localisedStringSchema, required: true },
    cardTip:     { type: localisedStringSchema, required: true },
    instructions: {
      type: new Schema({ en: [String], ar: [String] }, { _id: false }),
      required: true,
    },
    aiAdvice: {
      type: new Schema({ en: [String], ar: [String] }, { _id: false }),
      default: () => ({ en: [], ar: [] }),
    },
    ingredients: { type: [ingredientSchema], required: true },

    // Language-neutral fields
    imageUrl: { type: String, required: true },
    badge: {
      type: String,
      enum: ["keto","vegan","high_protein","low_calorie","low_carb","muscle_gain","premium"],
      required: true,
    },
    nutrition: { type: nutritionSchema, required: true },

    // Filters
    timeFilters:   { type: [String], enum: ["quick_meal","under_20_min","on_budget","saves_time"], default: [] },
    desireFilters: { type: [String], enum: ["savoury","sweet","light","spicy"], default: [] },
    moodFilters:   { type: [String], enum: ["healthy","comfort_food","crispy","full_meal"], default: [] },
    cuisine: {
      type: String,
      enum: ["italian","egyptian","japanese","mexican","indian","arabic","french","asian"],
      required: true,
    },
    mealTypes:    { type: [String], enum: ["breakfast","lunch","dinner","snack","dessert"], default: [] },
    dishType: {
      type: String,
      enum: ["pasta","seafood","soup","salad","pizza","grill","sandwich","bowl"],
      required: true,
    },
    occasionTags: { type: [String], enum: ["quick_meal","family_dinner","romantic_dinner","healthy_meal_prep"], default: [] },
    healthTags:   { type: [String], enum: ["keto","vegan","high_protein","low_calorie","low_carb","vegetarian","paleo"], default: [] },

    // Stats
    views:         { type: Number, default: 0 },
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount:   { type: Number, default: 0 },
    commentCount:  { type: Number, default: 0 },

    // Hidden from API — used only for view deduplication
    viewedBy: { type: [String], default: [], select: false },

    // Generation metadata
    generationBatch: { type: Number, required: true },
    generatedAt:     { type: Date, required: true },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────
recipeSchema.index({ cuisine: 1 });
recipeSchema.index({ mealTypes: 1 });
recipeSchema.index({ dishType: 1 });
recipeSchema.index({ healthTags: 1 });
recipeSchema.index({ timeFilters: 1 });
recipeSchema.index({ moodFilters: 1 });
recipeSchema.index({ desireFilters: 1 });
recipeSchema.index({ occasionTags: 1 });
recipeSchema.index({ views: -1 });
recipeSchema.index({ averageRating: -1 });
recipeSchema.index({ generationBatch: -1 });

export default mongoose.model<IRecipe>("Recipe", recipeSchema);