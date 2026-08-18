// /api/copilot/chat — AI Copilot chat endpoint (Phase 2: action-aware)
// =====================================================================
// Phase 1 behavior (free-form Q&A) is preserved. Phase 2 adds:
//
//   - The system prompt now lists ALL available AI actions so the LLM can
//     pick the right one when the user asks for an operation.
//   - When the LLM detects an action intent, it returns a JSON envelope
//     { kind: "ACTION_PLAN", actionType, params, rationale } instead of a
//     plain-text reply. The frontend then calls /actions/preview.
//   - The LLM is told NEVER to fabricate action types — only the ones in
//     the catalog are valid.
//
// All other behavior (context building, RBAC, history) is unchanged.
import { withModuleAction, ok, fail } from "@/lib/auth/api";
import type { UserRole } from "@/lib/auth/permissions";
import { buildCopilotContext } from "@/lib/ai/copilot-context";
import { getActionCatalog } from "@/lib/ai/actions/registry";
import { resolveActionPermission } from "@/lib/ai/actions/registry";
import { getAIProvider } from "@/lib/ai/provider";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// Response shape — the frontend distinguishes TEXT vs ACTION_PLAN
export interface ChatResponse {
  kind: "TEXT" | "ACTION_PLAN";
  reply: string;
  timestamp: string;
  // Present when kind === "ACTION_PLAN"
  action?: {
    actionType: string;
    params: Record<string, unknown>;
    rationale: string;
  };
}

// Build the action-aware system prompt addition
function buildActionPromptSection(userRole: UserRole): string {
  const catalog = getActionCatalog();
  // Filter to actions the user's role can actually perform
  const allowed = catalog.filter((a) => resolveActionPermission(a.type, userRole) !== null);
  const lines: string[] = [
    "",
    "## AI ACTIONS (Phase 2)",
    "",
    "You are also an Operational AI Assistant. You can PERFORM actions in the system — not just answer questions.",
    "",
    "### How to propose an action",
    "When the user asks you to DO something (create, edit, move, assign, generate, send, approve, etc.), do NOT just give instructions. Instead, return a JSON envelope so the UI can show a preview card and ask for confirmation.",
    "",
    "Respond with EXACTLY this JSON shape and nothing else:",
    "```json",
    "{",
    '  "kind": "ACTION_PLAN",',
    '  "actionType": "<one of the types below>",',
    '  "params": { ... },',
    '  "rationale": "<one sentence why>"',
    "}",
    "```",
    "",
    "### Rules",
    "- ONLY use action types listed below. Never invent new ones.",
    "- If the user's request is ambiguous (missing required IDs, dates, names), ask clarifying questions as plain TEXT — do NOT propose an action with guessed params.",
    "- If the user is just asking a question (not requesting an action), respond as plain TEXT.",
    "- For multi-step workflows, prefer WORKFLOW_CREATE_SESSION_FULL over chaining individual actions.",
    "- For bulk operations (10+ items), prefer BULK_* actions.",
    "- For suggestions/recommendations, use SUGGEST_* actions — they return analysis without mutating data.",
    "- Always explain in your rationale what will happen so the user can decide whether to confirm.",
    "",
    "### Available actions for your role (" + userRole + ")",
    "",
  ];
  for (const a of allowed) {
    lines.push(`- **${a.type}** — ${a.description}`);
  }
  return lines.join("\n");
}

