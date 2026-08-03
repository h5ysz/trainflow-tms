// /api/sessions/[id]/release-checklist — get release checklists for all certs in a session
// =====================================================================
// Returns an array of ReleaseChecklist objects for all certificates in
// the session. Coordinators see all; contractors see only their own
// company's certificates.
import { db } from "@/lib/db";
import { withModuleAction, ok } from "@/lib/auth/api";
import { computeSessionReleaseChecklists } from "@/lib/certificates/release-checklist";

export const GET = withModuleAction("certificates", "view", async ({ params, user }) => {
  const sessionId = params.id as string;
  // Contractors only see their own company's certificates
  const companyId = user.role === "CONTRACTOR" && user.companyId ? user.companyId : undefined;
  const checklists = await computeSessionReleaseChecklists(sessionId, companyId);
  return ok(checklists);
});
