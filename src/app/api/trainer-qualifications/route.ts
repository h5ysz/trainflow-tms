// /api/trainer-qualifications — list + create
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, auditLog } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";

export const GET = withModuleAction("trainer-qualifications", "view", async ({ req }) => {
  const params = parseListParams(req);
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { title: { contains: params.search } },
      { issuer: { contains: params.search } },
      { credentialNumber: { contains: params.search } },
    ];
  }
  if (params.status) where.status = params.status;
  const url = new URL(req.url);
  const trainerId = url.searchParams.get("trainerId");
  if (trainerId) where.trainerId = trainerId;

  const [rows, total] = await Promise.all([
    db.trainerQualification.findMany({
      where,
      include: { trainer: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.trainerQualification.count({ where }),
  ]);

  return ok(listResponse(rows, total, params));
});

export const POST = withModuleAction("trainer-qualifications", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { trainerId, title, issuer, credentialNumber, issueDate, expiryDate, documentUrl, status } = body;
  if (!trainerId || !title) return fail("trainerId and title are required", 400);

  const trainer = await db.trainer.findUnique({ where: { id: trainerId } });
  if (!trainer) return fail("Trainer not found", 404);

  const computedStatus = status ?? (expiryDate && new Date(expiryDate) < new Date() ? "EXPIRED" : "VALID");

  const qual = await db.trainerQualification.create({
    data: {
      trainerId,
      title,
      issuer: issuer ?? null,
      credentialNumber: credentialNumber ?? null,
      issueDate: issueDate ? new Date(issueDate) : null,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      documentUrl: documentUrl ?? null,
      status: computedStatus,
    },
  });

  await auditLog({
    userId: user.id,
    action: "CREATE",
    entity: "TRAINER",
    entityId: trainerId,
    description: `Added qualification "${title}" to ${trainer.fullName}`,
    req,
  });

  return created(qual);
});
