// TrainFlow TMS — Frontend API client (typed fetch wrapper)
// All functions return parsed JSON. Throws on non-success responses.

const BASE = "/api";

export interface ListResponse<T> {
  rows: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
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
    const msg = json.error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return json.data as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | boolean | undefined | null>) =>
    request<T>(path, { method: "GET" }, params),
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
