import Recipe, { IRecipe } from "../models/recipe.model.js";
import { ApiError } from "../utils/Apierror.js";
import { v2 as cloudinary } from "cloudinary";
import { HydratedDocument } from "mongoose";

// ─────────────────────────────────────────────────────────────
// Supported languages
// ─────────────────────────────────────────────────────────────
export type Lang = "en" | "ar";

// Parses the full Accept-Language header value (e.g. "ar-EG,ar;q=0.9,en;q=0.8")
// and returns "ar" if the highest-priority language tag starts with "ar", else "en".
export const parseLang = (header?: string): Lang => {
  if (!header) return "en";
  // Take the first language tag before any comma or semicolon
  const primary = header.split(",")[0].split(";")[0].trim().toLowerCase();
  return primary.startsWith("ar") ? "ar" : "en";
};

// ─────────────────────────────────────────────────────────────
// Env-var validation — called once at the start of any
// generation run so failures surface immediately with a clear
// message instead of dying silently mid-loop.
// ─────────────────────────────────────────────────────────────
const validateEnvVars = (): void => {
  const required: Record<string, string | undefined> = {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  };

  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    const msg = `Missing required environment variables: ${missing.join(", ")}`;
    console.error(`❌ ENV CHECK FAILED — ${msg}`);
    throw new ApiError(500, msg);
  }

  console.log("✅ All required environment variables are present.");
};

// ─────────────────────────────────────────────────────────────
// Cloudinary — lazy config
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
// Upload Cloudflare image (base64 data URI) → Cloudinary
// ─────────────────────────────────────────────────────────────
const uploadImageToCloudinary = (dataUri: string, publicId: string): Promise<string> => {
  configureCloudinary();
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      dataUri,
      {
        public_id: `recipe_images/${publicId}`,
        resource_type: "image",
        transformation: [{ quality: "auto", fetch_format: "auto" }],
      },
      (error, result) => {
        if (error || !result) {
          console.error("❌ Cloudinary upload error:", error);
          reject(new ApiError(502, `Failed to upload recipe image to Cloudinary: ${error?.message ?? "unknown error"}`));
          return;
        }
        resolve(result.secure_url);
      }
    );
  });
};

// ─────────────────────────────────────────────────────────────
// Generate image — Cloudflare Workers AI (flux-1-schnell)
// Returns a base64 data URI ready for Cloudinary ingestion.
// ─────────────────────────────────────────────────────────────
const generateRecipeImage = async (prompt: string): Promise<string> => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) throw new ApiError(500, "Image generation service is not configured.");

  console.log(`    🎨 Calling Cloudflare AI for image...`);

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, num_steps: 4 }),
    }
  );

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    console.error(`    ❌ Cloudflare AI HTTP ${response.status}:`, JSON.stringify(errBody));
    throw new ApiError(502, `Cloudflare AI failed (HTTP ${response.status}): ${JSON.stringify(errBody)}`);
  }

  // Cloudflare flux-1-schnell returns raw image bytes — NOT JSON.
  // Detect if it accidentally returned JSON (error payload) vs actual image data.
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body: any = await response.json().catch(() => ({}));

    // Cloudflare Workers AI returns { result: { image: "<base64>" }, success: true }
    const base64Image = body?.result?.image;
    if (body?.success && typeof base64Image === "string" && base64Image.length > 0) {
      console.log(`    ✅ Cloudflare image generated (base64 JSON response)`);
      // The base64 string may be JPEG or PNG — detect from the data
      const mimeType = base64Image.startsWith("/9j/") ? "image/jpeg" : "image/png";
      return `data:${mimeType};base64,${base64Image}`;
    }

    // It's JSON but not a successful image response — it's a real error
    console.error(`    ❌ Cloudflare AI returned JSON error:`, JSON.stringify(body));
    throw new ApiError(502, `Cloudflare AI returned an error payload: ${JSON.stringify(body)}`);
  }

  // Raw binary response path (fallback)
  const buffer = await response.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    throw new ApiError(502, "Cloudflare AI returned an empty image buffer.");
  }
  console.log(`    ✅ Cloudflare image generated (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:image/png;base64,${base64}`;
};

