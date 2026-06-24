import { v2 as cloudinary } from "cloudinary";
import mongoose from "mongoose";
import UserRecipe, { IUserRecipe } from "../models/userRecipe.model.js";
import Comment from "../models/comment.model.js";
import { Rating } from "../models/comment.model.js";
import { ApiError } from "../utils/Apierror.js";
import { flattenLang, Lang, parseLang } from "./recipe.service.js";

// ─────────────────────────────────────────────────────────────
// Re-export parseLang for convenience in the controller
// ─────────────────────────────────────────────────────────────
export { parseLang };

// ─────────────────────────────────────────────────────────────
// Cloudinary — lazy config (same pattern as recipe.service.ts)
// ─────────────────────────────────────────────────────────────
let _cloudinaryConfigured = false;
const configureCloudinary = () => {
  if (_cloudinaryConfigured) return;
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new ApiError(500, "Image service is not configured.");
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
  _cloudinaryConfigured = true;
};

// ─────────────────────────────────────────────────────────────
// Upload a base64 data URI to Cloudinary
// ─────────────────────────────────────────────────────────────
const uploadImageToCloudinary = (dataUri: string, publicId: string): Promise<string> => {
  configureCloudinary();
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      dataUri,
      {
        public_id: `user_recipe_images/${publicId}`,
        resource_type: "image",
        transformation: [{ quality: "auto", fetch_format: "auto" }],
      },
      (error, result) => {
        if (error || !result) {
          reject(new ApiError(502, `Failed to upload image to Cloudinary: ${error?.message ?? "unknown"}`));
          return;
        }
        resolve(result.secure_url);
      }
    );
  });
};

// ─────────────────────────────────────────────────────────────
// Delete a Cloudinary image by its public_id
// Called when a user deletes their recipe.
// ─────────────────────────────────────────────────────────────
const deleteImageFromCloudinary = async (imageUrl: string): Promise<void> => {
  configureCloudinary();
  try {
    // Extract the public_id from the URL:
    // e.g. https://res.cloudinary.com/<cloud>/image/upload/v.../user_recipe_images/<id>
    const match = imageUrl.match(/user_recipe_images\/([^.]+)/);
    if (!match) return; // Non-cloudinary URL or pattern mismatch — skip silently
    const publicId = `user_recipe_images/${match[1]}`;
    await cloudinary.uploader.destroy(publicId);
  } catch {
    // Non-fatal — log and continue. Recipe document is already deleted.
    console.warn("⚠️  Could not delete Cloudinary image:", imageUrl);
  }
};

// ─────────────────────────────────────────────────────────────
// Generate AI dish image — Cloudflare Workers AI (flux-1-schnell)
// Same pipeline as recipe.service.ts
// ─────────────────────────────────────────────────────────────
const generateDishImage = async (prompt: string): Promise<string> => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) throw new ApiError(500, "Image generation service is not configured.");

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, num_steps: 4 }),
    }
  );

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new ApiError(502, `Cloudflare AI failed (HTTP ${response.status}): ${JSON.stringify(errBody)}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body: any = await response.json().catch(() => ({}));
    const base64Image = body?.result?.image;
    if (body?.success && typeof base64Image === "string" && base64Image.length > 0) {
      const mimeType = base64Image.startsWith("/9j/") ? "image/jpeg" : "image/png";
      return `data:${mimeType};base64,${base64Image}`;
    }
    throw new ApiError(502, `Cloudflare AI returned an error payload: ${JSON.stringify(body)}`);
  }

  const buffer = await response.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) throw new ApiError(502, "Cloudflare AI returned an empty image buffer.");
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:image/png;base64,${base64}`;
};

