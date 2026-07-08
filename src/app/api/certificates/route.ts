// /api/certificates — list + issue
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, auditLog } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";

function genCertNumber(): string {
  const d = new Date();
  const yy = d.getFullYear().toString();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `TF-${yy}-${rand}`;
}

export const GET = withModuleAction("certificates", "view", async ({ req, user }) => {
  const params = parseListParams(req);
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { certificateNumber: { contains: params.search } },
      { traineeName: { contains: params.search } },
      { traineeEmail: { contains: params.search } },
      { traineeIdNational: { contains: params.search } },
    ];
  }
  if (params.status) where.status = params.status;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const companyId = url.searchParams.get("companyId");
  if (sessionId) where.sessionId = sessionId;
  if (companyId) where.companyId = companyId;

  // Contractors see only their company's certificates
  if (user.role === "CONTRACTOR" && user.companyId) {
    where.companyId = user.companyId;
  }

  const [rows, total] = await Promise.all([
    db.certificate.findMany({
      where,
      include: {
        session: {
          select: {
            id: true,
            sessionCode: true,
            title: true,
            startDate: true,
            endDate: true,
          },
        },
        course: { select: { id: true, title: true, code: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { issuedAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.certificate.count({ where }),
  ]);

  return ok(
    listResponse(
      rows.map((c) => ({
        id: c.id,
        certificateNumber: c.certificateNumber,
        sessionId: c.sessionId,
        sessionCode: c.session?.sessionCode ?? null,
        sessionTitle: c.session?.title ?? null,
        courseId: c.courseId,
        courseTitle: c.course?.title ?? null,
        courseCode: c.course?.code ?? null,
        companyId: c.companyId,
        companyName: c.company?.name ?? null,
        traineeName: c.traineeName,
        traineeIdNational: c.traineeIdNational,
        traineeEmail: c.traineeEmail,
        finalScore: c.finalScore,
        issuedAt: c.issuedAt,
        validUntil: c.validUntil,
        status: c.status,
        pdfUrl: c.pdfUrl,
        qrCodeUrl: c.qrCodeUrl,
      })),
      total,
      params
    )
  );
});

export const POST = withModuleAction("certificates", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    sessionId, traineeName, traineeIdNational, traineeEmail, finalScore,
  } = body;

  if (!sessionId || !traineeName || finalScore === undefined) {
    return fail("sessionId, traineeName, finalScore are required", 400);
  }

  const session = await db.trainingSession.findUnique({
    where: { id: sessionId },
    include: { course: true, request: { include: { company: true } } },
  });
  if (!session) return fail("Session not found", 404);
  if (!session.course) return fail("Course not found", 404);

  // Check pass score
  if (finalScore < session.course.passScore) {
    return fail(`Score ${finalScore}% is below passing score ${session.course.passScore}%`, 400);
  }

  // Prevent duplicate certificate
  const existing = await db.certificate.findFirst({
    where: { sessionId, traineeName: { equals: traineeName } },
  });
  if (existing) {
    return fail("Certificate already issued for this trainee in this session", 400);
  }

  // Unique certificate number
  let certificateNumber = genCertNumber();
  while (await db.certificate.findUnique({ where: { certificateNumber } })) {
    certificateNumber = genCertNumber();
  }

  const validUntil = new Date();
  validUntil.setMonth(validUntil.getMonth() + session.course.validityMonths);

  const cert = await db.certificate.create({
    data: {
      certificateNumber,
      sessionId,
      courseId: session.courseId,
      companyId: session.request?.companyId ?? null,
      traineeName,
      traineeIdNational: traineeIdNational ?? null,
      traineeEmail: traineeEmail ?? null,
      finalScore,
      validUntil,
      status: "VALID",
    },
  });

  await auditLog({
    userId: user.id,
    action: "ISSUE",
    entity: "CERTIFICATE",
    entityId: cert.id,
    description: `Issued certificate ${certificateNumber} to ${traineeName} (${finalScore}%)`,
    req,
  });

  return created(cert);
});
