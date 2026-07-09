// /api/auth/register — Public contractor self-registration
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/jwt";
import { ok, fail } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { parseBody } from "@/lib/api/validate";
import { registerSchema } from "@/lib/api/schemas";

export async function POST(req: NextRequest) {
  try {
    const rl = checkRateLimit(req, "auth:register", { limit: 10, windowMs: 60_000 });
    if (!rl.ok) return fail("Too many registration attempts. Please try again shortly.", 429, "RATE_LIMITED");

    const parsed = await parseBody(req, registerSchema);
    if ("error" in parsed) return parsed.error;
    const body = parsed.data;

    // Check if email already exists
    const existing = await db.user.findUnique({ where: { email: body.email } });
    if (existing) {
      return fail("An account with this email already exists", 400, "EMAIL_EXISTS");
    }

    // Hash password
    const passwordHash = await hashPassword(body.password);

    // Create user with PENDING_APPROVAL status
    const user = await db.user.create({
      data: {
        email: body.email,
        passwordHash,
        fullName: body.contactPerson,
        phone: body.mobileNumber,
        role: "CONTRACTOR",
        language: "en",
        isActive: false, // not active until approved
        accountStatus: "PENDING_APPROVAL",
        forcePasswordChange: false,
        registrationData: JSON.stringify({
          companyName: body.companyName,
          crNumber: body.crNumber || null,
          contactPerson: body.contactPerson,
          nationalId: body.nationalId,
          mobileNumber: body.mobileNumber,
        }),
      },
    });

    // Audit: registration
    await recordAudit({
      userId: user.id,
      action: "CREATE",
      entity: "USER",
      entityId: user.id,
      description: `New contractor registration: ${body.contactPerson} (${body.email}) for company "${body.companyName}" — status: PENDING_APPROVAL`,
      req,
      metadata: {
        companyName: body.companyName,
        crNumber: body.crNumber,
        mobileNumber: body.mobileNumber,
        accountStatus: "PENDING_APPROVAL",
      },
    });

    return ok({
      success: true,
      message: "Registration submitted successfully. Your account is pending approval by GCCLAB administration.",
      userId: user.id,
      accountStatus: "PENDING_APPROVAL",
    });
  } catch (e) {
    console.error("[Registration error]", e);
    return fail("Registration failed", 500);
  }
}
