// GCCLAB TMS — API helpers (cookies, current user, RBAC, response shapes)
// Updated to use standardized response envelope and audit service.

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { verifyToken, type JwtPayload } from "./jwt";
import { canAccessModule, canPerformAction, type RouteKey, type Action, type UserRole } from "@/lib/auth/permissions";
import { recordAudit, type AuditAction, type AuditEntity } from "./audit";
import { ok, created, fail, notFound, type ApiMeta } from "@/lib/api/response";

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
  permissions: string[];
}

// Account statuses that must never hold a live session.
const BLOCKED_STATUSES = new Set([
  "SUSPENDED",
  "REJECTED",
  "LOCKED",
  "PENDING_APPROVAL",
]);

// Resolves a user's live operational permission set: the assigned Role's
// permissions (the real, DB-driven RBAC source) when present, else the
// matching system Role's permissions by enum code (self-healing fallback for
// a user whose roleId hasn't been backfilled yet), else fail closed — never
// silently grant full access when a role can't be resolved.
export async function resolveEffectivePermissions(dbUser: {
  role: UserRole;
  roleId: string | null;
  roleRecord?: { permissions: unknown } | null;
}): Promise<string[]> {
  if (dbUser.roleId && dbUser.roleRecord?.permissions) {
    return dbUser.roleRecord.permissions as string[];
  }
  const fallbackRole = await db.role.findUnique({
    where: { code: dbUser.role },
    select: { permissions: true },
  });
  if (fallbackRole?.permissions) return fallbackRole.permissions as string[];
  console.error(`[RBAC] No Role record found for code=${dbUser.role}; denying all module access.`);
  return [];
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;

  // Re-validate against the database so that locking, suspending, deleting, or
  // rotating a user's tokenVersion revokes outstanding sessions immediately —
  // stateless JWT verification alone can't do that. Single indexed SQLite read.
  const dbUser = await db.user.findUnique({
    where: { id: payload.sub },
    select: {
      isActive: true,
      accountStatus: true,
      deletedAt: true,
      tokenVersion: true,
      role: true,
      roleId: true,
      companyId: true,
      trainerId: true,
      roleRecord: { select: { permissions: true } },
    },
  });

  if (!dbUser || dbUser.deletedAt || !dbUser.isActive) return null;
  if (BLOCKED_STATUSES.has(dbUser.accountStatus)) return null;
  if ((payload.tokenVersion ?? 0) !== dbUser.tokenVersion) return null;

  const permissions = await resolveEffectivePermissions(dbUser);

  // Trust the live DB values for authorization-relevant fields.
  return {
    ...payload,
    id: payload.sub,
    role: dbUser.role,
    companyId: dbUser.companyId,
    trainerId: dbUser.trainerId,
    permissions,
  };
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
  if (!canAccessModule(user.permissions, module)) {
    throw new ApiError(403, `Forbidden — no access to module: ${module}`);
  }
  if (!canPerformAction(user.permissions, module, action)) {
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
