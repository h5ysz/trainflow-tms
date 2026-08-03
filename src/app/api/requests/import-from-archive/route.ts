// /api/requests/import-from-archive — import trainees/attachments/course info
// from a past request into the current "New Request" form.
//
// Body: { sourceRequestId: string, items: string[] }
// items can include: "trainees", "attachments", "course_info"
//
// Returns: { trainees: TraineeEntry[], courseInfo?: { courseId, courseTitle } }
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction, ok, fail } from "@/lib/auth/api";

export const POST = withModuleAction("requests", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { sourceRequestId, items } = body as { sourceRequestId?: string; items?: string[] };

  if (!sourceRequestId) return fail("sourceRequestId is required", 422, "VALIDATION_ERROR");
  if (!items || !Array.isArray(items) || items.length === 0) {
    return fail("items must be a non-empty array", 422, "VALIDATION_ERROR");
  }

  // Fetch the source request + its trainees + course
  const source = await db.trainingRequest.findUnique({
    where: { id: sourceRequestId },
    include: {
      course: { select: { id: true, title: true } },
      requestCourses: {
        where: { deletedAt: null },
        select: {
          trainees: {
            where: { deletedAt: null },
            include: {
              trainee: {
                select: {
                  id: true, fullName: true, nationalId: true, nationality: true,
                  jobTitle: true, mobile: true, email: true, idAttachmentUrl: true,
                  documents: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!source || source.deletedAt) return fail("Source request not found", 404);
  // RBAC: contractors can only import from their own company's requests
  if (user.role === "CONTRACTOR" && source.companyId !== user.companyId) {
    return fail("Forbidden — you can only import from your own company's requests", 403);
  }

  const result: {
    trainees: unknown[];
    courseInfo?: { courseId: string; courseTitle: string | null };
  } = { trainees: [] };

  // ── Import trainees ────────────────────────────────────────────────────
  if (items.includes("trainees")) {
    for (const rc of source.requestCourses) {
      for (const trc of rc.trainees) {
        const tr = trc.trainee;
        // Parse documents if they exist
        let documents: unknown[] = [];
        if (tr.documents) {
          try {
            const parsed = JSON.parse(tr.documents);
            if (Array.isArray(parsed)) documents = parsed;
          } catch { /* ignore */ }
        }

        result.trainees.push({
          fullName: tr.fullName,
          nationalId: tr.nationalId,
          nationality: tr.nationality ?? "",
          jobTitle: tr.jobTitle ?? "",
          mobile: tr.mobile ?? "",
          email: tr.email ?? "",
          idAttachmentUrl: tr.idAttachmentUrl ?? null,
          documents,
        });
      }
    }
  }

  // ── Import course info ─────────────────────────────────────────────────
  if (items.includes("course_info") && source.course) {
    result.courseInfo = {
      courseId: source.course.id,
      courseTitle: source.course.title,
    };
  }

  // ── Import attachments (included with trainees — their documents) ─────
  // Attachments are already included in the trainees array above.
  // If "attachments" is requested without "trainees", we still return the
  // trainee list (with documents) so the UI can show them.
  if (items.includes("attachments") && !items.includes("trainees")) {
    for (const rc of source.requestCourses) {
      for (const trc of rc.trainees) {
        const tr = trc.trainee;
        let documents: unknown[] = [];
        if (tr.documents) {
          try {
            const parsed = JSON.parse(tr.documents);
            if (Array.isArray(parsed)) documents = parsed;
          } catch { /* ignore */ }
        }
        result.trainees.push({
          fullName: tr.fullName,
          nationalId: tr.nationalId,
          nationality: tr.nationality ?? "",
          jobTitle: tr.jobTitle ?? "",
          mobile: tr.mobile ?? "",
          email: tr.email ?? "",
          idAttachmentUrl: tr.idAttachmentUrl ?? null,
          documents,
        });
      }
    }
  }

  return ok(result);
});
