import User from "../models/user.model.js";
import bcrypt from "bcrypt";

export const seedAdmin = async () => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      console.log("⚠️ Admin credentials not found in environment variables. Skipping admin seed.");
      return;
    }

    // Check if any admin already exists
    const adminExists = await User.findOne({ role: "ADMIN" });
    
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      
      await User.create({
        name: "Wajba Admin",
        email: adminEmail,
        password: hashedPassword,
        role: "ADMIN",
        // Fill in required defaults to satisfy the schema
        cookingSkillLevel: "Professional",
        familyType: "Single person",
        primaryCookingGoal: "Save time",
      });
      
      console.log("✅ Default Admin user created successfully.");
    } else {
      console.log("⚡ Admin user already exists. Skipping seed.");
    }
  } catch (error) {
    console.error("❌ Error seeding admin user:", error);
  }
};