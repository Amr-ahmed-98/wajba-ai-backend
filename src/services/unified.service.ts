// services/unified.service.ts
import mongoose from "mongoose";
import Recipe from "../models/recipe.model.js";
import UserRecipe from "../models/userRecipe.model.js";
import { ApiError } from "../utils/Apierror.js";

export type RecipeSource = "curator" | "user";

export interface ResolvedRecipe {
    source: RecipeSource;
    id: string;
}

// Auto-detect which collection owns this ID.
// Tries curator first (more common), then user recipes.
export const resolveRecipeSource = async (
    recipeId: string
): Promise<ResolvedRecipe> => {
    if (!mongoose.isValidObjectId(recipeId)) {
        throw new ApiError(400, "Invalid recipe ID.");
    }

    const inCurator = await Recipe.exists({ _id: recipeId });
    if (inCurator) return { source: "curator", id: recipeId };

    const inUser = await UserRecipe.exists({ _id: recipeId });
    if (inUser) return { source: "user", id: recipeId };

    throw new ApiError(404, "Recipe not found.");
};

// For user recipes: assert it's public before allowing social actions
export const assertUserRecipeIsPublic = async (
    recipeId: string
): Promise<void> => {
    const recipe = await UserRecipe.findById(recipeId).select("isPublic");
    if (!recipe) throw new ApiError(404, "Recipe not found.");
    if (!recipe.isPublic) {
        throw new ApiError(403, "This recipe has not been published to the community.");
    }
};