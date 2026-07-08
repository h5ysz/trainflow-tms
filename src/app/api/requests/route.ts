// /api/requests — list + create training requests
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, auditLog } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";

function genRequestNumber(): string {
  const d = new Date();
  const yy = d.getFullYear().toString().slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `TR-${yy}${mm}-${rand}`;
}

export const GET = withModuleAction("requests", "view", async ({ req, user }) => {
  const params = parseListParams(req);
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { requestNumber: { contains: params.search } },
      { notes: { contains: params.search } },
    ];
  }
  if (params.status) where.status = params.status;
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");
  const courseId = url.searchParams.get("courseId");
  if (companyId) where.companyId = companyId;
  if (courseId) where.courseId = courseId;

  // Contractors see only their own requests
  if (user.role === "CONTRACTOR" && user.companyId) {
    where.companyId = user.companyId;
  }
  // Trainers don't see requests at all (filtered by RBAC)

  const [rows, total] = await Promise.all([
    db.trainingRequest.findMany({
      where,
      include: {
        company: { select: { id: true, name: true } },
        course: { select: { id: true, title: true, code: true } },
        session: { select: { id: true, sessionCode: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.trainingRequest.count({ where }),
  ]);

  return ok(
    listResponse(
      rows.map((r) => ({
        id: r.id,
        requestNumber: r.requestNumber,
        companyId: r.companyId,
        companyName: r.company?.name ?? null,
        courseId: r.courseId,
        courseTitle: r.course?.title ?? null,
        courseCode: r.course?.code ?? null,
        traineeCount: r.traineeCount,
        preferredDateFrom: r.preferredDateFrom,
        preferredDateTo: r.preferredDateTo,
        preferredLocation: r.preferredLocation,
        preferredLanguage: r.preferredLanguage,
        notes: r.notes,
        status: r.status,
        priority: r.priority,
        rejectionReason: r.rejectionReason,
        approvedAt: r.approvedAt,
        approvedBy: r.approvedBy,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        sessionId: r.session?.id ?? null,
        sessionCode: r.session?.sessionCode ?? null,
      })),
      total,
      params
    )
  );
});

export const POST = withModuleAction("requests", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    companyId, courseId, traineeCount, preferredDateFrom, preferredDateTo,
    preferredLocation, preferredLanguage, notes, priority,
  } = body;

  // Contractors auto-create their own company's request
  const finalCompanyId = user.role === "CONTRACTOR" && user.companyId ? user.companyId : companyId;

  if (!finalCompanyId || !courseId) return fail("companyId and courseId are required", 400);

  const [company, course] = await Promise.all([
    db.company.findUnique({ where: { id: finalCompanyId } }),
    db.course.findUnique({ where: { id: courseId } }),
  ]);
  if (!company) return fail("Company not found", 404);
  if (!course) return fail("Course not found", 404);

  // Unique request number
  let requestNumber = genRequestNumber();
  while (await db.trainingRequest.findUnique({ where: { requestNumber } })) {
    requestNumber = genRequestNumber();
  }

  const request = await db.trainingRequest.create({
    data: {
      requestNumber,
      companyId: finalCompanyId,
      courseId,
      requestedBy: user.id,
      traineeCount: traineeCount ?? 1,
      preferredDateFrom: preferredDateFrom ? new Date(preferredDateFrom) : null,
      preferredDateTo: preferredDateTo ? new Date(preferredDateTo) : null,
      preferredLocation: preferredLocation ?? null,
      preferredLanguage: preferredLanguage ?? null,
      notes: notes ?? null,
      status: "PENDING",
      priority: priority ?? "NORMAL",
    },
  });

  await auditLog({
    userId: user.id,
    action: "CREATE",
    entity: "REQUEST",
    entityId: request.id,
    description: `Created training request ${requestNumber} for ${company.name} - ${course.title}`,
    req,
  });

  return created(request);
});
