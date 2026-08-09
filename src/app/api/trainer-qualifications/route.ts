// /api/trainer-qualifications — list + create
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["title", "createdAt", "updatedAt", "status", "issueDate", "expiryDate"];

export const GET = withModuleAction("trainer-qualifications", "view", async ({ req }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { title: { contains: q.search } },
      { issuer: { contains: q.search } },
      { credentialNumber: { contains: q.search } },
    ];
  }
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.trainerId) where.trainerId = q.filters.trainerId;

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.trainerQualification.findMany({
      where,
      include: { trainer: { select: { id: true, nameEn: true, nameAr: true, refNumber: true } } },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.trainerQualification.count({ where }),
  ]);

  return list(rows, buildListMeta(total, q));
});

export const POST = withModuleAction("trainer-qualifications", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { trainerId, title, issuer, credentialNumber, issueDate, expiryDate, documentUrl, status } = body;
  if (!trainerId || !title) return fail("trainerId and title are required", 422, "VALIDATION_ERROR");

  const trainer = await db.trainer.findFirst({ where: { id: trainerId, deletedAt: null } });
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
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "TRAINER",
    entityId: trainerId,
    entityRef: trainer.refNumber,
    description: `Added qualification "${title}" to ${trainer.nameEn}`,
    descriptionAr: `تمت إضافة مؤهل "${title}" إلى ${trainer.nameEn}`,
    req,
  });

  return created(qual);
});
