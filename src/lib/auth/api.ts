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
  /** Primary operational region (coordinator scoping) — CENTRAL/EASTERN/WESTERN/SOUTHERN or null. */
  region?: string | null;
  /** JSON array of extra regions a coordinator covers (admin-assigned coverage). */
  regionsCovered?: string | null;
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
      region: true,
      regionsCovered: true,
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
    region: dbUser.region,
    regionsCovered: dbUser.regionsCovered,
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
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ─── Error translation ───────────────────────────────────────────────────────
// Uncaught Prisma errors used to escape as framework 500s with a non-JSON body, so
// the client's `res.json()` failed and the user saw the useless string
// "Invalid JSON response" instead of what actually went wrong.
//
// P2002 is the common one: several routes check uniqueness with `deletedAt: null`
// while the DB constraint is global, so re-creating a soft-deleted email, course code
// or national ID passes the app check and then violates the index.

type PrismaKnownError = { code?: unknown; meta?: { target?: unknown } };

function prismaErrorToApiError(e: unknown): ApiError | null {
  const err = e as PrismaKnownError;
  if (typeof err?.code !== "string") return null;

  const rawTarget = err.meta?.target;
  const fields = Array.isArray(rawTarget)
    ? rawTarget.filter((f): f is string => typeof f === "string")
    : typeof rawTarget === "string"
      ? [rawTarget]
      : [];
  const fieldList = fields.length > 0 ? fields.join(", ") : "value";

  switch (err.code) {
    case "P2002":
      return new ApiError(
        409,
        `A record with this ${fieldList} already exists. Note that soft-deleted records still hold their unique values.`,
        "DUPLICATE"
      );
    case "P2003":
      return new ApiError(409, `Related record not found or still referenced (${fieldList})`, "FOREIGN_KEY");
    case "P2025":
      return new ApiError(404, "Record not found", "NOT_FOUND");
    default:
      return null;
  }
}

// Converts any thrown error into the standard envelope. Used by every wrapper below
// so no handler can leak a raw framework 500.
//
// In development (NODE_ENV !== "production"), the actual error message + stack
// trace are included in the response body so the developer can see the root cause
// in the browser network tab / toast instead of a generic "Internal server error".
// In production, only the generic message is returned (don't leak internals).
export function errorToResponse(e: unknown): Response {
  if (e instanceof ApiError) {
    return fail(e.message, e.status, e.code);
  }
  const prismaError = prismaErrorToApiError(e);
  if (prismaError) {
    return fail(prismaError.message, prismaError.status, prismaError.code);
  }
  // Log the full error to the server console for debugging
  console.error("[API Error]", e);

  // In development, include the actual error message + stack in the response
  // so the developer can see exactly what went wrong without checking server logs.
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    const err = e as Error;
    const message = err?.message || String(e);
    const stack = err?.stack?.split("\n").slice(0, 10).join("\n") || "";
    return fail(
      `Internal server error: ${message}`,
      500,
      "INTERNAL_ERROR",
      { stack: isDev ? stack : undefined, name: err?.name ?? "Error" },
    );
  }
  return fail("Internal server error", 500);
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
  oldValue?: Record<string, unknown> | string | null;
  newValue?: Record<string, unknown> | string | null;
  reason?: string | null;
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
    oldValue: opts.oldValue,
    newValue: opts.newValue,
    reason: opts.reason,
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
      return errorToResponse(e);
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
      return errorToResponse(e);
    }
  };
}

// Wraps a raw Next route handler so anything it throws still comes back as the
// standard `{ success: false, error }` envelope. The hand-rolled admin routes have no
// try/catch of their own, so a Prisma error there produced a framework 500 with an
// HTML body and the client reported "Invalid JSON response".
export function withErrorEnvelope<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (e) {
      return errorToResponse(e);
    }
  };
}

// Wraps a role-gated handler. Same shape as withModuleAction, for the admin routes
// (users, roles, settings, login-history) that authorize on the fixed role enum.
export function withRole<T>(roles: UserRole[], handler: Handler<T>) {
  return async (
    req: Request,
    ctx: { params?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> } = {}
  ) => {
    try {
      const user = await requireRole(...roles);
      const params = (ctx.params instanceof Promise ? await ctx.params : ctx.params) ?? {};
      const result = await handler({ user, req, params });
      return result as unknown as Response;
    } catch (e) {
      return errorToResponse(e);
    }
  };
}

