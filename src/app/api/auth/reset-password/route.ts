// /api/auth/reset-password — reset password using a token
// =====================================================================
// Validates the reset token (from /forgot-password) and sets a new password.
// The token is validated by comparing its hash against the stored hash in
// the user's registrationData JSON field.

import { db } from "@/lib/db";
import { ok, fail } from "@/lib/auth/api";
import { hashPassword, verifyPassword } from "@/lib/auth/jwt";

export const POST = async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const { token, email, newPassword } = body as {
    token?: string;
    email?: string;
    newPassword?: string;
  };

  if (!token || !email || !newPassword) {
    return fail("Token, email, and new password are required", 422, "VALIDATION_ERROR");
  }

  if (newPassword.length < 8) {
    return fail("Password must be at least 8 characters", 422, "WEAK_PASSWORD");
  }

  const user = await db.user.findFirst({
    where: { email: email.toLowerCase().trim(), deletedAt: null },
  });

  if (!user) {
    return fail("Invalid or expired reset token", 400, "INVALID_TOKEN");
  }

  // Check if there's a stored reset token
  let resetData: { tokenHash?: string; expiresAt?: string } | null = null;
  try {
    if (user.registrationData) {
      const parsed = JSON.parse(user.registrationData);
      resetData = parsed.passwordReset ?? null;
    }
  } catch {
    // ignore parse errors
  }

  if (!resetData?.tokenHash || !resetData?.expiresAt) {
    return fail("Invalid or expired reset token", 400, "INVALID_TOKEN");
  }

  // Check expiry
  const expiresAt = new Date(resetData.expiresAt);
  if (expiresAt < new Date()) {
    return fail("Reset token has expired. Please request a new one.", 400, "TOKEN_EXPIRED");
  }

  // Verify the token matches
  const isValid = await verifyPassword(token, resetData.tokenHash);
  if (!isValid) {
    return fail("Invalid or expired reset token", 400, "INVALID_TOKEN");
  }

  // Set the new password and clear the reset token
  const newHash = await hashPassword(newPassword);

  // Clear the reset token from registrationData
  let updatedData: Record<string, unknown> = {};
  try {
    if (user.registrationData) updatedData = JSON.parse(user.registrationData);
  } catch { /* ignore */ }
  delete updatedData.passwordReset;

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: newHash,
      registrationData: Object.keys(updatedData).length > 0
        ? JSON.stringify(updatedData)
        : null,
      forcePasswordChange: false,
      // Clear any login lockout from before the reset
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    },
  });

  return ok({ success: true });
};
