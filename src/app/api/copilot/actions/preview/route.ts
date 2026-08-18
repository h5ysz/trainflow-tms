// /api/copilot/actions/preview — build a non-mutating preview for an AI action
// =====================================================================
// Body: { actionType: string, params: Record<string, unknown> }
// Returns: { preview: PreviewResult, previewToken: string }
//
// The previewToken is HMAC-signed and binds (actionType + hydratedParams +
// userId). The execute endpoint verifies it — params cannot be tampered
// between preview and execute.
import { withModuleAction, ok, fail } from "@/lib/auth/api";
import { canPerformAction } from "@/lib/auth/permissions";
import { getActionHandler, resolveActionPermission } from "@/lib/ai/actions/registry";
import { ActionError } from "@/lib/ai/actions/types";
import { signPreviewToken } from "@/lib/ai/actions/preview-token";

export const POST = withModuleAction("copilot", "view", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { actionType, params } = body as { actionType?: string; params?: Record<string, unknown> };

  if (!actionType || typeof actionType !== "string") {
    return fail("actionType is required", 422, "VALIDATION_ERROR");
  }
  if (!params || typeof params !== "object") {
    return fail("params object is required", 422, "VALIDATION_ERROR");
  }

  // 1. Resolve handler (throws ActionError if unknown)
  let handler;
  try {
    handler = getActionHandler(actionType);
  } catch (e) {
    const err = e as ActionError;
    return fail(err.message, err.statusCode, err.code);
  }

  // 2. Permission check — the user's role MUST have the required module+action
  const required = resolveActionPermission(actionType, user.role);
  if (!required) {
    return fail(
      `Your role (${user.role}) is not permitted to perform action ${actionType}`,
      403,
      "FORBIDDEN"
    );
  }
  if (!canPerformAction(user.permissions, required.module, required.action)) {
    return fail(
      `You do not have ${required.action} permission on ${required.module}`,
      403,
      "FORBIDDEN"
    );
  }

  // 3. Build the preview (non-mutating)
  try {
    const preview = await handler.preparePreview(params, user);
    // Override the actionType with the one the user actually requested —
    // handles alias actions (e.g. CONTRACTOR_UPDATE spreads CONTRACTOR_EDIT)
    // where preparePreview returns the source actionType.
    preview.actionType = actionType;
    // 4. Sign the preview — execute endpoint will verify
    const previewToken = await signPreviewToken({
      actionType,
      hydratedParams: preview.hydratedParams,
      userId: user.id,
    });
    return ok({ preview, previewToken });
  } catch (e) {
    if (e instanceof ActionError) {
      return fail(e.message, e.statusCode, e.code);
    }
    console.error("[copilot/preview] error:", e);
    return fail("Failed to prepare preview", 500, "PREVIEW_ERROR");
  }
});
