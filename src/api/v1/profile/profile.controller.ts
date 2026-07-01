import { Request, Response, NextFunction } from "express";
import * as profileService from "../../../services/profile.service.js";
import { parseLang } from "../../../services/recipe.service.js";
import { ApiError } from "../../../utils/Apierror.js";

const getLang = (req: Request) =>
    parseLang(req.headers["accept-language"] as string | undefined);

const requireUser = (req: Request): string => {
    const id = (req as any).user?.id;
    if (!id) throw new ApiError(401, "Authentication required.");
    return id as string;
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/profile/:identifier
// Public — view any user's public profile by username or userId.
// Tabs are paginated independently via query params.
// ─────────────────────────────────────────────────────────────
export const getPublicProfile = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const requesterId = (req as any).user?.id as string | undefined;
        const result = await profileService.getPublicProfile(
            req.params.identifier as string,
            requesterId,
            getLang(req),
            {
                recipesPage: req.query.recipesPage ? Number(req.query.recipesPage) : 1,
                likesPage: req.query.likesPage ? Number(req.query.likesPage) : 1,
                commentsPage: req.query.commentsPage ? Number(req.query.commentsPage) : 1,
                ratingsPage: req.query.ratingsPage ? Number(req.query.ratingsPage) : 1,
            }
        );
        res.status(200).json({ success: true, data: result });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// PATCH /api/v1/profile/me
// Authenticated — update own profile fields.
// ─────────────────────────────────────────────────────────────
export const editProfile = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const userId = requireUser(req);
        const updated = await profileService.editProfile(userId, req.body);
        res.status(200).json({ success: true, data: updated });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/profile/me/photo
// Authenticated — upload profile photo via multipart/form-data.
// Field name: "photo"
// ─────────────────────────────────────────────────────────────
export const uploadProfilePhoto = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const userId = requireUser(req);

        if (!req.file) {
            throw new ApiError(400, "No image file uploaded. Send a JPEG, PNG, or WEBP as the 'photo' field.");
        }

        const photoUrl = await profileService.uploadProfilePhoto(
            req.file.buffer,
            req.file.mimetype,
            userId
        );

        // Persist new photo URL
        const updated = await profileService.editProfile(userId, { photoUrl });
        res.status(200).json({ success: true, data: { photo: updated.photo } });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/profile/:id/follow
// Authenticated — toggles follow/unfollow on another user.
// ─────────────────────────────────────────────────────────────
export const followUser = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const followerId = requireUser(req);
        const result = await profileService.followUser(followerId, req.params.id as string);
        res.status(200).json({ success: true, data: result });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/profile/:id/followers
// Public — paginated list of a user's followers.
// ─────────────────────────────────────────────────────────────
export const getFollowers = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const result = await profileService.getFollowers(
            req.params.id as string,
            req.query.page ? Number(req.query.page) : 1,
            req.query.limit ? Number(req.query.limit) : 20
        );
        res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/profile/:id/following
// Public — paginated list of users this user is following.
// ─────────────────────────────────────────────────────────────
export const getFollowing = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const result = await profileService.getFollowing(
            req.params.id as string,
            req.query.page ? Number(req.query.page) : 1,
            req.query.limit ? Number(req.query.limit) : 20
        );
        res.status(200).json({ success: true, data: result.data, pagination: result.pagination });
    } catch (error) { next(error); }
};