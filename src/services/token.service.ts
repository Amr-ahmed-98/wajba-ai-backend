import jwt from "jsonwebtoken";

export const generateTokens = (userId: string, role: string) => {
  // No || fallback — if these are undefined the check below will throw immediately
  const accessTokenSecret = process.env.JWT_ACCESS_SECRET;
  const refreshTokenSecret = process.env.JWT_REFRESH_SECRET;

  if (!accessTokenSecret || !refreshTokenSecret) {
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in environment variables.");
  }

  const accessToken = jwt.sign(
    { id: userId, role },
    accessTokenSecret,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m" } as jwt.SignOptions
  );

  const refreshToken = jwt.sign(
    { id: userId },
    refreshTokenSecret,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" } as jwt.SignOptions
  );

  return { accessToken, refreshToken };
};

// Used by the refresh-token endpoint to verify the stored cookie
export const verifyRefreshToken = (token: string): { id: string } => {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error("JWT_REFRESH_SECRET is not set.");
  return jwt.verify(token, secret) as { id: string };
};