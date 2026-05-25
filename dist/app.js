import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import mongoose from "mongoose";
dotenv.config(); // Load env variables FIRST
const app = express();
// ── Middleware ──────────────────────────────────────
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: "Too many requests, please try again later.",
});
app.use(limiter);
// ── Health Check Route ──────────────────────────────
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Server is running 🚀",
    });
});
// ── DB Health Check Route ───────────────────────────
app.get("/health", (req, res) => {
    const dbState = {
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
export default app;