// ─────────────────────────────────────────────────────────────
// Analyse an ingredient photo using Groq's vision model
// (llama-4-scout-17b-16e-instruct supports vision via the
// messages API with image_url content parts).
// Returns a deduplicated list of recognised ingredient names.
// ─────────────────────────────────────────────────────────────
export const analyzeIngredientsFromImage = async (
  imageBuffer: Buffer,
  mimeType: string
): Promise<string[]> => {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) throw new ApiError(500, "Groq API key is not configured.");

  const base64 = imageBuffer.toString("base64");
  const dataUri = `data:${mimeType};base64,${base64}`;

  console.log("🔍 Sending ingredient photo to Groq vision model...");

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataUri },
            },
            {
              type: "text",
              text: `Identify every food ingredient visible in this image.
Return ONLY a valid JSON array of ingredient names as plain English strings — no quantities, no markdown, no explanation.
Example: ["chicken breast", "olive oil", "garlic", "lemon"]
If you cannot identify any ingredients, return an empty array: []`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new ApiError(502, `Groq vision API failed (HTTP ${response.status}): ${JSON.stringify(errBody)}`);
  }

  const data = await response.json() as any;
  const rawText: string = data.choices?.[0]?.message?.content ?? "[]";
  const clean = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((v: any) => typeof v === "string" && v.trim().length > 0))];
  } catch {
    console.warn("⚠️  Could not parse vision model response as JSON:", clean.slice(0, 200));
    return [];
  }
};

// ─────────────────────────────────────────────────────────────
// Valid enum sets — must stay in sync with userRecipe.model.ts
// ─────────────────────────────────────────────────────────────
const VALID_ENUMS = {
  badge: new Set(["keto", "vegan", "high_protein", "low_calorie", "low_carb", "muscle_gain", "premium"]),
  cuisine: new Set(["italian", "egyptian", "japanese", "mexican", "indian", "arabic", "french", "asian"]),
  mealTypes: new Set(["breakfast", "lunch", "dinner", "snack", "dessert"]),
  dishType: new Set(["pasta", "seafood", "soup", "salad", "pizza", "grill", "sandwich", "bowl"]),
  healthTags: new Set(["keto", "vegan", "high_protein", "low_calorie", "low_carb", "vegetarian", "paleo"]),
} as const;

const sanitizeScalar = (value: any, validSet: Set<string>, fallback: string): string =>
  typeof value === "string" && validSet.has(value) ? value : fallback;

const sanitizeArray = (values: any, validSet: Set<string>): string[] => {
  if (!Array.isArray(values)) return [];
  return values.filter((v: any) => typeof v === "string" && validSet.has(v));
};

