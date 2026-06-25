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
// Non-food keywords — if detected, the image is rejected.
// ─────────────────────────────────────────────────────────────
const NON_FOOD_KEYWORDS = new Set([
  "laptop", "computer", "phone", "keyboard", "mouse", "screen", "monitor",
  "table", "chair", "desk", "sofa", "couch", "bed", "pillow", "blanket",
  "shoe", "shoes", "sock", "socks", "hat", "cap", "jacket", "shirt", "pants",
  "glasses", "sunglasses", "watch", "jewelry", "ring", "necklace", "bracelet",
  "wallet", "purse", "bag", "backpack", "suitcase", "luggage", "umbrella",
  "book", "notebook", "pen", "pencil", "paper", "document", "card", "money",
  "coin", "bill", "cash", "credit card", "debit card", "id card", "passport",
  "keys", "key", "remote", "controller", "cable", "charger", "adapter",
  "AGE", "AGE_", "person", "people", "face", "hand", "arm", "leg", "foot",
  "body", "head", "hair", "skin", "eye", "ear", "nose", "mouth", "finger",
  "tooth", "nail", "blood", "bone", "muscle", "diaper", "toy", "doll",
  "ball", "balloon", "kite", "game", "puzzle", "building", "house",
  "car", "truck", "bus", "bike", "motorcycle", "train", "plane", "boat",
  "road", "street", "bridge", "wall", "door", "window", "roof", "floor",
  "ceiling", "light", "lamp", "fan", "air conditioner", "heater",
  "clock", "calendar", "picture", "painting", "mirror", "plant pot",
  "vase", "candle", "decoration", "tissue", "toilet paper", "trash",
  "bin", "bucket", "broom", "mop", "vacuum", "iron", "iron board",
  "hanger", "hook", "shelf", "cabinet", "drawer", "closet", "wardrobe",
  "curtain", "blind", "rug", "carpet", "mat", "towel", "napkin",
  "plate", "bowl", "cup", "glass", "mug", "fork", "spoon", "knife",
  "chopstick", "napkin ring", "placemat", "coaster", "tray", "serving dish",
  "cutting board", "knife block", "spice rack", "pot holder", "oven mitt",
  "apron", "kitchen towel", "dish soap", "sponge", "scrubber", "trash can",
  "recycling bin", "compost bin", "foil", "wrap", "bag", "container",
  "jar", "bottle", "can", "box", "package", "label", "st_eq",
]);

