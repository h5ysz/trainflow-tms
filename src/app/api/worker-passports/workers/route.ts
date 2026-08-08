// /api/worker-passports/workers — worker cards for a company (trainee-based).
//
// The worker passport is the Trainee record aggregated by National ID, so this
// returns the trainee list scoped to one company. Contractors can only ever see
// their own company's workers; everyone else scopes by the requested companyId.
//
// Query params: companyId, search, page, pageSize
// Permissions: any role with `worker-passports.view`.
import { db } from "@/lib/db";
import { withModuleAction } from "@/lib/auth/api";
import { list } from "@/lib/api/response";
import { parseListQuery, buildListMeta } from "@/lib/api/query";

interface WorkerDocument {
  url: string;
  filename: string;
  type: string;
  uploadedAt?: string;
}

function parseDocuments(raw: string | null | undefined): WorkerDocument[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d) => d && typeof d.url === "string" && typeof d.type === "string"
    );
  } catch {
    return [];
  }
}

export const GET = withModuleAction("worker-passports", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const requestedCompanyId = new URL(req.url).searchParams.get("companyId") || undefined;

  const where: Record<string, unknown> = { deletedAt: null };

  // Contractors only ever see their own company's workers.
  if (user.role === "CONTRACTOR") {
    if (!user.companyId) {
      return list([], buildListMeta(0, q));
    }
    where.companyId = user.companyId;
  } else if (requestedCompanyId) {
    where.companyId = requestedCompanyId;
  }

  if (q.search) {
    where.OR = [
      { fullName: { contains: q.search } },
      { nationalId: { contains: q.search } },
      { refNumber: { contains: q.search } },
      { nationality: { contains: q.search } },
    ];
  }

  const [rows, total] = await Promise.all([
    db.trainee.findMany({
      where,
      include: { company: { select: { id: true, name: true, refNumber: true } } },
      orderBy: { fullName: "asc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.trainee.count({ where }),
  ]);

  return list(
    rows.map((t) => ({
      id: t.id,
      refNumber: t.refNumber,
      fullName: t.fullName,
      nationalId: t.nationalId,
      nationality: t.nationality,
      jobTitle: t.jobTitle,
      status: t.status,
      companyId: t.companyId,
      companyName: t.company?.name ?? null,
      documents: parseDocuments(t.documents),
    })),
    buildListMeta(total, q)
  );
});