// ─────────────────────────────────────────────────────────────
// Generate structured bilingual recipe JSON — Groq
// Model : llama-3.3-70b-versatile
// Free tier: 30 RPM, 14,400 RPD — no daily quota issues.
// API is OpenAI-compatible (same request/response shape).
// ─────────────────────────────────────────────────────────────
const generateRecipeWithGroq = async (
  recipeIndex: number,
  batchNumber: number,
  existingTitles: string[]
): Promise<any> => {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) throw new ApiError(500, "Groq API key is not configured.");

  const avoidTitles = existingTitles.length ? existingTitles.join(", ") : "none yet";

  console.log(`    🤖 Calling Groq (llama-3.3-70b) for recipe ${recipeIndex + 1}...`);

  const prompt = `You are a professional chef and nutritionist.
Generate a unique recipe — number ${recipeIndex + 1} of 30 in batch ${batchNumber}.

RULES:
1. Do NOT reuse any of these titles (English): ${avoidTitles}
2. Return ONLY a valid JSON object — no markdown, no backticks, no explanation.
3. Every human-readable text field must be provided in BOTH English ("en") and Arabic ("ar").
4. Arabic text must be natural, fluent, right-to-left food Arabic — not a literal word-for-word translation.
5. Amounts like "200g" or "1 tbsp" stay as flat strings (no localisation needed).

Use EXACTLY this JSON structure:

{
  "title":       { "en": "Recipe Name in English",  "ar": "اسم الوصفة بالعربي" },
  "description": { "en": "One compelling sentence for the recipe card (max 100 chars)", "ar": "جملة واحدة جذابة للبطاقة (حد أقصى 100 حرف)" },
  "cardTip":     { "en": "Short AI tip for the card (max 80 chars)", "ar": "نصيحة قصيرة من الذكاء الاصطناعي للبطاقة (حد أقصى 80 حرف)" },
  "instructions": {
    "en": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
    "ar": ["الخطوة 1: ...", "الخطوة 2: ...", "الخطوة 3: ..."]
  },
  "aiAdvice": {
    "en": ["Tip 1 in English", "Tip 2 in English", "Tip 3 in English"],
    "ar": ["نصيحة 1 بالعربي", "نصيحة 2 بالعربي", "نصيحة 3 بالعربي"]
  },
  "ingredients": [
    { "name": { "en": "Chicken breast", "ar": "صدر دجاج" }, "amount": "200g", "optional": false },
    { "name": { "en": "Olive oil",      "ar": "زيت زيتون" }, "amount": "1 tbsp", "optional": false },
    { "name": { "en": "Fresh herbs",    "ar": "أعشاب طازجة" }, "amount": "1 handful", "optional": true }
  ],
  "badge": "<one of: keto|vegan|high_protein|low_calorie|low_carb|muscle_gain|premium>",
  "nutrition": {
    "calories": 420,
    "protein": 35,
    "carbohydrates": 28,
    "fat": 12
  },
  "imagePrompt": "Photorealistic food photography of [dish name], beautifully plated, natural lighting, top-down view, high resolution, white background",
  "timeFilters":   ["<zero or more values, each MUST be one of EXACTLY these 4 strings: quick_meal | under_20_min | on_budget | saves_time — NO other strings allowed>"],
  "desireFilters": ["<one or more values, each MUST be one of EXACTLY these 4 strings: savoury | sweet | light | spicy — NO other strings allowed>"],
  "moodFilters":   ["<one or more values, each MUST be one of EXACTLY these 4 strings: healthy | comfort_food | crispy | full_meal — NOTE: 'light' is NOT valid here, it belongs in desireFilters only>"],
  "cuisine":       "<MUST be exactly one of: italian | egyptian | japanese | mexican | indian | arabic | french | asian>",
  "mealTypes":     ["<one or more values, each MUST be one of EXACTLY these 5 strings: breakfast | lunch | dinner | snack | dessert>"],
  "dishType":      "<MUST be exactly one of: pasta | seafood | soup | salad | pizza | grill | sandwich | bowl>",
  "occasionTags":  ["<zero or more values, each MUST be one of EXACTLY these 4 strings: quick_meal | family_dinner | romantic_dinner | healthy_meal_prep>"],
  "healthTags":    ["<zero or more values, each MUST be one of EXACTLY these 7 strings: keto | vegan | high_protein | low_calorie | low_carb | vegetarian | paleo>"],
  "generationBatch": ${batchNumber}
}

CRITICAL FILTER RULES — violating these will break the database schema:
- "light" is ONLY valid in "desireFilters". It is FORBIDDEN in "moodFilters".
- "quick_meal" is ONLY valid in "timeFilters" and "occasionTags". It is FORBIDDEN in any other array.
- Every value in every filter array MUST come from that array's exact allowed list above — do not invent new values.
- Do not add values from one filter's list into a different filter's array.`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0.9,
      max_tokens: 3000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    console.error(`    ❌ Groq HTTP ${response.status}:`, JSON.stringify(errBody));
    throw new ApiError(502, `Groq API failed (HTTP ${response.status}): ${JSON.stringify(errBody)}`);
  }

  const data = await response.json() as any;

  // Surface stop_reason issues (e.g. length, content_filter)
  const stopReason: string = data.choices?.[0]?.finish_reason ?? "unknown";
  if (stopReason !== "stop") {
    console.error(`    ❌ Groq finish_reason=${stopReason} for recipe ${recipeIndex + 1}`, JSON.stringify(data));
    throw new ApiError(502, `Groq stopped with finish_reason=${stopReason} for recipe ${recipeIndex + 1}`);
  }

  const rawText: string = data.choices?.[0]?.message?.content ?? "";
  if (!rawText) {
    console.error(`    ❌ Groq returned empty content. Full response:`, JSON.stringify(data));
    throw new ApiError(502, `Groq returned empty content for recipe ${recipeIndex + 1}`);
  }

  // Strip any accidental markdown fences
  const clean = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  console.log(`    ✅ Groq responded (${clean.length} chars), parsing JSON...`);

  try {
    return JSON.parse(clean);
  } catch (parseErr: any) {
    console.error(`    ❌ JSON parse failed. Raw text (first 500 chars):\n${clean.slice(0, 500)}`);
    throw new ApiError(502, `Groq returned invalid JSON for recipe ${recipeIndex + 1}: ${clean.slice(0, 200)}`);
  }
};