// ─────────────────────────────────────────────────────────────
// Generate a single structured bilingual recipe from a list of
// ingredients using Groq (llama-3.3-70b-versatile).
// `recipeIndex` drives variety when count > 1 (tells the model
// "this is recipe N of total").
// ─────────────────────────────────────────────────────────────
const generateSingleRecipeJSON = async (
  ingredients: string[],
  missingIngredients: string[],
  recipeIndex: number,
  totalCount: number,
  existingTitles: string[]
): Promise<any> => {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) throw new ApiError(500, "Groq API key is not configured.");

  const ingredientList = ingredients.join(", ");
  const missingList = missingIngredients.length
    ? missingIngredients.join(", ")
    : "none";
  const avoidTitles = existingTitles.length ? existingTitles.join(", ") : "none";

  console.log(`  🤖 Groq generating recipe ${recipeIndex + 1}/${totalCount}...`);

  const prompt = `You are a professional chef and nutritionist.
The user has these ingredients available: ${ingredientList}.
They are also willing to use these missing/extra ingredients: ${missingList}.

Generate recipe number ${recipeIndex + 1} of ${totalCount} using primarily the available ingredients.
${totalCount > 1 ? `Make sure this recipe is DIFFERENT from: ${avoidTitles}` : ""}

RULES:
1. Return ONLY a valid JSON object — no markdown, no backticks, no explanation.
2. Every human-readable text field must be in BOTH English ("en") and Arabic ("ar").
3. Arabic must be natural, fluent, right-to-left food Arabic — not a word-for-word translation.
4. Use primarily the available ingredients. The missing ingredients are optional additions.
5. Amounts like "200g" or "1 tbsp" stay as flat strings.

Use EXACTLY this JSON structure:

{
  "title":       { "en": "Recipe Name in English",  "ar": "اسم الوصفة بالعربي" },
  "description": { "en": "One compelling sentence (max 100 chars)", "ar": "جملة واحدة جذابة (حد أقصى 100 حرف)" },
  "cardTip":     { "en": "Short AI tip (max 80 chars)", "ar": "نصيحة قصيرة (حد أقصى 80 حرف)" },
  "instructions": {
    "en": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
    "ar": ["الخطوة 1: ...", "الخطوة 2: ...", "الخطوة 3: ..."]
  },
  "aiAdvice": {
    "en": ["Tip 1", "Tip 2", "Tip 3"],
    "ar": ["نصيحة 1", "نصيحة 2", "نصيحة 3"]
  },
  "ingredients": [
    { "name": "Chicken breast", "amount": "200g", "optional": false },
    { "name": "Olive oil",      "amount": "1 tbsp", "optional": false },
    { "name": "Fresh herbs",    "amount": "1 handful", "optional": true }
  ],
  "badge": "<one of: keto|vegan|high_protein|low_calorie|low_carb|muscle_gain|premium>",
  "nutrition": {
    "calories": 420,
    "protein": 35,
    "carbohydrates": 28,
    "fat": 12
  },
  "imagePrompt": "Photorealistic food photography of [dish name], beautifully plated, natural lighting, top-down view, high resolution",
  "cuisine": "<MUST be exactly one of: italian|egyptian|japanese|mexican|indian|arabic|french|asian>",
  "mealTypes": ["<one or more of: breakfast|lunch|dinner|snack|dessert>"],
  "dishType": "<MUST be exactly one of: pasta|seafood|soup|salad|pizza|grill|sandwich|bowl>",
  "healthTags": ["<zero or more of: keto|vegan|high_protein|low_calorie|low_carb|vegetarian|paleo>"]
}`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.85,
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new ApiError(502, `Groq API failed (HTTP ${response.status}): ${JSON.stringify(errBody)}`);
  }

  const data = await response.json() as any;
  const stopReason: string = data.choices?.[0]?.finish_reason ?? "unknown";
  if (stopReason !== "stop") {
    throw new ApiError(502, `Groq stopped with finish_reason=${stopReason} for recipe ${recipeIndex + 1}`);
  }

  const rawText: string = data.choices?.[0]?.message?.content ?? "";
  if (!rawText) throw new ApiError(502, `Groq returned empty content for recipe ${recipeIndex + 1}`);

  const clean = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch {
    throw new ApiError(502, `Groq returned invalid JSON for recipe ${recipeIndex + 1}: ${clean.slice(0, 200)}`);
  }
};

// ─────────────────────────────────────────────────────────────
// Owner identity helper — attached to every user recipe
// ─────────────────────────────────────────────────────────────
interface OwnerInfo {
  id: string;
  name: string;
  photo: string | null;
}

