// /api/requests/company-archive — list all requests for the contractor's company
// Returns a simplified list for the Import from Archive feature.
import { db } from "@/lib/db";
import { withModuleAction, ok, fail } from "@/lib/auth/api";

export const GET = withModuleAction("requests", "view", async ({ req, user }) => {
  // Contractors see only their own company's requests.
  // Admins/coordinators can browse — but need a companyId from query param
  // since they don't have one on their user record.
  let companyId: string | undefined;
  if (user.role === "CONTRACTOR") {
    if (!user.companyId) return fail("No company linked to your account", 403);
    companyId = user.companyId;
  } else {
    // Admin/coordinator: use query param or return all (they have broader access)
    const url = new URL(req.url);
    companyId = url.searchParams.get("companyId") || undefined;
  }

  if (!companyId) return fail("companyId query parameter is required for non-contractor roles", 422);

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
            // Phase 3: documents[] is the only attachment source.
            select: { trainee: { select: { documents: true } } },
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
    // Check trainee-level documents[]
    if (!hasAttachments) {
      for (const rc of r.requestCourses) {
        for (const trc of rc.trainees) {
          if (trc.trainee?.documents) {
            hasAttachments = true;
            break;
          }
        }
        if (hasAttachments) break;
      }
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
