import { z } from "zod";

const recipeIdParam = z.object({
    params: z.object({
        recipeId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid recipe ID format"),
    }),
});

export const addBookmarkSchema = z.object({
    ...recipeIdParam.shape,
    body: z.object({
        type: z.enum(["curator", "user"]).optional().default("curator"),
    }),
});

export const removeBookmarkSchema = z.object({
    ...recipeIdParam.shape,
    body: z.object({
        type: z.enum(["curator", "user"]).optional().default("curator"),
    }),
});

export const getBookmarksSchema = z.object({
    query: z.object({
        page: z.string().regex(/^\d+$/).optional(),
        limit: z.string().regex(/^\d+$/).refine(v => !v || Number(v) <= 50).optional(),
    }),
});