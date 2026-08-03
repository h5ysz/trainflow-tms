// /api/requests/company-archive — list all requests for the contractor's company
// Returns a simplified list for the Import from Archive feature.
import { db } from "@/lib/db";
import { withModuleAction, ok, fail } from "@/lib/auth/api";

export const GET = withModuleAction("requests", "view", async ({ req, user }) => {
  // Contractors see only their own company's requests
  if (user.role === "CONTRACTOR" && !user.companyId) {
    return fail("No company linked to your account", 403);
  }

  const companyId = user.companyId;
  if (!companyId) return fail("No company found", 404);

  const requests = await db.trainingRequest.findMany({
    where: { companyId, deletedAt: null },
    select: {
      id: true,
      refNumber: true,
      createdAt: true,
      traineeCount: true,
      status: true,
      course: { select: { title: true } },
      documents: true, // JSON string of additional documents
      requestCourses: {
        where: { deletedAt: null },
        select: {
          trainees: {
            where: { deletedAt: null },
            select: { trainee: { select: { documents: true, idAttachmentUrl: true } } },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Check if any trainees have attachments
  const result = requests.map((r) => {
    let hasAttachments = false;
    // Check request-level documents
    if (r.documents) hasAttachments = true;
    // Check trainee-level documents
    for (const rc of r.requestCourses) {
      for (const trc of rc.trainees) {
        if (trc.trainee?.idAttachmentUrl || trc.trainee?.documents) {
          hasAttachments = true;
          break;
        }
      }
      if (hasAttachments) break;
    }

    return {
      id: r.id,
      refNumber: r.refNumber,
      courseTitle: r.course?.title ?? null,
      createdAt: r.createdAt.toISOString(),
      traineeCount: r.traineeCount,
      status: r.status,
      hasAttachments,
    };
  });

  return ok(result);
});
