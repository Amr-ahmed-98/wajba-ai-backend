import dotenv from "dotenv";
dotenv.config(); // Always at the top

// server.ts — add after dotenv.config()
console.log("JWT_ACCESS_SECRET loaded:", !!process.env.JWT_ACCESS_SECRET);
console.log("MONGODB_URI loaded:", !!process.env.MONGODB_URI);

import app from "./app.js";
import connectDB from "./config/database.js";
import { seedAdmin } from "./utils/seedAdmin.js"
const PORT = process.env.PORT || 3000;

const startServer = async (): Promise<void> => {
  // 1️⃣ Connect to database FIRST
  await connectDB();

  await seedAdmin();

  // 2️⃣ Then start the server
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
};

startServer();