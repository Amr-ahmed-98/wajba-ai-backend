import mongoose, { Types } from "mongoose";
import User from "../models/user.model.js";
import UserRecipe from "../models/userRecipe.model.js";
import Comment from "../models/comment.model.js";
import { Rating } from "../models/comment.model.js";
import Recipe from "../models/recipe.model.js";
import { ApiError } from "../utils/Apierror.js";
import { flattenLang, Lang } from "./recipe.service.js";
import { flattenUserRecipe } from "./userRecipe.service.js";
import { v2 as cloudinary } from "cloudinary";

// ─────────────────────────────────────────────────────────────
// Cloudinary — upload profile photo
// ─────────────────────────────────────────────────────────────
let _cloudinaryConfigured = false;
const configureCloudinary = () => {
    if (_cloudinaryConfigured) return;
    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
        throw new ApiError(500, "Image service is not configured.");
    }
    cloudinary.config({
        cloud_name: CLOUDINARY_CLOUD_NAME,
        api_key: CLOUDINARY_API_KEY,
        api_secret: CLOUDINARY_API_SECRET,
    });
    _cloudinaryConfigured = true;
};

export const uploadProfilePhoto = (
    buffer: Buffer,
    mimeType: string,
    userId: string
): Promise<string> => {
    configureCloudinary();
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                public_id: `profile_photos/${userId}`,
                overwrite: true,
                resource_type: "image",
                transformation: [{ width: 400, height: 400, crop: "fill", quality: "auto" }],
            },
            (error, result) => {
                if (error || !result) {
                    reject(new ApiError(502, `Failed to upload profile photo: ${error?.message ?? "unknown"}`));
                    return;
                }
                resolve(result.secure_url);
            }
        );
        stream.end(buffer);
    });
};

// ─────────────────────────────────────────────────────────────
// GET public profile by username or id
// ─────────────────────────────────────────────────────────────
export const getPublicProfile = async (
    identifier: string,         // username or userId
    requesterId: string | undefined,
    lang: Lang = "en",
    tabs: {
        recipesPage?: number;
        likesPage?: number;
        commentsPage?: number;
        ratingsPage?: number;
    } = {}
) => {
    // Resolve by username first, then by id
    const isObjectId = mongoose.isValidObjectId(identifier);
    const user = await User.findOne(
        isObjectId
            ? { $or: [{ _id: identifier }, { username: identifier }] }
            : { username: identifier.toLowerCase() }
    ).select("name username photo bio followers following cookingSkillLevel dietaryPreferences favoriteCuisines role");

    if (!user) throw new ApiError(404, "User not found.");

    const userId = user.id as string;
    const isOwnProfile = requesterId === userId;

    const PAGE = 12;
    const rPage = tabs.recipesPage ?? 1;
    const lPage = tabs.likesPage ?? 1;
    const cPage = tabs.commentsPage ?? 1;
    const rtPage = tabs.ratingsPage ?? 1;

    // ── Public recipes ────────────────────────────────────────
    const [publicRecipes, totalRecipes] = await Promise.all([
        UserRecipe.find({ owner: userId, isPublic: true })
            .sort({ createdAt: -1 })
            .skip((rPage - 1) * PAGE)
            .limit(PAGE)
            .select("title description imageUrl badge cardTip likes dislikes averageRating ratingCount commentCount createdAt")
            .lean(),
        UserRecipe.countDocuments({ owner: userId, isPublic: true }),
    ]);

    // ── Total likes received across all public recipes ────────
    const likesAgg = await UserRecipe.aggregate([
        { $match: { owner: new Types.ObjectId(userId), isPublic: true } },
        { $group: { _id: null, totalLikes: { $sum: "$likes" } } },
    ]);
    const totalLikesReceived = likesAgg[0]?.totalLikes ?? 0;

    // ── Liked recipes (recipes this user reacted "like" to) ───
    // UserRecipe.likedBy stores user IDs as strings
    const [likedUserRecipes, totalLikedUserRecipes] = await Promise.all([
        UserRecipe.find({ likedBy: userId, isPublic: true })
            .sort({ createdAt: -1 })
            .skip((lPage - 1) * PAGE)
            .limit(PAGE)
            .select("title description imageUrl badge cardTip likes averageRating ratingCount createdAt")
            .lean(),
        UserRecipe.countDocuments({ likedBy: userId, isPublic: true }),
    ]);

    // ── Comments this user made ───────────────────────────────
    const [comments, totalComments] = await Promise.all([
        Comment.find({ author: userId })
            .sort({ createdAt: -1 })
            .skip((cPage - 1) * PAGE)
            .limit(PAGE)
            .select("body recipe createdAt likes dislikes")
            .lean(),
        Comment.countDocuments({ author: userId }),
    ]);

    // ── Ratings this user gave ────────────────────────────────
    const [ratings, totalRatings] = await Promise.all([
        Rating.find({ user: userId })
            .sort({ createdAt: -1 })
            .skip((rtPage - 1) * PAGE)
            .limit(PAGE)
            .select("recipe value createdAt")
            .lean(),
        Rating.countDocuments({ user: userId }),
    ]);

    // Resolve recipe titles for ratings
    const ratingRecipeIds = ratings.map((r: any) => r.recipe);
    const [curatorForRatings, userForRatings] = await Promise.all([
        Recipe.find({ _id: { $in: ratingRecipeIds } }).select("title imageUrl").lean(),
        UserRecipe.find({ _id: { $in: ratingRecipeIds }, isPublic: true }).select("title imageUrl").lean(),
    ]);
    const recipeMap: Record<string, any> = {};
    [...curatorForRatings, ...userForRatings].forEach((r: any) => {
        recipeMap[String(r._id)] = {
            _id: r._id,
            title: typeof r.title === "object"
                ? (lang === "ar" ? r.title.ar : r.title.en)
                : r.title,
            imageUrl: r.imageUrl,
        };
    });

    const ratingsWithRecipe = ratings.map((r: any) => ({
        ...r,
        recipe: recipeMap[String(r.recipe)] ?? null,
    }));

    const makePagination = (total: number, page: number) => ({
        total,
        page,
        limit: PAGE,
        totalPages: Math.ceil(total / PAGE),
        hasNextPage: page < Math.ceil(total / PAGE),
    });

    return {
        profile: {
            id: user.id,
            name: user.name,
            username: user.username,
            photo: user.photo ?? null,
            bio: user.bio ?? null,
            cookingSkillLevel: user.cookingSkillLevel,
            dietaryPreferences: user.dietaryPreferences,
            favoriteCuisines: user.favoriteCuisines,
            followersCount: user.followers.length,
            followingCount: user.following.length,
            totalLikesReceived,
            isOwnProfile,
            isFollowing: requesterId
                ? user.followers.some((f) => f.toString() === requesterId)
                : false,
        },
        recipes: {
            data: publicRecipes.map((r) => flattenUserRecipe(r, lang)),
            pagination: makePagination(totalRecipes, rPage),
        },
        likes: {
            data: likedUserRecipes.map((r) => flattenUserRecipe(r, lang)),
            pagination: makePagination(totalLikedUserRecipes, lPage),
        },
        comments: {
            data: comments,
            pagination: makePagination(totalComments, cPage),
        },
        ratings: {
            data: ratingsWithRecipe,
            pagination: makePagination(totalRatings, rtPage),
        },
    };
};

