// GCCLAB AI Copilot — Phase 2 — Action Registry
// =====================================================================
// Central lookup for all AI action handlers. The preview and execute
// endpoints resolve handlers by `type` from this map.
//
// Each handler is responsible for:
//   - Declaring its permission requirement (role-aware)
//   - Preparing a non-mutating preview (hydrated records + diff)
//   - Executing the action inside a transaction with audit logging
//
// Handlers must NEVER:
//   - Mutate data during preparePreview
//   - Bypass the permission resolver
//   - Skip audit logging
//   - Modify files in the Financial or Training modules (frozen)
import type { ActionHandler } from "./types";
import type { UserRole, RouteKey, Action } from "@/lib/auth/permissions";
import { ActionError } from "./types";

import { courseActions } from "./courses";
import { contractorActions } from "./contractors";
import { traineeActions } from "./trainees";
import { trainerActions } from "./trainers";
import { sessionActions } from "./sessions";
import { attendanceActions } from "./attendance";
import { examActions } from "./exams";
import { certificateActions } from "./certificates";
import { financialActions } from "./financial";
import { notificationActions } from "./notifications";
import { workflowActions } from "./workflows";

// `any` here is intentional: each handler is generic over its own params type
// (e.g. CourseEditInput), and we need a single common type for the registry.
// The preview/execute endpoints cast params back to `Record<string, unknown>`
// before passing to the handler — type-safety lives inside each handler.
type AnyActionHandler = ActionHandler<any>;

const ALL_HANDLERS: AnyActionHandler[] = [
  ...courseActions,
  ...contractorActions,
  ...traineeActions,
  ...trainerActions,
  ...sessionActions,
  ...attendanceActions,
  ...examActions,
  ...certificateActions,
  ...financialActions,
  ...notificationActions,
  ...workflowActions,
];

const REGISTRY: Map<string, AnyActionHandler> = new Map();
for (const h of ALL_HANDLERS) {
  if (REGISTRY.has(h.type)) {
    throw new Error(`Duplicate AI action type: ${h.type}`);
  }
  REGISTRY.set(h.type, h);
}

export function getActionHandler(type: string): AnyActionHandler {
  const h = REGISTRY.get(type);
  if (!h) {
    throw new ActionError(
      `Unknown AI action type: ${type}`,
      404,
      "UNKNOWN_ACTION"
    );
  }
  return h;
}

export function listActionTypes(): Array<{
  type: string;
  category: string;
  description: string;
  descriptionAr: string;
}> {
  return ALL_HANDLERS.map((h) => ({
    type: h.type,
    category: h.category,
    description: h.description,
    descriptionAr: h.descriptionAr,
  }));
}

/**
 * Check whether a given role is permitted to perform an action. Returns the
 * required module+action, or null if forbidden.
 */
export function resolveActionPermission(
  type: string,
  role: UserRole
): { module: RouteKey; action: Action } | null {
  const handler = getActionHandler(type);
  return handler.resolvePermission(role);
}

/**
 * Catalog grouped by category — surfaced to the LLM prompt so the model
 * knows which actions exist and can pick the right one.
 */
export interface ActionCatalogEntry {
  type: string;
  category: string;
  description: string;
  descriptionAr: string;
  requiredParams: string[];
}

export function getActionCatalog(): ActionCatalogEntry[] {
  // We do not derive requiredParams automatically — each handler documents
  // them in its description. The catalog is static metadata for the LLM.
  return ALL_HANDLERS.map((h) => ({
    type: h.type,
    category: h.category,
    description: h.description,
    descriptionAr: h.descriptionAr,
    requiredParams: [],
  }));
}
