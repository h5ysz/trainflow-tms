// POST /api/auth/login — email/password production login (no demo/role-login in production)
// Sprint 6: Removed demo role-login path entirely (security hardening).
//           Email + password is now the only accepted login method.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { signToken, verifyPassword } from "@/lib/auth/jwt";
import { setSessionCookie, ok, fail } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MIN = 15;

async function logLoginAttempt(opts: {
  userId?: string | null;
  email: string;
  success: boolean;
  failureReason?: string;
  req: NextRequest;
}) {
  try {
    await db.loginHistory.create({
      data: {
        userId: opts.userId ?? null,
        email: opts.email,
        success: opts.success,
        failureReason: opts.failureReason ?? null,
        ipAddress: opts.req.headers.get("x-forwarded-for") ?? null,
        userAgent: opts.req.headers.get("user-agent") ?? null,
      },
    });
  } catch {
    // don't fail login if logging fails
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { email, password } = body as { email?: string; password?: string };

    if (!email || !password) {
      return fail("Email and password are required", 400, "VALIDATION_ERROR");
    }

    const user = await db.user.findUnique({ where: { email } });

    // User not found
    if (!user || user.deletedAt) {
      await logLoginAttempt({ email, success: false, failureReason: "User not found", req });
      return fail("Invalid email or password", 401);
    }

    // Check account status
    if (user.accountStatus === "PENDING_APPROVAL") {
      await logLoginAttempt({ userId: user.id, email, success: false, failureReason: "Pending approval", req });
      return fail("Your account is pending approval by GCCLAB administration", 403, "PENDING_APPROVAL");
    }
    if (user.accountStatus === "REJECTED") {
      await logLoginAttempt({ userId: user.id, email, success: false, failureReason: "Account rejected", req });
      return fail("Your registration has been rejected. Contact support.", 403, "ACCOUNT_REJECTED");
    }
    if (user.accountStatus === "SUSPENDED") {
      await logLoginAttempt({ userId: user.id, email, success: false, failureReason: "Account suspended", req });
      return fail("Your account has been suspended. Contact administration.", 403, "ACCOUNT_SUSPENDED");
    }

    // Check if locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await logLoginAttempt({ userId: user.id, email, success: false, failureReason: "Account locked", req });
      const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      return fail(`Account locked. Try again in ${remaining} minute(s).`, 403, "ACCOUNT_LOCKED");
    }

    // Verify password
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      // Increment failed attempts
      const newFailedCount = user.failedLoginAttempts + 1;
      const shouldLock = newFailedCount >= MAX_FAILED_ATTEMPTS;

      await db.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newFailedCount,
          ...(shouldLock && {
            accountStatus: "LOCKED",
            lockedUntil: new Date(Date.now() + LOCK_DURATION_MIN * 60000),
          }),
        },
      });

      await logLoginAttempt({ userId: user.id, email, success: false, failureReason: "Invalid password", req });

      if (shouldLock) {
        await recordAudit({
          userId: user.id,
          action: "LOGIN",
          entity: "USER",
          entityId: user.id,
          description: `Account locked after ${MAX_FAILED_ATTEMPTS} failed login attempts: ${email}`,
          req,
        });
        return fail(`Account locked after ${MAX_FAILED_ATTEMPTS} failed attempts. Try again in ${LOCK_DURATION_MIN} minutes.`, 403, "ACCOUNT_LOCKED");
      }

      return fail(`Invalid email or password. ${MAX_FAILED_ATTEMPTS - newFailedCount} attempt(s) remaining.`, 401);
    }

    // Password valid — reset failed attempts + unlock
    await db.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...(user.accountStatus === "LOCKED" && { accountStatus: "ACTIVE" }),
      },
    });

    await logLoginAttempt({ userId: user.id, email, success: true, req });

    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      include: { company: true, trainer: true },
    });
    if (!dbUser || dbUser.deletedAt) {
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
        forcePasswordChange: dbUser.forcePasswordChange,
        accountStatus: dbUser.accountStatus,
      },
      token,
    });
  } catch (e) {
    console.error("[Login error]", e);
    return fail("Login failed", 500);
  }
}
