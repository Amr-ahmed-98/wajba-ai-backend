import { Request, Response, NextFunction } from "express";
import * as recipeService from "../../../services/recipe.service.js";
import { parseLang } from "../../../services/recipe.service.js";
import crypto from "crypto";

// ─────────────────────────────────────────────────────────────
// Helper — read Accept-Language header and resolve to "en" | "ar"
// ─────────────────────────────────────────────────────────────
const getLang = (req: Request) =>
  parseLang(req.headers["accept-language"] as string | undefined);

// ─────────────────────────────────────────────────────────────
// Helper — build a deduplication key for the view counter.
// Auth users  → their user ID
// Guests      → SHA-256 hash of IP + User-Agent (no PII stored)
// ─────────────────────────────────────────────────────────────
const buildViewerKey = (req: Request): string => {
  const userId = (req as any).user?.id;
  if (userId) return `user:${userId}`;

  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const ua = req.headers["user-agent"] ?? "unknown";
  return `guest:${crypto
    .createHash("sha256")
    .update(`${ip}:${ua}`)
    .digest("hex")
    .slice(0, 16)}`;
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/generate
// Admin-only (x-admin-secret header).
// Returns 202 immediately — generation runs in the background.
// ─────────────────────────────────────────────────────────────
export const generateRecipes = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const secret         = req.headers["x-admin-secret"];
    const expectedSecret = process.env.ADMIN_GENERATION_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      res.status(403).json({ success: false, message: "Forbidden. Invalid admin secret." });
      return;
    }

    // Send 202 first so the HTTP connection doesn't time out.
    res.status(202).json({
      success: true,
      message: "Recipe generation started. Check server logs for progress.",
    });

    // Use setImmediate so the .catch() handler is guaranteed to be attached
    // before the async work begins — prevents the silent-crash race condition.
    setImmediate(() => {
      recipeService
        .generateWeeklyRecipes()
        .then(({ created, errors }) => {
          console.log(`✅ Generation complete: ${created}/30 recipes saved.`);
          if (errors.length) console.error("⚠️  Errors during generation:", errors);
        })
        .catch((err: any) =>
          console.error("❌ Generation crashed:", err.message, "\n", err.stack)
        );
    });

  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/generate-debug
// Admin-only — TEMPORARY endpoint for diagnosing generation issues.
// Runs the full pipeline for exactly 1 recipe synchronously and
// returns the result (or full error) directly in the response.
// DELETE THIS ENDPOINT once generation is confirmed working.
// ─────────────────────────────────────────────────────────────
export const generateRecipesDebug = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const secret         = req.headers["x-admin-secret"];
    const expectedSecret = process.env.ADMIN_GENERATION_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      res.status(403).json({ success: false, message: "Forbidden. Invalid admin secret." });
      return;
    }

    console.log("🔍 DEBUG: Starting single-recipe synchronous generation test...");

    // Check env vars and surface missing ones immediately in the response
    const requiredVars = [
      "GEMINI_API_KEY",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
    ];
    const missingVars = requiredVars.filter((k) => !process.env[k]);
    if (missingVars.length) {
      res.status(500).json({
        success: false,
        message: "Missing environment variables — generation cannot start.",
        missingVars,
      });
      return;
    }

    const recipe = await recipeService.generateSingleRecipe(0, 9999, []);

    res.status(200).json({
      success: true,
      message: "Debug recipe generated and saved successfully.",
      data: {
        id:       recipe._id,
        titleEn:  recipe.title.en,
        titleAr:  recipe.title.ar,
        imageUrl: recipe.imageUrl,
        badge:    recipe.badge,
      },
    });

  } catch (err: any) {
    // Return the full error to the caller — not just a 500 page
    console.error("❌ DEBUG generation failed:", err.message, err.stack);
    res.status(500).json({
      success: false,
      message: err.message,
      stack:   process.env.NODE_ENV !== "production" ? err.stack : undefined,
    });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/recipes
// Public — paginated list with optional filters.
// ─────────────────────────────────────────────────────────────
export const listRecipes = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await recipeService.listRecipes({
      lang:     getLang(req),
      time:     req.query.time     as string | string[] | undefined,
      desire:   req.query.desire   as string | string[] | undefined,
      mood:     req.query.mood     as string | string[] | undefined,
      cuisine:  req.query.cuisine  as string | undefined,
      mealType: req.query.mealType as string | string[] | undefined,
      dishType: req.query.dishType as string | undefined,
      occasion: req.query.occasion as string | string[] | undefined,
      health:   req.query.health   as string | string[] | undefined,
      sort:     req.query.sort     as "newest" | "most_viewed" | "top_rated" | undefined,
      page:     req.query.page     ? Number(req.query.page)  : undefined,
      limit:    req.query.limit    ? Number(req.query.limit) : undefined,
    });

    res.status(200).json({
      success:    true,
      data:       result.recipes,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/recipes/filters
// Public — returns all valid filter option keys for the UI panel.
// ─────────────────────────────────────────────────────────────
export const getFilterOptions = (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: recipeService.getFilterOptions(),
  });
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/recipes/:id
// Public — full recipe detail in the requested language.
// ─────────────────────────────────────────────────────────────
export const getRecipeById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const recipe = await recipeService.getRecipeById(
      req.params.id as string,
      buildViewerKey(req),
      getLang(req)
    );

    res.status(200).json({ success: true, data: recipe });
  } catch (error) {
    next(error);
  }
};