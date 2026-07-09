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
  // Auto-include Accept-Language so server-side bilingual error messages work
  const acceptLang =
    typeof document !== "undefined" && document.documentElement.lang
      ? document.documentElement.lang
      : "en";
  const res = await fetch(url, {
    ...options,
    headers: {
      "Accept-Language": acceptLang,
      ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    credentials: "same-origin",
  });

  const json = await res.json().catch(() => ({ success: false, error: "Invalid JSON response" }));

  if (!res.ok || !json.success) {
    const msg = json.error ?? `Request failed (${res.status})`;
    throw new Error(msg);
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
    const msg = json.error ?? `Request failed (${res.status})`;
    throw new Error(msg);
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
};

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ user: AuthUser; token: string }>("/auth/login", { email, password }),
  loginByRole: (role: string) =>
    api.post<{ user: AuthUser; token: string }>("/auth/login", { role }),
  logout: () => api.post<{ success: boolean }>("/auth/logout"),
  me: () => api.get<AuthUser>("/auth/me"),
};

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: "SUPER_ADMIN" | "COORDINATOR" | "TRAINER" | "CONTRACTOR";
  language: string;
  companyId?: string | null;
  companyName?: string | null;
  trainerId?: string | null;
  avatarUrl?: string | null;
  isActive?: boolean;
  lastLoginAt?: string | null;
}
