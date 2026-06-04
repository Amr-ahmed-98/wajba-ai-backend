import { ApiError } from "../utils/Apierror.js";

export const sendOtpEmail = async (to: string, otp: string): Promise<void> => {
  // ── Validate env var ──────────────────────────────────────────
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("❌ BREVO_API_KEY is not set in environment variables.");
    throw new ApiError(500, "Email service is not configured. Please contact support.");
  }

  // ── Send via Brevo HTTPS API (works on all Railway plans) ─────
  // Brevo uses a REST API over HTTPS — no SMTP ports, no Railway blocking.
  // Free tier: 300 emails/day. Can send to ANY email without a custom domain.
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: {
        name: process.env.BREVO_SENDER_NAME ?? "Wajba App",
        email: process.env.BREVO_SENDER_EMAIL ?? "noreply@wajba.app", // Must match a verified sender in Brevo
      },
      to: [{ email: to }],
      subject: "Your Password Reset OTP",
      textContent: `Your OTP for password reset is: ${otp}. It is valid for 10 minutes.`,
      htmlContent: `
        <div style="font-family: sans-serif; max-width: 480px; margin: auto;">
          <h2>Password Reset</h2>
          <p>Your one-time password (OTP) is:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px;">${otp}</p>
          <p>It expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
          <hr/>
          <small>If you didn't request this, you can safely ignore this email.</small>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    console.error("❌ Brevo failed to send OTP email:", errorBody);
    throw new ApiError(502, "Failed to send the OTP email. Please try again later.");
  }
};