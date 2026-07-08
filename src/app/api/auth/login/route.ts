// POST /api/auth/login — email/password OR role-based demo login
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { signToken, verifyPassword, getOrCreateDemoUser } from "@/lib/auth/jwt";
import { setSessionCookie, ok, fail, audit } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";
import type { UserRole } from "@/lib/auth/permissions";

const VALID_ROLES: UserRole[] = ["SUPER_ADMIN", "COORDINATOR", "TRAINER", "CONTRACTOR"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email, password, role } = body as {
      email?: string;
      password?: string;
      role?: string;
    };

    let userId: string;

    // Demo role-based login (for design exploration)
    if (role && VALID_ROLES.includes(role as UserRole) && !email) {
      const payload = await getOrCreateDemoUser(role as UserRole);
      userId = payload.id;
    } else if (email && password) {
      // Real email/password login
      const user = await db.user.findUnique({ where: { email } });
      if (!user || !user.isActive || user.deletedAt) {
        return fail("Invalid email or password", 401);
      }
      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return fail("Invalid email or password", 401);
      }
      await db.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      userId = user.id;
    } else {
      return fail("Provide email+password or role", 400);
    }

    const dbUser = await db.user.findUnique({
      where: { id: userId },
      include: { company: true, trainer: true },
    });
    if (!dbUser || !dbUser.isActive || dbUser.deletedAt) {
      return fail("Invalid account", 401);
    }

    const token = await signToken({
      sub: dbUser.id,
      email: dbUser.email,
      role: dbUser.role,
      fullName: dbUser.fullName,
      companyId: dbUser.companyId,
      trainerId: dbUser.trainerId,
    });

    await setSessionCookie(token);

    // Audit log: LOGIN
    await recordAudit({
      userId: dbUser.id,
      action: "LOGIN",
      entity: "USER",
      entityId: dbUser.id,
      description: `${dbUser.fullName} (${dbUser.role}) signed in`,
      descriptionAr: `${dbUser.fullName} (${dbUser.role}) سجّل الدخول`,
      req,
    });

    return ok({
      user: {
        id: dbUser.id,
        email: dbUser.email,
        fullName: dbUser.fullName,
        role: dbUser.role,
        language: dbUser.language,
        companyId: dbUser.companyId,
        companyName: dbUser.company?.name ?? null,
        trainerId: dbUser.trainerId,
        avatarUrl: dbUser.avatarUrl ?? null,
      },
      token,
    });
  } catch (e) {
    console.error("[Login error]", e);
    return fail("Login failed", 500);
  }
}

// Suppress unused warning
void audit;
