import User from "../models/user.model.js";
import Recipe from "../models/recipe.model.js";
import UserRecipe from "../models/userRecipe.model.js";
import { ApiError } from "../utils/Apierror.js";
import { Lang, flattenLang } from "../services/recipe.service.js";

// ── Add bookmark (curator or user recipe) ─────────────────────
export const addBookmark = async (
    userId: string,
    recipeId: string,
    type?: "curator" | "user"
): Promise<{ bookmarkCount: number }> => {
    let exists = false;
    if (type === "user") {
        exists = !!(await UserRecipe.exists({ _id: recipeId }));
    } else if (type === "curator") {
        exists = !!(await Recipe.exists({ _id: recipeId }));
    } else {
        exists = !!(await Recipe.exists({ _id: recipeId })) || !!(await UserRecipe.exists({ _id: recipeId }));
    }

    if (!exists) throw new ApiError(404, "Recipe not found.");

    const user = await User.findByIdAndUpdate(
        userId,
        { $addToSet: { bookmarks: recipeId } },
        { new: true, select: "bookmarks" }
    );
    if (!user) throw new ApiError(404, "User not found.");

    return { bookmarkCount: user.bookmarks.length };
};

// ── Remove bookmark ───────────────────────────────────────────
export const removeBookmark = async (
    userId: string,
    recipeId: string,
    type?: "curator" | "user"
): Promise<{ bookmarkCount: number }> => {
    const user = await User.findByIdAndUpdate(
        userId,
        { $pull: { bookmarks: recipeId } },
        { new: true, select: "bookmarks" }
    );
    if (!user) throw new ApiError(404, "User not found.");

    return { bookmarkCount: user.bookmarks.length };
};

// ── Get all bookmarks (unified) ───────────────────────────────
export const getBookmarks = async (
    userId: string,
    lang: Lang,
    page = 1,
    limit = 12
): Promise<{
    recipes: any[];
    pagination: {
        total: number; page: number; limit: number;
        totalPages: number; hasNextPage: boolean;
    };
}> => {
    const user = await User.findById(userId).select("bookmarks").lean();
    if (!user) throw new ApiError(404, "User not found.");

    const total = user.bookmarks.length;
    const newestFirst = [...user.bookmarks].reverse();
    const pageSlice = newestFirst.slice((page - 1) * limit, page * limit);

    if (pageSlice.length === 0) {
        return {
            recipes: [],
            pagination: {
                total, page, limit,
                totalPages: Math.ceil(total / limit),
                hasNextPage: false,
            },
        };
    }

    const [curatorRecipes, userRecipes] = await Promise.all([
        Recipe.find({ _id: { $in: pageSlice } })
            .select("title description imageUrl badge cardTip nutrition.calories nutrition.protein views averageRating ratingCount commentCount createdAt")
            .lean(),
        UserRecipe.find({
            _id: { $in: pageSlice },
            $or: [
                { isPublic: true },
                { owner: userId }
            ]
        })
            .select("title description imageUrl badge cardTip nutrition.calories likes dislikes averageRating ratingCount commentCount ownerName createdAt")
            .lean(),
    ]);

    // Tag each result with its source/type, then flatten lang
    const curatorMapped = (curatorRecipes as any[]).map(r => ({
        ...flattenLang(r, lang),
        isUserRecipe: false,
        _storedId: String(r._id),
    }));

    const userMapped = (userRecipes as any[]).map(r => ({
        ...flattenLang(r, lang),
        isUserRecipe: true,
        _storedId: String(r._id),
    }));

    // Merge and restore original bookmark order
    const allMapped = [...curatorMapped, ...userMapped];
    const ordered = pageSlice
        .map(id => allMapped.find(r => r._storedId === String(id)))
        .filter(Boolean);

    // Strip internal keys before sending
    const cleaned = ordered.map(({ _storedId: _s, ...rest }) => rest);

    return {
        recipes: cleaned,
        pagination: {
            total, page, limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page < Math.ceil(total / limit),
        },
    };
};