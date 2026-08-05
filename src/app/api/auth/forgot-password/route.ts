// /api/auth/forgot-password — request a password reset link
// =====================================================================
// Generates a secure reset token, stores its hash + expiry on the user's
// registrationData JSON field (no schema migration needed), and sends a
// reset link email via the existing email service.
//
// If the email doesn't exist, returns success anyway (security: don't leak
// which emails are registered).

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/auth/api";
import { hashPassword } from "@/lib/auth/jwt";
import { sendReportEmail } from "@/lib/reports/email-service";
import crypto from "node:crypto";

export const POST = async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const { email } = body as { email?: string };

  if (!email || typeof email !== "string") {
    return fail("Email is required", 422, "VALIDATION_ERROR");
  }

  const user = await db.user.findFirst({
    where: { email: email.toLowerCase().trim(), deletedAt: null },
  });

  // Always return success — don't leak whether the email exists
  if (!user) {
    return ok({ success: true });
  }

  // Don't allow reset for suspended/rejected accounts
  if (user.accountStatus === "SUSPENDED" || user.accountStatus === "REJECTED") {
    return ok({ success: true });
  }

  // Generate a secure random token (32 bytes → 64 hex chars)
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = await hashPassword(token); // reuse PBKDF2
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Store token hash + expiry in registrationData JSON (no migration needed)
  const existingData = user.registrationData
    ? JSON.parse(user.registrationData)
    : {};
  existingData.passwordReset = { tokenHash, expiresAt: expiresAt.toISOString() };

  await db.user.update({
    where: { id: user.id },
    data: { registrationData: JSON.stringify(existingData) },
  });

  // Build the reset link
  const origin = req.headers.get("origin");
  const fwdProto = req.headers.get("x-forwarded-proto");
  const fwdHost = req.headers.get("x-forwarded-host");
  const host = req.headers.get("host");
  const baseUrl = origin ||
    (fwdProto && fwdHost ? `${fwdProto}://${fwdHost}` : null) ||
    (host ? `http://${host}` : null) ||
    "http://localhost:3000";
  const resetLink = `${baseUrl}/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;

  // Try to send the email — if SMTP isn't configured, the reset link is
  // logged to the server console so the admin can share it manually.
  // Also always log the link so it's visible in dev/Render logs.
  console.log(`[forgot-password] Reset link for ${user.email}: ${resetLink}`);
  try {
    await sendReportEmail({
      to: [user.email],
      subject: "Password Reset — GCC Lab TMS",
      body: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #800000;">GCC Lab — Password Reset</h2>
          <p>Hello ${user.fullName},</p>
          <p>You requested a password reset for your GCC Lab TMS account.</p>
          <p>Click the link below to reset your password. This link expires in 1 hour.</p>
          <p><a href="${resetLink}" style="display: inline-block; padding: 10px 24px; background: #800000; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">Reset Password</a></p>
          <p style="color: #666; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
          <p style="color: #999; font-size: 11px;">GCC Lab Training Management System</p>
        </div>
      `,
      attachments: [],
    });
  } catch (err) {
    // SMTP error — the link was already logged above
  }

  return ok({ success: true });
};
