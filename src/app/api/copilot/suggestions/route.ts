// /api/copilot/suggestions — proactive smart suggestions for the dashboard
// =====================================================================
// GET — returns all smart-suggestion action types the user can run.
// POST { suggestionType, params } — runs a specific SUGGEST_* action
// (read-only, no audit-log signing needed; just returns the analysis).
//
// This endpoint does NOT require a preview/confirm flow because SUGGEST_*
// actions are read-only — they produce analysis, not mutations.
import { withAuth, ok, fail } from "@/lib/auth/api";
import { canPerformAction } from "@/lib/auth/permissions";
import { getActionHandler, resolveActionPermission } from "@/lib/ai/actions/registry";
import { ActionError } from "@/lib/ai/actions/types";

// GET — list all SUGGEST_* actions available to the user
export const GET = withAuth(async ({ user }) => {
  const catalog = [
    "SUGGEST_BEST_TRAINER",
    "SUGGEST_BEST_TIME",
    "SUGGEST_BEST_ROOM",
    "SUGGEST_CAPACITY_WARNINGS",
    "SUGGEST_FINANCIAL_WARNINGS",
    "SUGGEST_CERTIFICATE_EXPIRY",
    "SUGGEST_SCHEDULE_CONFLICTS",
  ];
  const available = catalog
    .map((type) => {
      const required = resolveActionPermission(type, user.role);
      if (!required) return null;
      if (!canPerformAction(user.permissions, required.module, required.action)) return null;
      try {
        const handler = getActionHandler(type);
        return { type, description: handler.description, descriptionAr: handler.descriptionAr };
      } catch {
        return null;
      }
    })
    .filter((x): x is { type: string; description: string; descriptionAr: string } => x !== null);
  return ok({ suggestions: available });
});

// POST — run a specific SUGGEST_* action and return its result
export const POST = withAuth(async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { suggestionType, params } = body as { suggestionType?: string; params?: Record<string, unknown> };

  if (!suggestionType || typeof suggestionType !== "string") {
    return fail("suggestionType is required", 422, "VALIDATION_ERROR");
  }
  if (!suggestionType.startsWith("SUGGEST_")) {
    return fail("Only SUGGEST_* actions are allowed via this endpoint", 400, "INVALID_TYPE");
  }

  let handler;
  try {
    handler = getActionHandler(suggestionType);
  } catch (e) {
    const err = e as ActionError;
    return fail(err.message, err.statusCode, err.code);
  }

  const required = resolveActionPermission(suggestionType, user.role);
  if (!required || !canPerformAction(user.permissions, required.module, required.action)) {
    return fail(`You do not have permission to run ${suggestionType}`, 403, "FORBIDDEN");
  }

  try {
    const preview = await handler.preparePreview(params ?? {}, user);
    // For SUGGEST_* actions, execute() is read-only and just records audit +
    // returns the analysis. We can call it directly.
    const result = await handler.execute(preview, user, req);
    return ok({ preview, result });
  } catch (e) {
    if (e instanceof ActionError) {
      return fail(e.message, e.statusCode, e.code);
    }
    console.error("[copilot/suggestions] error:", e);
    return fail("Failed to generate suggestion", 500, "SUGGESTION_ERROR");
  }
});
