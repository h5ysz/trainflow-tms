// GCCLAB TMS — API helpers (cookies, current user, RBAC, response shapes)
// Updated to use standardized response envelope and audit service.

import { cookies } from "next/headers";
import { verifyToken, type JwtPayload } from "./jwt";
import { canAccessModule, canPerformAction, loadRolePermissions, type RouteKey, type Action, type UserRole } from "@/lib/auth/permissions";
import { recordAudit, type AuditAction, type AuditEntity } from "./audit";
import { ok, created, fail, notFound, type ApiMeta } from "@/lib/api/response";
import { db } from "@/lib/db";

const COOKIE_NAME = "tf_session";
const COOKIE_TTL_DAYS = 7;

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * COOKIE_TTL_DAYS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value;
}

export interface AuthUser extends JwtPayload {
  id: string;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;

  // Sprint 6 — Dynamic RBAC: if the user has a custom roleId, load its
  // permissions from the DB into the runtime override map so canAccessModule /
  // canPerformAction consult them on this request.
  try {
    if (payload.roleId) {
      const role = await db.role.findUnique({
        where: { id: payload.roleId },
        select: { permissions: true, code: true },
      });
      if (role && Array.isArray(role.permissions) && role.permissions.length > 0) {
        // Use the role code as the dynamic-RBAC key — overrides the hardcoded
        // map for this role string during this request.
        loadRolePermissions(role.code ?? payload.role, role.permissions as string[]);
        // ALSO expose the role code on the user object so downstream code
        // sees the custom role identifier.
        return { ...payload, id: payload.sub, role: role.code as UserRole ?? payload.role };
      }
    }
  } catch {
    // DB might be unavailable in some edge cases (e.g. during seed); fall back to hardcoded.
  }

  return { ...payload, id: payload.sub };
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiError(401, "Unauthorized");
  }
  return user;
}

export async function requireRole(...roles: UserRole[]): Promise<AuthUser> {
  const user = await requireAuth();
  if (!roles.includes(user.role)) {
    throw new ApiError(403, "Forbidden — insufficient role");
  }
  return user;
}

export async function requireModuleAction(
  module: RouteKey,
  action: Action = "view"
): Promise<AuthUser> {
  const user = await requireAuth();
  if (!canAccessModule(user.role, module)) {
    throw new ApiError(403, `Forbidden — no access to module: ${module}`);
  }
  if (!canPerformAction(user.role, module, action)) {
    throw new ApiError(403, `Forbidden — cannot ${action} on ${module}`);
  }
  return user;
}

// Standard error class
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Re-export response helpers for convenience
export { ok, created, fail, notFound };
export type { ApiMeta };

// Audit log convenience wrapper (auto-fills user from auth context)
export async function audit(opts: {
  user: AuthUser;
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string;
  entityRef?: string;
  description: string;
  descriptionAr?: string;
  req?: Request;
  metadata?: Record<string, unknown>;
}) {
  return recordAudit({
    userId: opts.user.id,
    action: opts.action,
    entity: opts.entity,
    entityId: opts.entityId,
    entityRef: opts.entityRef,
    description: opts.description,
    descriptionAr: opts.descriptionAr,
    req: opts.req,
    metadata: opts.metadata,
  });
}

// Wrap an API handler with error + RBAC handling
type Handler<T> = (ctx: {
  user: AuthUser;
  req: Request;
  params: Record<string, string | string[] | undefined>;
}) => Promise<T>;

export function withAuth<T>(handler: Handler<T>) {
  return async (
    req: Request,
    ctx: { params?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> } = {}
  ) => {
    try {
      const user = await requireAuth();
      const params = (ctx.params instanceof Promise ? await ctx.params : ctx.params) ?? {};
      const result = await handler({ user, req, params });
      return result as unknown as Response;
    } catch (e) {
      if (e instanceof ApiError) {
        return fail(e.message, e.status);
      }
      console.error("[API Error]", e);
      return fail("Internal server error", 500);
    }
  };
}

export function withModuleAction<T>(module: RouteKey, action: Action, handler: Handler<T>) {
  return async (
    req: Request,
    ctx: { params?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> } = {}
  ) => {
    try {
      const user = await requireModuleAction(module, action);
      const params = (ctx.params instanceof Promise ? await ctx.params : ctx.params) ?? {};
      const result = await handler({ user, req, params });
      return result as unknown as Response;
    } catch (e) {
      if (e instanceof ApiError) {
        return fail(e.message, e.status);
      }
      console.error("[API Error]", e);
      return fail("Internal server error", 500);
    }
  };
}
