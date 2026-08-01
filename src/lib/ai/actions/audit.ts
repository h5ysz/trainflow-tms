// GCCLAB AI Copilot — Phase 2 — AI-aware audit helper
// =====================================================================
// Wraps the existing audit() helper from src/lib/auth/api.ts and stamps
// every AI-generated audit entry with metadata.aiGenerated = true plus the
// copilot action type. This makes AI-generated entries filterable in the
// audit log UI without any schema migration.
import { audit } from "@/lib/auth/api";
import type { AuthUser } from "@/lib/auth/api";
import type { AuditAction, AuditEntity } from "@/lib/auth/audit";

export interface CopilotAuditOptions {
  user: AuthUser;
  action: AuditAction | string;
  entity: AuditEntity | string;
  entityId?: string | null;
  entityRef?: string | null;
  description: string;
  descriptionAr?: string;
  req?: Request;
  oldValue?: Record<string, unknown> | string | null;
  newValue?: Record<string, unknown> | string | null;
  reason?: string | null;
  copilotActionType: string;
  /** Extra metadata to merge alongside the AI flag. */
  extraMetadata?: Record<string, unknown>;
}

/**
 * Record an audit entry attributed to the AI Copilot. Always sets
 * metadata.aiGenerated = true and metadata.copilotAction = <type>.
 */
export async function copilotAudit(opts: CopilotAuditOptions): Promise<void> {
  return audit({
    user: opts.user,
    action: opts.action as AuditAction,
    entity: opts.entity as AuditEntity,
    entityId: opts.entityId ?? undefined,
    entityRef: opts.entityRef ?? undefined,
    description: opts.description,
    descriptionAr: opts.descriptionAr,
    req: opts.req,
    oldValue: opts.oldValue ?? null,
    newValue: opts.newValue ?? null,
    reason: opts.reason ?? null,
    metadata: {
      aiGenerated: true,
      copilotAction: opts.copilotActionType,
      ...(opts.extraMetadata ?? {}),
    },
  });
}
