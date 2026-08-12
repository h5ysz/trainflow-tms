// /api/sessions/[id]/contact-directory — communication data for a session
// =====================================================================
// Trainer-facing "contact & follow-up" panel: the companies whose trainees are
// enrolled in THIS session, their company contacts, and each enrolled trainee
// with the contact fields the trainer needs to chase an absence/late.
//
// Security: this endpoint is scoped exactly like GET /api/sessions/[id]. A
// TRAINER may only read a session assigned to them (trainerDeniedSession →
// 403), so the companies/trainees/contacts they see are always and only the
// ones participating in their OWN session. No client-supplied trainerId or
// sessionId can widen that scope, and no new TRAINER module permission is
// introduced — this is session-scoped delivery data, not a global grant.
//
// Usage: GET /api/sessions/[id]/contact-directory
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, notFound } from "@/lib/auth/api";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";

export const GET = withModuleAction("sessions", "view", async ({ params, user }) => {
  const sessionId = params.id as string;

  // Ownership check first: a trainer must not read another trainer's session.
  const session = await db.trainingSession.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: { id: true, trainerId: true },
  });
  if (!session) return notFound("Session not found");
  if (trainerDeniedSession(user, session.trainerId)) {
    return fail("Forbidden — you can only access your own sessions", 403);
  }

  // Only trainees enrolled in this session (soft-deleted / removed excluded).
  const enrollments = await db.sessionEnrollment.findMany({
    where: { sessionId, deletedAt: null },
    select: {
      id: true,
      attendanceStatus: true,
      // The trainee's company at enrollment time (snapshot — preserves the
      // original company even if the trainee's company changed later).
      company: { select: { id: true, name: true, nameAr: true, refNumber: true, phone: true, email: true } },
      trainee: {
        select: {
          id: true,
          refNumber: true,
          fullName: true,
          nationalId: true,
          nationality: true,
          jobTitle: true,
          mobile: true,
          email: true,
        },
      },
    },
    orderBy: { enrollmentDate: "asc" },
  });

  const companyIds = Array.from(new Set(enrollments.map((e) => e.company?.id).filter(Boolean))) as string[];

  // Contacts of the participating companies only — never other companies.
  const contacts = companyIds.length > 0
    ? await db.companyContact.findMany({
        where: { companyId: { in: companyIds }, deletedAt: null, isActive: true },
        select: {
          id: true,
          companyId: true,
          fullName: true,
          fullNameAr: true,
          jobTitle: true,
          email: true,
          phone: true,
          mobile: true,
          preferredContact: true,
          contactType: true,
          isPrimary: true,
        },
        orderBy: [{ isPrimary: "desc" }, { fullName: "asc" }],
      })
    : [];

  // Group trainees + contacts under each participating company.
  const companies = new Map<string, {
    companyId: string;
    companyName: string | null;
    companyNameAr: string | null;
    companyRef: string | null;
    companyPhone: string | null;
    companyEmail: string | null;
    traineeCount: number;
    contacts: typeof contacts;
    trainees: {
      enrollmentId: string;
      traineeId: string | null;
      refNumber: string | null;
      fullName: string | null;
      nationalId: string | null;
      nationality: string | null;
      jobTitle: string | null;
      mobile: string | null;
      email: string | null;
      attendanceStatus: string;
    }[];
  }>();

  for (const enr of enrollments) {
    const company = enr.company;
    if (!company) continue;
    let entry = companies.get(company.id);
    if (!entry) {
      entry = {
        companyId: company.id,
        companyName: company.name,
        companyNameAr: company.nameAr ?? null,
        companyRef: company.refNumber,
        companyPhone: company.phone ?? null,
        companyEmail: company.email ?? null,
        traineeCount: 0,
        contacts: [],
        trainees: [],
      };
      companies.set(company.id, entry);
    }
    entry.traineeCount += 1;
    entry.trainees.push({
      enrollmentId: enr.id,
      traineeId: enr.trainee?.id ?? null,
      refNumber: enr.trainee?.refNumber ?? null,
      fullName: enr.trainee?.fullName ?? null,
      nationalId: enr.trainee?.nationalId ?? null,
      nationality: enr.trainee?.nationality ?? null,
      jobTitle: enr.trainee?.jobTitle ?? null,
      mobile: enr.trainee?.mobile ?? null,
      email: enr.trainee?.email ?? null,
      attendanceStatus: enr.attendanceStatus,
    });
  }

  // Attach the contacts to their company (contacts include companyId).
  for (const c of contacts) {
    const entry = companies.get(c.companyId);
    if (entry) entry.contacts.push(c);
  }

  return ok({ companies: Array.from(companies.values()) });
});
