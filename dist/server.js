import dotenv from "dotenv";
dotenv.config(); // Always at the top
import app from "./app.js";
import connectDB from "./config/database.js";
const PORT = process.env.PORT || 5000;
const startServer = async () => {
    // 1️⃣ Connect to database FIRST
    await connectDB();
    // 2️⃣ Then start the server
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    });
};
startServer();
