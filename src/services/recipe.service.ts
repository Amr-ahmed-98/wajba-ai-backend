import Recipe, { IRecipe } from "../models/recipe.model.js";
import { ApiError } from "../utils/Apierror.js";
import { v2 as cloudinary } from "cloudinary";
import { HydratedDocument } from "mongoose";

// ─────────────────────────────────────────────────────────────
// Supported languages
// ─────────────────────────────────────────────────────────────
export type Lang = "en" | "ar";

export const parseLang = (header?: string): Lang =>
  header === "ar" ? "ar" : "en";

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
    api_key:    CLOUDINARY_API_KEY,
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
        public_id:      `recipe_images/${publicId}`,
        resource_type:  "image",
        transformation: [{ quality: "auto", fetch_format: "auto" }],
      },
      (error, result) => {
        if (error || !result) {
          reject(new ApiError(502, "Failed to upload recipe image to Cloudinary."));
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
  const apiToken  = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) throw new ApiError(500, "Image generation service is not configured.");

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, num_steps: 4 }),
    }
  );

  if (!response.ok) {
    console.error("Cloudflare AI error:", await response.json().catch(() => ({})));
    throw new ApiError(502, "Failed to generate recipe image.");
  }

  const buffer  = await response.arrayBuffer();
  const base64  = Buffer.from(buffer).toString("base64");
  return `data:image/png;base64,${base64}`;
};

// ─────────────────────────────────────────────────────────────
// Generate structured bilingual recipe JSON — Gemini 2.5 Pro
// ─────────────────────────────────────────────────────────────
const generateRecipeWithGemini = async (
  recipeIndex:    number,
  batchNumber:    number,
  existingTitles: string[]
): Promise<any> => {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) throw new ApiError(500, "Gemini API key is not configured.");

  const avoidTitles = existingTitles.length ? existingTitles.join(", ") : "none yet";

  // ── Prompt ────────────────────────────────────────────────────
  // All localised fields must have BOTH "en" and "ar" keys.
  // Amounts stay flat strings ("200g") — numbers are universal.
  // ─────────────────────────────────────────────────────────────
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
  "timeFilters":   ["<zero or more of: quick_meal|under_20_min|on_budget|saves_time>"],
  "desireFilters": ["<one or more of: savoury|sweet|light|spicy>"],
  "moodFilters":   ["<one or more of: healthy|comfort_food|crispy|full_meal>"],
  "cuisine":       "<one of: italian|egyptian|japanese|mexican|indian|arabic|french|asian>",
  "mealTypes":     ["<one or more of: breakfast|lunch|dinner|snack|dessert>"],
  "dishType":      "<one of: pasta|seafood|soup|salad|pizza|grill|sandwich|bowl>",
  "occasionTags":  ["<zero or more of: quick_meal|family_dinner|romantic_dinner|healthy_meal_prep>"],
  "healthTags":    ["<zero or more of: keto|vegan|high_protein|low_calorie|low_carb|vegetarian|paleo>"],
  "generationBatch": ${batchNumber}
}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 3000 },
      }),
    }
  );

  if (!response.ok) {
    console.error("Gemini API error:", await response.json().catch(() => ({})));
    throw new ApiError(502, `Gemini API failed for recipe ${recipeIndex + 1}`);
  }

  const data    = await response.json() as any;
  const rawText: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const clean   = rawText.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(clean);
  } catch {
    throw new ApiError(502, `Gemini returned invalid JSON for recipe ${recipeIndex + 1}: ${clean.slice(0, 200)}`);
  }
};

// ─────────────────────────────────────────────────────────────
// Weekly generation — 30 bilingual recipes per run
// ─────────────────────────────────────────────────────────────
export const generateWeeklyRecipes = async (): Promise<{ created: number; errors: string[] }> => {
  const lastRecipe  = await Recipe.findOne().sort({ generationBatch: -1 }).select("generationBatch");
  const batchNumber = (lastRecipe?.generationBatch ?? 0) + 1;

  const errors:         string[]                   = [];
  const created:        HydratedDocument<IRecipe>[] = [];
  const existingTitles: string[]                   = [];

  console.log(`🍳 Starting bilingual recipe generation — batch #${batchNumber}`);

  for (let i = 0; i < 30; i++) {
    try {
      console.log(`  Generating recipe ${i + 1}/30...`);

      // 1️⃣ Gemini — bilingual structured JSON
      const recipeData  = await generateRecipeWithGemini(i, batchNumber, existingTitles);
      const imagePrompt: string = recipeData.imagePrompt
        ?? `Photorealistic food photo of ${recipeData.title?.en ?? "a dish"}`;
      delete recipeData.imagePrompt; // not stored in DB

      existingTitles.push(recipeData.title?.en ?? `recipe-${i}`);

      // 2️⃣ Cloudflare Workers AI — generate image
      const imageDataUri = await generateRecipeImage(imagePrompt);

      // 3️⃣ Cloudinary — persist image
      const slug     = (recipeData.title?.en ?? `recipe-${i}`)
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
      const publicId = `batch-${batchNumber}-${i + 1}-${slug}`;
      const imageUrl = await uploadImageToCloudinary(imageDataUri, publicId);

      // 4️⃣ MongoDB — save full bilingual document
      const recipe = await Recipe.create({ ...recipeData, imageUrl, generatedAt: new Date() });

      created.push(recipe);
      console.log(`  ✅ ${i + 1}/30 saved: ${recipe.title.en} / ${recipe.title.ar}`);

      // 2-second pause — respects Gemini free-tier RPM limit
      await new Promise((r) => setTimeout(r, 2000));

    } catch (err: any) {
      const msg = `Recipe ${i + 1} failed: ${err.message}`;
      errors.push(msg);
      console.error(`  ❌ ${msg}`);
    }
  }

  return { created: created.length, errors };
};

