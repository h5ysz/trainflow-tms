// GCCLAB TMS — Standardized API response format
// =====================================================================
// All API responses follow this envelope:
//   Success: { success: true, data: T, meta?: {...} }
//   List:    { success: true, data: T[], meta: { page, pageSize, total, totalPages, sortBy, sortDir, filters } }
//   Error:   { success: false, error: string, code?: string, details?: unknown }

import { NextResponse } from "next/server";

export interface ApiMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  filters?: Record<string, string | undefined>;
  /** Optional extra fields (e.g. unreadCount for notifications) */
  unreadCount?: number;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: ApiMeta;
}

export interface ApiListResponse<T> {
  success: true;
  data: T[];
  meta: ApiMeta;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: unknown;
}

export function ok<T>(data: T, meta?: ApiMeta): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function list<T>(data: T[], meta: ApiMeta): NextResponse<ApiListResponse<T>> {
  return NextResponse.json({ success: true, data, meta });
}

export function created<T>(data: T): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({ success: true, data }, { status: 201 });
}

export function fail(
  error: string,
  status = 400,
  code?: string,
  details?: unknown
): NextResponse<ApiErrorResponse> {
  return NextResponse.json({ success: false, error, code, details }, { status });
}

export function notFound(message = "Not found") {
  return fail(message, 404, "NOT_FOUND");
}

export function unauthorized(message = "Unauthorized") {
  return fail(message, 401, "UNAUTHORIZED");
}

export function forbidden(message = "Forbidden") {
  return fail(message, 403, "FORBIDDEN");
}

export function validationError(message: string, details?: unknown) {
  return fail(message, 422, "VALIDATION_ERROR", details);
}