// ─── Assessment routes ───────────────────────────────────────────────────────
// Questions, test results and exam attempts all serve two modules: `pre-test` and
// `final-test`. They used to be hardcoded to `pre-test`, so a role granted only
// `final-test.*` could see the Final Test page (which authorizes client-side against
// `final-test`) but got 403 on every request it made.
//
// The guard below admits a caller holding the action on *either* module and tells the
// handler which test types they may touch, so the route can scope its query and reject
// a record of the wrong type.

export type TestType = "PRE_TEST" | "FINAL_TEST";

export const TEST_TYPE_MODULE: Record<TestType, RouteKey> = {
  PRE_TEST: "pre-test",
  FINAL_TEST: "final-test",
};

export function allowedTestTypesFor(user: AuthUser, action: Action): TestType[] {
  // Read-only results access via the dedicated `exam-attempts` module (e.g. the
  // coordinator): the caller may LIST attempt scores of BOTH test types but has
  // no `create`/`edit` on pre-test/final-test, so start/submit/reopen/edit all
  // still 403. This checks the DIRECT grant only (not the pre-test/final-test
  // aliases), so a viewer holding just `pre-test.view` keeps seeing pre-test
  // attempts only.
  if (action === "view" && hasDirectExamResultsAccess(user)) {
    return Object.keys(TEST_TYPE_MODULE) as TestType[];
  }
  return (Object.keys(TEST_TYPE_MODULE) as TestType[]).filter((testType) => {
    // Not named `module`: that identifier is reserved in this module scope by the
    // bundler's CommonJS interop.
    const routeKey = TEST_TYPE_MODULE[testType];
    return (
      canAccessModule(user.permissions, routeKey) &&
      canPerformAction(user.permissions, routeKey, action)
    );
  });
}

function hasDirectExamResultsAccess(user: AuthUser): boolean {
  const p = user.permissions;
  return p.includes("*") || p.includes("exam-attempts.*") || p.includes("exam-attempts.view");
}

// True for a caller whose exam access comes ONLY from the results-only
// `exam-attempts` grant (coordinator) — they may see attempt SCORES but never
// the question content, so the exam-attempts handlers strip questionSet/answers.
export function isExamResultsOnly(user: AuthUser): boolean {
  if (!hasDirectExamResultsAccess(user)) return false;
  return !(
    canAccessModule(user.permissions, "pre-test") ||
    canAccessModule(user.permissions, "final-test")
  );
}

// Builds the `testType` clause for an assessment list query. Returns null when the
// caller explicitly asked for a test type they may not see, so the route can 403
// rather than silently returning the other type's rows.
export function testTypeWhere(
  requested: string | undefined,
  allowed: TestType[]
): TestType | { in: TestType[] } | null {
  if (!requested) return { in: allowed };
  if (!allowed.includes(requested as TestType)) return null;
  return requested as TestType;
}

type ExamHandler<T> = (ctx: {
  user: AuthUser;
  req: Request;
  params: Record<string, string | string[] | undefined>;
  allowedTestTypes: TestType[];
}) => Promise<T>;

export function withExamAction<T>(action: Action, handler: ExamHandler<T>) {
  return async (
    req: Request,
    ctx: { params?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> } = {}
  ) => {
    try {
      const user = await requireAuth();
      const allowedTestTypes = allowedTestTypesFor(user, action);
      if (allowedTestTypes.length === 0) {
        throw new ApiError(403, `Forbidden — cannot ${action} on pre-test or final-test`);
      }
      const params = (ctx.params instanceof Promise ? await ctx.params : ctx.params) ?? {};
      const result = await handler({ user, req, params, allowedTestTypes });
      return result as unknown as Response;
    } catch (e) {
      return errorToResponse(e);
    }
  };
}

/**
 * Returns a Prisma where-clause filter that scopes results to the user's company.
 * For CONTRACTOR users with null companyId, returns a never-match filter
 * to prevent cross-tenant data leaks.
 */
export function companyScope(user: { role: string; companyId?: string | null }) {
  if (user.role === "CONTRACTOR") {
    if (!user.companyId) {
      return { companyId: "__NONE__" }; // never matches any real UUID
    }
    return { companyId: user.companyId };
  }
  return undefined; // no filter — admin roles see everything
}
