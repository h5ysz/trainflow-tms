// /api/auth/language — any authenticated user can update their own language preference.
// This bypasses the user-management permission check on PUT /api/users/[id],
// which contractors don't have. Language is a personal preference, not admin data.
import { db } from "@/lib/db";
import { ok, fail, withAuth } from "@/lib/auth/api";
import type { Locale } from "@/lib/i18n/translations";

const VALID_LOCALES: Locale[] = ["en", "ar"];

export const PUT = withAuth(async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { language } = body;

  if (!language || !VALID_LOCALES.includes(language)) {
    return fail("Invalid language. Must be 'en' or 'ar'", 422, "VALIDATION_ERROR");
  }

  await db.user.update({
    where: { id: user.id },
    data: { language },
  });

  return ok({ language });
});
