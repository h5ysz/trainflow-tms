// POST /api/auth/logout
import { db } from "@/lib/db";
import { clearSessionCookie, getCurrentUser, ok } from "@/lib/auth/api";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (user) {
    await db.auditLog.create({
      data: {
        userId: user.id,
        action: "LOGOUT",
        entity: "USER",
        entityId: user.id,
        description: `${user.fullName} (${user.role}) signed out`,
        ipAddress: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });
  }
  await clearSessionCookie();
  return ok({ success: true });
}