// ─────────────────────────────────────────────────────────────
// Edit profile (authenticated user's own profile only)
// ─────────────────────────────────────────────────────────────
export const editProfile = async (
    userId: string,
    updates: {
        name?: string;
        username?: string;
        bio?: string;
        cookingSkillLevel?: string;
        dietaryPreferences?: string[];
        favoriteCuisines?: string[];
        photoUrl?: string;        // already uploaded, just store URL
    }
) => {
    // Username uniqueness check
    if (updates.username) {
        const taken = await User.findOne({
            username: updates.username.toLowerCase(),
            _id: { $ne: userId },
        });
        if (taken) throw new ApiError(409, "Username is already taken.");
        updates.username = updates.username.toLowerCase().trim();
    }

    const allowedFields: (keyof typeof updates)[] = [
        "name", "username", "bio", "cookingSkillLevel",
        "dietaryPreferences", "favoriteCuisines", "photoUrl",
    ];

    const payload: Record<string, any> = {};
    for (const key of allowedFields) {
        if (updates[key] !== undefined) {
            payload[key === "photoUrl" ? "photo" : key] = updates[key];
        }
    }

    const updated = await User.findByIdAndUpdate(
        userId,
        { $set: payload },
        { new: true, runValidators: true }
    ).select("name username bio photo cookingSkillLevel dietaryPreferences favoriteCuisines");

    if (!updated) throw new ApiError(404, "User not found.");
    return updated;
};

// ─────────────────────────────────────────────────────────────
// Follow / Unfollow
// ─────────────────────────────────────────────────────────────
export const followUser = async (
    followerId: string,
    targetId: string
): Promise<{ following: boolean; followersCount: number }> => {
    if (followerId === targetId) throw new ApiError(400, "Cannot follow yourself.");
    if (!mongoose.isValidObjectId(targetId)) throw new ApiError(400, "Invalid user ID.");

    const target = await User.findById(targetId).select("followers");
    if (!target) throw new ApiError(404, "User not found.");

    const alreadyFollowing = target.followers.some((f) => f.toString() === followerId);

    if (alreadyFollowing) {
        // Unfollow
        await Promise.all([
            User.findByIdAndUpdate(targetId, { $pull: { followers: followerId } }),
            User.findByIdAndUpdate(followerId, { $pull: { following: targetId } }),
        ]);
        return { following: false, followersCount: target.followers.length - 1 };
    } else {
        // Follow
        await Promise.all([
            User.findByIdAndUpdate(targetId, { $addToSet: { followers: followerId } }),
            User.findByIdAndUpdate(followerId, { $addToSet: { following: targetId } }),
        ]);
        return { following: true, followersCount: target.followers.length + 1 };
    }
};

// ─────────────────────────────────────────────────────────────
// Get followers list
// ─────────────────────────────────────────────────────────────
export const getFollowers = async (
    userId: string,
    page = 1,
    limit = 20
) => {
    if (!mongoose.isValidObjectId(userId)) throw new ApiError(400, "Invalid user ID.");

    const user = await User.findById(userId)
        .select("followers")
        .populate({
            path: "followers",
            select: "name username photo",
            options: { skip: (page - 1) * limit, limit },
        })
        .lean();

    if (!user) throw new ApiError(404, "User not found.");

    const total = (user.followers as any[]).length;
    return {
        data: user.followers,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page < Math.ceil(total / limit),
        },
    };
};

// ─────────────────────────────────────────────────────────────
// Get following list
// ─────────────────────────────────────────────────────────────
export const getFollowing = async (
    userId: string,
    page = 1,
    limit = 20
) => {
    if (!mongoose.isValidObjectId(userId)) throw new ApiError(400, "Invalid user ID.");

    const user = await User.findById(userId)
        .select("following")
        .populate({
            path: "following",
            select: "name username photo",
            options: { skip: (page - 1) * limit, limit },
        })
        .lean();

    if (!user) throw new ApiError(404, "User not found.");

    const total = (user.following as any[]).length;
    return {
        data: user.following,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page < Math.ceil(total / limit),
        },
    };
};