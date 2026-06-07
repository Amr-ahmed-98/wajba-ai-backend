import { Request, Response, NextFunction } from "express";
import * as recipeService from "../../../services/recipe.service.js";
import { parseLang } from "../../../services/recipe.service.js";
import crypto from "crypto";

// ─────────────────────────────────────────────────────────────
// Helper — read Accept-Language header and resolve to "en" | "ar"
// Defaults to "en" if the header is missing or unrecognised.
// ─────────────────────────────────────────────────────────────
const getLang = (req: Request) => parseLang(req.headers["accept-language"] as string | undefined);

// ─────────────────────────────────────────────────────────────
// Helper — build a deduplication key for the view counter.
// Auth users  → their user ID
// Guests      → SHA-256 hash of IP + User-Agent (no PII stored)
// ─────────────────────────────────────────────────────────────
const buildViewerKey = (req: Request): string => {
  const userId = (req as any).user?.id;
  if (userId) return `user:${userId}`;

  const ip  = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const ua  = req.headers["user-agent"] ?? "unknown";
  return `guest:${crypto.createHash("sha256").update(`${ip}:${ua}`).digest("hex").slice(0, 16)}`;
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/generate
// Admin-only (x-admin-secret header).
// Triggers 30-recipe bilingual generation in the background.
// Returns 202 immediately — generation takes 2-4 minutes.
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

    res.status(202).json({
      success: true,
      message: "Recipe generation started. Check server logs for progress.",
    });

    recipeService.generateWeeklyRecipes()
      .then(({ created, errors }) => {
        console.log(`✅ Generation complete: ${created}/30 recipes saved.`);
        if (errors.length) console.error("⚠️  Errors during generation:", errors);
      })
      .catch((err) => console.error("❌ Generation crashed:", err));

  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/recipes
// Public — paginated list with optional filters.
// Language resolved from Accept-Language header (en / ar).
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
      success: true,
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
// Increments view count exactly once per unique viewer.
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