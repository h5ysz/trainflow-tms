// /api/worker-passports/companies — companies visible to the caller's role.
//
// Powers the company-first flow of the Worker Passport page:
//   - CONTRACTOR  → exactly their own company (workers are shown immediately)
//   - Others holding `worker-passports.view` → all active companies
//
// Permissions: any role with `worker-passports.view`.
import { db } from "@/lib/db";
import { withModuleAction } from "@/lib/auth/api";
import { list } from "@/lib/api/response";

export const GET = withModuleAction("worker-passports", "view", async ({ user }) => {
  if (user.role === "CONTRACTOR") {
    const company = user.companyId
      ? await db.company.findFirst({
          where: { id: user.companyId, deletedAt: null },
          select: { id: true, name: true, refNumber: true },
        })
      : null;
    const rows = company ? [company] : [];
    return list(rows, {
      page: 1,
      pageSize: rows.length || 1,
      total: rows.length,
      totalPages: rows.length ? 1 : 0,
    });
  }

  const companies = await db.company.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, refNumber: true },
    orderBy: { name: "asc" },
  });
  return list(companies, {
    page: 1,
    pageSize: companies.length || 1,
    total: companies.length,
    totalPages: companies.length ? 1 : 0,
  });
});
