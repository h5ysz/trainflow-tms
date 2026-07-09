// /api/auth/register — Public contractor self-registration
// Sprint 6: hardened validation, duplicate email + national ID checks, bilingual errors.
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

// Bilingual message store: each error code → { en, ar }
const MESSAGES: Record<string, { en: string; ar: string }> = {
  VALIDATION_ERROR: {
    en: "All fields are required except Commercial Registration",
    ar: "جميع الحقول مطلوبة عدا السجل التجاري",
  },
  PASSWORD_MISMATCH: {
    en: "Passwords do not match",
    ar: "كلمتا المرور غير متطابقتين",
  },
  WEAK_PASSWORD_LENGTH: {
    en: "Password must be at least 8 characters",
    ar: "كلمة المرور يجب أن تكون 8 أحرف على الأقل",
  },
  WEAK_PASSWORD_COMPLEXITY: {
    en: "Password must include uppercase, lowercase, and a number",
    ar: "كلمة المرور يجب أن تحتوي على أحرف كبيرة وصغيرة ورقم",
  },
  EMAIL_EXISTS: {
    en: "An account with this email already exists",
    ar: "يوجد حساب مسجّل بهذا البريد الإلكتروني مسبقاً",
  },
  NATIONAL_ID_EXISTS: {
    en: "An account with this National ID / Iqama already exists",
    ar: "يوجد حساب مسجّل بهذا رقم الهوية / الإقامة مسبقاً",
  },
  INVALID_EMAIL: {
    en: "Please enter a valid email address",
    ar: "الرجاء إدخال بريد إلكتروني صحيح",
  },
  INVALID_MOBILE: {
    en: "Please enter a valid mobile number (e.g. +966 5X XXX XXXX)",
    ar: "الرجاء إدخال رقم جوال صحيح (مثل ‎+966 5X XXX XXXX)",
  },
  INVALID_NATIONAL_ID: {
    en: "National ID / Iqama must be 10 digits",
    ar: "رقم الهوية / الإقامة يجب أن يكون 10 أرقام",
  },
  REGISTRATION_FAILED: {
    en: "Registration failed. Please try again or contact support.",
    ar: "فشل التسجيل. يرجى المحاولة مرة أخرى أو الاتصال بالدعم.",
  },
};

function pickLocale(req: NextRequest): "en" | "ar" {
  const al = req.headers.get("accept-language")?.toLowerCase() ?? "";
  if (al.startsWith("ar")) return "ar";
  return "en";
}

// RFC-5322 simplified email regex
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Saudi mobile: optional +966 or 0, then 5, then 8 digits — accept spaces/dashes
const MOBILE_RE = /^(\+?966|0)?[\s-]?5\d[\s-]?\d{3}[\s-]?\d{4}$/;
// Saudi National ID / Iqama: 10 digits
const NATIONAL_ID_RE = /^\d{10}$/;

export async function POST(req: NextRequest) {
  const locale = pickLocale(req);
  const t = (code: string) => MESSAGES[code]?.[locale] ?? MESSAGES[code]?.en ?? code;

  try {
    const body: RegisterBody = await req.json().catch(() => ({} as RegisterBody));

    // 1) Required fields
    if (
      !body.companyName?.trim() ||
      !body.contactPerson?.trim() ||
      !body.nationalId?.trim() ||
      !body.mobileNumber?.trim() ||
      !body.email?.trim() ||
      !body.password
    ) {
      return fail(t("VALIDATION_ERROR"), 422, "VALIDATION_ERROR");
    }

    // 2) Confirm password presence + match
    if (!body.confirmPassword) {
      return fail(t("VALIDATION_ERROR"), 422, "VALIDATION_ERROR");
    }
    if (body.password !== body.confirmPassword) {
      return fail(t("PASSWORD_MISMATCH"), 422, "PASSWORD_MISMATCH");
    }

    // 3) Password length
    if (body.password.length < 8) {
      return fail(t("WEAK_PASSWORD_LENGTH"), 422, "WEAK_PASSWORD_LENGTH");
    }

    // 4) Password complexity (uppercase + lowercase + digit) — aligned with seed settings
    if (!/[A-Z]/.test(body.password) || !/[a-z]/.test(body.password) || !/\d/.test(body.password)) {
      return fail(t("WEAK_PASSWORD_COMPLEXITY"), 422, "WEAK_PASSWORD_COMPLEXITY");
    }

    // 5) Email format
    const email = body.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return fail(t("INVALID_EMAIL"), 422, "INVALID_EMAIL");
    }

    // 6) Mobile format
    if (!MOBILE_RE.test(body.mobileNumber.trim())) {
      return fail(t("INVALID_MOBILE"), 422, "INVALID_MOBILE");
    }

    // 7) National ID format
    const nationalId = body.nationalId.trim();
    if (!NATIONAL_ID_RE.test(nationalId)) {
      return fail(t("INVALID_NATIONAL_ID"), 422, "INVALID_NATIONAL_ID");
    }

    // 8) Duplicate email check
    const existingByEmail = await db.user.findUnique({ where: { email } });
    if (existingByEmail) {
      return fail(t("EMAIL_EXISTS"), 400, "EMAIL_EXISTS");
    }

    // 9) Duplicate National ID check — scan registrationData JSON across all users
    //    (National ID is stored inside registrationData JSON, not as a top-level column.)
    const existingByNationalId = await db.user.findFirst({
      where: {
        registrationData: { contains: `"nationalId":"${nationalId}"` },
        deletedAt: null,
      },
      select: { id: true, email: true },
    });
    if (existingByNationalId) {
      return fail(t("NATIONAL_ID_EXISTS"), 400, "NATIONAL_ID_EXISTS");
    }

    // Hash password
    const passwordHash = await hashPassword(body.password);

    // Create user with PENDING_APPROVAL status
    const user = await db.user.create({
      data: {
        email,
        passwordHash,
        fullName: body.contactPerson.trim(),
        phone: body.mobileNumber.trim(),
        role: "CONTRACTOR",
        language: locale,
        isActive: false, // not active until approved
        accountStatus: "PENDING_APPROVAL",
        forcePasswordChange: false,
        registrationData: JSON.stringify({
          companyName: body.companyName.trim(),
          crNumber: body.crNumber?.trim() || null,
          contactPerson: body.contactPerson.trim(),
          nationalId,
          mobileNumber: body.mobileNumber.trim(),
        }),
      },
    });

    // Audit: registration
    await recordAudit({
      userId: user.id,
      action: "CREATE",
      entity: "USER",
      entityId: user.id,
      description: `New contractor registration: ${body.contactPerson} (${email}) for company "${body.companyName}" — status: PENDING_APPROVAL`,
      descriptionAr: `تسجيل مقاول جديد: ${body.contactPerson} (${email}) للشركة "${body.companyName}" — الحالة: قيد الاعتماد`,
      req,
      metadata: {
        companyName: body.companyName,
        crNumber: body.crNumber,
        mobileNumber: body.mobileNumber,
        nationalId,
        accountStatus: "PENDING_APPROVAL",
      },
    });

    return ok({
      success: true,
      message:
        locale === "ar"
          ? "تم تقديم طلب التسجيل بنجاح. حسابك قيد المراجعة من إدارة GCCLAB."
          : "Registration submitted successfully. Your account is pending approval by GCCLAB administration.",
      userId: user.id,
      accountStatus: "PENDING_APPROVAL",
    });
  } catch (e) {
    console.error("[Registration error]", e);
    return fail(t("REGISTRATION_FAILED"), 500, "REGISTRATION_FAILED");
  }
}
