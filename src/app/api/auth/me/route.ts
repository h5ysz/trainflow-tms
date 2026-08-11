// GET /api/auth/me — return current authenticated user
import { db } from "@/lib/db";
import { getCurrentUser, ok, fail, resolveEffectivePermissions } from "@/lib/auth/api";
import { computeTrainerNav } from "@/lib/api/trainer-nav";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("Not authenticated", 401);

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    include: { company: true, trainer: true, roleRecord: { select: { permissions: true } } },
  });
  if (!dbUser || dbUser.deletedAt) return fail("User not found", 404);

  const permissions = await resolveEffectivePermissions(dbUser);

  // Data-driven nav flags for trainers (workshops only when assigned, evaluation
  // only when they have sessions). Null for non-trainers.
  const trainerNav = dbUser.role === "TRAINER" && dbUser.trainerId
    ? await computeTrainerNav(dbUser.trainerId)
    : null;

  return ok({
    id: dbUser.id,
    email: dbUser.email,
    fullName: dbUser.fullName,
    role: dbUser.role,
    permissions,
    language: dbUser.language,
    companyId: dbUser.companyId,
    companyName: dbUser.company?.name ?? null,
    trainerId: dbUser.trainerId,
    trainerNav,
    region: dbUser.region ?? null,
    regionsCovered: dbUser.regionsCovered ?? null,
    avatarUrl: dbUser.avatarUrl ?? null,
    isActive: dbUser.isActive,
    lastLoginAt: dbUser.lastLoginAt,
  });
}
