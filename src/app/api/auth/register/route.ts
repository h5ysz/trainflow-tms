// /api/auth/register — Public contractor self-registration
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/jwt";
import { ok, fail } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";

interface RegisterBody {
  companyName: string;
  crNumber?: string;
  contactPerson: string;
  nationalId: string;
  mobileNumber: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: RegisterBody = await req.json().catch(() => ({} as RegisterBody));

    // Validate required fields
    if (!body.companyName || !body.contactPerson || !body.nationalId || !body.mobileNumber || !body.email || !body.password) {
      return fail("All fields are required except Commercial Registration", 422, "VALIDATION_ERROR");
    }

    if (body.password !== body.confirmPassword) {
      return fail("Passwords do not match", 422, "PASSWORD_MISMATCH");
    }

    if (body.password.length < 8) {
      return fail("Password must be at least 8 characters", 422, "WEAK_PASSWORD");
    }

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
