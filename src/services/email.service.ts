import nodemailer from "nodemailer";
import { ApiError } from "../utils/Apierror.js";

export const sendOtpEmail = async (to: string, otp: string): Promise<void> => {
  // ── 1. Validate env vars BEFORE trying to connect ────────────
  // If any of these are missing on Railway, fail immediately with
  // a clear error instead of a silent TCP hang.
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !port || !user || !pass) {
    console.error("❌ SMTP env vars missing:", {
      SMTP_HOST: !!host,
      SMTP_PORT: !!port,
      SMTP_USER: !!user,
      SMTP_PASS: !!pass,
    });
    throw new ApiError(500, "Email service is not configured. Please contact support.");
  }

  // ── 2. Create transporter with explicit timeouts ──────────────
  // Without these, nodemailer will hang for ~2 minutes on a dead
  // SMTP connection before throwing — which causes the 500 you saw.
  //
  // SMTP_PORT guide:
  //   587  → STARTTLS  (secure: false) ← most common for Gmail/Brevo/Resend
  //   465  → SSL/TLS   (secure: true)
  //   25   → BLOCKED on Railway and most cloud platforms — do NOT use
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,          // true only for port 465
    auth: { user, pass },
    connectionTimeout: 10_000,     // 10 s — fail fast instead of hanging
    greetingTimeout:  10_000,      // 10 s — time to wait for server greeting
    socketTimeout:    15_000,      // 15 s — per-socket idle timeout
  });

  // ── 3. Verify the connection before sending ───────────────────
  // This gives you a clear log line on Railway if credentials are wrong,
  // rather than a cryptic 500 to the client.
  try {
    await transporter.verify();
  } catch (verifyErr: any) {
    console.error("❌ SMTP connection failed:", verifyErr.message);
    throw new ApiError(
      502,
      "Could not connect to the email server. Please try again later."
    );
  }

  // ── 4. Send the email ─────────────────────────────────────────
  try {
    await transporter.sendMail({
      from: `"Wajba App" <${user}>`,
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
  } catch (sendErr: any) {
    console.error("❌ Failed to send OTP email:", sendErr.message);
    throw new ApiError(502, "Failed to send the OTP email. Please try again later.");
  }
};