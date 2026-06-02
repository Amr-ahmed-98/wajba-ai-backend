import express, { Application, Request, Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import authRoutes from "./api/v1/auth/auth.routes.js";
import { errorHandler } from "./middlewares/Errorhandler.middleware.js";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swager.js";

dotenv.config();

const app: Application = express();

// ── CORS — MUST be first, before helmet and everything else ──
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    "https://your-production-frontend.com", // ← add your real domain later
  ],
  credentials: true, // Required because you use cookies (cookieParser)
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// ── Security & body parsing — MUST come before all routes ────
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Required for reading httpOnly refresh token cookie

// ── Global rate limiter ───────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { success: false, message: "Too many requests, please try again later." },
});
app.use(limiter);

// ── Routes ────────────────────────────────────────────────────
app.use("/api/v1/auth", authRoutes);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── Health check routes ───────────────────────────────────────
app.get("/", (_req: Request, res: Response) => {
  res.json({ success: true, message: "Server is running 🚀" });
});

app.get("/health", (_req: Request, res: Response) => {
  const dbState: Record<number, string> = {
    0: "Disconnected ❌",
    1: "Connected ✅",
    2: "Connecting... 🔄",
    3: "Disconnecting... ⚠️",
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