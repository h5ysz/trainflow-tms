// GCCLAB AI Copilot — Phase 2 — WORKFLOWS (multi-step + bulk + smart suggestions)
// =====================================================================
// WORKFLOW_CREATE_SESSION_FULL — create session + assign trainer + generate
//   QR + notify trainees + prepare attendance sheet
//
// BULK_MOVE_TRAINEES — move 50+ trainees across sessions
// BULK_ASSIGN_TRAINER — assign one trainer to N sessions
// BULK_GENERATE_CERTIFICATES — generate certs for N sessions
// BULK_SEND_INVOICES — send invoices to all contractors with outstanding drafts
// BULK_APPROVE_PAYMENTS — approve multiple pending payments
//
// SUGGEST_BEST_TRAINER — recommend trainer for a course+date
// SUGGEST_BEST_ROOM — recommend venue based on capacity needs
// SUGGEST_BEST_TIME — recommend time slot avoiding conflicts
// SUGGEST_CAPACITY_WARNINGS — surface over-capacity sessions
// SUGGEST_FINANCIAL_WARNINGS — surface overdue invoices + outstanding balances
// SUGGEST_CERTIFICATE_EXPIRY — surface certificates expiring in 30 days
// SUGGEST_SCHEDULE_CONFLICTS — surface trainer double-bookings
import { db } from "@/lib/db";
import { nextRefNumber } from "@/lib/api/ref-number";
import { recomputeSessionCounts, upsertEnrollment, truncateForAudit } from "@/lib/sessions/session-management";
import { validateTrainerAssignment } from "@/lib/api/trainer-assignment";
import { randomBytes } from "crypto";
import type { ActionHandler, ExecuteResult } from "./types";
import { ActionError } from "./types";
import { copilotAudit } from "./audit";

