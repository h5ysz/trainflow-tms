// GCCLAB TMS — Generic list query parser
// Supports: pagination, search, status filter, sort, arbitrary filters,
// and "includeDeleted" toggle for soft-delete aware endpoints.

export interface ListQuery {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortDir: "asc" | "desc";
  filters: Record<string, string | undefined>;
  includeDeleted: boolean;
}

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sortBy?: string;
  sortDir: "asc" | "desc";
  filters: Record<string, string | undefined>;
}

const ALLOWED_SORT_DIRECTIONS = new Set(["asc", "desc"]);

export function parseListQuery(req: Request): ListQuery {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "10", 10) || 10));
  const search = url.searchParams.get("search") ?? undefined;
  const sortBy = url.searchParams.get("sortBy") ?? undefined;
  const rawSortDir = url.searchParams.get("sortDir") ?? "desc";
  const sortDir: "asc" | "desc" = ALLOWED_SORT_DIRECTIONS.has(rawSortDir) ? (rawSortDir as "asc" | "desc") : "desc";
  const includeDeleted = url.searchParams.get("includeDeleted") === "true";

  // Reserved keys we don't treat as filters
  const reserved = new Set(["page", "pageSize", "search", "sortBy", "sortDir", "includeDeleted"]);
  const filters: Record<string, string | undefined> = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (!reserved.has(k)) filters[k] = v;
  }

  return { page, pageSize, search, sortBy, sortDir, filters, includeDeleted };
}

export function buildListMeta(total: number, q: ListQuery): ListMeta {
  return {
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.ceil(total / q.pageSize),
    sortBy: q.sortBy,
    sortDir: q.sortDir,
    filters: q.filters,
  };
}

// Soft-delete Prisma WHERE clause builder
// Returns a WHERE fragment that excludes soft-deleted records unless includeDeleted=true
export function softDeleteWhere(includeDeleted: boolean): { deletedAt?: null } {
  return includeDeleted ? {} : { deletedAt: null };
}

// Merge search fragments with soft-delete filter
export function whereWithSoftDelete(
  baseWhere: Record<string, unknown>,
  includeDeleted: boolean
): Record<string, unknown> {
  if (includeDeleted) return baseWhere;
  return { ...baseWhere, deletedAt: null };
}

// Build a Prisma orderBy object from sortBy + sortDir
// Falls back to fallbackField if sortBy is missing/invalid
export function buildOrderBy(
  sortBy: string | undefined,
  sortDir: "asc" | "desc",
  allowedFields: string[],
  fallbackField = "createdAt"
): Record<string, "asc" | "desc"> {
  if (sortBy && allowedFields.includes(sortBy)) {
    return { [sortBy]: sortDir };
  }
  return { [fallbackField]: sortDir };
}
