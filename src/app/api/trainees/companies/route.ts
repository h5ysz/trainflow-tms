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

export const GET = withModuleAction("trainees", "view", async ({ user }) => {
  const select = {
    id: true,
    name: true,
    refNumber: true,
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
      ? [{ id: company.id, name: company.name, refNumber: company.refNumber, traineeCount: company._count.trainees }]
      : [];
    return list(rows, {
      page: 1,
      pageSize: rows.length || 1,
      total: rows.length,
      totalPages: rows.length ? 1 : 0,
    });
  }

  const companies = await db.company.findMany({
    where: { deletedAt: null },
    select,
    orderBy: { name: "asc" },
  });
  return list(
    companies.map((c) => ({
      id: c.id,
      name: c.name,
      refNumber: c.refNumber,
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