// ─────────────────────────────────────────────────────────────
// Core pipeline — build ONE UserRecipe document end-to-end:
//   1. Generate bilingual recipe JSON (Groq text)
//   2. Generate dish image (Cloudflare AI)
//   3. Upload image (Cloudinary)
//   4. Save UserRecipe to MongoDB
// ─────────────────────────────────────────────────────────────
const buildOneUserRecipe = async (
  ingredients: string[],
  missingIngredients: string[],
  owner: OwnerInfo,
  isPublic: boolean,
  recipeIndex: number,
  totalCount: number,
  existingTitles: string[]
): Promise<IUserRecipe> => {
  // Step 1 — LLM recipe generation
  const raw = await generateSingleRecipeJSON(
    ingredients,
    missingIngredients,
    recipeIndex,
    totalCount,
    existingTitles
  );

  const imagePrompt: string =
    raw.imagePrompt ??
    `Photorealistic food photography of ${raw.title?.en ?? "a dish"}, beautifully plated, natural lighting`;
  delete raw.imagePrompt;

  // Step 2 — Sanitize enums so Mongoose never crashes on bad LLM output
  raw.badge = sanitizeScalar(raw.badge, VALID_ENUMS.badge, "premium");
  raw.cuisine = sanitizeScalar(raw.cuisine, VALID_ENUMS.cuisine, "arabic");
  raw.dishType = sanitizeScalar(raw.dishType, VALID_ENUMS.dishType, "bowl");
  raw.mealTypes = sanitizeArray(raw.mealTypes, VALID_ENUMS.mealTypes);
  raw.healthTags = sanitizeArray(raw.healthTags, VALID_ENUMS.healthTags);

  // Flatten LLM ingredient objects (no { en, ar } needed — user recipe ingredients are plain strings)
  if (Array.isArray(raw.ingredients)) {
    raw.ingredients = raw.ingredients.map((ing: any) => ({
      name: typeof ing.name === "object" ? (ing.name.en ?? "") : (ing.name ?? ""),
      amount: ing.amount ?? "",
      optional: ing.optional ?? false,
    }));
  }

  // Step 3 — Generate AI dish image
  console.log(`  📸 Generating dish image for: ${raw.title?.en}`);
  const imageDataUri = await generateDishImage(imagePrompt);

  // Step 4 — Upload to Cloudinary
  const slug = (raw.title?.en ?? `user-recipe-${recipeIndex}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const publicId = `${owner.id}-${Date.now()}-${recipeIndex}-${slug}`;
  console.log(`  ☁️  Uploading to Cloudinary as: user_recipe_images/${publicId}`);
  const imageUrl = await uploadImageToCloudinary(imageDataUri, publicId);

  // Step 5 — Persist
  const recipe = await UserRecipe.create({
    owner: owner.id,
    ownerName: owner.name,
    ownerPhoto: owner.photo,
    isPublic,
    sourceIngredients: ingredients,
    missingIngredients,
    title: raw.title,
    description: raw.description,
    cardTip: raw.cardTip,
    instructions: raw.instructions,
    aiAdvice: raw.aiAdvice,
    ingredients: raw.ingredients,
    imageUrl,
    badge: raw.badge,
    nutrition: raw.nutrition,
    cuisine: raw.cuisine,
    mealTypes: raw.mealTypes,
    dishType: raw.dishType,
    healthTags: raw.healthTags,
  });

  console.log(`  ✅ Saved: "${recipe.title.en}"`);
  return recipe;
};

// ─────────────────────────────────────────────────────────────
// Public — generate `count` recipes from ingredients (photo or text)
//
// `count` is controlled by the caller (the endpoint validates
// min=1, max=5). A 3-second pause between LLM calls keeps the
// request within Groq's free-tier 30 RPM limit.
// ─────────────────────────────────────────────────────────────
export interface GenerateUserRecipesInput {
  ingredients: string[];       // detected from photo OR typed
  missingIngredients: string[]; // extra optional ingredients
  owner: OwnerInfo;
  isPublic: boolean;
  count: number;               // 1–5
  lang?: Lang;
}

export const generateUserRecipes = async (
  input: GenerateUserRecipesInput
): Promise<{ recipes: any[]; errors: string[] }> => {
  const { ingredients, missingIngredients, owner, isPublic, count, lang = "en" } = input;

  if (!ingredients.length) {
    throw new ApiError(400, "At least one ingredient is required to generate a recipe.");
  }

  const results: IUserRecipe[] = [];
  const errors: string[] = [];
  const existingTitles: string[] = [];

  console.log(`🍳 Generating ${count} user recipe(s) for owner ${owner.id}...`);

  for (let i = 0; i < count; i++) {
    try {
      const recipe = await buildOneUserRecipe(
        ingredients,
        missingIngredients,
        owner,
        isPublic,
        i,
        count,
        existingTitles
      );
      existingTitles.push(recipe.title.en);
      results.push(recipe);

      // Throttle — 3s gap between calls (Groq free-tier: 30 RPM)
      if (i < count - 1) await new Promise((r) => setTimeout(r, 3000));
    } catch (err: any) {
      const msg = `Recipe ${i + 1} failed: ${err.message}`;
      errors.push(msg);
      console.error(`  ❌ ${msg}`);
    }
  }

  console.log(`🏁 Done — ${results.length}/${count} generated, ${errors.length} errors.`);

  return {
    recipes: results.map((r) => flattenUserRecipe(r.toObject(), lang)),
    errors,
  };
};

// ─────────────────────────────────────────────────────────────
// Flatten localised fields for a UserRecipe document
// Mirrors flattenLang() from recipe.service.ts but handles the
// plain-string ingredient names in UserRecipe.
// ─────────────────────────────────────────────────────────────
export const flattenUserRecipe = (recipe: any, lang: Lang): any => {
  const pick = (field: { en: string; ar: string } | undefined) =>
    field ? (field[lang] ?? field.en) : "";

  return {
    ...recipe,
    title: pick(recipe.title),
    description: pick(recipe.description),
    cardTip: pick(recipe.cardTip),
    instructions: recipe.instructions?.[lang] ?? recipe.instructions?.en ?? [],
    aiAdvice: recipe.aiAdvice?.[lang] ?? recipe.aiAdvice?.en ?? [],
    // UserRecipe ingredients have plain-string names — no flattening needed
  };
};

// ─────────────────────────────────────────────────────────────
// List community recipes (isPublic: true) with pagination
// ─────────────────────────────────────────────────────────────
export interface ListCommunityRecipesInput {
  lang?: Lang;
  sort?: "newest" | "most_liked" | "top_rated";
  page?: number;
  limit?: number;
}

export const listCommunityRecipes = async (input: ListCommunityRecipesInput) => {
  const { lang = "en", sort = "newest", page = 1, limit = 12 } = input;

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    newest: { createdAt: -1 },
    most_liked: { likes: -1 },
    top_rated: { averageRating: -1 },
  };

  const [recipes, total] = await Promise.all([
    UserRecipe.find({ isPublic: true })
      .sort(sortMap[sort] ?? sortMap.newest)
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        "title description imageUrl badge cardTip nutrition.calories " +
        "ownerName ownerPhoto likes dislikes averageRating ratingCount " +
        "commentCount cuisine mealTypes dishType healthTags createdAt"
      )
      .lean(),
    UserRecipe.countDocuments({ isPublic: true }),
  ]);

  return {
    recipes: recipes.map((r) => flattenUserRecipe(r, lang)),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
    },
  };
};

// ─────────────────────────────────────────────────────────────
// List the authenticated user's own recipes (public + private)
// ─────────────────────────────────────────────────────────────
export const listMyRecipes = async (
  userId: string,
  lang: Lang = "en",
  page = 1,
  limit = 12
) => {
  const [recipes, total] = await Promise.all([
    UserRecipe.find({ owner: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        "title description imageUrl badge cardTip isPublic nutrition.calories likes dislikes averageRating ratingCount commentCount createdAt"
      )
      .lean(),
    UserRecipe.countDocuments({ owner: userId }),
  ]);

  return {
    recipes: recipes.map((r) => flattenUserRecipe(r, lang)),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
    },
  };
};

// ─────────────────────────────────────────────────────────────
// Get a single user recipe — enforces privacy for private recipes
// ─────────────────────────────────────────────────────────────
export const getUserRecipeById = async (
  recipeId: string,
  requesterId?: string,
  lang: Lang = "en"
): Promise<any> => {
  if (!mongoose.isValidObjectId(recipeId)) {
    throw new ApiError(400, "Invalid recipe ID.");
  }
  const recipe = await UserRecipe.findById(recipeId).lean();
  if (!recipe) throw new ApiError(404, "Recipe not found.");

  if (!recipe.isPublic && recipe.owner.toString() !== requesterId) {
    throw new ApiError(403, "This recipe is private.");
  }

  return flattenUserRecipe(recipe, lang);
};

// ─────────────────────────────────────────────────────────────
// React to a community recipe — like or dislike
// Mutual exclusion: liking removes a previous dislike and vice-versa.
// Reacting with the same reaction a second time removes it (toggle).
// ─────────────────────────────────────────────────────────────
export type Reaction = "like" | "dislike";

export const reactToUserRecipe = async (
  recipeId: string,
  userId: string,
  reaction: Reaction
): Promise<{ likes: number; dislikes: number }> => {
  const recipe = await UserRecipe.findById(recipeId).select("+likedBy +dislikedBy");
  if (!recipe) throw new ApiError(404, "Recipe not found.");
  if (!recipe.isPublic) throw new ApiError(403, "You can only react to public community recipes.");

  const likedBy = recipe.likedBy ?? [];
  const dislikedBy = recipe.dislikedBy ?? [];

  const hasLiked = likedBy.includes(userId);
  const hasDisliked = dislikedBy.includes(userId);

  if (reaction === "like") {
    if (hasLiked) {
      // Toggle off — remove like
      recipe.likedBy = likedBy.filter((id) => id !== userId);
      recipe.likes = Math.max(0, recipe.likes - 1);
    } else {
      // Add like, remove any existing dislike
      recipe.likedBy = [...likedBy, userId];
      recipe.likes += 1;
      if (hasDisliked) {
        recipe.dislikedBy = dislikedBy.filter((id) => id !== userId);
        recipe.dislikes = Math.max(0, recipe.dislikes - 1);
      }
    }
  } else {
    // dislike
    if (hasDisliked) {
      // Toggle off — remove dislike
      recipe.dislikedBy = dislikedBy.filter((id) => id !== userId);
      recipe.dislikes = Math.max(0, recipe.dislikes - 1);
    } else {
      // Add dislike, remove any existing like
      recipe.dislikedBy = [...dislikedBy, userId];
      recipe.dislikes += 1;
      if (hasLiked) {
        recipe.likedBy = likedBy.filter((id) => id !== userId);
        recipe.likes = Math.max(0, recipe.likes - 1);
      }
    }
  }

  await recipe.save();
  return { likes: recipe.likes, dislikes: recipe.dislikes };
};

// ─────────────────────────────────────────────────────────────
// Toggle a recipe's visibility (public ↔ private)
// Owner only.
// ─────────────────────────────────────────────────────────────
export const toggleVisibility = async (
  recipeId: string,
  userId: string
): Promise<{ isPublic: boolean }> => {
  const recipe = await UserRecipe.findById(recipeId);
  if (!recipe) throw new ApiError(404, "Recipe not found.");
  if (recipe.owner.toString() !== userId) throw new ApiError(403, "You can only edit your own recipes.");

  recipe.isPublic = !recipe.isPublic;
  await recipe.save();
  return { isPublic: recipe.isPublic };
};

// ─────────────────────────────────────────────────────────────
// Delete a user recipe — owner only.
// Also removes the associated Cloudinary image.
// ─────────────────────────────────────────────────────────────
export const deleteUserRecipe = async (
  recipeId: string,
  userId: string
): Promise<void> => {
  const recipe = await UserRecipe.findById(recipeId);
  if (!recipe) throw new ApiError(404, "Recipe not found.");
  if (recipe.owner.toString() !== userId) throw new ApiError(403, "You can only delete your own recipes.");

  // Delete recipe document, its Cloudinary image, and all orphaned Comments + Ratings
  await Promise.all([
    deleteImageFromCloudinary(recipe.imageUrl),
    Comment.deleteMany({ recipe: recipeId }),
    Rating.deleteMany({ recipe: recipeId }),
  ]);
  await recipe.deleteOne();
};
