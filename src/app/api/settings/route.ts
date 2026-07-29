// /api/settings — list + bulk update (Super Admin only)
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, fail, audit } from "@/lib/auth/api";
import { categoryForKey, isSecretSetting } from "@/lib/settings/secrets";
import { encryptSecret } from "@/lib/settings/crypto";

interface SettingView {
  value: string;
  category: string;
  description?: string | null;
  isPublic: boolean;
  /** True for keys whose value is withheld from the client (see isSecretSetting). */
  isSecret?: boolean;
  /** For secret keys: whether a value is stored, without revealing it. */
  isSet?: boolean;
}

export const GET = withErrorEnvelope(async function GET() {
  await requireRole("SUPER_ADMIN");

  const settings = await db.setting.findMany({ orderBy: { category: "asc" } });
  const map: Record<string, SettingView> = {};
  for (const s of settings) {
    const secret = isSecretSetting(s.key);
    map[s.key] = {
      // Secret values are never serialised — not the plaintext, not the ciphertext.
      // The UI renders a "configured" placeholder from isSet instead.
      value: secret ? "" : s.value,
      category: s.category,
      description: s.description,
      isPublic: s.isPublic,
      ...(secret ? { isSecret: true, isSet: s.value.length > 0 } : {}),
    };
  }
  return ok(map);
});

export const PUT = withErrorEnvelope(async function PUT(req: Request) {
  const user = await requireRole("SUPER_ADMIN");

  const body = await req.json().catch(() => ({}));
  const updates = body.settings ?? body;
  if (typeof updates !== "object" || updates === null || Array.isArray(updates)) {
    return fail("Expected { settings: { key: value } }", 422, "VALIDATION_ERROR");
  }

  const applied: string[] = [];
  const skipped: string[] = [];

  // Sequential, not Promise.all: SQLite allows a single writer, and firing N upserts
  // concurrently risks SQLITE_BUSY on a page that saves many keys at once.
  for (const [key, raw] of Object.entries(updates)) {
    if (key === "category") continue; // legacy body field, not a setting

    let value = String(raw ?? "");

    if (isSecretSetting(key)) {
      // An empty value means "leave the stored secret alone" — otherwise saving the
      // form without retyping the password would wipe it.
      if (value === "") {
        skipped.push(key);
        continue;
      }
      value = encryptSecret(value);
    }

    await db.setting.upsert({
      where: { key },
      update: { value, updatedBy: user.id },
      create: {
        key,
        value,
        // Derived per key rather than from a single body-level category, so a setting
        // stays in the tab it belongs to.
        category: categoryForKey(key, body.category ?? "GENERAL"),
        updatedBy: user.id,
      },
    });
    applied.push(key);
  }

  await audit({
    user,
    action: "UPDATE",
    entity: "SETTING",
    description: `Updated settings: ${applied.join(", ") || "(none)"}`,
    descriptionAr: `تم تحديث الإعدادات: ${applied.join(", ") || "(لا شيء)"}`,
    req,
    // Only key names — never values, which may include the SMTP password.
    metadata: { keys: applied, skipped },
  });

  return ok({ updated: applied, skipped });
});
