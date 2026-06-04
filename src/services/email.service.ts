import { Resend } from "resend";
import { ApiError } from "../utils/Apierror.js";

export const sendOtpEmail = async (to: string, otp: string): Promise<void> => {
  // ── Validate env var ──────────────────────────────────────────
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("❌ RESEND_API_KEY is not set in environment variables.");
    throw new ApiError(500, "Email service is not configured. Please contact support.");
  }

  // ── Send via HTTPS (works on all Railway plans) ───────────────
  // Resend uses a REST API over HTTPS — no SMTP ports, no Railway blocking.
  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    // IMPORTANT: "from" must use your verified Resend domain.
    // During development you can use: onboarding@resend.dev  (sends to your own email only)
    // In production replace with:     noreply@yourdomain.com
    from: process.env.RESEND_FROM_EMAIL ?? "Wajba App <onboarding@resend.dev>",
    to,
    subject: "Your Password Reset OTP",
    text: `Your OTP for password reset is: ${otp}. It is valid for 10 minutes.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
        <h2>Password Reset</h2>
        <p>Your one-time password (OTP) is:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px;">${otp}</p>
        <p>It expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <hr/>
        <small>If you didn't request this, you can safely ignore this email.</small>
      </div>
    `,
  });

  if (error) {
    console.error("❌ Resend failed to send OTP email:", error);
    throw new ApiError(502, "Failed to send the OTP email. Please try again later.");
  }
};