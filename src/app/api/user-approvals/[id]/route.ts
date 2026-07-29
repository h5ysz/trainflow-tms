// /api/user-approvals/[id] — approve / reject / suspend / activate / request-info
import { db } from "@/lib/db";
import { withErrorEnvelope, requireModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";
import { parseJsonColumn } from "@/lib/api/json-column";

const VALID_ACTIONS = ["APPROVE", "REJECT", "SUSPEND", "ACTIVATE", "REQUEST_INFO"];

export const POST = withErrorEnvelope(async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireModuleAction("user-approvals", "edit");

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const { action, reason, createCompany, roleId } = body as {
    action: string;
    reason?: string;
    createCompany?: boolean;
    roleId?: string;
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

      // Approval must assign a Role. Registration only sets the `role` enum and leaves
      // `roleId` null; with no matching Role row, resolveEffectivePermissions() fails
      // closed to an empty permission set and the approved user logs in to an app with
      // no sidebar, no dashboard and nothing they can click.
      const effectiveRoleId = roleId ?? targetUser.roleId;
      if (!effectiveRoleId) {
        return fail(
          "A role must be assigned when approving an account, otherwise the user will have no access to anything.",
          422,
          "ROLE_REQUIRED"
        );
      }
      const role = await db.role.findFirst({
        where: { id: effectiveRoleId, deletedAt: null },
        select: { id: true, baseType: true, name: true },
      });
      if (!role) return fail(`Invalid roleId: ${effectiveRoleId}`, 400, "INVALID_ROLE");
      updates.roleId = role.id;
      updates.role = role.baseType;
      description = `Approved user account: ${targetUser.email} as ${role.name}`;

      // Optionally create a Company record for the contractor
      if (createCompany && targetUser.registrationData) {
        const regData = parseJsonColumn<{
          companyName?: string;
          crNumber?: string;
          contactPerson?: string;
          mobileNumber?: string;
        }>(targetUser.registrationData, {}, "user.registrationData");

        // Company.name is required. A registration payload missing companyName (or a
        // row whose registrationData failed to parse) would otherwise reach Prisma with
        // `name: undefined` and blow up mid-approval.
        const companyName = regData.companyName?.trim();
        if (!companyName) {
          return fail(
            "Cannot create a company: the registration data has no company name",
            422,
            "VALIDATION_ERROR"
          );
        }

        const existingCompany = await db.company.findFirst({
          where: { name: companyName, deletedAt: null },
        });
        if (existingCompany) {
          updates.companyId = existingCompany.id;
        } else {
          const { nextRefNumber } = await import("@/lib/api/ref-number");
          const refNumber = await nextRefNumber("COMPANY");
          const newCompany = await db.company.create({
            data: {
              refNumber,
              name: companyName,
              crNumber: regData.crNumber || null,
              contactPerson: regData.contactPerson ?? null,
              contactPhone: regData.mobileNumber ?? null,
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
});