// ─────────────────────────────────────────────────────────────
// Valid enum sets — single source of truth for sanitization.
// Must stay in sync with recipe.model.ts and recipe.validation.ts.
// ─────────────────────────────────────────────────────────────
const VALID_ENUMS = {
  timeFilters: new Set(["quick_meal", "under_20_min", "on_budget", "saves_time"]),
  desireFilters: new Set(["savoury", "sweet", "light", "spicy"]),
  moodFilters: new Set(["healthy", "comfort_food", "crispy", "full_meal"]),
  cuisine: new Set(["italian", "egyptian", "japanese", "mexican", "indian", "arabic", "french", "asian"]),
  mealTypes: new Set(["breakfast", "lunch", "dinner", "snack", "dessert"]),
  dishType: new Set(["pasta", "seafood", "soup", "salad", "pizza", "grill", "sandwich", "bowl"]),
  occasionTags: new Set(["quick_meal", "family_dinner", "romantic_dinner", "healthy_meal_prep"]),
  healthTags: new Set(["keto", "vegan", "high_protein", "low_calorie", "low_carb", "vegetarian", "paleo"]),
  badge: new Set(["keto", "vegan", "high_protein", "low_calorie", "low_carb", "muscle_gain", "premium"]),
} as const;

// ─────────────────────────────────────────────────────────────
// Sanitize LLM output before hitting Mongoose.
// Strips any value that doesn't belong in a given filter array
// so a cross-assigned value (e.g. "light" in moodFilters) never
// reaches Recipe.create() and causes a validation crash.
// Logs every removed value so bad LLM behaviour is visible.
// ─────────────────────────────────────────────────────────────
const sanitizeRecipeFilters = (data: any, recipeIndex: number): any => {
  const sanitizeArray = (field: string, values: any, validSet: Set<string>): string[] => {
    if (!Array.isArray(values)) return [];
    const valid = values.filter((v: any) => typeof v === "string" && validSet.has(v));
    const removed = values.filter((v: any) => !validSet.has(v));
    if (removed.length) {
      console.warn(
        `    ⚠️  Recipe ${recipeIndex + 1}: removed invalid ${field} values: [${removed.join(", ")}]`
      );
    }
    return valid;
  };

  const sanitizeScalar = (field: string, value: any, validSet: Set<string>, fallback: string): string => {
    if (typeof value === "string" && validSet.has(value)) return value;
    console.warn(
      `    ⚠️  Recipe ${recipeIndex + 1}: invalid ${field} value "${value}" — falling back to "${fallback}"`
    );
    return fallback;
  };

  return {
    ...data,
    timeFilters: sanitizeArray("timeFilters", data.timeFilters, VALID_ENUMS.timeFilters),
    desireFilters: sanitizeArray("desireFilters", data.desireFilters, VALID_ENUMS.desireFilters),
    moodFilters: sanitizeArray("moodFilters", data.moodFilters, VALID_ENUMS.moodFilters),
    mealTypes: sanitizeArray("mealTypes", data.mealTypes, VALID_ENUMS.mealTypes),
    occasionTags: sanitizeArray("occasionTags", data.occasionTags, VALID_ENUMS.occasionTags),
    healthTags: sanitizeArray("healthTags", data.healthTags, VALID_ENUMS.healthTags),
    cuisine: sanitizeScalar("cuisine", data.cuisine, VALID_ENUMS.cuisine, "italian"),
    dishType: sanitizeScalar("dishType", data.dishType, VALID_ENUMS.dishType, "bowl"),
    badge: sanitizeScalar("badge", data.badge, VALID_ENUMS.badge, "premium"),
  };
};

