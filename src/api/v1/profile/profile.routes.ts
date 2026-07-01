import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { authenticate, optionalAuth } from "../../../middlewares/Auth.middleware.js";
import validate from "../../../middlewares/validate.middleware.js";
import * as profileController from "./profile.controller.js";
import {
    getPublicProfileSchema,
    editProfileSchema,
    followSchema,
    followListSchema,
} from "./profile.validation.js";

const router = Router();

// ── Multer for profile photo ──────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
        const allowed = ["image/jpeg", "image/png", "image/webp"];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error("Only JPEG, PNG, or WEBP images are allowed."));
    },
});

const uploadSingle = (req: Request, res: Response, next: NextFunction) => {
    upload.single("photo")(req, res, (err) => {
        if (err) {
            res.status(400).json({ success: false, message: err.message ?? "File upload error." });
            return;
        }
        next();
    });
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/profile/:identifier
// ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/profile/{identifier}:
 *   get:
 *     summary: Get a user's public profile
 *     tags: [Profile]
 *     description: >
 *       Returns full public profile by username or MongoDB user ID.
 *       Includes recipes, liked recipes, comments, and ratings — all paginated independently.
 *       If authenticated and viewing own profile, `isOwnProfile` is true.
 *       `isFollowing` indicates whether the requester follows this user (false if unauthenticated).
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema: { type: string }
 *         description: Username (e.g. "elena_cooks") or MongoDB ObjectId of the user
 *       - in: header
 *         name: Accept-Language
 *         schema: { type: string, enum: [en, ar], default: en }
 *       - in: query
 *         name: recipesPage
 *         schema: { type: integer, default: 1 }
 *         description: Page for public recipes tab
 *       - in: query
 *         name: likesPage
 *         schema: { type: integer, default: 1 }
 *         description: Page for liked recipes tab
 *       - in: query
 *         name: commentsPage
 *         schema: { type: integer, default: 1 }
 *         description: Page for comments tab
 *       - in: query
 *         name: ratingsPage
 *         schema: { type: integer, default: 1 }
 *         description: Page for ratings tab
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     responses:
 *       200:
 *         description: Public profile returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     profile:
 *                       type: object
 *                       properties:
 *                         id:                  { type: string }
 *                         name:                { type: string, example: "Elena Rossi" }
 *                         username:            { type: string, example: "elena_cooks" }
 *                         photo:               { type: string, nullable: true }
 *                         bio:                 { type: string, nullable: true }
 *                         cookingSkillLevel:   { type: string, example: "Intermediate" }
 *                         dietaryPreferences:  { type: array, items: { type: string } }
 *                         favoriteCuisines:    { type: array, items: { type: string } }
 *                         followersCount:      { type: integer, example: 45000 }
 *                         followingCount:      { type: integer, example: 1200 }
 *                         totalLikesReceived:  { type: integer, example: 120000 }
 *                         isOwnProfile:        { type: boolean }
 *                         isFollowing:         { type: boolean }
 *                     recipes:
 *                       type: object
 *                       properties:
 *                         data: { type: array, items: { type: object } }
 *                         pagination: { type: object }
 *                     likes:
 *                       type: object
 *                       properties:
 *                         data: { type: array, items: { type: object } }
 *                         pagination: { type: object }
 *                     comments:
 *                       type: object
 *                       properties:
 *                         data: { type: array, items: { type: object } }
 *                         pagination: { type: object }
 *                     ratings:
 *                       type: object
 *                       properties:
 *                         data: { type: array, items: { type: object } }
 *                         pagination: { type: object }
 *       404:
 *         description: User not found
 */
router.get(
    "/:identifier",
    optionalAuth,
    validate(getPublicProfileSchema),
    profileController.getPublicProfile
);

// ─────────────────────────────────────────────────────────────
// PATCH /api/v1/profile/me
// ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/profile/me:
 *   patch:
 *     summary: Edit own profile
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Update one or more profile fields. All fields are optional — only
 *       send what needs changing. Username must be unique across all users,
 *       lowercase, 3–30 chars, letters/numbers/underscores only.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Elena Rossi"
 *                 description: Full name, at least two words
 *               username:
 *                 type: string
 *                 example: "elena_cooks"
 *                 description: Unique username, lowercase, 3–30 chars
 *               bio:
 *                 type: string
 *                 nullable: true
 *                 example: "Passionate home cook focusing on Mediterranean flavors"
 *                 description: Max 300 characters. Send null to clear.
 *               cookingSkillLevel:
 *                 type: string
 *                 enum: [Beginner, Intermediate, Professional]
 *               dietaryPreferences:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [Vegan, Low Carb, Vegetarian, Paleo, Keto]
 *               favoriteCuisines:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [Arabic, Asian, Italian, French]
 *     responses:
 *       200:
 *         description: Profile updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     name:               { type: string }
 *                     username:           { type: string }
 *                     bio:                { type: string, nullable: true }
 *                     photo:              { type: string, nullable: true }
 *                     cookingSkillLevel:  { type: string }
 *                     dietaryPreferences: { type: array, items: { type: string } }
 *                     favoriteCuisines:   { type: array, items: { type: string } }
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 *       409:
 *         description: Username already taken
 */
router.patch(
    "/me",
    authenticate,
    validate(editProfileSchema),
    profileController.editProfile
);

// ─────────────────────────────────────────────────────────────
// POST /api/v1/profile/me/photo
// ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/profile/me/photo:
 *   post:
 *     summary: Upload or change profile photo
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Upload a new profile photo via multipart/form-data.
 *       Field name must be "photo". Max size 5 MB. Allowed types: JPEG, PNG, WEBP.
 *       The image is resized to 400×400 and uploaded to Cloudinary.
 *       Replaces any existing profile photo.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [photo]
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *                 description: Profile image (JPEG, PNG, or WEBP, max 5 MB)
 *     responses:
 *       200:
 *         description: Photo uploaded and saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     photo: { type: string, example: "https://res.cloudinary.com/..." }
 *       400:
 *         description: No file uploaded or invalid file type
 *       401:
 *         description: Authentication required
 *       502:
 *         description: Cloudinary upload failed
 */
router.post(
    "/me/photo",
    authenticate,
    uploadSingle,
    profileController.uploadProfilePhoto
);

// ─────────────────────────────────────────────────────────────
// POST /api/v1/profile/:id/follow
// ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/profile/{id}/follow:
 *   post:
 *     summary: Follow or unfollow a user
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Toggles follow state. If already following → unfollows. If not → follows.
 *       Cannot follow yourself — returns 400.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB ObjectId of the user to follow/unfollow
 *     responses:
 *       200:
 *         description: Follow state toggled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     following:      { type: boolean, example: true }
 *                     followersCount: { type: integer, example: 45001 }
 *       400:
 *         description: Cannot follow yourself or invalid user ID
 *       401:
 *         description: Authentication required
 *       404:
 *         description: User not found
 */
router.post(
    "/:id/follow",
    authenticate,
    validate(followSchema),
    profileController.followUser
);

// ─────────────────────────────────────────────────────────────
// GET /api/v1/profile/:id/followers
// ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/profile/{id}/followers:
 *   get:
 *     summary: Get a user's followers
 *     tags: [Profile]
 *     description: Returns paginated list of users who follow this user.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200:
 *         description: Followers list returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:      { type: string }
 *                       name:     { type: string }
 *                       username: { type: string }
 *                       photo:    { type: string, nullable: true }
 *                 pagination: { type: object }
 *       404:
 *         description: User not found
 */
router.get(
    "/:id/followers",
    validate(followListSchema),
    profileController.getFollowers
);

// ─────────────────────────────────────────────────────────────
// GET /api/v1/profile/:id/following
// ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/v1/profile/{id}/following:
 *   get:
 *     summary: Get users this user is following
 *     tags: [Profile]
 *     description: Returns paginated list of users this user follows.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200:
 *         description: Following list returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:      { type: string }
 *                       name:     { type: string }
 *                       username: { type: string }
 *                       photo:    { type: string, nullable: true }
 *                 pagination: { type: object }
 *       404:
 *         description: User not found
 */
router.get(
    "/:id/following",
    validate(followListSchema),
    profileController.getFollowing
);

export default router;