export const POST = withModuleAction("copilot", "view", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { message, history, locale } = body as { message?: string; history?: ChatMessage[]; locale?: string };

  if (!message || typeof message !== "string") {
    return fail("message is required", 422, "VALIDATION_ERROR");
  }

  // Normalize the locale — default to "en" if missing or unrecognized.
  // The frontend sends the active UI locale so the LLM can respond in the
  // same language the user is reading.
  const normalizedLocale = locale === "ar" ? "ar" : "en";

  // Build context from live system data (Phase 1, unchanged — now locale-aware)
  const { systemPrompt, contextData } = await buildCopilotContext(user, normalizedLocale);

  // Extend the system prompt with Phase 2 action instructions
  const actionSection = buildActionPromptSection(user.role);
  const fullSystemPrompt = `${systemPrompt}\n${actionSection}\n\n${contextData}`;

  // Build conversation messages
  const messages: ChatMessage[] = [
    { role: "system", content: fullSystemPrompt },
    ...(history ?? []).slice(-10),
    { role: "user", content: message },
  ];

  try {
    const provider = getAIProvider();
    const response = await provider.chat({
      messages,
      temperature: 0.5, // slightly lower for more deterministic action selection
      maxTokens: 2000,
    });

    const raw = response.content || "I apologize, I couldn't generate a response. Please try again.";

    // Try to parse an ACTION_PLAN envelope. The LLM is instructed to return
    // JSON only when proposing an action — but it may wrap it in markdown
    // fences or add prose around it. We extract the first ```json block
    // (or the first {...} shape) and try to parse.
    const actionPlan = tryExtractActionPlan(raw);
    if (actionPlan) {
      // Validate the actionType against the registry
      let required: { module: import("@/lib/auth/permissions").RouteKey; action: import("@/lib/auth/permissions").Action } | null = null;
      let unknownType = false;
      try {
        required = resolveActionPermission(actionPlan.actionType, user.role);
      } catch {
        // LLM hallucinated an action type that doesn't exist in the registry
        unknownType = true;
      }
      if (unknownType) {
        return ok({
          kind: "TEXT" as const,
          reply: `I considered proposing action "${actionPlan.actionType}" but that action doesn't exist in the system. Please rephrase your request or ask me what actions are available.\n\nOriginal AI response: ${raw}`,
          timestamp: new Date().toISOString(),
        } satisfies ChatResponse);
      }
      if (!required) {
        // LLM hallucinated an action type — fall back to text reply explaining
        return ok({
          kind: "TEXT" as const,
          reply: `I considered proposing action "${actionPlan.actionType}" but you don't have permission for it. Please ask your administrator.\n\nOriginal AI response: ${raw}`,
          timestamp: new Date().toISOString(),
        } satisfies ChatResponse);
      }
      return ok({
        kind: "ACTION_PLAN" as const,
        reply: actionPlan.rationale,
        timestamp: new Date().toISOString(),
        action: {
          actionType: actionPlan.actionType,
          params: actionPlan.params ?? {},
          rationale: actionPlan.rationale,
        },
      } satisfies ChatResponse);
    }

    // Plain-text reply (Phase 1 behavior preserved)
    return ok({
      kind: "TEXT" as const,
      reply: raw,
      timestamp: new Date().toISOString(),
    } satisfies ChatResponse);
  } catch (err) {
    console.error("[copilot] LLM error:", err);
    return fail("AI service temporarily unavailable. Please try again.", 503, "AI_ERROR");
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────

interface ExtractedActionPlan {
  actionType: string;
  params?: Record<string, unknown>;
  rationale: string;
}

function tryExtractActionPlan(raw: string): ExtractedActionPlan | null {
  // Try fenced ```json ... ``` first
  const fenced = /```json\s*([\s\S]*?)```/i.exec(raw);
  if (fenced?.[1]) {
    const parsed = tryParse(fenced[1]);
    if (parsed && parsed.kind === "ACTION_PLAN" && typeof parsed.actionType === "string") {
      return {
        actionType: parsed.actionType,
        params: typeof parsed.params === "object" && parsed.params ? parsed.params : {},
        rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
      };
    }
  }
  // Try first {...} block
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = raw.slice(firstBrace, lastBrace + 1);
    const parsed = tryParse(slice);
    if (parsed && parsed.kind === "ACTION_PLAN" && typeof parsed.actionType === "string") {
      return {
        actionType: parsed.actionType,
        params: typeof parsed.params === "object" && parsed.params ? parsed.params : {},
        rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
      };
    }
  }
  return null;
}

function tryParse(s: string): { kind?: string; actionType?: string; params?: Record<string, unknown>; rationale?: string } | null {
  try {
    return JSON.parse(s.trim());
  } catch {
    return null;
  }
}
