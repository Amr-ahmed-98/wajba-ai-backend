import { Request, Response, NextFunction } from "express";
import * as userRecipeService from "../../../services/userRecipe.service.js";
import { parseLang } from "../../../services/recipe.service.js";
import { ApiError } from "../../../utils/Apierror.js";

// ─────────────────────────────────────────────────────────────
// Helper — read Accept-Language header and resolve to "en" | "ar"
// ─────────────────────────────────────────────────────────────
const getLang = (req: Request) =>
  parseLang(req.headers["accept-language"] as string | undefined);

// ─────────────────────────────────────────────────────────────
// Typed helper — extract authenticated user from request.
// Auth middleware sets req.user = { id, name, photo }.
// ─────────────────────────────────────────────────────────────
const requireUser = (req: Request): { id: string; name: string; photo: string | null } => {
  const user = (req as any).user;
  if (!user?.id) throw new ApiError(401, "Authentication required.");
  return {
    id: user.id as string,
    name: (user.name ?? "User") as string,
    photo: (user.photo ?? null) as string | null,
  };
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/user-recipes/generate-from-text
// Generate recipe(s) from typed ingredient list.
// ─────────────────────────────────────────────────────────────
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

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/user-recipes/generate-from-photo
// Upload an ingredient photo, AI analyses it, then generate recipe(s).
// ─────────────────────────────────────────────────────────────
export const generateFromPhoto = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id, name, photo } = requireUser(req);

    if (!req.file) {
      throw new ApiError(400, "No image file uploaded.");
    }

    // Parse optional fields from form-data
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

    // Analyze the uploaded image
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

    res.status(201).json({ success: true, data: { detectedIngredients, ...result } });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/user-recipes/community
// Public — list public community recipes with sort & pagination.
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// GET /api/v1/user-recipes/my-recipes
// Authenticated — list current user's own recipes (public + private).
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// GET /api/v1/user-recipes/:id
// Public for community recipes; private requires owner auth.
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// POST /api/v1/user-recipes/:id/react
// Authenticated — like or dislike a community recipe (toggle).
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// PATCH /api/v1/user-recipes/:id/visibility
// Authenticated — toggle recipe public/private (owner only).
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/user-recipes/:id
// Authenticated — delete recipe + Cloudinary image (owner only).
// ─────────────────────────────────────────────────────────────
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
