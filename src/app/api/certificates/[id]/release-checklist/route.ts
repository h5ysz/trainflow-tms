// /api/certificates/[id]/release-checklist — get the release checklist for a certificate
// =====================================================================
// Returns the full release checklist: invoice, attendance, exam, profession,
// and coordinator approval status. Used by the UI to show what's missing
// before certificates can be released.
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, notFound } from "@/lib/auth/api";
import { computeReleaseChecklist } from "@/lib/certificates/release-checklist";

export const GET = withModuleAction("certificates", "view", async ({ params, user }) => {
  const id = params.id as string;
  const cert = await db.certificate.findUnique({ where: { id }, select: { id: true, companyId: true, deletedAt: true } });
  if (!cert || cert.deletedAt) return notFound("Certificate not found");

  // Contractor can only view their own company's certificates
  if (user.role === "CONTRACTOR" && user.companyId && cert.companyId !== user.companyId) {
    return fail("Forbidden", 403);
  }

  const checklist = await computeReleaseChecklist(id);
  if (!checklist) return notFound("Certificate not found");

  return ok(checklist);
});
