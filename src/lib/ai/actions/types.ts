// GCCLAB AI Copilot — Phase 2 — Action Framework Types
// =====================================================================
// Every AI action follows the same contract:
//
//   1. User asks.
//   2. LLM proposes an action (actionType + params).
//   3. /actions/preview hydrates records, computes diff, returns a Preview.
//   4. User confirms or cancels. Nothing executes before confirmation.
//   5. /actions/execute re-validates permissions + state, runs the action
//      inside a transaction, writes the audit log with metadata.aiGenerated
//      = true, and returns the result.
//
// Action handlers NEVER modify existing endpoint files. They call Prisma
// directly (same as the endpoints do) and reuse shared helpers
// (nextRefNumber, audit, recomputeSessionCounts, etc.).
import type { AuthUser } from "@/lib/auth/api";
import type { UserRole, RouteKey, Action } from "@/lib/auth/permissions";

// ─── Action Categories ───────────────────────────────────────────────────
export type ActionCategory =
  | "COURSES"
  | "CONTRACTORS"
  | "TRAINEES"
  | "TRAINERS"
  | "SESSIONS"
  | "ATTENDANCE"
  | "EXAMS"
  | "CERTIFICATES"
  | "FINANCIAL"
  | "NOTIFICATIONS"
  | "WORKFLOW";

// ─── Permission Resolver ─────────────────────────────────────────────────
// Returns the module + action required to perform this AI action for the
// given role, or null if the role is not permitted. Used by the registry
// to enforce RBAC at both preview AND execute time.
export type PermissionResolver = (
  role: UserRole
) => { module: RouteKey; action: Action } | null;

// ─── Preview ──────────────────────────────────────────────────────────────
// One row in the affected-records table of the preview card.
export interface AffectedRecord {
  entity: string;            // e.g. "SESSION", "TRAINEE"
  refNumber?: string | null; // human-friendly ref
  description: string;       // short label
  descriptionAr?: string;    // bilingual
}

// One field-level change (old → new). Used for UPDATE actions.
export interface FieldChange {
  field: string;
  label: string;
  labelAr?: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface Warning {
  level: "info" | "warning" | "danger";
  message: string;
  messageAr?: string;
}

export interface PreviewResult {
  actionType: string;
  title: string;
  titleAr: string;
  summary: string;          // 1–2 sentence description of what will happen
  summaryAr: string;
  affectedRecords: AffectedRecord[];
  changes: FieldChange[];
  warnings: Warning[];
  expectedResult: string;   // what the user should see after execution
  expectedResultAr: string;
  // The hydrated params that will actually be used (after lookup / resolution).
  // The execute endpoint will only accept params matching this payload
  // (verified via the signed preview token).
  hydratedParams: Record<string, unknown>;
  // Multi-step workflows expose their step list for the progress UI.
  steps?: { key: string; label: string; labelAr?: string }[];
}

// ─── Execution ────────────────────────────────────────────────────────────
export interface ExecuteResult {
  success: boolean;
  actionType: string;
  message: string;
  messageAr?: string;
  // Entity refs created/updated — surfaced in the UI as links.
  results?: Array<{
    entity: string;
    id?: string;
    refNumber?: string;
    description: string;
  }>;
  // For multi-step workflows: per-step status.
  stepResults?: Array<{
    key: string;
    success: boolean;
    message: string;
    refNumber?: string;
  }>;
}

// ─── Action Handler Interface ─────────────────────────────────────────────
export interface ActionHandler<
  TParams = Record<string, unknown>,
  TPreview extends PreviewResult = PreviewResult,
  TResult extends ExecuteResult = ExecuteResult
> {
  type: string;
  category: ActionCategory;
  description: string;
  descriptionAr: string;
  /** Resolve required module/action for the given role, or null if forbidden. */
  resolvePermission: PermissionResolver;
  /** Hydrate params + build the preview. NEVER mutates data. */
  preparePreview(params: TParams, user: AuthUser): Promise<TPreview>;
  /** Execute the action. Must be idempotent on re-run when possible. */
  execute(
    preview: TPreview,
    user: AuthUser,
    req?: Request
  ): Promise<TResult>;
}

// ─── Convenience error type for action handlers ───────────────────────────
export class ActionError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(message: string, statusCode = 422, code = "ACTION_ERROR") {
    super(message);
    this.name = "ActionError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
