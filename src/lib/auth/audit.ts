// GCCLAB TMS — Audit log service (Enterprise Audit Trail)
// =====================================================================
// Sprint 6: Extended with full enterprise audit trail support.
//
// Records every required action:
//   LOGIN, LOGOUT, FAILED_LOGIN, CREATE, UPDATE, DELETE, APPROVE, REJECT,
//   ISSUE_CERT, RENEW_CERT, GENERATE_QR, VERIFY_QR, CREATE_WORKER,
//   UPDATE_WORKER, DELETE_WORKER, CREATE_COMPANY, UPDATE_COMPANY,
//   COMPLIANCE_CHANGE, PERMISSION_CHANGE, STATUS_CHANGE, EXAM_SUBMIT,
//   CERTIFICATE_GENERATE, ISSUE, REVOKE, QR_REGENERATE, EXPORT
//
// Each entry includes: user, role, action, entity, entityId, ref number,
// description (EN+AR), IP, user-agent, browser, device, old/new values,
// reason, and structured metadata.
//
// Audit log is NEVER editable. Only SUPER_ADMIN can delete entries.

import { db } from "@/lib/db";
import type { JwtPayload } from "./jwt";
import { randomUUID } from "node:crypto";

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "FAILED_LOGIN"
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "STATUS_CHANGE"
  | "EXAM_SUBMIT"
  | "CERTIFICATE_GENERATE"
  | "APPROVE"
  | "REJECT"
  | "ISSUE"
  | "ISSUE_CERT"
  | "RENEW_CERT"
  | "REVOKE"
  | "QR_REGENERATE"
  | "GENERATE_QR"
  | "VERIFY_QR"
  | "CREATE_WORKER"
  | "UPDATE_WORKER"
  | "DELETE_WORKER"
  | "CREATE_COMPANY"
  | "UPDATE_COMPANY"
  | "COMPLIANCE_CHANGE"
  | "PERMISSION_CHANGE"
  | "EXPORT";

export type AuditEntity =
  | "COMPANY"
  | "TRAINER"
  | "TRAINEE"
  | "COURSE"
  | "REQUEST"
  | "SESSION"
  | "CERTIFICATE"
  | "USER"
  | "ROLE"
  | "SETTING"
  | "EXAM"
  | "ATTENDANCE"
  | "EVALUATION"
  | "WORKER_PASSPORT"
  | "COMPLIANCE_RULE"
  | "QR_CODE";

export interface AuditEntry {
  userId?: string | null;
  userRole?: string | null;
  action: AuditAction | string;
  entity: AuditEntity | string;
  entityId?: string | null;
  entityRef?: string | null;
  description: string;
  descriptionAr?: string | null;
  req?: Request | NextRequestLike;
  metadata?: Record<string, unknown>;
  oldValue?: Record<string, unknown> | string | null;
  newValue?: Record<string, unknown> | string | null;
  reason?: string | null;
}

interface NextRequestLike {
  headers?: { get(name: string): string | null };
}

/**
 * Parse a User-Agent string into browser + device (best-effort, no external deps).
 */
function parseUA(ua: string | null | undefined): { browser: string | null; device: string | null } {
  if (!ua) return { browser: null, device: null };
  let browser: string | null = null;
  let device: string | null = null;

  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";
  else browser = "Other";

  if (/iPad/.test(ua)) device = "iPad";
  else if (/iPhone/.test(ua)) device = "iPhone";
  else if (/Android/.test(ua)) device = "Android";
  else if (/Mobile/.test(ua)) device = "Mobile";
  else device = "Desktop";

  return { browser, device };
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const ip = entry.req?.headers?.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
    const ua = entry.req?.headers?.get("user-agent") ?? null;
    const parsed = parseUA(ua);

    await db.auditLog.create({
      data: {
        id: randomUUID(),
        userId: entry.userId ?? null,
        userRole: entry.userRole ?? null,
        action: entry.action as string,
        entity: entry.entity as string,
        entityId: entry.entityId ?? null,
        entityRef: entry.entityRef ?? null,
        description: entry.description,
        descriptionAr: entry.descriptionAr ?? null,
        ipAddress: ip,
        userAgent: ua,
        browser: parsed.browser,
        device: parsed.device,
        oldValue: entry.oldValue ? (typeof entry.oldValue === "string" ? entry.oldValue : JSON.stringify(entry.oldValue)) : null,
        newValue: entry.newValue ? (typeof entry.newValue === "string" ? entry.newValue : JSON.stringify(entry.newValue)) : null,
        reason: entry.reason ?? null,
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
  user: JwtPayload & { id: string; role?: string };
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
    userRole: opts.user.role ?? null,
    action: "STATUS_CHANGE",
    entity: opts.entity,
    entityId: opts.entityId,
    entityRef: opts.entityRef,
    description: `Status changed from ${opts.fromStatus} to ${opts.toStatus}`,
    descriptionAr: `تغيير الحالة من ${opts.fromStatus} إلى ${opts.toStatus}`,
    req: opts.req,
    oldValue: { status: opts.fromStatus },
    newValue: { status: opts.toStatus },
    metadata: { fromStatus: opts.fromStatus, toStatus: opts.toStatus, ...opts.extra },
  });
}
