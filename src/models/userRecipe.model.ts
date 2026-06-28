import mongoose, { Schema, Document, Types } from "mongoose";
import { LocalisedString } from "./recipe.model.js";

interface IUserIngredient {
  name: string;
  nameAr: string;
  optional: boolean;
  amount: string;
}

interface IUserNutrition {
  calories: number;
  protein: number;
  carbohydrates: number;
  fat: number;
}

export interface IUserRecipe extends Document {
  owner: Types.ObjectId;
  ownerName: string;
  ownerPhoto: string | null;

  isPublic: boolean;

  sourceIngredients: LocalisedString[];
  missingIngredients: LocalisedString[];

  title: LocalisedString;
  description: LocalisedString;
  cardTip: LocalisedString;
  instructions: { en: string[]; ar: string[] };
  aiAdvice: { en: string[]; ar: string[] };
  ingredients: IUserIngredient[];

  imageUrl: string;
  badge: string;
  nutrition: IUserNutrition;

  cuisine: string;
  mealTypes: string[];
  dishType: string;
  healthTags: string[];

  likes: number;
  dislikes: number;
  likedBy: string[];
  dislikedBy: string[];



  // View count — incremented on every GET /:id
  viewCount: number;

  averageRating: number;
  ratingCount: number;
  commentCount: number;

  createdAt: Date;
  updatedAt: Date;
}

const localisedStringSchema = new Schema<LocalisedString>(
  { en: { type: String, required: true, trim: true }, ar: { type: String, required: true, trim: true } },
  { _id: false }
);

const userIngredientSchema = new Schema<IUserIngredient>(
  {
    name: { type: String, required: true, trim: true },
    nameAr: { type: String, default: "", trim: true },
    amount: { type: String, required: true, trim: true },
    optional: { type: Boolean, default: false },
  },
  { _id: false }
);

const userNutritionSchema = new Schema<IUserNutrition>(
  {
    calories: { type: Number, required: true, min: 0 },
    protein: { type: Number, required: true, min: 0 },
    carbohydrates: { type: Number, required: true, min: 0 },
    fat: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const userRecipeSchema = new Schema<IUserRecipe>(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    ownerName: { type: String, required: true },
    ownerPhoto: { type: String, default: null },

    isPublic: { type: Boolean, default: false },

    sourceIngredients: { type: [localisedStringSchema], default: [] },
    missingIngredients: { type: [localisedStringSchema], default: [] },

    title: { type: localisedStringSchema, required: true },
    description: { type: localisedStringSchema, required: true },
    cardTip: { type: localisedStringSchema, required: true },
    instructions: {
      type: new Schema({ en: [String], ar: [String] }, { _id: false }),
      required: true,
    },
    aiAdvice: {
      type: new Schema({ en: [String], ar: [String] }, { _id: false }),
      default: () => ({ en: [], ar: [] }),
    },
    ingredients: { type: [userIngredientSchema], required: true },

    imageUrl: { type: String, required: true },
    badge: {
      type: String,
      enum: ["keto", "vegan", "high_protein", "low_calorie", "low_carb", "muscle_gain", "premium"],
      default: "premium",
    },
    nutrition: { type: userNutritionSchema, required: true },

    cuisine: {
      type: String,
      enum: ["italian", "egyptian", "japanese", "mexican", "indian", "arabic", "french", "asian"],
      default: "italian",
    },
    mealTypes: {
      type: [String],
      enum: ["breakfast", "lunch", "dinner", "snack", "dessert"],
      default: [],
    },
    dishType: {
      type: String,
      enum: ["pasta", "seafood", "soup", "salad", "pizza", "grill", "sandwich", "bowl"],
      default: "bowl",
    },
    healthTags: {
      type: [String],
      enum: ["keto", "vegan", "high_protein", "low_calorie", "low_carb", "vegetarian", "paleo"],
      default: [],
    },

    likes: { type: Number, default: 0 },
    dislikes: { type: Number, default: 0 },
    likedBy: { type: [String], default: [], select: false },
    dislikedBy: { type: [String], default: [], select: false },


    // NEW: view count
    viewCount: { type: Number, default: 0 },

    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────
userRecipeSchema.index({ isPublic: 1, createdAt: -1 });
userRecipeSchema.index({ isPublic: 1, likes: -1 });
userRecipeSchema.index({ isPublic: 1, averageRating: -1 });
userRecipeSchema.index({ owner: 1, createdAt: -1 });
// For "my bookmarks" queries on the User model — no extra index needed here
// since bookmarks on UserRecipe are queried by recipeId from the User's array.

export default mongoose.model<IUserRecipe>("UserRecipe", userRecipeSchema);