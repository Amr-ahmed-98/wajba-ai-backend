import { Request, Response, NextFunction } from "express";
import pkg from "jsonwebtoken";
import { ApiError } from "../utils/Apierror.js";

const { verify } = pkg;

// Extend Express Request so downstream handlers can access req.user
declare global {
    namespace Express {
        interface Request {
            user?: { id: string };
        }
    }
}

// ─────────────────────────────────────────────────────────────
// authenticate
// Reads the Bearer token from the Authorization header,
// verifies it with JWT_SECRET, and attaches { id } to req.user.
//
// JWT errors (expired, invalid signature, etc.) are passed to
// next() so your existing errorHandler middleware handles them
// and returns the correct 401 response automatically.
// ─────────────────────────────────────────────────────────────
export const authenticate = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
    try {
        const authHeader = req.headers["authorization"];

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            throw new ApiError(401, "Authentication required. No token provided.");
        }

        const token = authHeader.split(" ")[1];

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new ApiError(500, "Server misconfiguration: JWT_SECRET is not set.");
        }

        // verify() throws TokenExpiredError / JsonWebTokenError on failure —
        // your errorHandler already handles both and returns 401 automatically.
        const payload = verify(token, secret) as { id: string;[key: string]: any };

        req.user = { id: payload.id };

        next();
    } catch (error) {
        next(error);
    }
};