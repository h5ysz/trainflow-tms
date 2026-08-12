// /api/copilot/actions/execute — execute a previously-previewed AI action
// =====================================================================
// Body: { previewToken: string }
//
// Verifies the token (HMAC signature + 10-min TTL + user binding),
// re-resolves the handler, re-checks permissions, then calls execute().
// All audit entries are stamped metadata.aiGenerated = true.
//
// Returns: ExecuteResult
import { withModuleAction, ok, fail } from "@/lib/auth/api";
import { canPerformAction } from "@/lib/auth/permissions";
import { getActionHandler, resolveActionPermission } from "@/lib/ai/actions/registry";
import { ActionError } from "@/lib/ai/actions/types";
import { verifyPreviewToken } from "@/lib/ai/actions/preview-token";

export const POST = withModuleAction("ai-dashboard", "view", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { previewToken } = body as { previewToken?: string };

  if (!previewToken || typeof previewToken !== "string") {
    return fail("previewToken is required", 422, "VALIDATION_ERROR");
  }

  // 1. Verify the signed preview token (signature + TTL + user binding)
  const payload = await verifyPreviewToken(previewToken);
  if (!payload) {
    return fail(
      "Preview token is invalid, expired, or was issued to a different user. Please re-request the preview.",
      401,
      "INVALID_PREVIEW_TOKEN"
    );
  }
  if (payload.userId !== user.id) {
    return fail(
      "Preview token was issued to a different user — cannot execute.",
      403,
      "USER_MISMATCH"
    );
  }

  // 2. Resolve handler
  let handler;
  try {
    handler = getActionHandler(payload.actionType);
  } catch (e) {
    const err = e as ActionError;
    return fail(err.message, err.statusCode, err.code);
  }

  // 3. Re-check permissions (they may have changed since preview)
  const required = resolveActionPermission(payload.actionType, user.role);
  if (!required || !canPerformAction(user.permissions, required.module, required.action)) {
    return fail(
      `You no longer have permission to perform action ${payload.actionType}`,
      403,
      "FORBIDDEN"
    );
  }

  // 4. Reconstruct the preview object (handler.execute expects a Preview)
  const preview = {
    actionType: payload.actionType,
    hydratedParams: payload.hydratedParams,
    // Other fields are not used by execute() — only hydratedParams.
    title: "", titleAr: "", summary: "", summaryAr: "",
    affectedRecords: [], changes: [], warnings: [],
    expectedResult: "", expectedResultAr: "",
  };

  // 5. Execute
  try {
    const result = await handler.execute(preview, user, req);
    return ok(result);
  } catch (e) {
    if (e instanceof ActionError) {
      return fail(e.message, e.statusCode, e.code);
    }
    console.error("[copilot/execute] error:", e);
    return fail(
      `Execution failed: ${(e as Error).message}`,
      500,
      "EXECUTION_ERROR"
    );
  }
});
