import mongoose, { Schema, Document, Types } from "mongoose";
import { nanoid } from "nanoid";

export interface IUser extends Document {
  name: string;
  email: string;
  password?: string;
  googleId?: string;
  photo?: string;
  role: "FREE_USER" | "PAID_USER" | "ADMIN";

  // ── Profile fields ────────────────────────────────────────
  username: string;           // unique, auto-generated if not set
  bio?: string;

  // ── Social ───────────────────────────────────────────────
  followers: Types.ObjectId[];
  following: Types.ObjectId[];

  // ── Preferences ──────────────────────────────────────────
  dietaryPreferences: string[];
  favoriteCuisines: string[];
  allergies: string[];
  cookingSkillLevel: string;
  familyType: string;
  primaryCookingGoal: string;
  availableKitchenTools: string[];

  // ── Bookmarks (unified — stores raw ObjectId strings) ────
  bookmarks: string[];

  // ── Auth ─────────────────────────────────────────────────
  otp?: string;
  otpExpires?: Date;
  refreshToken?: string;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, select: false },
    googleId: { type: String, sparse: true, unique: true },
    photo: { type: String, default: null },
    role: {
      type: String,
      enum: ["FREE_USER", "PAID_USER", "ADMIN"],
      default: "FREE_USER",
    },

    // ── Profile ───────────────────────────────────────────
    username: {
      type: String,
      unique: true,
      sparse: true,   // allows null/undefined during migration
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 30,
    },
    bio: { type: String, default: null, maxlength: 300, trim: true },

    // ── Social ────────────────────────────────────────────
    followers: { type: [{ type: Schema.Types.ObjectId, ref: "User" }], default: [] },
    following: { type: [{ type: Schema.Types.ObjectId, ref: "User" }], default: [] },

    // ── Preferences ───────────────────────────────────────
    dietaryPreferences: [{ type: String, enum: ["Vegan", "Low Carb", "Vegetarian", "Paleo", "Keto"] }],
    favoriteCuisines: [{ type: String, enum: ["Arabic", "Asian", "Italian", "French"] }],
    allergies: [{ type: String }],
    cookingSkillLevel: { type: String, enum: ["Beginner", "Intermediate", "Professional"] },
    familyType: { type: String, enum: ["Single person", "Couple", "Large family"] },
    primaryCookingGoal: {
      type: String,
      enum: ["Save time", "Healthy and nutritious eating", "Learn new skills", "Save money"],
    },
    availableKitchenTools: [
      {
        type: String,
        enum: ["Oven", "Air fryer", "Blender", "Pressure cooker", "Coffee maker", "Toaster", "Slow cooker", "Other"],
      },
    ],

    // ── Bookmarks (unified string array) ──────────────────
    bookmarks: { type: [String], default: [] },

    // ── Auth ──────────────────────────────────────────────
    otp: { type: String, select: false },
    otpExpires: { type: Date, select: false },
    refreshToken: { type: String, select: false },
  },
  { timestamps: true }
);

// ── Auto-generate username if missing (pre-save) ──────────────
UserSchema.pre("save", async function () {
  if (!this.username) {
    let candidate = `user_${nanoid(8)}`;
    // Ensure uniqueness (extremely unlikely collision but safe)
    while (await mongoose.models.User.exists({ username: candidate })) {
      candidate = `user_${nanoid(8)}`;
    }
    this.username = candidate;
  }
});

// ── Indexes ───────────────────────────────────────────────────
UserSchema.index({ username: 1 });
UserSchema.index({ followers: 1 });
UserSchema.index({ following: 1 });

export default mongoose.model<IUser>("User", UserSchema);