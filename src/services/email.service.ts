import nodemailer from "nodemailer";

export const sendOtpEmail = async (to: string, otp: string) => {
  // ⚠️  Transporter must be created inside the function, NOT at module level.
  // This file is imported (and evaluated) before dotenv.config() runs in
  // server.ts due to ESM hoisting — SMTP_* variables would be undefined
  // at module-init time.
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailOptions = {
    from: `"Wajba App" <${process.env.SMTP_USER}>`,
    to,
    subject: "Your Password Reset OTP",
    text: `Your OTP for password reset is: ${otp}. It is valid for 10 minutes.`,
  };
  await transporter.sendMail(mailOptions);
};