// ─────────────────────────────────────────────────────────────
// Analyse an ingredient photo using Groq's vision model.
// Validates that the image actually contains food/ingredients.
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
              text: `First, determine if this image contains food/ingredients.
If it does NOT contain food or ingredients, return exactly: {"isFood": false, "ingredients": []}
If it DOES contain food/ingredients, return: {"isFood": true, "ingredients": ["ingredient1", "ingredient2", ...]}

Return ONLY valid JSON — no markdown, no explanation.
Identify every food ingredient visible. Use plain English strings — no quantities.
Example: {"isFood": true, "ingredients": ["chicken breast", "olive oil", "garlic", "lemon"]}
If no clear ingredients are visible even though it's food, return: {"isFood": true, "ingredients": []}`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    let errMsg = "Groq vision API returned an error.";
    try { errMsg = JSON.stringify(await (await response.json())); } catch { errMsg = `${response.status} ${response.statusText}`; }
    console.error("❌ Groq vision API error:", errMsg);
    throw new ApiError(502, `Groq vision API failed (${errMsg}). Check server logs.`);
  }

  const data = await response.json() as any;
  const rawText: string = data.choices?.[0]?.message?.content ?? "{\"isFood\":false,\"ingredients\":[]}";
  const clean = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  try {
    const parsed = JSON.parse(clean);

    // Validate the structure
    if (typeof parsed.isFood !== "boolean") {
      console.warn("⚠️ Vision model returned non-food response structure:", clean.slice(0, 200));
      throw new ApiError(422, "Could not verify that the photo contains food. Please upload a photo of ingredients.");
    }

    if (!parsed.isFood) {
      throw new ApiError(422, "The uploaded photo does not appear to contain food or ingredients. Please upload a photo of your ingredients.");
    }

    if (!Array.isArray(parsed.ingredients)) {
      return [];
    }

    const ingredients = [...new Set(
      parsed.ingredients.filter((v: any) => typeof v === "string" && v.trim().length > 0)
    )] as string[];

    // Additional validation: reject known non-food items
    const suspiciousItems = ingredients.filter(ing => {
      const lower = ing.toLowerCase();
      return NON_FOOD_KEYWORDS.has(lower) || NON_FOOD_KEYWORDS.has(lower.replace(/\s+/g, "_"));
    });

    if (suspiciousItems.length > 0) {
      console.warn("⚠️ Non-food items detected in vision response:", suspiciousItems);
      throw new ApiError(422, `The photo does not appear to contain food ingredients. Detected items: ${suspiciousItems.join(", ")}. Please upload a photo of your ingredients.`);
    }

    return ingredients;
  } catch (err: any) {
    if (err instanceof ApiError) throw err;
    console.warn("⚠️ Could not parse vision model response as JSON:", clean.slice(0, 200));
    throw new ApiError(422, "Could not understand the image. Please upload a clearer photo of your ingredients.");
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
5. Amounts like "200g" or "1 tbsp" stay as flat strings (no localisation needed).
6. Ingredient names MUST have both "en" and "ar" keys — see the structure below.

CUISINE ACCURACY — this is critical:
- Choose cuisine based on the ACTUAL cultural origin of the dish you generate.
- Examples: Pancakes → american (but "american" is not in the list — map to "asian" is WRONG).
  Use the closest correct option from the allowed list.
- Pancakes, Burgers, BBQ Ribs → use "french" or the closest Western option available.
- Do NOT assign "arabic" to Western dishes. Do NOT assign "italian" to Asian dishes.
- Think: "What country/region did this dish actually originate from?"
- Only use "arabic" for dishes that genuinely originate from Arab cuisine
  (e.g. Koshari, Shawarma, Fatteh, Mansaf, Kibbeh).

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
    { "name": { "en": "Chicken breast", "ar": "صدر دجاج" }, "amount": "200g", "optional": false },
    { "name": { "en": "Olive oil",      "ar": "زيت زيتون" }, "amount": "1 tbsp", "optional": false },
    { "name": { "en": "Fresh herbs",    "ar": "أعشاب طازجة" }, "amount": "1 handful", "optional": true }
  ],
  "sourceIngredients": [
    { "en": "Chicken breast", "ar": "صدر دجاج" },
    { "en": "Olive oil",      "ar": "زيت زيتون" }
  ],
  "missingIngredients": [
    { "en": "Fresh herbs", "ar": "أعشاب طازجة" }
  ],
  "badge": "<one of: keto|vegan|high_protein|low_calorie|low_carb|muscle_gain|premium>",
  "nutrition": {
    "calories": 420,
    "protein": 35,
    "carbohydrates": 28,
    "fat": 12
  },
  "imagePrompt": "Photorealistic food photography of [dish name], beautifully plated, natural lighting, top-down view, high resolution",
  "cuisine": "<MUST be exactly one of: italian|egyptian|japanese|mexican|indian|arabic|french|asian — pick based on the dish's TRUE cultural origin>",
  "mealTypes": ["<one or more of: breakfast|lunch|dinner|snack|dessert>"],
  "dishType": "<MUST be exactly one of: pasta|seafood|soup|salad|pizza|grill|sandwich|bowl>",
  "healthTags": ["<zero or more of: keto|vegan|high_protein|low_calorie|low_carb|vegetarian|paleo>"]