function genQrToken(): string {
  return randomBytes(16).toString("hex");
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-STEP WORKFLOW: CREATE_SESSION_FULL
// ═══════════════════════════════════════════════════════════════════════════
interface WorkflowCreateSessionInput {
  courseId: string;
  title: string;
  startDate: string;
  endDate: string;
  shift?: string;
  capacity?: number;
  trainerId?: string;
  venue?: string;
  city?: string;
  traineeIds?: string[];
  notifyTrainees?: boolean;
}
const workflowCreateSession: ActionHandler<WorkflowCreateSessionInput> = {
  type: "WORKFLOW_CREATE_SESSION_FULL",
  category: "WORKFLOW",
  description: "Multi-step workflow: create session → assign trainer → generate QR → notify trainees → prepare attendance sheet.",
  descriptionAr: "سير عمل متعدد الخطوات: إنشاء الجلسة ← تعيين المدرب ← توليد QR ← إشعار المتدربين ← تجهيز كشف الحضور.",
  resolvePermission: (role) => {
    if (role === "SUPER_ADMIN" || role === "COORDINATOR" || role === "TRAINER") {
      return { module: "sessions", action: "create" };
    }
    return null;
  },
  async preparePreview(input, user) {
    if (!input.courseId || !input.title || !input.startDate || !input.endDate) {
      throw new ActionError("courseId, title, startDate, endDate are required", 422, "VALIDATION_ERROR");
    }
    const course = await db.course.findFirst({ where: { id: input.courseId, deletedAt: null } });
    if (!course) throw new ActionError("Course not found", 404, "NOT_FOUND");
    let trainerName: string | null = null;
    if (input.trainerId) {
      const t = await db.trainer.findFirst({ where: { id: input.trainerId, deletedAt: null } });
      if (!t) throw new ActionError("Trainer not found", 404, "NOT_FOUND");
      trainerName = t.nameEn;
      const v = await validateTrainerAssignment({
        user, trainerId: t.id, courseId: course.id,
        startDate: new Date(input.startDate), endDate: new Date(input.endDate),
      });
      if (!v.valid && v.error) {
        throw new ActionError("Trainer assignment blocked: " + v.error, 400, "ASSIGNMENT_BLOCKED");
      }
    }
    let traineeRows: { id: string; fullName: string; companyId: string; refNumber: string }[] = [];
    if (input.traineeIds && input.traineeIds.length > 0) {
      traineeRows = await db.trainee.findMany({
        where: { id: { in: input.traineeIds }, deletedAt: null },
        select: { id: true, fullName: true, companyId: true, refNumber: true },
      });
    }
    const capacity = input.capacity ?? course.maxTrainees;
    return {
      actionType: "WORKFLOW_CREATE_SESSION_FULL",
      title: "Create Session Workflow",
      titleAr: "سير عمل إنشاء الجلسة",
      summary: `Run 5-step workflow: create session "${input.title}" → assign trainer${trainerName ? ` (${trainerName})` : ""} → generate QR → notify ${traineeRows.length} trainee(s) → prepare attendance sheet.`,
      summaryAr: `تنفيذ سير عمل من 5 خطوات: إنشاء الجلسة "${input.title}" ← تعيين المدرب${trainerName ? ` (${trainerName})` : ""} ← توليد QR ← إشعار ${traineeRows.length} متدرب ← تجهيز كشف الحضور.`,
      affectedRecords: [
        { entity: "COURSE", refNumber: course.refNumber, description: course.title },
        ...(input.trainerId ? [{ entity: "TRAINER", description: trainerName ?? "" }] : []),
        ...traineeRows.slice(0, 5).map((t) => ({ entity: "TRAINEE", refNumber: t.refNumber, description: t.fullName })),
      ],
      changes: [
        { field: "steps", label: "Steps", oldValue: 0, newValue: 5 },
        { field: "traineeCount", label: "Trainees", oldValue: 0, newValue: traineeRows.length },
      ],
      warnings: [],
      expectedResult: `A new session will be created with QR code and (optionally) enrolled + notified trainees.`,
      expectedResultAr: `سيتم إنشاء جلسة جديدة برمز QR و(اختيارياً) متدربين مسجلين ومُشعَرين.`,
      steps: [
        { key: "create_session", label: "Create Session", labelAr: "إنشاء الجلسة" },
        { key: "assign_trainer", label: "Assign Trainer", labelAr: "تعيين المدرب" },
        { key: "generate_qr", label: "Generate QR", labelAr: "توليد QR" },
        { key: "notify_trainees", label: "Notify Trainees", labelAr: "إشعار المتدربين" },
        { key: "attendance_sheet", label: "Prepare Attendance Sheet", labelAr: "تجهيز كشف الحضور" },
      ],
      hydratedParams: {
        courseId: course.id, courseRef: course.refNumber, courseTitle: course.title,
        title: input.title, startDate: input.startDate, endDate: input.endDate,
        shift: input.shift, capacity, trainerId: input.trainerId, trainerName,
        venue: input.venue, city: input.city, durationHours: course.durationHours, language: course.language,
        traineeRows, notifyTrainees: input.notifyTrainees ?? true,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const stepResults: ExecuteResult["stepResults"] = [];
    const refNumber = await nextRefNumber("SESSION");
    const qrToken = genQrToken();
    let sessionId: string = "";
    let sessionRef: string = "";

    await db.$transaction(async (tx) => {
      // Step 1: Create session (with QR already set)
      const session = await tx.trainingSession.create({
        data: {
          refNumber,
          courseId: p.courseId as string,
          trainerId: (p.trainerId as string | null) ?? null,
          title: p.title as string,
          city: (p.city as string | null) ?? null,
          venue: (p.venue as string | null) ?? null,
          shift: (p.shift as string | null) ?? null,
          durationHours: p.durationHours as number,
          capacity: p.capacity as number,
          language: (p.language as string) ?? "en",
          startDate: new Date(p.startDate as string),
          endDate: new Date(p.endDate as string),
          expectedTrainees: 0, actualTrainees: 0, status: "SCHEDULED",
          classification: "COURSE",
          qrCodeToken: qrToken, qrCodeGeneratedAt: new Date(),
          createdBy: user.id, updatedBy: user.id,
        },
      });
      sessionId = session.id; sessionRef = session.refNumber;
      stepResults.push({ key: "create_session", success: true, message: `Session ${sessionRef} created`, refNumber: sessionRef });

      // Step 2: Trainer already assigned in step 1 (if trainerId provided)
      if (p.trainerId) {
        stepResults.push({ key: "assign_trainer", success: true, message: `Trainer ${p.trainerName} assigned`, refNumber: undefined });
      } else {
        stepResults.push({ key: "assign_trainer", success: true, message: `Skipped (no trainer provided)`, refNumber: undefined });
      }

      // Step 3: QR generated in step 1
      stepResults.push({ key: "generate_qr", success: true, message: `QR token generated`, refNumber: undefined });

      // Step 4: Enroll trainees + notify
      const traineeRows = (p.traineeRows as Array<{ id: string; fullName: string; companyId: string; refNumber: string }>) ?? [];
      let notifiedCount = 0;
      if (traineeRows.length > 0) {
        for (const t of traineeRows) {
          await upsertEnrollment(sessionId, t.id, t.companyId, user.id, { tx, enrollmentStatus: "CONFIRMED" });
        }
        await recomputeSessionCounts(sessionId, tx);
        // Create attendance records for enrolled trainees
        for (const t of traineeRows) {
          await tx.attendance.create({
            data: {
              sessionId,
              traineeName: t.fullName,
              status: "REGISTERED",
              createdBy: user.id,
              updatedBy: user.id,
            },
          }).catch(() => {/* unique constraint may exist; ignore */});
        }
        if (p.notifyTrainees) {
          // Find contractor users per company
          const companyIds = Array.from(new Set(traineeRows.map((t) => t.companyId)));
          const contractorUsers = await tx.user.findMany({
            where: { companyId: { in: companyIds }, role: "CONTRACTOR", deletedAt: null, isActive: true },
            select: { id: true },
          });
          if (contractorUsers.length > 0) {
            await tx.notification.createMany({
              data: contractorUsers.map((u) => ({
                userId: u.id,
                title: `Session Scheduled: ${sessionRef}`,
                titleAr: `جلسة مجدولة: ${sessionRef}`,
                message: `Your trainees have been enrolled in "${p.title}" on ${new Date(p.startDate as string).toLocaleDateString()}.`,
                messageAr: `تم تسجيل متدربيك في "${p.title}" بتاريخ ${new Date(p.startDate as string).toLocaleDateString()}.`,
                type: "INFO", category: "SESSION",
                channels: JSON.stringify(["in_app", "email"]),
                emailSentAt: new Date(),
              })),
            });
            notifiedCount = contractorUsers.length;
          }
        }
      }
      stepResults.push({ key: "notify_trainees", success: true, message: `${traineeRows.length} trainee(s) enrolled, ${notifiedCount} user(s) notified`, refNumber: undefined });

      // Step 5: Attendance sheet — already populated in step 4 via Attendance.create
      stepResults.push({ key: "attendance_sheet", success: true, message: `Attendance sheet prepared (${traineeRows.length} records)`, refNumber: undefined });
    });

    await copilotAudit({
      user,
      action: "CREATE",
      entity: "SESSION",
      entityId: sessionId,
      entityRef: sessionRef,
      description: `AI workflow: created session ${sessionRef} with ${stepResults.length} steps`,
      descriptionAr: `سير عمل الذكاء الاصطناعي: إنشاء الجلسة ${sessionRef} بـ ${stepResults.length} خطوات`,
      req,
      newValue: { sessionRef, steps: stepResults, traineeCount: (p.traineeRows as unknown[])?.length ?? 0 },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "WORKFLOW_CREATE_SESSION_FULL",
      message: `Workflow complete. Session ${sessionRef} created.`,
      messageAr: `اكتمل سير العمل. تم إنشاء الجلسة ${sessionRef}.`,
      results: [{ entity: "SESSION", id: sessionId, refNumber: sessionRef, description: p.title as string }],
      stepResults,
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// BULK OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

// BULK_MOVE_TRAINEES — move 50+ trainees across sessions
interface BulkMoveInput {
  moves: Array<{ traineeId: string; fromSessionId: string; toSessionId: string }>;
}
const bulkMoveTrainees: ActionHandler<BulkMoveInput> = {
  type: "BULK_MOVE_TRAINEES",
  category: "WORKFLOW",
  description: "Bulk move N trainees across sessions (one transaction). Each move: cancel source enrollment + enroll at target.",
  descriptionAr: "نقل جماعي لـ N متدرب عبر الجلسات (معاملة واحدة). كل نقل: إلغاء تسجيل المصدر + تسجيل في الهدف.",
  resolvePermission: () => ({ module: "sessions", action: "edit" }),
  async preparePreview(input, _user) {
    if (!input.moves || input.moves.length === 0) {
      throw new ActionError("moves[] is required", 422, "VALIDATION_ERROR");
    }
    if (input.moves.length > 500) {
      throw new ActionError("Maximum 500 moves per bulk operation", 422, "TOO_MANY");
    }
    // Validate all moves
    const fromIds = Array.from(new Set(input.moves.map((m) => m.fromSessionId)));
    const toIds = Array.from(new Set(input.moves.map((m) => m.toSessionId)));
    const traineeIds = Array.from(new Set(input.moves.map((m) => m.traineeId)));
    const [fromSessions, toSessions, trainees] = await Promise.all([
      db.trainingSession.findMany({ where: { id: { in: fromIds }, deletedAt: null }, select: { id: true, refNumber: true, courseId: true, status: true } }),
      db.trainingSession.findMany({ where: { id: { in: toIds }, deletedAt: null }, select: { id: true, refNumber: true, courseId: true, status: true, capacity: true } }),
      db.trainee.findMany({ where: { id: { in: traineeIds }, deletedAt: null }, select: { id: true, refNumber: true, fullName: true, companyId: true } }),
    ]);
    const fromMap = new Map(fromSessions.map((s) => [s.id, s]));
    const toMap = new Map(toSessions.map((s) => [s.id, s]));
    const traineeMap = new Map(trainees.map((t) => [t.id, t]));
    // Verify each move
    const validMoves: Array<{ traineeId: string; traineeRef: string; traineeName: string; companyId: string; fromSessionId: string; fromSessionRef: string; toSessionId: string; toSessionRef: string }> = [];
    const errors: string[] = [];
    for (const m of input.moves) {
      const from = fromMap.get(m.fromSessionId);
      const to = toMap.get(m.toSessionId);
      const trainee = traineeMap.get(m.traineeId);
      if (!from || !to || !trainee) { errors.push(`Invalid move: missing session/trainee`); continue; }
      if (from.courseId !== to.courseId) { errors.push(`${trainee.refNumber}: course mismatch`); continue; }
      if (from.status !== "SCHEDULED" || to.status !== "SCHEDULED") { errors.push(`${trainee.refNumber}: non-SCHEDULED session`); continue; }
      validMoves.push({
        traineeId: trainee.id, traineeRef: trainee.refNumber, traineeName: trainee.fullName, companyId: trainee.companyId,
        fromSessionId: from.id, fromSessionRef: from.refNumber,
        toSessionId: to.id, toSessionRef: to.refNumber,
      });
    }
    return {
      actionType: "BULK_MOVE_TRAINEES",
      title: "Bulk Move Trainees",
      titleAr: "نقل جماعي للمتدربين",
      summary: `Move ${validMoves.length} trainee(s) across sessions${errors.length > 0 ? ` (${errors.length} skipped due to errors)` : ""}.`,
      summaryAr: `نقل ${validMoves.length} متدرب عبر الجلسات${errors.length > 0 ? ` (${errors.length} متخطى بسبب أخطاء)` : ""}.`,
      affectedRecords: validMoves.slice(0, 20).map((m) => ({ entity: "TRAINEE", refNumber: m.traineeRef, description: `${m.traineeName}: ${m.fromSessionRef} → ${m.toSessionRef}` })),
      changes: [
        { field: "moves", label: "Valid Moves", oldValue: input.moves.length, newValue: validMoves.length },
        { field: "errors", label: "Skipped", oldValue: 0, newValue: errors.length },
      ],
      warnings: errors.length > 0 ? [{ level: "warning" as const, message: `${errors.length} move(s) skipped: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "..." : ""}`, messageAr: `تم تخطي ${errors.length} نقل` }] : [],
      expectedResult: `${validMoves.length} trainee(s) will be moved.`,
      expectedResultAr: `سيتم نقل ${validMoves.length} متدرب.`,
      hydratedParams: { moves: validMoves, errorCount: errors.length },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const moves = p.moves as Array<{ traineeId: string; companyId: string; fromSessionId: string; toSessionId: string }>;
    let successCount = 0;
    await db.$transaction(async (tx) => {
      // Group by source/target for batch recompute
      const affectedSessions = new Set<string>();
      for (const m of moves) {
        // Cancel source
        await tx.sessionEnrollment.updateMany({
          where: { sessionId: m.fromSessionId, traineeId: m.traineeId, deletedAt: null },
          data: { enrollmentStatus: "CANCELLED", deletedAt: new Date(), updatedBy: user.id },
        });
        // Enroll at target
        await upsertEnrollment(m.toSessionId, m.traineeId, m.companyId, user.id, { tx, enrollmentStatus: "CONFIRMED" });
        affectedSessions.add(m.fromSessionId);
        affectedSessions.add(m.toSessionId);
        successCount++;
      }
      // Recompute all affected sessions
      for (const sid of affectedSessions) {
        await recomputeSessionCounts(sid, tx);
      }
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      description: `AI bulk-moved ${successCount} trainees across sessions`,
      descriptionAr: `نقل الذكاء الاصطناعي جماعياً ${successCount} متدرب عبر الجلسات`,
      req,
      newValue: { count: successCount },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "BULK_MOVE_TRAINEES",
      message: `${successCount} trainee(s) moved successfully.`,
      messageAr: `تم نقل ${successCount} متدرب بنجاح.`,
      results: [],
    };
  },
};

// BULK_ASSIGN_TRAINER — assign one trainer to N sessions
interface BulkAssignTrainerInput { trainerId: string; sessionIds: string[]; }
const bulkAssignTrainer: ActionHandler<BulkAssignTrainerInput> = {
  type: "BULK_ASSIGN_TRAINER",
  category: "WORKFLOW",
  description: "Assign one trainer to N sessions in a single transaction (with conflict validation per session).",
  descriptionAr: "تعيين مدرب واحد لـ N جلسات في معاملة واحدة (مع التحقق من التضارب لكل جلسة).",
  resolvePermission: () => ({ module: "sessions", action: "edit" }),
  async preparePreview(input, user) {
    if (!input.trainerId || !input.sessionIds || input.sessionIds.length === 0) {
      throw new ActionError("trainerId and sessionIds[] are required", 422, "VALIDATION_ERROR");
    }
    if (input.sessionIds.length > 200) throw new ActionError("Maximum 200 sessions per bulk operation", 422, "TOO_MANY");
    const trainer = await db.trainer.findFirst({ where: { id: input.trainerId, deletedAt: null } });
    if (!trainer) throw new ActionError("Trainer not found", 404, "NOT_FOUND");
    const sessions = await db.trainingSession.findMany({
      where: { id: { in: input.sessionIds }, deletedAt: null },
      include: { course: { select: { title: true } } },
    });
    const validSessions: Array<{ id: string; refNumber: string; title: string }> = [];
    const errors: string[] = [];
    for (const s of sessions) {
      const v = await validateTrainerAssignment({
        user, trainerId: trainer.id, courseId: s.courseId,
        startDate: s.startDate, endDate: s.endDate,
      });
      if (v.valid) {
        validSessions.push({ id: s.id, refNumber: s.refNumber, title: s.course?.title ?? s.title });
      } else {
        errors.push(`${s.refNumber}: ${v.error ?? "validation failed"}`);
      }
    }
    return {
      actionType: "BULK_ASSIGN_TRAINER",
      title: "Bulk Assign Trainer",
      titleAr: "تعيين جماعي للمدرب",
      summary: `Assign ${trainer.nameEn} to ${validSessions.length} session(s)${errors.length > 0 ? ` (${errors.length} skipped)` : ""}.`,
      summaryAr: `تعيين ${trainer.nameEn} لـ ${validSessions.length} جلسة${errors.length > 0 ? ` (${errors.length} متخطى)` : ""}.`,
      affectedRecords: validSessions.slice(0, 20).map((s) => ({ entity: "SESSION", refNumber: s.refNumber, description: s.title })),
      changes: [
        { field: "trainer", label: "Trainer", oldValue: null, newValue: `${trainer.nameEn} (${trainer.refNumber})` },
        { field: "count", label: "Sessions", oldValue: 0, newValue: validSessions.length },
      ],
      warnings: errors.length > 0 ? [{ level: "warning" as const, message: `${errors.length} session(s) skipped: ${errors.slice(0, 2).join("; ")}${errors.length > 2 ? "..." : ""}`, messageAr: `تم تخطي ${errors.length} جلسة` }] : [],
      expectedResult: `${validSessions.length} session(s) will have trainer ${trainer.nameEn} assigned.`,
      expectedResultAr: `سيتم تعيين المدرب ${trainer.nameEn} لـ ${validSessions.length} جلسة.`,
      hydratedParams: { trainerId: trainer.id, trainerRef: trainer.refNumber, trainerName: trainer.nameEn, sessionIds: validSessions.map((s) => s.id) },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const sessionIds = p.sessionIds as string[];
    const result = await db.trainingSession.updateMany({
      where: { id: { in: sessionIds } },
      data: { trainerId: p.trainerId as string, updatedBy: user.id },
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      description: `AI bulk-assigned trainer ${p.trainerRef} to ${result.count} sessions`,
      descriptionAr: `عيّن الذكاء الاصطناعي جماعياً المدرب ${p.trainerRef} لـ ${result.count} جلسة`,
      req,
      newValue: { trainerRef: p.trainerRef, count: result.count },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "BULK_ASSIGN_TRAINER",
      message: `${p.trainerName} assigned to ${result.count} session(s).`,
      messageAr: `تم تعيين ${p.trainerName} لـ ${result.count} جلسة.`,
      results: [],
    };
  },
};

// BULK_GENERATE_CERTIFICATES — generate certs for N sessions
interface BulkGenCertsInput { sessionIds: string[]; }
const bulkGenerateCerts: ActionHandler<BulkGenCertsInput> = {
  type: "BULK_GENERATE_CERTIFICATES",
  category: "WORKFLOW",
  description: "Generate certificates for eligible trainees across N sessions (single transaction).",
  descriptionAr: "إنشاء شهادات للمتدربين المؤهلين عبر N جلسات (معاملة واحدة).",
  resolvePermission: () => ({ module: "certificates", action: "create" }),
  async preparePreview(input, _user) {
    if (!input.sessionIds || input.sessionIds.length === 0) {
      throw new ActionError("sessionIds[] is required", 422, "VALIDATION_ERROR");
    }
    if (input.sessionIds.length > 50) throw new ActionError("Maximum 50 sessions per bulk cert operation", 422, "TOO_MANY");
    const sessions = await db.trainingSession.findMany({
      where: { id: { in: input.sessionIds }, deletedAt: null },
      select: { id: true, refNumber: true, title: true, courseId: true },
    });
    if (sessions.length === 0) throw new ActionError("No sessions found", 404, "NOT_FOUND");
    return {
      actionType: "BULK_GENERATE_CERTIFICATES",
      title: "Bulk Generate Certificates",
      titleAr: "إنشاء جماعي للشهادات",
      summary: `Generate certificates for eligible trainees in ${sessions.length} session(s).`,
      summaryAr: `إنشاء شهادات للمتدربين المؤهلين في ${sessions.length} جلسة.`,
      affectedRecords: sessions.slice(0, 20).map((s) => ({ entity: "SESSION", refNumber: s.refNumber, description: s.title })),
      changes: [{ field: "sessions", label: "Sessions", oldValue: 0, newValue: sessions.length }],
      warnings: [],
      expectedResult: `Certificates will be generated for all eligible PRESENT + PASSED trainees.`,
      expectedResultAr: `سيتم إنشاء الشهادات لجميع المتدربين الحاضرين والناجحين المؤهلين.`,
      hydratedParams: { sessionIds: sessions.map((s) => s.id) },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const sessionIds = p.sessionIds as string[];
    let totalGenerated = 0;
    const perSessionResults: { sessionRef: string; generated: number }[] = [];
    await db.$transaction(async (tx) => {
      for (const sid of sessionIds) {
        const session = await tx.trainingSession.findFirst({
          where: { id: sid, deletedAt: null },
          include: {
            course: { select: { id: true, title: true, validityMonths: true, passScore: true } },
          },
        });
        if (!session) continue;
        const present = await tx.attendance.findMany({
          where: { sessionId: sid, status: "PRESENT", deletedAt: null },
        });
        let sessionGenerated = 0;
        for (const att of present) {
          const existing = await tx.certificate.findFirst({
            where: { sessionId: sid, traineeName: att.traineeName, deletedAt: null },
          });
          if (existing) continue;
          const finalAttempt = await tx.examAttempt.findFirst({
            where: { sessionId: sid, testType: "FINAL_TEST", traineeName: att.traineeName, status: "GRADED", passed: true, deletedAt: null },
            orderBy: { submittedAt: "desc" },
          });
          if (!finalAttempt) continue;
          const refNumber = await nextRefNumber("CERTIFICATE", tx);
          const validUntil = new Date();
          validUntil.setMonth(validUntil.getMonth() + session.course.validityMonths);
          await tx.certificate.create({
            data: {
              refNumber,
              sessionId: sid,
              courseId: session.courseId,
              companyId: att.companyId ?? null,
              attendanceId: att.id,
              traineeName: att.traineeName,
              traineeIdNational: att.traineeIdNational ?? null,
              traineeEmail: att.traineeEmail ?? null,
              finalScore: finalAttempt.scorePercent ?? 0,
              validUntil,
              status: "VALID",
              verificationToken: randomBytes(12).toString("hex"),
              createdBy: user.id,
              updatedBy: user.id,
            },
          });
          sessionGenerated++; totalGenerated++;
        }
        perSessionResults.push({ sessionRef: session.refNumber, generated: sessionGenerated });
      }
    });
    await copilotAudit({
      user,
      action: "CERTIFICATE_GENERATE",
      entity: "CERTIFICATE",
      description: `AI bulk-generated ${totalGenerated} certificates across ${perSessionResults.length} sessions`,
      descriptionAr: `أنشأ الذكاء الاصطناعي جماعياً ${totalGenerated} شهادة عبر ${perSessionResults.length} جلسة`,
      req,
      newValue: { total: totalGenerated, perSession: truncateForAudit(perSessionResults) },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "BULK_GENERATE_CERTIFICATES",
      message: `${totalGenerated} certificate(s) generated across ${perSessionResults.length} session(s).`,
      messageAr: `تم إنشاء ${totalGenerated} شهادة عبر ${perSessionResults.length} جلسة.`,
      results: perSessionResults.map((r) => ({ entity: "CERTIFICATE", refNumber: r.sessionRef, description: `${r.generated} cert(s)` })),
    };
  },
};

// BULK_SEND_INVOICES — send all DRAFT invoices
interface BulkSendInvoicesInput { invoiceIds?: string[]; companyId?: string; }
const bulkSendInvoices: ActionHandler<BulkSendInvoicesInput> = {
  type: "BULK_SEND_INVOICES",
  category: "WORKFLOW",
  description: "Send (issue) all DRAFT invoices — optionally filtered by company. Notifies each contractor.",
  descriptionAr: "إرسال (إصدار) جميع الفواتير المسودة — اختيارياً مفلترة بالشركة. يُشعر كل مقاول.",
  resolvePermission: () => ({ module: "invoices", action: "edit" }),
  async preparePreview(input, _user) {
    const where: Record<string, unknown> = { status: "DRAFT", deletedAt: null };
    if (input.invoiceIds && input.invoiceIds.length > 0) where.id = { in: input.invoiceIds };
    if (input.companyId) where.companyId = input.companyId;
    const invoices = await db.invoice.findMany({
      where,
      include: { company: { select: { name: true, refNumber: true } } },
      take: 200,
    });
    if (invoices.length === 0) throw new ActionError("No DRAFT invoices found matching criteria", 400, "NO_INVOICES");
    return {
      actionType: "BULK_SEND_INVOICES",
      title: "Bulk Send Invoices",
      titleAr: "إرسال جماعي للفواتير",
      summary: `Issue ${invoices.length} DRAFT invoice(s) to contractors.`,
      summaryAr: `إصدار ${invoices.length} فاتورة مسودة للمقاولين.`,
      affectedRecords: invoices.slice(0, 20).map((inv) => ({ entity: "INVOICE", refNumber: inv.refNumber, description: `${inv.company.name} — ${inv.grandTotal.toFixed(2)} ${inv.currency}` })),
      changes: [
        { field: "count", label: "Invoices", oldValue: 0, newValue: invoices.length },
        { field: "status", label: "Status", oldValue: "DRAFT", newValue: "PENDING_PAYMENT" },
      ],
      warnings: [],
      expectedResult: `${invoices.length} invoice(s) will transition DRAFT → PENDING_PAYMENT.`,
      expectedResultAr: `ستنتقل ${invoices.length} فاتورة من مسودة إلى بانتظار الدفع.`,
      hydratedParams: { invoiceIds: invoices.map((i) => i.id) },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const invoiceIds = p.invoiceIds as string[];
    const result = await db.invoice.updateMany({
      where: { id: { in: invoiceIds }, status: "DRAFT" },
      data: { status: "PENDING_PAYMENT", issueDate: new Date(), updatedBy: user.id },
    });
    // Notify contractors (best-effort)
    const invoices = await db.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, refNumber: true, companyId: true, grandTotal: true, currency: true } });
    const byCompany = new Map<string, string[]>();
    for (const inv of invoices) {
      const arr = byCompany.get(inv.companyId) ?? [];
      arr.push(inv.refNumber);
      byCompany.set(inv.companyId, arr);
    }
    let notified = 0;
    for (const [companyId, refs] of byCompany) {
      const contractorUsers = await db.user.findMany({
        where: { companyId, role: "CONTRACTOR", deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (contractorUsers.length > 0) {
        await db.notification.createMany({
          data: contractorUsers.map((u) => ({
            userId: u.id,
            title: `${refs.length} invoice(s) issued`,
            titleAr: `تم إصدار ${refs.length} فاتورة`,
            message: `Invoices: ${refs.join(", ")}`,
            messageAr: `الفواتير: ${refs.join("، ")}`,
            type: "INFO", category: "SYSTEM",
            channels: JSON.stringify(["in_app", "email"]),
            emailSentAt: new Date(),
          })),
        });
        notified += contractorUsers.length;
      }
    }
    await copilotAudit({
      user,
      action: "ISSUE",
      entity: "COMPANY",
      description: `AI bulk-sent ${result.count} invoices (${notified} contractors notified)`,
      descriptionAr: `أرسل الذكاء الاصطناعي جماعياً ${result.count} فاتورة (${notified} مقاول مُشعَر)`,
      req,
      newValue: { count: result.count, notified },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "BULK_SEND_INVOICES",
      message: `${result.count} invoice(s) sent. ${notified} contractor(s) notified.`,
      messageAr: `تم إرسال ${result.count} فاتورة. ${notified} مقاول مُشعَر.`,
      results: [],
    };
  },
};

// BULK_APPROVE_PAYMENTS — approve N pending payments
interface BulkApprovePaymentsInput { paymentIds: string[]; }
const bulkApprovePayments: ActionHandler<BulkApprovePaymentsInput> = {
  type: "BULK_APPROVE_PAYMENTS",
  category: "WORKFLOW",
  description: "Approve multiple PENDING payments in a single transaction. Each approval applies amount to its invoice + auto-generates receipt if invoice becomes PAID.",
  descriptionAr: "اعتماد عدة دفعات بانتظار في معاملة واحدة. كل اعتماد يطبق المبلغ على فاتورته + إنشاء إيصال تلقائي إذا اكتمل الدفع.",
  resolvePermission: () => ({ module: "payments", action: "edit" }),
  async preparePreview(input, _user) {
    if (!input.paymentIds || input.paymentIds.length === 0) {
      throw new ActionError("paymentIds[] is required", 422, "VALIDATION_ERROR");
    }
    if (input.paymentIds.length > 100) throw new ActionError("Maximum 100 payments per bulk approval", 422, "TOO_MANY");
    const payments = await db.payment.findMany({
      where: { id: { in: input.paymentIds }, status: "PENDING", deletedAt: null },
      include: { invoice: { select: { refNumber: true, outstandingBalance: true, grandTotal: true, paidAmount: true } }, company: { select: { name: true } } },
    });
    if (payments.length === 0) throw new ActionError("No PENDING payments found", 400, "NO_PAYMENTS");
    return {
      actionType: "BULK_APPROVE_PAYMENTS",
      title: "Bulk Approve Payments",
      titleAr: "اعتماد جماعي للدفعات",
      summary: `Approve ${payments.length} PENDING payment(s) totaling ${payments.reduce((s, p) => s + p.amount, 0).toFixed(2)} ${payments[0].currency}.`,
      summaryAr: `اعتماد ${payments.length} دفعة بانتظار بإجمالي ${payments.reduce((s, p) => s + p.amount, 0).toFixed(2)} ${payments[0].currency}.`,
      affectedRecords: payments.slice(0, 20).map((p) => ({ entity: "PAYMENT", refNumber: p.refNumber, description: `${p.amount.toFixed(2)} ${p.currency} → ${p.invoice?.refNumber}` })),
      changes: [
        { field: "count", label: "Payments", oldValue: 0, newValue: payments.length },
        { field: "total", label: "Total Amount", oldValue: 0, newValue: payments.reduce((s, p) => s + p.amount, 0) },
      ],
      warnings: [],
      expectedResult: `${payments.length} payment(s) will be approved. Invoices updated; receipts auto-generated for fully-paid ones.`,
      expectedResultAr: `سيتم اعتماد ${payments.length} دفعة. تحديث الفواتير؛ إنشاء إيصالات تلقائياً للمدفوعة بالكامل.`,
      hydratedParams: { paymentIds: payments.map((p) => p.id) },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const paymentIds = p.paymentIds as string[];
    let approvedCount = 0;
    let receiptCount = 0;
    await db.$transaction(async (tx) => {
      const payments = await tx.payment.findMany({
        where: { id: { in: paymentIds }, status: "PENDING", deletedAt: null },
        include: { invoice: true },
      });
      for (const payment of payments) {
        if (!payment.invoice) continue;
        const newPaid = payment.invoice.paidAmount + payment.amount;
        const newOutstanding = Math.max(0, payment.invoice.grandTotal - newPaid);
        const newStatus = newOutstanding <= 0.01 ? "PAID" : "PARTIALLY_PAID";
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "PAID", paymentDate: new Date(), updatedBy: user.id },
        });
        await tx.invoice.update({
          where: { id: payment.invoice.id },
          data: {
            paidAmount: newPaid,
            outstandingBalance: newOutstanding,
            status: newStatus,
            paidDate: newStatus === "PAID" ? new Date() : null,
            updatedBy: user.id,
          },
        });
        if (newStatus === "PAID") {
          const refNumber = await nextRefNumber("RECEIPT", tx);
          await tx.receipt.create({
            data: {
              refNumber,
              paymentId: payment.id,
              invoiceId: payment.invoice.id,
              companyId: payment.companyId,
              amount: payment.amount,
              currency: payment.currency,
              receiptDate: new Date(),
              paymentMethod: payment.method,
              paidBy: payment.paidBy,
              referenceNumber: payment.referenceNumber,
              status: "ISSUED",
              createdBy: user.id,
              updatedBy: user.id,
            },
          });
          receiptCount++;
        }
        approvedCount++;
      }
    });
    await copilotAudit({
      user,
      action: "APPROVE",
      entity: "COMPANY",
      description: `AI bulk-approved ${approvedCount} payments (${receiptCount} receipts auto-generated)`,
      descriptionAr: `اعتمد الذكاء الاصطناعي جماعياً ${approvedCount} دفعة (${receiptCount} إيصال منشأ تلقائياً)`,
      req,
      newValue: { approved: approvedCount, receipts: receiptCount },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "BULK_APPROVE_PAYMENTS",
      message: `${approvedCount} payment(s) approved. ${receiptCount} receipt(s) auto-generated.`,
      messageAr: `تم اعتماد ${approvedCount} دفعة. ${receiptCount} إيصال منشأ تلقائياً.`,
      results: [],
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// SMART SUGGESTIONS — these return analysis, not mutations. They are exposed
// as actions because the LLM may invoke them when the user asks "what should
// I do?" — they produce read-only suggestions.
// ═══════════════════════════════════════════════════════════════════════════

interface SuggestTrainerInput { courseId: string; startDate: string; endDate: string; }
const suggestBestTrainer: ActionHandler<SuggestTrainerInput> = {
  type: "SUGGEST_BEST_TRAINER",
  category: "WORKFLOW",
  description: "Suggest the best available trainer for a course+date range (certified + no scheduling conflict + fewest prior sessions).",
  descriptionAr: "اقتراح أفضل مدرب متاح لدورة+فترة (معتمد + لا تضارب + الأقل ارتباطاً).",
  resolvePermission: () => ({ module: "trainers", action: "view" }),
  async preparePreview(input, _user) {
    if (!input.courseId || !input.startDate || !input.endDate) {
      throw new ActionError("courseId, startDate, endDate are required", 422, "VALIDATION_ERROR");
    }
    const course = await db.course.findFirst({ where: { id: input.courseId, deletedAt: null } });
    if (!course) throw new ActionError("Course not found", 404, "NOT_FOUND");
    const start = new Date(input.startDate); const end = new Date(input.endDate);
    // Find certified trainers
    const certs = await db.trainerCertification.findMany({
      where: { courseId: course.id, deletedAt: null, status: "VALID", OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }] },
      include: { trainer: { select: { id: true, refNumber: true, nameEn: true, status: true, deletedAt: true } } },
    });
    const candidates: Array<{ trainerId: string; trainerRef: string; trainerName: string; conflictCount: number; priorSessions: number }> = [];
    for (const c of certs) {
      if (!c.trainer || c.trainer.deletedAt || c.trainer.status !== "ACTIVE") continue;
      const conflicts = await db.trainingSession.count({
        where: { trainerId: c.trainer.id, deletedAt: null, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, startDate: { lt: end }, endDate: { gt: start } },
      });
      const priorSessions = await db.trainingSession.count({
        where: { trainerId: c.trainer.id, deletedAt: null, courseId: course.id },
      });
      candidates.push({ trainerId: c.trainer.id, trainerRef: c.trainer.refNumber, trainerName: c.trainer.nameEn, conflictCount: conflicts, priorSessions });
    }
    candidates.sort((a, b) => a.conflictCount - b.conflictCount || a.priorSessions - b.priorSessions);
    const top = candidates.slice(0, 5);
    return {
      actionType: "SUGGEST_BEST_TRAINER",
      title: "Best Trainer Suggestion",
      titleAr: "اقتراح أفضل مدرب",
      summary: `Found ${candidates.length} certified trainer(s) for "${course.title}". Top pick: ${top[0]?.trainerName ?? "none"} (${top[0]?.conflictCount ?? 0} conflicts).`,
      summaryAr: `وُجد ${candidates.length} مدرب معتمد لـ "${course.title}". الأفضل: ${top[0]?.trainerName ?? "لا يوجد"} (${top[0]?.conflictCount ?? 0} تضارب).`,
      affectedRecords: top.map((t) => ({ entity: "TRAINER", refNumber: t.trainerRef, description: `${t.trainerName} — ${t.conflictCount} conflicts, ${t.priorSessions} prior` })),
      changes: [],
      warnings: candidates.length === 0 ? [{ level: "warning", message: "No certified trainers found for this course.", messageAr: "لا يوجد مدربون معتمدون لهذه الدورة." }] : [],
      expectedResult: `Suggestion returned. Use TRAINER_ASSIGN to assign the chosen trainer.`,
      expectedResultAr: `تم إرجاع الاقتراح. استخدم تعيين المدرب لتعيين المدرب المختار.`,
      hydratedParams: { courseId: course.id, suggestions: top },
    };
  },
  async execute(preview, user, req) {
    await copilotAudit({
      user,
      action: "EXPORT",
      entity: "TRAINER",
      description: `AI suggested trainers for course ${preview.hydratedParams.courseId}`,
      descriptionAr: `اقترح الذكاء الاصطناعي مدربين لدورة`,
      req,
      newValue: { suggestions: preview.hydratedParams.suggestions },
      copilotActionType: preview.actionType,
    });
    const suggestions = preview.hydratedParams.suggestions as Array<{ trainerId: string; trainerRef: string; trainerName: string; conflictCount: number; priorSessions: number }>;
    return {
      success: true,
      actionType: "SUGGEST_BEST_TRAINER",
      message: `Top ${suggestions.length} trainer(s): ${suggestions.map((s) => `${s.trainerName} (${s.conflictCount} conflicts)`).join(", ")}`,
      messageAr: `أفضل ${suggestions.length} مدرب: ${suggestions.map((s) => s.trainerName).join("، ")}`,
      results: suggestions.map((s) => ({ entity: "TRAINER", refNumber: s.trainerRef, description: `${s.trainerName} — ${s.conflictCount} conflicts, ${s.priorSessions} prior sessions` })),
    };
  },
};

interface SuggestCapacityWarningsInput { daysAhead?: number; }
const suggestCapacityWarnings: ActionHandler<SuggestCapacityWarningsInput> = {
  type: "SUGGEST_CAPACITY_WARNINGS",
  category: "WORKFLOW",
  description: "Surface all sessions where enrolled trainees exceed capacity (next N days).",
  descriptionAr: "كشف جميع الجلسات التي يتجاوز فيها المسجلون الطاقة (خلال N أيام).",
  resolvePermission: () => ({ module: "sessions", action: "view" }),
  async preparePreview(input, _user) {
    const daysAhead = input.daysAhead ?? 30;
    const cutoff = new Date(Date.now() + daysAhead * 86400000);
    const sessions = await db.trainingSession.findMany({
      where: { deletedAt: null, status: "SCHEDULED", startDate: { gte: new Date(), lte: cutoff } },
      select: { id: true, refNumber: true, title: true, capacity: true, expectedTrainees: true, startDate: true },
    });
    const overCapacity = sessions.filter((s) => s.expectedTrainees > s.capacity);
    return {
      actionType: "SUGGEST_CAPACITY_WARNINGS",
      title: "Capacity Warnings",
      titleAr: "تحذيرات الطاقة",
      summary: `Found ${overCapacity.length} session(s) over capacity in the next ${daysAhead} days.`,
      summaryAr: `وُجد ${overCapacity.length} جلسة تتجاوز الطاقة خلال ${daysAhead} أيام.`,
      affectedRecords: overCapacity.slice(0, 20).map((s) => ({ entity: "SESSION", refNumber: s.refNumber, description: `${s.title}: ${s.expectedTrainees}/${s.capacity} (${s.startDate.toLocaleDateString()})` })),
      changes: [],
      warnings: overCapacity.map((s) => ({ level: "warning" as const, message: `${s.refNumber}: ${s.expectedTrainees}/${s.capacity}` })),
      expectedResult: `Use SESSION_SPLIT to break over-capacity sessions into smaller ones.`,
      expectedResultAr: `استخدم تقسيم الجلسة لتقسيم الجلسات المكتظة.`,
      hydratedParams: { sessions: overCapacity.map((s) => ({ id: s.id, refNumber: s.refNumber, title: s.title, capacity: s.capacity, expected: s.expectedTrainees })) },
    };
  },
  async execute(preview, user, req) {
    await copilotAudit({
      user, action: "EXPORT", entity: "SESSION",
      description: `AI surfaced capacity warnings`,
      descriptionAr: `كشف الذكاء الاصطناعي تحذيرات الطاقة`,
      req,
      newValue: { count: (preview.hydratedParams.sessions as unknown[]).length },
      copilotActionType: preview.actionType,
    });
    const sessions = preview.hydratedParams.sessions as Array<{ refNumber: string; title: string; capacity: number; expected: number }>;
    return {
      success: true, actionType: "SUGGEST_CAPACITY_WARNINGS",
      message: `${sessions.length} over-capacity session(s) found.`,
      messageAr: `وُجد ${sessions.length} جلسة تتجاوز الطاقة.`,
      results: sessions.map((s) => ({ entity: "SESSION", refNumber: s.refNumber, description: `${s.title}: ${s.expected}/${s.capacity}` })),
    };
  },
};

type SuggestFinancialWarningsInput = Record<string, never>;
const suggestFinancialWarnings: ActionHandler<SuggestFinancialWarningsInput> = {
  type: "SUGGEST_FINANCIAL_WARNINGS",
  category: "WORKFLOW",
  description: "Surface overdue invoices and payments pending approval for >7 days.",
  descriptionAr: "كشف الفواتير المتأخرة والدفعات بانتظار الاعتماد لأكثر من 7 أيام.",
  resolvePermission: () => ({ module: "invoices", action: "view" }),
  async preparePreview(_input, _user) {
    const now = new Date();
    const overdueInvoices = await db.invoice.findMany({
      where: { deletedAt: null, status: "OVERDUE", dueDate: { lt: now } },
      select: { id: true, refNumber: true, grandTotal: true, outstandingBalance: true, currency: true, dueDate: true, company: { select: { name: true } } },
      take: 50,
    });
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const stalePayments = await db.payment.findMany({
      where: { deletedAt: null, status: "PENDING", createdAt: { lt: sevenDaysAgo } },
      select: { id: true, refNumber: true, amount: true, currency: true, createdAt: true, company: { select: { name: true } } },
      take: 50,
    });
    return {
      actionType: "SUGGEST_FINANCIAL_WARNINGS",
      title: "Financial Warnings",
      titleAr: "تحذيرات مالية",
      summary: `Found ${overdueInvoices.length} overdue invoice(s) and ${stalePayments.length} stale payment(s) (>7 days pending).`,
      summaryAr: `وُجد ${overdueInvoices.length} فاتورة متأخرة و${stalePayments.length} دفعة قديمة (>7 أيام بانتظار).`,
      affectedRecords: [
        ...overdueInvoices.slice(0, 10).map((i) => ({ entity: "INVOICE", refNumber: i.refNumber, description: `${i.company.name}: ${i.outstandingBalance.toFixed(2)} ${i.currency} (due ${i.dueDate?.toLocaleDateString()})` })),
        ...stalePayments.slice(0, 10).map((p) => ({ entity: "PAYMENT", refNumber: p.refNumber, description: `${p.company.name}: ${p.amount.toFixed(2)} ${p.currency} (since ${p.createdAt.toLocaleDateString()})` })),
      ],
      changes: [],
      warnings: [
        ...(overdueInvoices.length > 0 ? [{ level: "warning" as const, message: `${overdueInvoices.length} overdue invoice(s)`, messageAr: `${overdueInvoices.length} فاتورة متأخرة` }] : []),
        ...(stalePayments.length > 0 ? [{ level: "warning" as const, message: `${stalePayments.length} stale payment(s) pending approval`, messageAr: `${stalePayments.length} دفعة قديمة بانتظار الاعتماد` }] : []),
      ],
      expectedResult: `Use FINANCIAL_APPROVE_PAYMENT to approve pending payments, or send reminders to contractors with overdue invoices.`,
      expectedResultAr: `استخدم اعتماد الدفعة لاعتماد الدفعات، أو أرسل تذكيرات للمقاولين بالفواتير المتأخرة.`,
      hydratedParams: {
        overdueInvoices: overdueInvoices.map((i) => ({ refNumber: i.refNumber, companyName: i.company.name, outstanding: i.outstandingBalance, currency: i.currency })),
        stalePayments: stalePayments.map((p) => ({ refNumber: p.refNumber, companyName: p.company.name, amount: p.amount, currency: p.currency })),
      },
    };
  },
  async execute(preview, user, req) {
    await copilotAudit({
      user, action: "EXPORT", entity: "COMPANY",
      description: `AI surfaced financial warnings`,
      descriptionAr: `كشف الذكاء الاصطناعي تحذيرات مالية`,
      req,
      newValue: {
        overdueCount: (preview.hydratedParams.overdueInvoices as unknown[]).length,
        staleCount: (preview.hydratedParams.stalePayments as unknown[]).length,
      },
      copilotActionType: preview.actionType,
    });
    return {
      success: true, actionType: "SUGGEST_FINANCIAL_WARNINGS",
      message: `${(preview.hydratedParams.overdueInvoices as unknown[]).length} overdue invoice(s), ${(preview.hydratedParams.stalePayments as unknown[]).length} stale payment(s).`,
      messageAr: `${(preview.hydratedParams.overdueInvoices as unknown[]).length} فاتورة متأخرة، ${(preview.hydratedParams.stalePayments as unknown[]).length} دفعة قديمة.`,
      results: [
        ...(preview.hydratedParams.overdueInvoices as Array<{ refNumber: string; companyName: string; outstanding: number; currency: string }>).slice(0, 20).map((i) => ({ entity: "INVOICE", refNumber: i.refNumber, description: `${i.companyName}: ${i.outstanding.toFixed(2)} ${i.currency}` })),
        ...(preview.hydratedParams.stalePayments as Array<{ refNumber: string; companyName: string; amount: number; currency: string }>).slice(0, 20).map((p) => ({ entity: "PAYMENT", refNumber: p.refNumber, description: `${p.companyName}: ${p.amount.toFixed(2)} ${p.currency}` })),
      ],
    };
  },
};

interface SuggestCertExpiryInput { daysAhead?: number; }
const suggestCertExpiry: ActionHandler<SuggestCertExpiryInput> = {
  type: "SUGGEST_CERTIFICATE_EXPIRY",
  category: "WORKFLOW",
  description: "Surface certificates expiring in the next N days (default 30).",
  descriptionAr: "كشف الشهادات المنتهية خلال N أيام (افتراضي 30).",
  resolvePermission: () => ({ module: "certificates", action: "view" }),
  async preparePreview(input, _user) {
    const daysAhead = input.daysAhead ?? 30;
    const from = new Date(); const to = new Date(Date.now() + daysAhead * 86400000);
    const certs = await db.certificate.findMany({
      where: { deletedAt: null, status: "VALID", validUntil: { gte: from, lte: to } },
      select: { id: true, refNumber: true, traineeName: true, validUntil: true, course: { select: { title: true } } },
      orderBy: { validUntil: "asc" },
      take: 100,
    });
    return {
      actionType: "SUGGEST_CERTIFICATE_EXPIRY",
      title: "Certificate Expiry",
      titleAr: "انتهاء الشهادات",
      summary: `Found ${certs.length} certificate(s) expiring in the next ${daysAhead} days.`,
      summaryAr: `وُجد ${certs.length} شهادة تنتهي خلال ${daysAhead} أيام.`,
      affectedRecords: certs.slice(0, 20).map((c) => ({ entity: "CERTIFICATE", refNumber: c.refNumber, description: `${c.traineeName} — ${c.course.title} (expires ${c.validUntil.toLocaleDateString()})` })),
      changes: [],
      warnings: certs.length > 0 ? [{ level: "warning" as const, message: `${certs.length} certificates expiring soon — notify trainees to schedule renewal.`, messageAr: `${certs.length} شهادة تنتهي قريباً — أَشعِر المتدربين لجدولة التجديد.` }] : [],
      expectedResult: `Suggestion returned. Use NOTIFICATION_SEND_REMINDER to notify affected trainees.`,
      expectedResultAr: `تم إرجاع الاقتراح. استخدم إرسال التذكير لإشعار المتدربين المتأثرين.`,
      hydratedParams: { certs: certs.map((c) => ({ refNumber: c.refNumber, traineeName: c.traineeName, courseTitle: c.course.title, validUntil: c.validUntil.toISOString() })) },
    };
  },
  async execute(preview, user, req) {
    await copilotAudit({
      user, action: "EXPORT", entity: "CERTIFICATE",
      description: `AI surfaced ${((preview.hydratedParams.certs as unknown[]).length)} expiring certificates`,
      descriptionAr: `كشف الذكاء الاصطناعي ${((preview.hydratedParams.certs as unknown[]).length)} شهادة منتهية`,
      req,
      copilotActionType: preview.actionType,
    });
    const certs = preview.hydratedParams.certs as Array<{ refNumber: string; traineeName: string; courseTitle: string; validUntil: string }>;
    return {
      success: true, actionType: "SUGGEST_CERTIFICATE_EXPIRY",
      message: `${certs.length} certificate(s) expiring.`,
      messageAr: `${certs.length} شهادة تنتهي.`,
      results: certs.slice(0, 50).map((c) => ({ entity: "CERTIFICATE", refNumber: c.refNumber, description: `${c.traineeName} — ${c.courseTitle} (${new Date(c.validUntil).toLocaleDateString()})` })),
    };
  },
};

type SuggestScheduleConflictsInput = Record<string, never>;
const suggestScheduleConflicts: ActionHandler<SuggestScheduleConflictsInput> = {
  type: "SUGGEST_SCHEDULE_CONFLICTS",
  category: "WORKFLOW",
  description: "Surface trainers who are double-booked (assigned to 2+ overlapping sessions).",
  descriptionAr: "كشف المدربين المزدوجين (المعينين لجلسات متداخلة).",
  resolvePermission: () => ({ module: "sessions", action: "view" }),
  async preparePreview(_input, _user) {
    const sessions = await db.trainingSession.findMany({
      where: { deletedAt: null, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, trainerId: { not: null } },
      select: { id: true, refNumber: true, title: true, trainerId: true, startDate: true, endDate: true, trainer: { select: { refNumber: true, nameEn: true } } },
    });
    // Group by trainer
    const byTrainer = new Map<string, typeof sessions>();
    for (const s of sessions) {
      if (!s.trainerId) continue;
      const arr = byTrainer.get(s.trainerId) ?? [];
      arr.push(s); byTrainer.set(s.trainerId, arr);
    }
    const conflicts: Array<{ trainerRef: string; trainerName: string; session1Ref: string; session2Ref: string; overlap: string }> = [];
    for (const [_, arr] of byTrainer) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          if (arr[i].startDate < arr[j].endDate && arr[j].startDate < arr[i].endDate) {
            conflicts.push({
              trainerRef: arr[i].trainer?.refNumber ?? "?",
              trainerName: arr[i].trainer?.nameEn ?? "?",
              session1Ref: arr[i].refNumber,
              session2Ref: arr[j].refNumber,
              overlap: `${arr[i].startDate.toLocaleDateString()}–${arr[j].endDate.toLocaleDateString()}`,
            });
          }
        }
      }
    }
    return {
      actionType: "SUGGEST_SCHEDULE_CONFLICTS",
      title: "Schedule Conflicts",
      titleAr: "تضارب الجدول",
      summary: `Found ${conflicts.length} scheduling conflict(s) across ${byTrainer.size} trainer(s).`,
      summaryAr: `وُجد ${conflicts.length} تضارب جدول عبر ${byTrainer.size} مدرب.`,
      affectedRecords: conflicts.slice(0, 20).map((c) => ({ entity: "TRAINER", refNumber: c.trainerRef, description: `${c.trainerName}: ${c.session1Ref} ↔ ${c.session2Ref}` })),
      changes: [],
      warnings: conflicts.map((c) => ({ level: "danger" as const, message: `${c.trainerName} double-booked: ${c.session1Ref} + ${c.session2Ref}`, messageAr: `${c.trainerName} مزدوج: ${c.session1Ref} + ${c.session2Ref}` })),
      expectedResult: `Use TRAINER_REPLACE to resolve conflicts.`,
      expectedResultAr: `استخدم استبدال المدرب لحل التضارب.`,
      hydratedParams: { conflicts },
    };
  },
  async execute(preview, user, req) {
    await copilotAudit({
      user, action: "EXPORT", entity: "TRAINER",
      description: `AI surfaced schedule conflicts`,
      descriptionAr: `كشف الذكاء الاصطناعي تضارب الجدول`,
      req,
      newValue: { count: (preview.hydratedParams.conflicts as unknown[]).length },
      copilotActionType: preview.actionType,
    });
    const conflicts = preview.hydratedParams.conflicts as Array<{ trainerRef: string; trainerName: string; session1Ref: string; session2Ref: string }>;
    return {
      success: true, actionType: "SUGGEST_SCHEDULE_CONFLICTS",
      message: `${conflicts.length} conflict(s) found.`,
      messageAr: `وُجد ${conflicts.length} تضارب.`,
      results: conflicts.slice(0, 30).map((c) => ({ entity: "TRAINER", refNumber: c.trainerRef, description: `${c.trainerName}: ${c.session1Ref} ↔ ${c.session2Ref}` })),
    };
  },
};

interface SuggestBestTimeInput { courseId: string; trainerId?: string; daysAhead?: number; }
const suggestBestTime: ActionHandler<SuggestBestTimeInput> = {
  type: "SUGGEST_BEST_TIME",
  category: "WORKFLOW",
  description: "Suggest the best time slot (next N days) avoiding trainer conflicts and minimizing schedule gaps.",
  descriptionAr: "اقتراح أفضل فتZان (خلال N أيام) لتجنب تضارب المدرب وتقليل فجوات الجدول.",
  resolvePermission: () => ({ module: "sessions", action: "view" }),
  async preparePreview(input, _user) {
    if (!input.courseId) throw new ActionError("courseId is required", 422, "VALIDATION_ERROR");
    const course = await db.course.findFirst({ where: { id: input.courseId, deletedAt: null } });
    if (!course) throw new ActionError("Course not found", 404, "NOT_FOUND");
    const daysAhead = input.daysAhead ?? 14;
    const slots: Array<{ date: Date; trainerAvailable: boolean; reason: string }> = [];
    for (let d = 1; d <= daysAhead; d++) {
      const day = new Date(); day.setDate(day.getDate() + d); day.setHours(8, 0, 0, 0);
      const dayEnd = new Date(day); dayEnd.setHours(day.getHours() + course.durationHours);
      let trainerAvailable = true; let reason = "All trainers free";
      if (input.trainerId) {
        const conflicts = await db.trainingSession.count({
          where: { trainerId: input.trainerId, deletedAt: null, startDate: { lt: dayEnd }, endDate: { gt: day } },
        });
        trainerAvailable = conflicts === 0;
        reason = trainerAvailable ? "Trainer available" : `${conflicts} conflict(s)`;
      }
      slots.push({ date: day, trainerAvailable, reason });
    }
    const recommended = slots.filter((s) => s.trainerAvailable).slice(0, 5);
    return {
      actionType: "SUGGEST_BEST_TIME",
      title: "Best Time Suggestion",
      titleAr: "اقتراح أفضل وقت",
      summary: `Top ${recommended.length} slot(s) in the next ${daysAhead} days for "${course.title}".`,
      summaryAr: `أفضل ${recommended.length} فتZان خلال ${daysAhead} أيام لـ "${course.title}".`,
      affectedRecords: recommended.map((s) => ({ entity: "SESSION", description: `${s.date.toLocaleDateString()} — ${s.reason}` })),
      changes: [],
      warnings: [],
      expectedResult: `Use SESSION_CREATE with the recommended date.`,
      expectedResultAr: `استخدم إنشاء الجلسة بالتاريخ الموصى به.`,
      hydratedParams: { courseId: course.id, recommended: recommended.map((s) => ({ date: s.date.toISOString(), reason: s.reason })) },
    };
  },
  async execute(preview, user, req) {
    await copilotAudit({
      user, action: "EXPORT", entity: "SESSION",
      description: `AI suggested time slots`,
      descriptionAr: `اقترح الذكاء الاصطناعي فترات زمنية`,
      req,
      newValue: { count: (preview.hydratedParams.recommended as unknown[]).length },
      copilotActionType: preview.actionType,
    });
    const rec = preview.hydratedParams.recommended as Array<{ date: string; reason: string }>;
    return {
      success: true, actionType: "SUGGEST_BEST_TIME",
      message: `${rec.length} slot(s) recommended: ${rec.map((s) => new Date(s.date).toLocaleDateString()).join(", ")}`,
      messageAr: `${rec.length} فتZان موصى بها.`,
      results: rec.map((s) => ({ entity: "SESSION", description: `${new Date(s.date).toLocaleDateString()} — ${s.reason}` })),
    };
  },
};

interface SuggestBestRoomInput { requiredCapacity: number; city?: string; }
const suggestBestRoom: ActionHandler<SuggestBestRoomInput> = {
  type: "SUGGEST_BEST_ROOM",
  category: "WORKFLOW",
  description: "Suggest venues (from past sessions) that match the required capacity, ranked by historical usage.",
  descriptionAr: "اقتراح قاعات (من جلسات سابقة) تطابق الطاقة المطلوبة، مرتبة حسب الاستخدام التاريخي.",
  resolvePermission: () => ({ module: "sessions", action: "view" }),
  async preparePreview(input, _user) {
    if (!input.requiredCapacity || input.requiredCapacity <= 0) {
      throw new ActionError("requiredCapacity is required", 422, "VALIDATION_ERROR");
    }
    // Aggregate venue usage from past sessions
    const sessions = await db.trainingSession.findMany({
      where: { deletedAt: null, venue: { not: null }, capacity: { gte: input.requiredCapacity }, ...(input.city ? { city: input.city } : {}) },
      select: { venue: true, city: true, capacity: true, refNumber: true },
    });
    const venueMap = new Map<string, { venue: string; city: string | null; capacity: number; usage: number }>();
    for (const s of sessions) {
      if (!s.venue) continue;
      const key = `${s.venue}|${s.city ?? ""}`;
      const entry = venueMap.get(key) ?? { venue: s.venue, city: s.city, capacity: s.capacity, usage: 0 };
      entry.usage++; venueMap.set(key, entry);
    }
    const venues = Array.from(venueMap.values()).sort((a, b) => b.usage - a.usage).slice(0, 5);
    return {
      actionType: "SUGGEST_BEST_ROOM",
      title: "Best Room Suggestion",
      titleAr: "اقتراح أفضل قاعة",
      summary: `Found ${venues.length} venue(s) with capacity ≥ ${input.requiredCapacity}${input.city ? ` in ${input.city}` : ""}.`,
      summaryAr: `وُجد ${venues.length} قاعة بطاقة ≥ ${input.requiredCapacity}${input.city ? ` في ${input.city}` : ""}.`,
      affectedRecords: venues.map((v) => ({ entity: "SESSION", description: `${v.venue}${v.city ? `, ${v.city}` : ""} — cap ${v.capacity}, used ${v.usage}×` })),
      changes: [],
      warnings: venues.length === 0 ? [{ level: "warning", message: "No matching venues in history. Consider a new venue.", messageAr: "لا قاعات مطابقة في السجل. ابحث عن قاعة جديدة." }] : [],
      expectedResult: `Use the suggested venue when creating a session.`,
      expectedResultAr: `استخدم القاعة الموصى بها عند إنشاء الجلسة.`,
      hydratedParams: { requiredCapacity: input.requiredCapacity, city: input.city ?? null, venues },
    };
  },
  async execute(preview, user, req) {
    await copilotAudit({
      user, action: "EXPORT", entity: "SESSION",
      description: `AI suggested rooms`,
      descriptionAr: `اقترح الذكاء الاصطناعي قاعات`,
      req,
      newValue: { count: (preview.hydratedParams.venues as unknown[]).length },
      copilotActionType: preview.actionType,
    });
    const venues = preview.hydratedParams.venues as Array<{ venue: string; city: string | null; capacity: number; usage: number }>;
    return {
      success: true, actionType: "SUGGEST_BEST_ROOM",
      message: `${venues.length} venue(s) suggested.`,
      messageAr: `تم اقتراح ${venues.length} قاعة.`,
      results: venues.map((v) => ({ entity: "SESSION", description: `${v.venue}${v.city ? `, ${v.city}` : ""} — cap ${v.capacity}, used ${v.usage}×` })),
    };
  },
};

export const workflowActions: ActionHandler<any>[] = [
  workflowCreateSession,
  bulkMoveTrainees, bulkAssignTrainer, bulkGenerateCerts, bulkSendInvoices, bulkApprovePayments,
  suggestBestTrainer, suggestBestTime, suggestBestRoom,
  suggestCapacityWarnings, suggestFinancialWarnings, suggestCertExpiry, suggestScheduleConflicts,
];
