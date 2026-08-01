// GCCLAB AI Copilot — Phase 2 — ATTENDANCE actions
// =====================================================================
// mark / correct / generate_report
import { db } from "@/lib/db";
import type { ActionHandler } from "./types";
import { ActionError } from "./types";
import { copilotAudit } from "./audit";

// ─── ATTENDANCE_MARK ──────────────────────────────────────────────────────
interface AttendanceMarkInput {
  sessionId: string;
  // Either pass attendanceIds[] OR traineeIds[] (looked up via enrollments)
  attendanceIds?: string[];
  status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
  notes?: string;
}
const markAttendance: ActionHandler<AttendanceMarkInput> = {
  type: "ATTENDANCE_MARK",
  category: "ATTENDANCE",
  description: "Mark attendance status for one or more trainees in a session (PRESENT/ABSENT/LATE/EXCUSED).",
  descriptionAr: "تعليم حالة الحضور لمتدرب أو أكثر في جلسة (حاضر/غائب/متأخر/معذور).",
  resolvePermission: (role) => {
    if (role === "TRAINER" || role === "COORDINATOR" || role === "SUPER_ADMIN") {
      return { module: "attendance", action: "edit" };
    }
    return null;
  },
  async preparePreview(input, user) {
    if (!input.sessionId || !input.status) {
      throw new ActionError("sessionId and status are required", 422, "VALIDATION_ERROR");
    }
    const validStatuses = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];
    if (!validStatuses.includes(input.status)) {
      throw new ActionError(`Invalid status: ${input.status}`, 422, "VALIDATION_ERROR");
    }
    const session = await db.trainingSession.findFirst({ where: { id: input.sessionId, deletedAt: null } });
    if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
    if (user.role === "TRAINER" && session.trainerId !== user.trainerId) {
      throw new ActionError("Trainers can only mark attendance for their own sessions", 403, "FORBIDDEN");
    }
    let attendanceIds = input.attendanceIds ?? [];
    if (attendanceIds.length === 0) {
      // Mark ALL active enrollments
      const rows = await db.attendance.findMany({
        where: { sessionId: session.id, deletedAt: null },
        select: { id: true, traineeName: true, status: true },
      });
      attendanceIds = rows.map((r) => r.id);
    }
    if (attendanceIds.length === 0) {
      throw new ActionError("No attendance records found for this session", 400, "NO_RECORDS");
    }
    const records = await db.attendance.findMany({
      where: { id: { in: attendanceIds }, sessionId: session.id, deletedAt: null },
      select: { id: true, traineeName: true, status: true },
    });
    return {
      actionType: "ATTENDANCE_MARK",
      title: "Mark Attendance",
      titleAr: "تعليم الحضور",
      summary: `Mark ${records.length} trainee(s) as ${input.status} in session ${session.refNumber}.`,
      summaryAr: `تعليم ${records.length} متدرب كـ ${input.status} في الجلسة ${session.refNumber}.`,
      affectedRecords: records.slice(0, 10).map((r) => ({
        entity: "ATTENDANCE",
        description: `${r.traineeName} (${r.status} → ${input.status})`,
      })),
      changes: records.slice(0, 20).map((r) => ({
        field: "status", label: r.traineeName, oldValue: r.status, newValue: input.status,
      })),
      warnings: [],
      expectedResult: `${records.length} attendance record(s) will be updated to ${input.status}.`,
      expectedResultAr: `سيتم تحديث ${records.length} سجل حضور إلى ${input.status}.`,
      hydratedParams: {
        sessionId: session.id, sessionRef: session.refNumber,
        attendanceIds: records.map((r) => r.id), status: input.status,
        notes: input.notes ?? null, count: records.length,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const ids = p.attendanceIds as string[];
    const result = await db.attendance.updateMany({
      where: { id: { in: ids }, sessionId: p.sessionId as string },
      data: { status: p.status as string, notes: (p.notes as string | null) ?? null, updatedBy: user.id },
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "ATTENDANCE",
      entityId: p.sessionId as string,
      entityRef: p.sessionRef as string,
      description: `AI marked ${result.count} attendance records as ${p.status} in ${p.sessionRef}`,
      descriptionAr: `علّم الذكاء الاصطناعي ${result.count} سجل حضور كـ ${p.status} في ${p.sessionRef}`,
      req,
      newValue: { status: p.status, count: result.count },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "ATTENDANCE_MARK",
      message: `${result.count} attendance record(s) marked as ${p.status}.`,
      messageAr: `تم تعليم ${result.count} سجل حضور كـ ${p.status}.`,
      results: [],
    };
  },
};

// ─── ATTENDANCE_CORRECT ───────────────────────────────────────────────────
interface AttendanceCorrectInput {
  attendanceId: string;
  newStatus: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "REGISTERED";
  reason?: string;
}
const correctAttendance: ActionHandler<AttendanceCorrectInput> = {
  type: "ATTENDANCE_CORRECT",
  category: "ATTENDANCE",
  description: "Correct the attendance status of a single trainee (with reason for audit).",
  descriptionAr: "تصحيح حالة حضور متدرب واحد (مع السبب للمراجعة).",
  resolvePermission: (role) => {
    if (role === "TRAINER" || role === "COORDINATOR" || role === "SUPER_ADMIN") {
      return { module: "attendance", action: "edit" };
    }
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.attendanceId || !input.newStatus) {
      throw new ActionError("attendanceId and newStatus are required", 422, "VALIDATION_ERROR");
    }
    const att = await db.attendance.findFirst({
      where: { id: input.attendanceId, deletedAt: null },
      include: { session: { select: { refNumber: true, id: true } } },
    });
    if (!att) throw new ActionError("Attendance record not found", 404, "NOT_FOUND");
    if (att.status === input.newStatus) {
      throw new ActionError(`Status is already ${input.newStatus}`, 400, "NO_CHANGE");
    }
    return {
      actionType: "ATTENDANCE_CORRECT",
      title: "Correct Attendance",
      titleAr: "تصحيح الحضور",
      summary: `Correct ${att.traineeName} from ${att.status} → ${input.newStatus} in ${att.session.refNumber}.`,
      summaryAr: `تصحيح ${att.traineeName} من ${att.status} → ${input.newStatus} في ${att.session.refNumber}.`,
      affectedRecords: [
        { entity: "ATTENDANCE", description: `${att.traineeName} (${att.session.refNumber})` },
      ],
      changes: [{ field: "status", label: att.traineeName, oldValue: att.status, newValue: input.newStatus }],
      warnings: [],
      expectedResult: `${att.traineeName}'s status will be ${input.newStatus}.`,
      expectedResultAr: `ستكون حالة ${att.traineeName} هي ${input.newStatus}.`,
      hydratedParams: {
        attendanceId: att.id, oldStatus: att.status, newStatus: input.newStatus,
        traineeName: att.traineeName, sessionRef: att.session.refNumber, sessionId: att.session.id,
        reason: input.reason ?? null,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const updated = await db.attendance.update({
      where: { id: p.attendanceId as string },
      data: { status: p.newStatus as string, updatedBy: user.id },
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "ATTENDANCE",
      entityId: updated.id,
      entityRef: p.sessionRef as string,
      description: `AI corrected attendance: ${p.traineeName} ${p.oldStatus} → ${p.newStatus}`,
      descriptionAr: `صحّح الذكاء الاصطناعي الحضور: ${p.traineeName} ${p.oldStatus} → ${p.newStatus}`,
      req,
      oldValue: { status: p.oldStatus },
      newValue: { status: p.newStatus },
      reason: (p.reason as string | null) ?? null,
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "ATTENDANCE_CORRECT",
      message: `Attendance corrected: ${p.traineeName} → ${p.newStatus}.`,
      messageAr: `تم تصحيح الحضور: ${p.traineeName} → ${p.newStatus}.`,
      results: [],
    };
  },
};

// ─── ATTENDANCE_GENERATE_REPORT ───────────────────────────────────────────
interface AttendanceReportInput {
  sessionId: string;
  format?: "SUMMARY" | "DETAILED";
}
const generateAttendanceReport: ActionHandler<AttendanceReportInput> = {
  type: "ATTENDANCE_GENERATE_REPORT",
  category: "ATTENDANCE",
  description: "Generate an attendance report (counts by status) for a session.",
  descriptionAr: "إنشاء تقرير حضور (عدد حسب الحالة) لجلسة.",
  resolvePermission: () => ({ module: "attendance", action: "view" }),
  async preparePreview(input, _user) {
    if (!input.sessionId) throw new ActionError("sessionId is required", 422, "VALIDATION_ERROR");
    const session = await db.trainingSession.findFirst({
      where: { id: input.sessionId, deletedAt: null },
      include: { _count: { select: { attendance: true } } },
    });
    if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
    const counts = await db.attendance.groupBy({
      by: ["status"],
      where: { sessionId: session.id, deletedAt: null },
      _count: { _all: true },
    });
    const summary = counts.map((c) => `${c.status}: ${c._count._all}`).join(", ");
    return {
      actionType: "ATTENDANCE_GENERATE_REPORT",
      title: "Attendance Report",
      titleAr: "تقرير الحضور",
      summary: `Generate attendance report for ${session.refNumber}.`,
      summaryAr: `إنشاء تقرير حضور للجلسة ${session.refNumber}.`,
      affectedRecords: [
        { entity: "SESSION", refNumber: session.refNumber, description: session.title },
      ],
      changes: [
        { field: "totalRecords", label: "Total Records", oldValue: null, newValue: session._count.attendance },
        { field: "summary", label: "By Status", oldValue: null, newValue: summary || "No records" },
      ],
      warnings: [],
      expectedResult: `Report will be returned with attendance breakdown.`,
      expectedResultAr: `سيتم إرجاع التقرير مع تفصيل الحضور.`,
      hydratedParams: { sessionId: session.id, sessionRef: session.refNumber, format: input.format ?? "SUMMARY" },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const records = await db.attendance.findMany({
      where: { sessionId: p.sessionId as string, deletedAt: null },
      select: { id: true, traineeName: true, status: true, checkInAt: true, checkOutAt: true, company: true },
    });
    const byStatus: Record<string, number> = {};
    for (const r of records) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    await copilotAudit({
      user,
      action: "EXPORT",
      entity: "ATTENDANCE",
      entityId: p.sessionId as string,
      entityRef: p.sessionRef as string,
      description: `AI generated attendance report for ${p.sessionRef} (${records.length} records)`,
      descriptionAr: `أنشأ الذكاء الاصطناعي تقرير حضور لـ ${p.sessionRef} (${records.length} سجل)`,
      req,
      newValue: { total: records.length, byStatus },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "ATTENDANCE_GENERATE_REPORT",
      message: `Report generated: ${records.length} records. ${Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
      messageAr: `تم إنشاء التقرير: ${records.length} سجل.`,
      results: records.slice(0, 100).map((r) => ({
        entity: "ATTENDANCE",
        id: r.id,
        description: `${r.traineeName} — ${r.status}`,
      })),
    };
  },
};

export const attendanceActions: ActionHandler<any>[] = [markAttendance, correctAttendance, generateAttendanceReport];