IMPORTANT for sourceIngredients and missingIngredients:
- "sourceIngredients" must mirror the user's available ingredients list: ${ingredientList}
- "missingIngredients" must mirror the missing/extra ingredients list: ${missingList === "none" ? "[]" : missingList}
- Translate each into Arabic. These are plain ingredient names, not recipe steps.
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

  // Step 2 — Sanitize enums so Mongoose never crashes on bad LLM output.
  // Cuisine fallback is "italian" (neutral Western default) — NOT "arabic",
  // which was causing wrong cuisine assignments for Western dishes.
  raw.badge = sanitizeScalar(raw.badge, VALID_ENUMS.badge, "premium");
  raw.cuisine = sanitizeScalar(raw.cuisine, VALID_ENUMS.cuisine, "italian");
  raw.dishType = sanitizeScalar(raw.dishType, VALID_ENUMS.dishType, "bowl");
  raw.mealTypes = sanitizeArray(raw.mealTypes, VALID_ENUMS.mealTypes);
  raw.healthTags = sanitizeArray(raw.healthTags, VALID_ENUMS.healthTags);

  // Flatten bilingual ingredient names into { name: string (EN), nameAr: string (AR) }.
  // The Mongoose schema defines `name` as a plain String — storing an object crashes it.
  // We keep the Arabic text in the separate `nameAr` field instead.
  if (Array.isArray(raw.ingredients)) {
    raw.ingredients = raw.ingredients.map((ing: any) => {
      const enName = typeof ing.name === "object"
        ? (ing.name.en ?? "")
        : (ing.name ?? "");
      const arName = typeof ing.name === "object"
        ? (ing.name.ar ?? ing.name.en ?? "")
        : (ing.name ?? "");
      return { name: enName, nameAr: arName, amount: ing.amount ?? "", optional: ing.optional ?? false };
    });
  }

  // Normalise sourceIngredients — LLM returns [{ en, ar }] or plain strings.
  const normalisedSourceIngredients: Array<{ en: string; ar: string }> =
    Array.isArray(raw.sourceIngredients)
      ? raw.sourceIngredients.map((s: any) =>
        typeof s === "object"
          ? { en: s.en ?? "", ar: s.ar ?? s.en ?? "" }
          : { en: String(s), ar: String(s) }
      )
      : ingredients.map((s) => ({ en: s, ar: s })); // fallback — no Arabic translation

  // Normalise missingIngredients — same pattern.
  const normalisedMissingIngredients: Array<{ en: string; ar: string }> =
    Array.isArray(raw.missingIngredients)
      ? raw.missingIngredients.map((s: any) =>
        typeof s === "object"
          ? { en: s.en ?? "", ar: s.ar ?? s.en ?? "" }
          : { en: String(s), ar: String(s) }
      )
      : missingIngredients.map((s) => ({ en: s, ar: s }));

  // Build the document payload — validated BEFORE generating the image.
  // This catches any remaining Mongoose validation errors cheaply,
  // so we never waste a Cloudflare AI + Cloudinary round-trip on bad data.
  const docPayload = {
    owner: owner.id,
    ownerName: owner.name,
    ownerPhoto: owner.photo,
    isPublic,
    sourceIngredients: normalisedSourceIngredients,
    missingIngredients: normalisedMissingIngredients,
    title: raw.title,
    description: raw.description,
    cardTip: raw.cardTip,
    instructions: raw.instructions,
    aiAdvice: raw.aiAdvice,
    ingredients: raw.ingredients,
    imageUrl: "pending", // placeholder — replaced after upload
    badge: raw.badge,
    nutrition: raw.nutrition,
    cuisine: raw.cuisine,
    mealTypes: raw.mealTypes,
    dishType: raw.dishType,
    healthTags: raw.healthTags,
  };

  // Dry-run validation — throws a Mongoose ValidationError immediately if
  // anything in docPayload is wrong, BEFORE we spend time generating an image.
  const dryDoc = new UserRecipe(docPayload);
  await dryDoc.validate();

  // Step 3 — Generate AI dish image (only reached if validation passed)
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

  // Step 5 — Persist (reuse the validated payload, swap in the real imageUrl)
  const recipe = await UserRecipe.create({ ...docPayload, imageUrl });

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
// Translation maps — enum values stored in DB are English keys;
// these maps localise them for Arabic-speaking users.
// ─────────────────────────────────────────────────────────────
const CUISINE_AR: Record<string, string> = {
  italian: "إيطالية",
  egyptian: "مصرية",
  japanese: "يابانية",
  mexican: "مكسيكية",
  indian: "هندية",
  arabic: "عربية",
  french: "فرنسية",
  asian: "آسيوية",
};

const MEAL_TYPE_AR: Record<string, string> = {
  breakfast: "إفطار",
  lunch: "غداء",
  dinner: "عشاء",
  snack: "وجبة خفيفة",
  dessert: "حلوى",
};

const DISH_TYPE_AR: Record<string, string> = {
  pasta: "معكرونة",
  seafood: "مأكولات بحرية",
  soup: "شوربة",
  salad: "سلطة",
  pizza: "بيتزا",
  grill: "مشويات",
  sandwich: "ساندويش",
  bowl: "طبق",
};

const HEALTH_TAG_AR: Record<string, string> = {
  keto: "كيتو",
  vegan: "نباتي",
  high_protein: "عالي البروتين",
  low_calorie: "منخفض السعرات",
  low_carb: "منخفض الكربوهيدرات",
  vegetarian: "نباتي (لاكتو)",
  paleo: "باليو",
};

