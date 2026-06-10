import User from "../models/user.model.js";
import Recipe from "../models/recipe.model.js";
import { ApiError } from "../utils/Apierror.js";
import { Lang, flattenLang } from "../services/recipe.service.js";


// ─────────────────────────────────────────────────────────────
// Add a bookmark
// Uses $addToSet so bookmarking the same recipe twice is a no-op
// — the client always gets a success response either way.
// ─────────────────────────────────────────────────────────────
export const addBookmark = async (
    userId: string,
    recipeId: string
): Promise<{ bookmarkCount: number }> => {
    // Verify recipe exists before touching the user document
    const recipeExists = await Recipe.exists({ _id: recipeId });
    if (!recipeExists) throw new ApiError(404, "Recipe not found.");

    const user = await User.findByIdAndUpdate(
        userId,
        { $addToSet: { bookmarks: recipeId } },
        { new: true, select: "bookmarks" }
    );

    if (!user) throw new ApiError(404, "User not found.");

    return { bookmarkCount: user.bookmarks.length };
};

// ─────────────────────────────────────────────────────────────
// Remove a bookmark
// Uses $pull — removing a recipe that was never bookmarked is
// also a no-op so the client always gets a success response.
// ─────────────────────────────────────────────────────────────
export const removeBookmark = async (
    userId: string,
    recipeId: string
): Promise<{ bookmarkCount: number }> => {
    const user = await User.findByIdAndUpdate(
        userId,
        { $pull: { bookmarks: recipeId } },
        { new: true, select: "bookmarks" }
    );

    if (!user) throw new ApiError(404, "User not found.");

    return { bookmarkCount: user.bookmarks.length };
};

// ─────────────────────────────────────────────────────────────
// Get all bookmarked recipes (paginated)
// Populates the bookmarks array with the same card-level fields
// used by the recipe list endpoint so the UI is consistent.
// ─────────────────────────────────────────────────────────────
export const getBookmarks = async (
    userId: string,
    lang: Lang,
    page: number = 1,
    limit: number = 12
): Promise<{
    recipes: any[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNextPage: boolean;
    };
}> => {
    // First get just the bookmarks array to know the total count
    const user = await User.findById(userId).select("bookmarks").lean();
    if (!user) throw new ApiError(404, "User not found.");

    const total = user.bookmarks.length;

    // Reverse so the most recently bookmarked ID comes first,
    // then slice the page window out of that reversed array.
    const newestFirst = [...user.bookmarks].reverse();
    const paginatedIds = newestFirst.slice((page - 1) * limit, page * limit);

    const recipes = await Recipe.find({ _id: { $in: paginatedIds } })
        .select(
            "title description imageUrl badge cardTip nutrition.calories nutrition.protein views averageRating ratingCount commentCount createdAt"
        )
        .lean();

    // Preserve the order of bookmarks (newest bookmarked first)
    // Recipe.find() does not guarantee order so we re-sort manually
    const idOrder = paginatedIds.map(String);
    const sorted = [...recipes].sort(
        (a, b) => idOrder.indexOf(String(a._id)) - idOrder.indexOf(String(b._id))
    );

    const localised = sorted.map((r) => flattenLang(r, lang));

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