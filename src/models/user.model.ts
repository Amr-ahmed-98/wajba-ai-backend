import mongoose, { Schema, Document, Types } from "mongoose";

export interface IUser extends Document {
  name: string;
  email: string;
  password?: string; // Optional for Google Auth users
  googleId?: string;
  role: "FREE_USER" | "PAID_USER" | "ADMIN";
  dietaryPreferences: string[];
  favoriteCuisines: string[];
  allergies: string[];
  cookingSkillLevel: string;
  familyType: string;
  primaryCookingGoal: string;
  availableKitchenTools: string[];
  bookmarks: Types.ObjectId[]; // Recipe IDs saved by this user
  otp?: string;
  otpExpires?: Date;
  refreshToken?: string;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, select: false }, // Hidden by default for security
    googleId: { type: String, sparse: true, unique: true },
    role: {
      type: String,
      enum: ["FREE_USER", "PAID_USER", "ADMIN"],
      default: "FREE_USER",
    },
    dietaryPreferences: [{ type: String, enum: ["Vegan", "Low Carb", "Vegetarian", "Paleo", "Keto"] }],
    favoriteCuisines: [{ type: String, enum: ["Arabic", "Asian", "Italian", "French"] }],
    allergies: [{ type: String }], // Flexible, populated from our GET endpoint
    cookingSkillLevel: { type: String, enum: ["Beginner", "Intermediate", "Professional"] },
    familyType: { type: String, enum: ["Single person", "Couple", "Large family"] },
    primaryCookingGoal: { type: String, enum: ["Save time", "Healthy and nutritious eating", "Learn new skills", "Save money"] },
    availableKitchenTools: [{ type: String, enum: ["Oven", "Air fryer", "Blender", "Pressure cooker", "Coffee maker", "Toaster", "Slow cooker", "Other"] }],
    bookmarks: {
      type: [{ type: Schema.Types.ObjectId, ref: "Recipe" }],
      default: [],
    },
    otp: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    refreshToken: { type: String, select: false },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>("User", UserSchema);