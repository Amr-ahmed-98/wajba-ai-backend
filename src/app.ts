import express, { Application, Request, Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import cors from "cors";
import authRoutes from "./api/v1/auth/auth.routes.js";
import feedbackRoutes from "./api/v1/feedback/feedback.routes.js";
import recipeRoutes from "./api/v1/recipes/recipe.routes.js";
import bookmarkRoutes from "./api/v1/bookmark/bookmark.routes.js";
import userRecipeRoutes from "./api/v1/user-recipes/user-recipe.routes.js";
import { errorHandler } from "./middlewares/Errorhandler.middleware.js";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swager.js";

const app: Application = express();

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    "https://your-production-frontend.com",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept-Language", "x-admin-secret"],
}));

// ── Security & body parsing ───────────────────────────────────
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Global rate limiter ───────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: "Too many requests, please try again later." },
});
app.use(limiter);

// ── Routes ────────────────────────────────────────────────────
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/feedback", feedbackRoutes);
app.use("/api/v1/recipes", recipeRoutes);
app.use("/api/v1/bookmarks", bookmarkRoutes);
app.use("/api/v1/user-recipes", userRecipeRoutes);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── Health check ──────────────────────────────────────────────
app.get("/", (_req: Request, res: Response) => {
  res.json({ success: true, message: "Server is running 🚀" });
});

app.get("/health", (_req: Request, res: Response) => {
  const dbState: Record<number, string> = {
    0: "Disconnected ❌", 1: "Connected ✅",
    2: "Connecting... 🔄", 3: "Disconnecting... ⚠️",
  };
  res.json({
    success: true,
    database: dbState[mongoose.connection.readyState],
    uptime: process.uptime(),
  });
});

// ── Central error handler — MUST be last ─────────────────────
app.use(errorHandler);

export default app;