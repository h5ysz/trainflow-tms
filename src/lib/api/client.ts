// GCCLAB TMS — Frontend API client (typed fetch wrapper)
// All functions return parsed JSON. Throws on non-success responses.
//
// Standardized response envelope:
//   Success: { success: true, data: T, meta?: {...} }
//   List:    { success: true, data: T[], meta: { page, pageSize, total, totalPages, sortBy, sortDir, filters } }
//   Error:   { success: false, error: string, code?: string, details?: unknown }
//
// For list endpoints, this client unwraps `data` + `meta` into the legacy
// { rows, pagination } shape so existing useList hook keeps working.

const BASE = "/api";

// ─── Session expiry ──────────────────────────────────────────────────────────
// A 401 means the session is gone: the cookie expired, the account was locked or
// suspended, or its tokenVersion was rotated. Nothing used to handle that, so the
// persisted store kept `isAuthenticated: true` and the app stayed mounted while
// every request failed. The store registers a handler here at startup.
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

// `/auth/me` is the session probe itself — it legitimately 401s for a logged-out
// visitor on the login page, and firing the handler there would be circular.
function notifyUnauthorized(path: string) {
  if (path.startsWith("/auth/")) return;
  onUnauthorized?.();
}

// Reads the filename from a Content-Disposition header, preferring the RFC 5987
// `filename*=UTF-8''…` form so non-ASCII names (Arabic report titles) survive.
export function filenameFromDisposition(disposition: string): string | null {
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim() ?? null;
}

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  filters?: Record<string, string | undefined>;
  [key: string]: unknown; // for extra fields like unreadCount
}

export interface ListResponse<T> {
  rows: T[];
  pagination: ListMeta | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: ListMeta;
  error?: string;
}

/**
 * Carries the machine-readable `code` the API returns alongside `error`, so
 * callers can branch on it instead of pattern-matching the message text.
 * Still an Error, so `(e as Error).message` keeps working everywhere.
 */
export class ApiError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  params?: Record<string, string | number | boolean | undefined | null>
): Promise<T> {
  let url = `${BASE}${path}`;
  if (params) {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        search.set(k, String(v));
      }
    }
    const qs = search.toString();
    if (qs) url += `?${qs}`;
  }

  const isFormData = options.body instanceof FormData;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    credentials: "same-origin",
  });

  const json = await res.json().catch(() => ({ success: false, error: "Invalid JSON response" }));

  if (!res.ok || !json.success) {
    if (res.status === 401) notifyUnauthorized(path);
    throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status, json.code);
  }

  return json.data as T;
}

// List-specific request — unwraps `data` + `meta` into { rows, pagination }
async function requestList<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined | null>
): Promise<ListResponse<T>> {
  let url = `${BASE}${path}`;
  if (params) {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        search.set(k, String(v));
      }
    }
    const qs = search.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, { credentials: "same-origin" });
  const json = await res.json().catch(() => ({ success: false, error: "Invalid JSON response" }));

  if (!res.ok || !json.success) {
    if (res.status === 401) notifyUnauthorized(path);
    throw new ApiError(json.error ?? `Request failed (${res.status})`, res.status, json.code);
  }

  // Standardized list shape: { success, data: [], meta: {...} }
  return {
    rows: Array.isArray(json.data) ? json.data : [],
    pagination: json.meta ?? null,
  };
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | undefined | null>) =>
    request<T>(path, { method: "GET" }, params),
  getList: <T>(path: string, params?: Record<string, string | number | boolean | undefined | null>) =>
    requestList<T>(path, params),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) =>
    request<T>(path, { method: "DELETE" }),
  postFile: <T>(path: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<T>(path, { method: "POST", body });
  },
};

/**
 * Download an endpoint that returns a raw file rather than the JSON envelope.
 * `api.post` would call res.json() on the PDF bytes and throw, so this reads
 * the body as a blob and triggers a browser download instead.
 */
export async function downloadFile(
  path: string,
  fallbackName: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<void> {
  const method = options.method ?? "POST";
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "same-origin",
    ...(options.body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) }
      : {}),
  });

  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized(path);
    // Errors still come back as the JSON envelope.
    const json = await res.json().catch(() => null);
    throw new Error(json?.error ?? `Request failed (${res.status})`);
  }

  const disposition = res.headers.get("Content-Disposition") ?? "";
  const parsedName = filenameFromDisposition(disposition);
  const blob = await res.blob();

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = parsedName ?? fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ user: AuthUser }>("/auth/login", { email, password }),
  logout: () => api.post<{ success: boolean }>("/auth/logout"),
  me: () => api.get<AuthUser>("/auth/me"),
};

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: "SUPER_ADMIN" | "COORDINATOR" | "TRAINER" | "CONTRACTOR" | "VIEWER";
  permissions: string[];
  language: string;
  companyId?: string | null;
  companyName?: string | null;
  trainerId?: string | null;
  /**
   * Data-driven nav visibility for trainers. `workshops` is true only when the
   * trainer has an assigned workshop; `evaluation` only when they have sessions
   * to evaluate. Null/undefined for non-trainers or before /me loads.
   */
  trainerNav?: { workshops: boolean; evaluation: boolean } | null;
  avatarUrl?: string | null;
  isActive?: boolean;
  lastLoginAt?: string | null;
}