// ─────────────────────────────────────────────────────────────
// Core single-recipe pipeline — shared by both the full batch
// loop and the debug endpoint (which calls it once).
// ─────────────────────────────────────────────────────────────
export const generateSingleRecipe = async (
  recipeIndex: number,
  batchNumber: number,
  existingTitles: string[]
): Promise<HydratedDocument<IRecipe>> => {
  // Step 1 — Groq
  const rawRecipeData = await generateRecipeWithGroq(recipeIndex, batchNumber, existingTitles);
  const imagePrompt: string = rawRecipeData.imagePrompt
    ?? `Photorealistic food photo of ${rawRecipeData.title?.en ?? "a dish"}`;
  delete rawRecipeData.imagePrompt;

  // Step 1b — Sanitize all filter/enum fields before they touch Mongoose.
  // This catches any values the LLM cross-assigned to the wrong filter array
  // (e.g. "light" in moodFilters) so Recipe.create() never throws a
  // validation error and leaves an orphaned Cloudinary image behind.
  const recipeData = sanitizeRecipeFilters(rawRecipeData, recipeIndex);

  // Step 2 — Cloudflare image
  console.log(`    📸 Generating image for: ${recipeData.title?.en}`);
  const imageDataUri = await generateRecipeImage(imagePrompt);

  // Step 3 — Cloudinary upload
  const slug = (recipeData.title?.en ?? `recipe-${recipeIndex}`)
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const publicId = `batch-${batchNumber}-${recipeIndex + 1}-${slug}`;
  console.log(`    ☁️  Uploading to Cloudinary as: recipe_images/${publicId}`);
  const imageUrl = await uploadImageToCloudinary(imageDataUri, publicId);

  // Step 4 — MongoDB
  console.log(`    💾 Saving to MongoDB...`);
  const recipe = await Recipe.create({ ...recipeData, imageUrl, generatedAt: new Date() });

  console.log(`    ✅ Saved: "${recipe.title.en}" / "${recipe.title.ar}"`);
  return recipe;
};

// ─────────────────────────────────────────────────────────────
// Weekly generation — 30 bilingual recipes per run
// ─────────────────────────────────────────────────────────────
export const generateWeeklyRecipes = async (): Promise<{ created: number; errors: string[] }> => {
  // Validate all env vars upfront — throws immediately if anything is missing
  validateEnvVars();

  const lastRecipe = await Recipe.findOne().sort({ generationBatch: -1 }).select("generationBatch");
  const batchNumber = (lastRecipe?.generationBatch ?? 0) + 1;

  const errors: string[] = [];
  const created: HydratedDocument<IRecipe>[] = [];
  const existingTitles: string[] = [];

  console.log(`🍳 Starting bilingual recipe generation — batch #${batchNumber}`);

  for (let i = 0; i < 30; i++) {
    try {
      console.log(`\n  ── Recipe ${i + 1}/30 ──`);
      const recipe = await generateSingleRecipe(i, batchNumber, existingTitles);
      existingTitles.push(recipe.title.en);
      created.push(recipe);

      // 3-second pause — stays within Groq free-tier limit of 30 RPM
      // (60s ÷ 30 = 2s minimum; 3s gives a safety buffer).
      // Total run time for 30 recipes: ~1.5 minutes.
      if (i < 29) await new Promise((r) => setTimeout(r, 3000));

    } catch (err: any) {
      const msg = `Recipe ${i + 1} failed: ${err.message}`;
      errors.push(msg);
      console.error(`  ❌ ${msg}`);
      // Continue with remaining recipes even if one fails
    }
  }

  console.log(`\n🏁 Generation complete — ${created.length}/30 saved, ${errors.length} errors.`);
  if (errors.length) console.error("Errors summary:", errors);

  return { created: created.length, errors };
};