// ─────────────────────────────────────────────────────────────
// Flatten localised fields — called before sending to client
// Picks only the requested language so the frontend never sees
// the { en, ar } structure — it always gets plain strings.
// ─────────────────────────────────────────────────────────────
const flattenLang = (recipe: any, lang: Lang): any => {
  const pick = (field: { en: string; ar: string } | undefined) =>
    field ? field[lang] ?? field.en : "";

  return {
    ...recipe,
    title:        pick(recipe.title),
    description:  pick(recipe.description),
    cardTip:      pick(recipe.cardTip),
    instructions: recipe.instructions?.[lang] ?? recipe.instructions?.en ?? [],
    aiAdvice:     recipe.aiAdvice?.[lang]     ?? recipe.aiAdvice?.en     ?? [],
    ingredients:  (recipe.ingredients ?? []).map((ing: any) => ({
      ...ing,
      name: pick(ing.name),
    })),
  };
};

// ─────────────────────────────────────────────────────────────
// List recipes with filters + pagination
// ─────────────────────────────────────────────────────────────
export interface ListRecipesInput {
  lang?:     Lang;
  time?:     string | string[];
  desire?:   string | string[];
  mood?:     string | string[];
  cuisine?:  string;
  mealType?: string | string[];
  dishType?: string;
  occasion?: string | string[];
  health?:   string | string[];
  sort?:     "newest" | "most_viewed" | "top_rated";
  page?:     number;
  limit?:    number;
}

export const listRecipes = async (input: ListRecipesInput) => {
  const {
    lang = "en",
    time, desire, mood,
    cuisine, mealType, dishType, occasion, health,
    sort  = "newest",
    page  = 1,
    limit = 12,
  } = input;

  const filter: Record<string, any> = {};
  const toArray = (v?: string | string[]) => v ? (Array.isArray(v) ? v : [v]) : undefined;

  const t = toArray(time);
  const d = toArray(desire);
  const m = toArray(mood);
  const ml= toArray(mealType);
  const o = toArray(occasion);
  const h = toArray(health);

  if (t)  filter.timeFilters   = { $in: t };
  if (d)  filter.desireFilters = { $in: d };
  if (m)  filter.moodFilters   = { $in: m };
  if (cuisine)  filter.cuisine  = cuisine;
  if (ml) filter.mealTypes     = { $in: ml };
  if (dishType) filter.dishType = dishType;
  if (o)  filter.occasionTags  = { $in: o };
  if (h)  filter.healthTags    = { $in: h };

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    newest:      { createdAt: -1 },
    most_viewed: { views: -1 },
    top_rated:   { averageRating: -1 },
  };

  const [recipes, total] = await Promise.all([
    Recipe.find(filter)
      .sort(sortMap[sort] ?? sortMap.newest)
      .skip((page - 1) * limit)
      .limit(limit)
      // Only card-level fields — localised + stats + image
      .select("title description imageUrl badge cardTip nutrition.calories nutrition.protein views averageRating ratingCount commentCount createdAt")
      .lean(),
    Recipe.countDocuments(filter),
  ]);

  // Flatten each recipe to the requested language
  const localised = recipes.map((r) => flattenLang(r, lang));

  return {
    recipes: localised,
    pagination: {
      total,
      page,
      limit,
      totalPages:  Math.ceil(total / limit),
      hasNextPage: page < Math.ceil(total / limit),
    },
  };
};

// ─────────────────────────────────────────────────────────────
// Get single recipe (full detail) + deduplicated view count
// ─────────────────────────────────────────────────────────────
export const getRecipeById = async (
  recipeId:  string,
  viewerKey: string,
  lang:      Lang = "en"
): Promise<any> => {
  const recipe = await Recipe.findById(recipeId).select("+viewedBy");
  if (!recipe) throw new ApiError(404, "Recipe not found.");

  // Increment view exactly once per viewer
  if (!recipe.viewedBy.includes(viewerKey)) {
    recipe.viewedBy.push(viewerKey);
    recipe.views += 1;
    await recipe.save();
  }

  // Convert to plain object, strip viewedBy, then flatten to requested language
  const plain = recipe.toObject() as any;
  delete plain.viewedBy;

  return flattenLang(plain, lang);
};

// ─────────────────────────────────────────────────────────────
// Filter options (static — for the filter panel UI)
// ─────────────────────────────────────────────────────────────
export const getFilterOptions = () => ({
  smartFilters: {
    time:   ["quick_meal","under_20_min","on_budget","saves_time"],
    desire: ["savoury","sweet","light","spicy"],
    mood:   ["healthy","comfort_food","crispy","full_meal"],
  },
  basicFilters: {
    cuisine:  ["italian","egyptian","japanese","mexican","indian","arabic","french","asian"],
    mealType: ["breakfast","lunch","dinner","snack","dessert"],
    dishType: ["pasta","seafood","soup","salad","pizza","grill","sandwich","bowl"],
    occasion: ["quick_meal","family_dinner","romantic_dinner","healthy_meal_prep"],
    health:   ["keto","vegan","high_protein","low_calorie","low_carb","vegetarian","paleo"],
  },
});