// ─────────────────────────────────────────────────────────────
// Flatten localised fields for a UserRecipe document.
// Handles:
//   • bilingual text fields (title, description, cardTip, …)
//   • bilingual ingredient names  { en, ar }
//   • bilingual sourceIngredients / missingIngredients  [{ en, ar }]
//   • enum fields (cuisine, mealTypes, dishType, healthTags)
//     — returned as the localised string for Arabic, English key for English
// ─────────────────────────────────────────────────────────────
export const flattenUserRecipe = (recipe: any, lang: Lang): any => {
  const pick = (field: { en: string; ar: string } | undefined) =>
    field ? (field[lang] ?? field.en) : "";

  // Localise a plain enum string using the provided translation map.
  // Falls back to the raw English key so nothing is ever blank.
  const localiseEnum = (value: string | undefined, map: Record<string, string>): string => {
    if (!value) return "";
    return lang === "ar" ? (map[value] ?? value) : value;
  };

  // Localise an array of enum strings.
  const localiseEnumArray = (values: string[] | undefined, map: Record<string, string>): string[] => {
    if (!Array.isArray(values)) return [];
    return values.map((v) => (lang === "ar" ? (map[v] ?? v) : v));
  };

  // Localise an array of { en, ar } objects (sourceIngredients / missingIngredients).
  const pickArray = (arr: Array<{ en: string; ar: string }> | string[] | undefined): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr.map((item) =>
      typeof item === "object" ? (item[lang] ?? item.en ?? "") : String(item)
    );
  };

  return {
    ...recipe,
    title: pick(recipe.title),
    description: pick(recipe.description),
    cardTip: pick(recipe.cardTip),
    instructions: recipe.instructions?.[lang] ?? recipe.instructions?.en ?? [],
    aiAdvice: recipe.aiAdvice?.[lang] ?? recipe.aiAdvice?.en ?? [],
    // Ingredients: stored as { name: string (EN), nameAr?: string (AR) }.
    // Return the Arabic name when available and lang === "ar".
    ingredients: (recipe.ingredients ?? []).map((ing: any) => ({
      ...ing,
      name: lang === "ar" && ing.nameAr ? ing.nameAr : ing.name,
    })),
    // Ingredient lists stored as [{ en, ar }]
    sourceIngredients: pickArray(recipe.sourceIngredients),
    missingIngredients: pickArray(recipe.missingIngredients),
    // Enum fields — localised for Arabic
    cuisine: localiseEnum(recipe.cuisine, CUISINE_AR),
    dishType: localiseEnum(recipe.dishType, DISH_TYPE_AR),
    mealTypes: localiseEnumArray(recipe.mealTypes, MEAL_TYPE_AR),
    healthTags: localiseEnumArray(recipe.healthTags, HEALTH_TAG_AR),
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
// ── Increment viewCount on detail fetch ───────────────────────

export const getUserRecipeById = async (
  recipeId: string,
  requesterId?: string,
  lang: Lang = "en"
): Promise<any> => {
  if (!mongoose.isValidObjectId(recipeId)) {
    throw new ApiError(400, "Invalid recipe ID.");
  }

  // Atomically increment viewCount and return the updated doc
  const recipe = await UserRecipe.findByIdAndUpdate(
    recipeId,
    { $inc: { viewCount: 1 } },
    { new: true }
  ).lean();

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

// ─────────────────────────────────────────────────────────────
// ADD these two functions to the bottom of userRecipe.service.ts
// ─────────────────────────────────────────────────────────────



// ── Bookmark toggle ───────────────────────────────────────────
// Stored on UserRecipe.bookmarkedBy (same pattern as likedBy).
// Frontend "my bookmarks" should query GET /user-recipes/my-recipes
// filtered client-side, OR maintain a separate bookmarks array on User.
// This function toggles the bookmark and syncs bookmarkCount.
export const bookmarkUserRecipe = async (
  recipeId: string,
  userId: string
): Promise<{ bookmarked: boolean; bookmarkCount: number }> => {
  if (!mongoose.isValidObjectId(recipeId)) {
    throw new ApiError(400, "Invalid recipe ID.");
  }

  const recipe = await UserRecipe.findById(recipeId).select("+bookmarkedBy");
  if (!recipe) throw new ApiError(404, "Recipe not found.");
  if (!recipe.isPublic) throw new ApiError(403, "Only public community recipes can be bookmarked.");

  const already = (recipe.bookmarkedBy ?? []).includes(userId);

  if (already) {
    recipe.bookmarkedBy = recipe.bookmarkedBy.filter((id) => id !== userId);
    recipe.bookmarkCount = Math.max(0, (recipe.bookmarkCount ?? 1) - 1);
  } else {
    recipe.bookmarkedBy.push(userId);
    recipe.bookmarkCount = (recipe.bookmarkCount ?? 0) + 1;
  }

  await recipe.save();
  return { bookmarked: !already, bookmarkCount: recipe.bookmarkCount };
};