// ─────────────────────────────────────────────────────────────
// Flatten localised fields — called before sending to client
// ─────────────────────────────────────────────────────────────
const flattenLang = (recipe: any, lang: Lang): any => {
  const pick = (field: { en: string; ar: string } | undefined) =>
    field ? field[lang] ?? field.en : "";

  return {
    ...recipe,
    title: pick(recipe.title),
    description: pick(recipe.description),
    cardTip: pick(recipe.cardTip),
    instructions: recipe.instructions?.[lang] ?? recipe.instructions?.en ?? [],
    aiAdvice: recipe.aiAdvice?.[lang] ?? recipe.aiAdvice?.en ?? [],
    ingredients: (recipe.ingredients ?? []).map((ing: any) => ({
      ...ing,
      name: pick(ing.name),
    })),
  };
};

// ─────────────────────────────────────────────────────────────
// List recipes with filters + pagination
// ─────────────────────────────────────────────────────────────
export interface ListRecipesInput {
  lang?: Lang;
  time?: string | string[];
  desire?: string | string[];
  mood?: string | string[];
  cuisine?: string;
  mealType?: string | string[];
  dishType?: string;
  occasion?: string | string[];
  health?: string | string[];
  sort?: "newest" | "most_viewed" | "top_rated";
  page?: number;
  limit?: number;
}

