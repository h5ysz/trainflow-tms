// /api/settings/public — public branding settings (no auth required)
// =====================================================================
// Returns only the keys flagged isPublic=true. Used by the login page
// to display the support email, official logo URL, and primary brand
// color without requiring the user to sign in first.
//
// Secret values (SMTP passwords, etc.) are filtered out by isSecretSetting.
import { db } from "@/lib/db";
import { withErrorEnvelope } from "@/lib/auth/api";
import { ok } from "@/lib/api/response";
import { isSecretSetting } from "@/lib/settings/secrets";

export const GET = withErrorEnvelope(async function GET() {
  const rows = await db.setting.findMany({
    where: { isPublic: true },
    select: { key: true, value: true, category: true },
  });

  // Defensive: also strip any secret keys that were mistakenly flagged public
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (isSecretSetting(r.key)) continue;
    map[r.key] = r.value;
  }

  return ok(map);
});
