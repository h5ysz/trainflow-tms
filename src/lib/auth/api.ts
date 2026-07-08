// TrainFlow TMS — API helpers (cookies, current user, RBAC, response shapes)
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyToken, type JwtPayload } from "./jwt";
import { db } from "@/lib/db";
import { canAccessModule, canPerformAction, type RouteKey, type Action, type UserRole } from "@/lib/auth/permissions";

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

// Standard JSON helpers
export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, init);
}

export function created<T>(data: T) {
  return NextResponse.json({ success: true, data }, { status: 201 });
}

export function fail(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ success: false, error: message, details }, { status });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ success: false, error: message }, { status: 404 });
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

// Audit log helper
export async function auditLog(opts: {
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  description: string;
  req?: Request;
  metadata?: unknown;
}) {
  try {
    await db.auditLog.create({
      data: {
        userId: opts.userId ?? null,
        action: opts.action,
        entity: opts.entity,
        entityId: opts.entityId ?? null,
        description: opts.description,
        ipAddress: opts.req?.headers.get("x-forwarded-for") ?? null,
        userAgent: opts.req?.headers.get("user-agent") ?? null,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
      },
    });
  } catch (e) {
    console.error("[Audit log error]", e);
  }
}
