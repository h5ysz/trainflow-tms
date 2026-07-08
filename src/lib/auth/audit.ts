// GCCLAB TMS — Audit log service
// =====================================================================
// Records every required action:
//   - LOGIN, LOGOUT
//   - CREATE, UPDATE, DELETE
//   - STATUS_CHANGE (workflow transitions)
//   - EXAM_SUBMIT
//   - CERTIFICATE_GENERATE
//   - APPROVE, REJECT, ISSUE, REVOKE
//   - QR_REGENERATE
//
// Each entry includes: user, action, entity, entityId, human-readable ref,
// bilingual description, IP, user-agent, and structured metadata (before/after diff).

import { db } from "@/lib/db";
import type { JwtPayload } from "./jwt";

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "STATUS_CHANGE"
  | "EXAM_SUBMIT"
  | "CERTIFICATE_GENERATE"
  | "APPROVE"
  | "REJECT"
  | "ISSUE"
  | "REVOKE"
  | "QR_REGENERATE";

export type AuditEntity =
  | "COMPANY"
  | "TRAINER"
  | "TRAINEE"
  | "COURSE"
  | "REQUEST"
  | "SESSION"
  | "CERTIFICATE"
  | "USER"
  | "SETTING"
  | "EXAM"
  | "ATTENDANCE";

export interface AuditEntry {
  userId?: string | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string | null;
  entityRef?: string | null;
  description: string;
  descriptionAr?: string | null;
  req?: Request | NextRequestLike;
  metadata?: Record<string, unknown>;
}

interface NextRequestLike {
  headers?: { get(name: string): string | null };
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        entityRef: entry.entityRef ?? null,
        description: entry.description,
        descriptionAr: entry.descriptionAr ?? null,
        ipAddress: entry.req?.headers?.get("x-forwarded-for") ?? null,
        userAgent: entry.req?.headers?.get("user-agent") ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      },
    });
  } catch (e) {
    // Audit log must NEVER break the main operation
    console.error("[AuditLog error]", e);
  }
}

// Convenience helper for status-change events (workflow transitions)
export function recordStatusChange(opts: {
  user: JwtPayload;
  entity: AuditEntity;
  entityId: string;
  entityRef?: string;
  fromStatus: string;
  toStatus: string;
  req?: Request;
  extra?: Record<string, unknown>;
}) {
  return recordAudit({
    userId: opts.user.id,
    action: "STATUS_CHANGE",
    entity: opts.entity,
    entityId: opts.entityId,
    entityRef: opts.entityRef,
    description: `Status changed from ${opts.fromStatus} to ${opts.toStatus}`,
    descriptionAr: `تغيير الحالة من ${opts.fromStatus} إلى ${opts.toStatus}`,
    req: opts.req,
    metadata: { fromStatus: opts.fromStatus, toStatus: opts.toStatus, ...opts.extra },
  });
}
