// /api/trainees/[id]/history — full training history for a trainee
//
// Returns every session enrollment (active + cancelled) with the session's
// course, trainer, dates, status, and the enrollment's progress fields
// (attendance, pre-test, final-test, evaluation, certificate status).
// Also includes matching certificates (matched by nationalId).
//
// This powers the "Training History" tab on the trainee detail page and
// supports the Re-Exam workflow: coordinators can see which sessions a
// trainee has attended, which they failed, and which are re-exams.
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound } from "@/lib/auth/api";
import { parseJsonColumn } from "@/lib/api/json-column";

export const GET = withModuleAction("trainees", "view", async ({ params, user }) => {
  const id = params.id as string;
  const trainee = await db.trainee.findUnique({
    where: { id },
    select: {
      id: true,
      refNumber: true,
      fullName: true,
      nationalId: true,
      nationality: true,
      jobTitle: true,
      mobile: true,
      email: true,
      idAttachmentUrl: true,
      status: true,
      companyId: true,
      deletedAt: true,
      company: { select: { id: true, name: true, refNumber: true } },
    },
  });
  if (!trainee || trainee.deletedAt) return notFound("Trainee not found");

  // ── Fetch all enrollments (including cancelled) with session details ────
  const enrollments = await db.sessionEnrollment.findMany({
    where: { traineeId: id },
    include: {
      session: {
        select: {
          id: true,
          refNumber: true,
          title: true,
          startDate: true,
          endDate: true,
          shift: true,
          status: true,
          lifecycleStatus: true,
          courseId: true,
          course: { select: { id: true, title: true, code: true, refNumber: true } },
          trainer: { select: { id: true, fullName: true, refNumber: true } },
          venue: true,
          city: true,
        },
      },
      company: { select: { id: true, name: true, refNumber: true } },
    },
    orderBy: { enrollmentDate: "desc" },
  });

  // ── Fetch certificates matching this trainee's nationalId ───────────────
  // Certificates store trainee identity as snapshots (traineeName,
  // traineeIdNational) — no FK to Trainee. We match on nationalId.
  const certificates = trainee.nationalId
    ? await db.certificate.findMany({
        where: { traineeIdNational: trainee.nationalId, deletedAt: null },
        select: {
          id: true,
          refNumber: true,
          sessionId: true,
          courseId: true,
          course: { select: { id: true, title: true, code: true } },
          finalScore: true,
          issuedAt: true,
          validUntil: true,
          status: true,
          version: true,
          pdfUrl: true,
        },
        orderBy: { issuedAt: "desc" },
      })
    : [];

  // ── Build the history timeline ─────────────────────────────────────────
  // Each enrollment is a "history entry" with all progress fields visible.
  // We also cross-reference certificates by sessionId so the UI can show
  // the certificate number alongside the session it was issued from.
  const history = enrollments.map((e) => {
    const cert = certificates.find((c) => c.sessionId === e.sessionId);
    return {
      enrollmentId: e.id,
      enrollmentDate: e.enrollmentDate,
      enrollmentStatus: e.enrollmentStatus,
      isReExam: e.isReExam,
      enrollmentSource: e.enrollmentSource,
      addedByTrainer: e.addedByTrainer,
      pendingReview: e.pendingReview,
      isDeleted: Boolean(e.deletedAt),
      // Session details
      session: {
        id: e.session.id,
        refNumber: e.session.refNumber,
        title: e.session.title,
        startDate: e.session.startDate,
        endDate: e.session.endDate,
        shift: e.session.shift,
        status: e.session.status,
        lifecycleStatus: e.session.lifecycleStatus,
        venue: e.session.venue,
        city: e.session.city,
      },
      // Course details
      course: e.session.course
        ? {
            id: e.session.course.id,
            title: e.session.course.title,
            code: e.session.course.code,
            refNumber: e.session.course.refNumber,
          }
        : null,
      // Trainer
      trainer: e.session.trainer
        ? {
            id: e.session.trainer.id,
            fullName: e.session.trainer.fullName,
            refNumber: e.session.trainer.refNumber,
          }
        : null,
      // Company at the time of enrollment (snapshot)
      company: e.company
        ? { id: e.company.id, name: e.company.name, refNumber: e.company.refNumber }
        : null,
      // Progress
      attendanceStatus: e.attendanceStatus,
      preTestStatus: e.preTestStatus,
      finalTestStatus: e.finalTestStatus,
      evaluationStatus: e.evaluationStatus,
      certificateStatus: e.certificateStatus,
      // Certificate (if issued for this session)
      certificate: cert
        ? {
            id: cert.id,
            refNumber: cert.refNumber,
            finalScore: cert.finalScore,
            issuedAt: cert.issuedAt,
            validUntil: cert.validUntil,
            status: cert.status,
            version: cert.version,
            pdfUrl: cert.pdfUrl,
          }
        : null,
      notes: e.notes,
    };
  });

  // ── Summary stats ──────────────────────────────────────────────────────
  const activeHistory = history.filter((h) => !h.isDeleted);
  const summary = {
    totalSessions: activeHistory.length,
    reExamCount: activeHistory.filter((h) => h.isReExam).length,
    passedCount: activeHistory.filter((h) => h.finalTestStatus === "PASSED").length,
    failedCount: activeHistory.filter((h) => h.finalTestStatus === "FAILED").length,
    certificatesIssued: activeHistory.filter((h) => h.certificate).length,
    attendedCount: activeHistory.filter((h) => ["PRESENT", "LATE"].includes(h.attendanceStatus)).length,
  };

  return ok({
    trainee,
    history,
    certificates,
    summary,
  });
});
