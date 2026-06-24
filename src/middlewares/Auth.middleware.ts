import { Request, Response, NextFunction } from "express";
import pkg from "jsonwebtoken";
import { ApiError } from "../utils/Apierror.js";
import User from "../models/user.model.js";

const { verify } = pkg;

// Extend Express Request so downstream handlers can access req.user
declare global {
    namespace Express {
        interface Request {
            user?: { id: string; name: string; photo: string | null };
        }
    }
}

export const optionalAuth = async (
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const authHeader = req.headers["authorization"];

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            // No token — proceed without setting req.user
            return next();
        }

        const token = authHeader.split(" ")[1];
        const secret = process.env.JWT_ACCESS_SECRET;
        if (!secret) {
            // If secret is missing, still proceed as guest
            return next();
        }

        const payload = verify(token, secret) as { id: string };
        const user = await User.findById(payload.id).select("name photo");
        if (user) {
            req.user = {
                id: user.id,
                name: user.name,
                photo: user.photo ?? null,
            };
        }

        next();
    } catch {
        // Invalid token — silently proceed as guest
        next();
    }
};

export const authenticate = async (
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const authHeader = req.headers["authorization"];

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            throw new ApiError(401, "Authentication required. No token provided.");
        }

        const token = authHeader.split(" ")[1];

        const secret = process.env.JWT_ACCESS_SECRET;
        if (!secret) {
            throw new ApiError(500, "Server misconfiguration: JWT_SECRET is not set.");
        }

        const payload = verify(token, secret) as { id: string };

        // Fetch the user's name and photo to attach to the request
        const user = await User.findById(payload.id).select("name photo");
        if (!user) {
            throw new ApiError(401, "User not found.");
        }

        req.user = {
            id: user.id,
            name: user.name,
            photo: user.photo ?? null
        };

        next();
    } catch (error) {
        next(error);
    }
};