export const listRecipes = async (input: ListRecipesInput) => {
  const {
    lang = "en",
    time, desire, mood,
    cuisine, mealType, dishType, occasion, health,
    sort = "newest",
    page = 1,
    limit = 12,
  } = input;

  const filter: Record<string, any> = {};
  const toArray = (v?: string | string[]) => v ? (Array.isArray(v) ? v : [v]) : undefined;

  const t = toArray(time);
  const d = toArray(desire);
  const m = toArray(mood);
  const ml = toArray(mealType);
  const o = toArray(occasion);
  const h = toArray(health);

  if (t) filter.timeFilters = { $in: t };
  if (d) filter.desireFilters = { $in: d };
  if (m) filter.moodFilters = { $in: m };
  if (cuisine) filter.cuisine = cuisine;
  if (ml) filter.mealTypes = { $in: ml };
  if (dishType) filter.dishType = dishType;
  if (o) filter.occasionTags = { $in: o };
  if (h) filter.healthTags = { $in: h };

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    newest: { createdAt: -1 },
    most_viewed: { views: -1 },
    top_rated: { averageRating: -1 },
  };

  const [recipes, total] = await Promise.all([
    Recipe.find(filter)
      .sort(sortMap[sort] ?? sortMap.newest)
      .skip((page - 1) * limit)
      .limit(limit)
      .select("title description imageUrl badge cardTip nutrition.calories nutrition.protein views averageRating ratingCount commentCount createdAt")
      .lean(),
    Recipe.countDocuments(filter),
  ]);

  const localised = recipes.map((r) => flattenLang(r, lang));

  return {
    recipes: localised,
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
// Get single recipe (full detail) — pure read, no side-effects.
// View counting is handled separately by recordView().
// ─────────────────────────────────────────────────────────────
export const getRecipeById = async (
  recipeId: string,
  lang: Lang = "en"
): Promise<any> => {
  const recipe = await Recipe.findById(recipeId).lean();
  if (!recipe) throw new ApiError(404, "Recipe not found.");
  return flattenLang(recipe, lang);
};

// ─────────────────────────────────────────────────────────────
// Record a deduplicated view for a recipe.
// Uses a single atomic $addToSet + conditional $inc so concurrent
// requests from the same viewer are safe without any locking.
//
// viewerKey format:
//   "user:<userId>"   — registered users (from auth middleware)
//   "guest:<hex16>"   — guests (SHA-256 of IP+UA, first 16 chars)
// ─────────────────────────────────────────────────────────────
export const recordView = async (
  recipeId: string,
  viewerKey: string
): Promise<{ views: number }> => {
  // Single atomic operation:
  //   - Filter: document exists AND viewerKey is NOT already in viewedBy
  //   - Update: add the key + increment views in one round-trip
  //   - new: true  → returns the document AFTER the update
  //
  // If the viewer already counted, the filter won't match so
  // findOneAndUpdate returns null — we then fetch the current
  // view count with a plain findById (read-only, no write).
  const updated = await Recipe.findOneAndUpdate(
    {
      _id: recipeId,
      viewedBy: { $not: { $elemMatch: { $eq: viewerKey } } },
    },
    {
      $addToSet: { viewedBy: viewerKey },
      $inc: { views: 1 },
    },
    { new: true, select: "views" }
  );

  if (updated) {
    // First-time view — return the freshly incremented count.
    return { views: updated.views };
  }

  // Either the recipe doesn't exist OR the viewer already counted.
  // Distinguish the two cases with a lightweight existence check.
  const existing = await Recipe.findById(recipeId).select("views").lean();
  if (!existing) throw new ApiError(404, "Recipe not found.");

  // Already counted — return the unchanged view count.
  return { views: (existing as any).views };
};

// ─────────────────────────────────────────────────────────────
// Full-text search recipes — bilingual, with the same filter set
// as listRecipes.  MongoDB $text operator runs against the
// compound text index defined in recipe.model.ts.
//
// Sort behaviour:
//   • No sort param  → order by text relevance score (best match first)
//   • sort param set → use explicit sort field; ignore text score
// ─────────────────────────────────────────────────────────────
export interface SearchRecipesInput extends ListRecipesInput {
  q: string;
}

export const searchRecipes = async (input: SearchRecipesInput) => {
  const {
    lang = "en",
    q,
    time, desire, mood,
    cuisine, mealType, dishType, occasion, health,
    sort,
    page = 1,
    limit = 12,
  } = input;

  if (!q || q.trim().length === 0) {
    throw new ApiError(400, "Search query `q` is required.");
  }

  const filter: Record<string, any> = {
    $text: { $search: q.trim() },
  };

  const toArray = (v?: string | string[]) => v ? (Array.isArray(v) ? v : [v]) : undefined;

  const t = toArray(time);
  const d = toArray(desire);
  const m = toArray(mood);
  const ml = toArray(mealType);
  const o = toArray(occasion);
  const h = toArray(health);

  if (t) filter.timeFilters = { $in: t };
  if (d) filter.desireFilters = { $in: d };
  if (m) filter.moodFilters = { $in: m };
  if (cuisine) filter.cuisine = cuisine;
  if (ml) filter.mealTypes = { $in: ml };
  if (dishType) filter.dishType = dishType;
  if (o) filter.occasionTags = { $in: o };
  if (h) filter.healthTags = { $in: h };

  // When no explicit sort requested, rank by text relevance score.
  // When an explicit sort is requested, use that field instead.
  const sortMap: Record<string, Record<string, 1 | -1>> = {
    newest: { createdAt: -1 },
    most_viewed: { views: -1 },
    top_rated: { averageRating: -1 },
  };

  const sortStage: Record<string, any> = sort
    ? (sortMap[sort] ?? { score: { $meta: "textScore" } })
    : { score: { $meta: "textScore" } };

  const projection =
    "title description imageUrl badge cardTip nutrition.calories nutrition.protein views averageRating ratingCount commentCount createdAt";

  const [recipes, total] = await Promise.all([
    Recipe.find(filter, sort ? {} : { score: { $meta: "textScore" } })
      .sort(sortStage)
      .skip((page - 1) * limit)
      .limit(limit)
      .select(projection)
      .lean(),
    Recipe.countDocuments(filter),
  ]);

  const localised = recipes.map((r) => flattenLang(r, lang));

  return {
    recipes: localised,
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
// Filter options (static — for the filter panel UI)
// ─────────────────────────────────────────────────────────────
export const getFilterOptions = () => ({
  smartFilters: {
    time: ["quick_meal", "under_20_min", "on_budget", "saves_time"],
    desire: ["savoury", "sweet", "light", "spicy"],
    mood: ["healthy", "comfort_food", "crispy", "full_meal"],
  },
  basicFilters: {
    cuisine: ["italian", "egyptian", "japanese", "mexican", "indian", "arabic", "french", "asian"],
    mealType: ["breakfast", "lunch", "dinner", "snack", "dessert"],
    dishType: ["pasta", "seafood", "soup", "salad", "pizza", "grill", "sandwich", "bowl"],
    occasion: ["quick_meal", "family_dinner", "romantic_dinner", "healthy_meal_prep"],
    health: ["keto", "vegan", "high_protein", "low_calorie", "low_carb", "vegetarian", "paleo"],
  },
});