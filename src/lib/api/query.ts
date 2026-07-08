// TrainFlow TMS — URL query parsing helpers for list APIs
export interface PaginationParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export function parseListParams(req: Request): PaginationParams {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "10", 10) || 10));
  const search = url.searchParams.get("search") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const sortBy = url.searchParams.get("sortBy") ?? undefined;
  const sortDir = (url.searchParams.get("sortDir") as "asc" | "desc") ?? undefined;
  return { page, pageSize, search, status, sortBy, sortDir };
}

export function paginationMeta(total: number, params: PaginationParams) {
  return {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.ceil(total / params.pageSize),
  };
}

export function listResponse<T>(rows: T[], total: number, params: PaginationParams) {
  return {
    rows,
    pagination: paginationMeta(total, params),
  };
}
