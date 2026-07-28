// /api/user-approvals/[id] — approve / reject / suspend / activate / request-info
import { db } from "@/lib/db";
import { requireModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";

const VALID_ACTIONS = ["APPROVE", "REJECT", "SUSPEND", "ACTIVATE", "REQUEST_INFO"];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireModuleAction("user-approvals", "edit");
  } catch {
    return fail("Forbidden", 403);
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const { action, reason, createCompany } = body as {
    action: string;
    reason?: string;
    createCompany?: boolean;
  };

  if (!action || !VALID_ACTIONS.includes(action)) {
    return fail(`action must be one of: ${VALID_ACTIONS.join(", ")}`, 422, "VALIDATION_ERROR");
  }

  const targetUser = await db.user.findUnique({ where: { id } });
  if (!targetUser || targetUser.deletedAt) return notFound("User not found");

  const updates: Record<string, unknown> = { updatedBy: user.id };
  let description = "";
  let descriptionAr = "";

  switch (action) {
    case "APPROVE": {
      updates.accountStatus = "ACTIVE";
      updates.isActive = true;
      description = `Approved user account: ${targetUser.email}`;
      descriptionAr = `تم اعتماد حساب المستخدم: ${targetUser.email}`;

      // Optionally create a Company record for the contractor
      if (createCompany && targetUser.registrationData) {
        const regData = JSON.parse(targetUser.registrationData);
        const existingCompany = await db.company.findFirst({
          where: { name: regData.companyName, deletedAt: null },
        });
        if (existingCompany) {
          updates.companyId = existingCompany.id;
        } else {
          const { nextRefNumber } = await import("@/lib/api/ref-number");
          const refNumber = await nextRefNumber("COMPANY");
          const newCompany = await db.company.create({
            data: {
              refNumber,
              name: regData.companyName,
              crNumber: regData.crNumber || null,
              contactPerson: regData.contactPerson,
              contactPhone: regData.mobileNumber,
              contactEmail: targetUser.email,
              status: "ACTIVE",
              createdBy: user.id,
              updatedBy: user.id,
            },
          });
          updates.companyId = newCompany.id;
        }
      }
      break;
    }
    case "REJECT":
      updates.accountStatus = "REJECTED";
      updates.isActive = false;
      description = `Rejected user account: ${targetUser.email}${reason ? ` — ${reason}` : ""}`;
      descriptionAr = `تم رفض حساب المستخدم: ${targetUser.email}`;
      break;
    case "SUSPEND":
      updates.accountStatus = "SUSPENDED";
      updates.isActive = false;
      description = `Suspended user account: ${targetUser.email}${reason ? ` — ${reason}` : ""}`;
      descriptionAr = `تم إيقاف حساب المستخدم: ${targetUser.email}`;
      break;
    case "ACTIVATE":
      updates.accountStatus = "ACTIVE";
      updates.isActive = true;
      description = `Activated user account: ${targetUser.email}`;
      descriptionAr = `تم تفعيل حساب المستخدم: ${targetUser.email}`;
      break;
    case "REQUEST_INFO":
      description = `Requested more information from: ${targetUser.email}${reason ? ` — ${reason}` : ""}`;
      descriptionAr = `تم طلب معلومات إضافية من: ${targetUser.email}`;
      break;
  }

  await db.user.update({ where: { id }, data: updates });

  await recordAudit({
    userId: user.id,
    action: action === "APPROVE" ? "APPROVE" : action === "REJECT" ? "REJECT" : "UPDATE",
    entity: "USER",
    entityId: id,
    description,
    descriptionAr,
    req,
    metadata: { action, reason, targetEmail: targetUser.email },
  });

  // Create notification for the user
  await db.notification.create({
    data: {
      userId: id,
      title: `Account ${action === "APPROVE" ? "Approved" : action === "REJECT" ? "Rejected" : action === "SUSPEND" ? "Suspended" : "Updated"}`,
      message: description,
      type: action === "APPROVE" ? "SUCCESS" : action === "REJECT" ? "ERROR" : "WARNING",
      category: "SYSTEM",
    },
  });

  return ok({ success: true, action, userId: id, accountStatus: updates.accountStatus ?? targetUser.accountStatus });
}
