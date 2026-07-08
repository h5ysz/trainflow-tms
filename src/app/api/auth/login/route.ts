// POST /api/auth/login — email/password OR role-based demo login
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { signToken, verifyPassword, getOrCreateDemoUser } from "@/lib/auth/jwt";
import { setSessionCookie, ok, fail } from "@/lib/auth/api";
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
    let userRole: UserRole;
    let userEmail: string;
    let userFullName: string;

    // Demo role-based login (for design exploration)
    if (role && VALID_ROLES.includes(role as UserRole) && !email) {
      const payload = await getOrCreateDemoUser(role as UserRole);
      userId = payload.id;
      userRole = payload.role;
      userEmail = payload.email;
      userFullName = payload.fullName;
    } else if (email && password) {
      const user = await db.user.findUnique({ where: { email } });
      if (!user || !user.isActive) {
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
      userRole = user.role;
      userEmail = user.email;
      userFullName = user.fullName;
    } else {
      return fail("Provide email+password or role", 400);
    }

    const dbUser = await db.user.findUnique({
      where: { id: userId },
      include: { company: true, trainer: true },
    });

    const token = await signToken({
      sub: dbUser!.id,
      email: dbUser!.email,
      role: dbUser!.role,
      fullName: dbUser!.fullName,
      companyId: dbUser!.companyId,
      trainerId: dbUser!.trainerId,
    });

    await setSessionCookie(token);

    await db.auditLog.create({
      data: {
        userId: dbUser!.id,
        action: "LOGIN",
        entity: "USER",
        entityId: dbUser!.id,
        description: `${dbUser!.fullName} (${dbUser!.role}) signed in`,
        ipAddress: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });

    return ok({
      user: {
        id: dbUser!.id,
        email: dbUser!.email,
        fullName: dbUser!.fullName,
        role: dbUser!.role,
        language: dbUser!.language,
        companyId: dbUser!.companyId,
        companyName: dbUser!.company?.name ?? null,
        trainerId: dbUser!.trainerId,
        avatarUrl: dbUser!.avatarUrl ?? null,
      },
      token,
    });
  } catch (e) {
    console.error("[Login error]", e);
    return fail("Login failed", 500);
  }
}
