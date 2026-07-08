// GET /api/auth/me — return current authenticated user
import { db } from "@/lib/db";
import { getCurrentUser, ok, fail } from "@/lib/auth/api";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("Not authenticated", 401);

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    include: { company: true, trainer: true },
  });
  if (!dbUser) return fail("User not found", 404);

  return ok({
    id: dbUser.id,
    email: dbUser.email,
    fullName: dbUser.fullName,
    role: dbUser.role,
    language: dbUser.language,
    companyId: dbUser.companyId,
    companyName: dbUser.company?.name ?? null,
    trainerId: dbUser.trainerId,
    avatarUrl: dbUser.avatarUrl ?? null,
    isActive: dbUser.isActive,
    lastLoginAt: dbUser.lastLoginAt,
  });
}
