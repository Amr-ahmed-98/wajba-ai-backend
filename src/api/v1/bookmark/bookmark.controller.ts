import { Request, Response, NextFunction } from "express";
import * as bookmarkService from "../../../services/bookmark.service.js";
import { parseLang } from "../../../services/recipe.service.js";
import { ApiError } from "../../../utils/Apierror.js";

// ─────────────────────────────────────────────────────────────
// Helper — same language resolution used by recipe endpoints
// ─────────────────────────────────────────────────────────────
const getLang = (req: Request) =>
    parseLang(req.headers["accept-language"] as string | undefined);

// ─────────────────────────────────────────────────────────────
// POST /api/v1/bookmarks/:recipeId
// Authenticated — adds a recipe to the user's bookmarks.
// Idempotent: bookmarking the same recipe twice returns 200 both times.
// ─────────────────────────────────────────────────────────────
export const addBookmark = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const userId = req.user!.id;
        const recipeId = req.params.recipeId as string;
        const type = req.body?.type as "curator" | "user" | undefined;
        const result = await bookmarkService.addBookmark(userId, recipeId, type);
        res.status(200).json({ success: true, message: "Recipe bookmarked successfully.", data: result });
    } catch (error) {
        if (error instanceof ApiError) {
            res.status(error.statusCode).json({
                success: false,
                message: error.message,
            });
            return;
        }
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/bookmarks/:recipeId
// Authenticated — removes a recipe from the user's bookmarks.
// Idempotent: removing a recipe that was never bookmarked returns 200.
// ─────────────────────────────────────────────────────────────
export const removeBookmark = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const userId = req.user!.id;
        const recipeId = req.params.recipeId as string;
        const type = req.body?.type as "curator" | "user" | undefined;
        const result = await bookmarkService.removeBookmark(userId, recipeId, type);
        res.status(200).json({ success: true, message: "Bookmark removed successfully.", data: result });
    } catch (error) {
        if (error instanceof ApiError) {
            res.status(error.statusCode).json({
                success: false,
                message: error.message,
            });
            return;
        }
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/bookmarks
// Authenticated — returns the user's bookmarked recipes as paginated
// recipe cards (same shape as GET /api/v1/recipes).
//
// Query params:
//   page  — default 1
//   limit — default 12, max 50
// ─────────────────────────────────────────────────────────────
export const getBookmarks = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const userId = req.user!.id;

        const result = await bookmarkService.getBookmarks(
            userId,
            getLang(req),
            req.query.page ? Number(req.query.page) : undefined,
            req.query.limit ? Number(req.query.limit) : undefined
        );

        res.status(200).json({
            success: true,
            message: "Bookmarks retrieved successfully.",
            data: result.recipes,
            pagination: result.pagination,
        });
    } catch (error) {
        if (error instanceof ApiError) {
            res.status(error.statusCode).json({
                success: false,
                message: error.message,
            });
            return;
        }
        next(error);
    }
};