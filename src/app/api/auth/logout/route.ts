// POST /api/auth/logout
import { db } from "@/lib/db";
import { clearSessionCookie, getCurrentUser, ok } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (user) {
    await recordAudit({
      userId: user.id,
      action: "LOGOUT",
      entity: "USER",
      entityId: user.id,
      description: `${user.fullName} (${user.role}) signed out`,
      descriptionAr: `${user.fullName} (${user.role}) سجّل الخروج`,
      req,
    });
  }
  await clearSessionCookie();
  return ok({ success: true });
}
