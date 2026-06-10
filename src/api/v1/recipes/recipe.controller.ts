import { Request, Response, NextFunction } from "express";
import * as recipeService from "../../../services/recipe.service.js";
import { parseLang } from "../../../services/recipe.service.js";

// ─────────────────────────────────────────────────────────────
// Helper — read Accept-Language header and resolve to "en" | "ar"
// ─────────────────────────────────────────────────────────────
const getLang = (req: Request) =>
  parseLang(req.headers["accept-language"] as string | undefined);


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
    const secret = req.headers["x-admin-secret"];
    const expectedSecret = process.env.ADMIN_GENERATION_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      res.status(403).json({ success: false, message: "Forbidden. Invalid admin secret." });
      return;
    }

    res.status(202).json({
      success: true,
      message: "Recipe generation started. Check server logs for progress.",
    });

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
// DELETE once generation is confirmed working.
// ─────────────────────────────────────────────────────────────
export const generateRecipesDebug = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const secret = req.headers["x-admin-secret"];
    const expectedSecret = process.env.ADMIN_GENERATION_SECRET;

    if (!expectedSecret || secret !== expectedSecret) {
      res.status(403).json({ success: false, message: "Forbidden. Invalid admin secret." });
      return;
    }

    console.log("🔍 DEBUG: Starting single-recipe synchronous generation test...");

    const requiredVars = [
      "GROQ_API_KEY",
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
        id: recipe._id,
        titleEn: recipe.title.en,
        titleAr: recipe.title.ar,
        imageUrl: recipe.imageUrl,
        badge: recipe.badge,
      },
    });

  } catch (err: any) {
    console.error("❌ DEBUG generation failed:", err.message, err.stack);
    res.status(500).json({
      success: false,
      message: err.message,
      stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    });
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
      lang: getLang(req),
      time: req.query.time as string | string[] | undefined,
      desire: req.query.desire as string | string[] | undefined,
      mood: req.query.mood as string | string[] | undefined,
      cuisine: req.query.cuisine as string | undefined,
      mealType: req.query.mealType as string | string[] | undefined,
      dishType: req.query.dishType as string | undefined,
      occasion: req.query.occasion as string | string[] | undefined,
      health: req.query.health as string | string[] | undefined,
      sort: req.query.sort as "newest" | "most_viewed" | "top_rated" | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    res.status(200).json({
      success: true,
      data: result.recipes,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/recipes/search
// Public — full-text search across title + description in both
// English and Arabic, combined with the same filter set as the
// list endpoint.
//
// Query params:
//   q        — required, free-text (en or ar), 1–100 chars
//   + all filter/sort/page/limit params identical to GET /recipes
//
// How it works:
//   MongoDB $text operator runs against the compound text index
//   defined in recipe.model.ts (title.en, title.ar,
//   description.en, description.ar, weights 10/5).
//   When sort=newest|most_viewed|top_rated the text score is
//   ignored and the explicit sort field is used instead; when no
//   sort is specified the results are ordered by text score
//   (most relevant first).
// ─────────────────────────────────────────────────────────────
export const searchRecipes = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await recipeService.searchRecipes({
      lang: getLang(req),
      q: req.query.q as string,
      time: req.query.time as string | string[] | undefined,
      desire: req.query.desire as string | string[] | undefined,
      mood: req.query.mood as string | string[] | undefined,
      cuisine: req.query.cuisine as string | undefined,
      mealType: req.query.mealType as string | string[] | undefined,
      dishType: req.query.dishType as string | undefined,
      occasion: req.query.occasion as string | string[] | undefined,
      health: req.query.health as string | string[] | undefined,
      sort: req.query.sort as "newest" | "most_viewed" | "top_rated" | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    res.status(200).json({
      success: true,
      data: result.recipes,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/recipes/:id
// Public — full recipe detail page in the requested language.
//
// FIX: view counting has been REMOVED from this handler.
// The GET endpoint is now pure read — it returns the recipe
// exactly as stored without any side-effects. The client must
// make a separate POST /api/v1/recipes/:id/view call to register
// a view (see recordView below).
//
// Response shape matches the UI screenshot:
//   title, description, imageUrl, badge, cardTip,
//   nutrition (calories, protein, carbohydrates, fat),
//   ingredients[], instructions[], aiAdvice[],
//   views, averageRating, ratingCount, commentCount
// ─────────────────────────────────────────────────────────────
export const getRecipeById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const recipe = await recipeService.getRecipeById(
      req.params.id as string,
      getLang(req)
    );

    res.status(200).json({ success: true, data: recipe });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/recipes/:id/view
// Public — registers one view for this recipe from this viewer.
//
// Deduplication rules:
//   • Registered users  → deduplicated by their user ID
//     (extracted from req.user set by auth middleware)
//   • Guest users       → deduplicated by SHA-256(IP + User-Agent)
//     truncated to 16 hex chars — no PII stored in the DB
//
// In both cases the viewer key is added to the recipe's
// `viewedBy` array (select: false — never exposed by the API)
// using a $addToSet + $inc atomic update so concurrent requests
// are safe without any application-level locking.
//
// Returns the updated view count so the client can reflect it
// immediately without a second GET request.
// ─────────────────────────────────────────────────────────────
export const recordView = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Only registered users can record views.
    // Guests cannot reach the detail page, so no guest path is needed.
    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Authentication required to record a view." });
      return;
    }

    const viewerKey = `user:${userId}`;
    const updated = await recipeService.recordView(req.params.id as string, viewerKey);

    // 404 is thrown inside the service if the recipe doesn't exist
    res.status(200).json({
      success: true,
      data: { views: updated.views },
    });
  } catch (error) {
    next(error);
  }
};