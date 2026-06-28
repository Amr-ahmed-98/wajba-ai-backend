import { Request, Response, NextFunction } from "express";
import * as userRecipeService from "../../../services/userRecipe.service.js";
import { parseLang } from "../../../services/recipe.service.js";
import { ApiError } from "../../../utils/Apierror.js";

const getLang = (req: Request) =>
  parseLang(req.headers["accept-language"] as string | undefined);

const requireUser = (req: Request): { id: string; name: string; photo: string | null } => {
  const user = (req as any).user;
  if (!user?.id) throw new ApiError(401, "Authentication required.");
  return {
    id: user.id as string,
    name: (user.name ?? "User") as string,
    photo: (user.photo ?? null) as string | null,
  };
};

// ── Helper: stringify errors safely ──────────────────────────
// Previously `result.errors[0]` could be an object → "[object Object]"
const stringifyError = (err: unknown): string => {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return "Unknown error"; }
};

// ── POST /generate-from-text ──────────────────────────────────

export const generateFromText = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id, name, photo } = requireUser(req);
    const { ingredients, missingIngredients, isPublic, count } = req.body;

    const result = await userRecipeService.generateUserRecipes({
      ingredients,
      missingIngredients: missingIngredients ?? [],
      owner: { id, name, photo },
      isPublic: isPublic ?? false,
      count: count ?? 1,
      lang: getLang(req),
    });

    if (result.recipes.length === 0 && result.errors.length > 0) {
      throw new ApiError(502, stringifyError(result.errors[0]));
    }

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// ── POST /generate-from-photo ─────────────────────────────────

export const generateFromPhoto = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id, name, photo } = requireUser(req);

    // Multer errors are caught by handleMulterError middleware in the route,
    // so if we reach here without req.file it's a genuine missing-file error.
    if (!req.file) {
      throw new ApiError(400, "No image file uploaded. Send a JPEG, PNG, or WEBP as the 'photo' field.");
    }

    let missingIngredients: string[] = [];
    if (req.body.missingIngredients) {
      try {
        missingIngredients = JSON.parse(req.body.missingIngredients);
        if (!Array.isArray(missingIngredients)) missingIngredients = [];
      } catch {
        missingIngredients = [];
      }
    }
    const isPublic = req.body.isPublic === "true" || req.body.isPublic === true;
    const rawCount = parseInt(req.body.count ?? "1", 10);
    const count = isNaN(rawCount) ? 1 : Math.min(Math.max(rawCount, 1), 5);

    const detectedIngredients = await userRecipeService.analyzeIngredientsFromImage(
      req.file.buffer,
      req.file.mimetype
    );

    if (!detectedIngredients.length) {
      throw new ApiError(422, "Could not detect any ingredients from the uploaded photo.");
    }

    const result = await userRecipeService.generateUserRecipes({
      ingredients: detectedIngredients,
      missingIngredients,
      owner: { id, name, photo },
      isPublic,
      count,
      lang: getLang(req),
    });

    if (result.recipes.length === 0 && result.errors.length > 0) {
      throw new ApiError(502, stringifyError(result.errors[0]));
    }

    res.status(201).json({ success: true, data: { detectedIngredients, ...result } });
  } catch (error) {
    next(error);
  }
};

// ── GET /community ────────────────────────────────────────────

export const listCommunity = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await userRecipeService.listCommunityRecipes({
      lang: getLang(req),
      sort: (req.query.sort as "newest" | "most_liked" | "top_rated") ?? "newest",
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    res.status(200).json({ success: true, data: result.recipes, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
};

// ── GET /my-recipes ───────────────────────────────────────────

export const listMyRecipes = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = requireUser(req);
    const result = await userRecipeService.listMyRecipes(
      id,
      getLang(req),
      req.query.page ? Number(req.query.page) : undefined,
      req.query.limit ? Number(req.query.limit) : undefined
    );

    res.status(200).json({ success: true, data: result.recipes, pagination: result.pagination });
  } catch (error) {
    next(error);
  }
};

// ── GET /:id ──────────────────────────────────────────────────
// Increments viewCount on every access (public or owner).

export const getUserRecipeById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const recipe = await userRecipeService.getUserRecipeById(
      req.params.id as string,
      userId,
      getLang(req)
    );

    res.status(200).json({ success: true, data: recipe });
  } catch (error) {
    next(error);
  }
};

// ── POST /:id/react ───────────────────────────────────────────

export const reactToRecipe = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id: userId } = requireUser(req);
    const { reaction } = req.body;

    const counts = await userRecipeService.reactToUserRecipe(
      req.params.id as string,
      userId,
      reaction
    );

    res.status(200).json({ success: true, data: counts });
  } catch (error) {
    next(error);
  }
};

// ── PATCH /:id/visibility ─────────────────────────────────────

export const toggleVisibility = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id: userId } = requireUser(req);
    const result = await userRecipeService.toggleVisibility(
      req.params.id as string,
      userId
    );

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// ── DELETE /:id ───────────────────────────────────────────────

export const deleteUserRecipe = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id: userId } = requireUser(req);
    await userRecipeService.deleteUserRecipe(req.params.id as string, userId);

    res.status(200).json({ success: true, message: "Recipe deleted." });
  } catch (error) {
    next(error);
  }
};