// /api/bank-accounts — CRUD for bank accounts
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["bankName", "createdAt", "updatedAt", "isActive"];

export const GET = withModuleAction("bank-accounts", "view", async ({ req }) => {
  const q = parseListQuery(req);
  const where = whereWithSoftDelete({}, q.includeDeleted);
  if (q.filters.isActive) where.isActive = q.filters.isActive === "true";
  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);
  const [rows, total] = await Promise.all([
    db.bankAccount.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.bankAccount.count({ where }),
  ]);
  return list(rows, buildListMeta(total, q));
});

export const POST = withModuleAction("bank-accounts", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { bankName, beneficiary, accountNumber, iban, swift, qrImageUrl, isActive, isDefault } = body;
  if (!bankName || !beneficiary || !accountNumber) {
    return fail("bankName, beneficiary, and accountNumber are required", 422, "VALIDATION_ERROR");
  }

  // If this is the default, unset any existing default
  if (isDefault) {
    await db.bankAccount.updateMany({ where: { isDefault: true, deletedAt: null }, data: { isDefault: false } });
  }

  const account = await db.bankAccount.create({
    data: {
      bankName, beneficiary, accountNumber,
      iban: iban ?? null, swift: swift ?? null, qrImageUrl: qrImageUrl ?? null,
      isActive: isActive ?? true, isDefault: isDefault ?? false,
      createdBy: user.id, updatedBy: user.id,
    },
  });

  await audit({
    user, action: "CREATE", entity: "SETTING", entityId: account.id,
    description: `Created bank account: ${bankName} (${accountNumber})`,
    descriptionAr: `تم إنشاء حساب بنكي: ${bankName} (${accountNumber})`,
    req, metadata: { action: "BANK_ACCOUNT_CREATED" },
  });

  return created(account);
});
