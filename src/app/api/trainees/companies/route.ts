// /api/trainees/companies — companies visible to the caller, with trainee counts.
//
// Powers the company-first flow of the Trainees page (companies → trainees →
// trainee record), mirroring /api/worker-passports/companies:
//   - CONTRACTOR  → exactly their own company (trainees shown immediately)
//   - Others holding `trainees.view` → all active companies
//
// Permissions: any role with `trainees.view`.
import { db } from "@/lib/db";
import { withModuleAction } from "@/lib/auth/api";
import { list } from "@/lib/api/response";
import { coordinatorRegionScope } from "@/lib/api/region-scope";

export const GET = withModuleAction("trainees", "view", async ({ user }) => {
  const select = {
    id: true,
    name: true,
    refNumber: true,
    region: true,
    _count: { select: { trainees: { where: { deletedAt: null } } } },
  } as const;

  if (user.role === "CONTRACTOR") {
    const company = user.companyId
      ? await db.company.findFirst({
          where: { id: user.companyId, deletedAt: null },
          select,
        })
      : null;
    const rows = company
      ? [{ id: company.id, name: company.name, refNumber: company.refNumber, region: company.region, traineeCount: company._count.trainees }]
      : [];
    return list(rows, {
      page: 1,
      pageSize: rows.length || 1,
      total: rows.length,
      totalPages: rows.length ? 1 : 0,
    });
  }

  const scope = coordinatorRegionScope(user);
  const where: Record<string, unknown> = { deletedAt: null };
  if (scope) where.region = { in: scope };

  const companies = await db.company.findMany({
    where,
    select,
    orderBy: { name: "asc" },
  });
  return list(
    companies.map((c) => ({
      id: c.id,
      name: c.name,
      refNumber: c.refNumber,
      region: c.region,
      traineeCount: c._count.trainees,
    })),
    {
      page: 1,
      pageSize: companies.length || 1,
      total: companies.length,
      totalPages: companies.length ? 1 : 0,
    }
  );
});
