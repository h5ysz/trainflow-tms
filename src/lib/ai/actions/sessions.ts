// GCCLAB AI Copilot — Phase 2 — SESSIONS actions
// =====================================================================
// create / duplicate / split / merge / assemble / move_trainees /
// change_course / change_trainer / change_dates / change_location /
// change_capacity
//
// All multi-write actions are wrapped in $transaction. Calls shared
// helpers from src/lib/sessions/session-management.ts (frozen module).
import { db } from "@/lib/db";
import { nextRefNumber } from "@/lib/api/ref-number";
import { recomputeSessionCounts, truncateForAudit, upsertEnrollment } from "@/lib/sessions/session-management";
import { validateTrainerAssignment } from "@/lib/api/trainer-assignment";
import { randomBytes } from "crypto";
import type { ActionHandler } from "./types";
import { ActionError } from "./types";
import { copilotAudit } from "./audit";
import { copilotEnroll } from "./enroll";

function genQrToken(): string {
  return randomBytes(16).toString("hex");
}

function chunk<T>(arr: T[], count: number): T[][] {
  if (count <= 0) return [arr];
  const out: T[][] = Array.from({ length: count }, () => []);
  arr.forEach((item, idx) => out[idx % count].push(item));
  return out;
}

// ─── SESSION_CREATE ───────────────────────────────────────────────────────
interface SessionCreateInput {
  courseId?: string;
  trainerId?: string;
  title?: string;
  location?: string;
  city?: string;
  region?: string;
  venue?: string;
  shift?: string;
  durationHours?: number;
  capacity?: number;
  language?: string;
  startDate?: string;
  endDate?: string;
  expectedTrainees?: number;
  notes?: string;
  instituteName?: string;
  classification?: string;
  locationMapUrl?: string;
  durationDays?: number;
  traineeIds?: string[]; // optional: auto-enroll these trainees
}
const createSession: ActionHandler<SessionCreateInput> = {
  type: "SESSION_CREATE",
  category: "SESSIONS",
  description: "Create a new training session. Optionally auto-enroll a list of trainees.",
  descriptionAr: "إنشاء جلسة تدريبية جديدة. يمكن تسجيل قائمة متدربين تلقائياً.",
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
      const trainer = await db.trainer.findFirst({ where: { id: input.trainerId, deletedAt: null } });
      if (!trainer) throw new ActionError("Trainer not found", 404, "NOT_FOUND");
      trainerName = trainer.nameEn;
      const validation = await validateTrainerAssignment({
        user, trainerId: trainer.id, courseId: course.id,
        startDate: new Date(input.startDate), endDate: new Date(input.endDate),
      });
      if (!validation.valid && validation.error) {
        throw new ActionError(
          "Trainer assignment blocked: " + validation.error,
          400, "ASSIGNMENT_BLOCKED"
        );
      }
    }
    // Validate trainee IDs
    let traineeRows: { id: string; fullName: string; companyId: string; refNumber: string }[] = [];
    if (input.traineeIds && input.traineeIds.length > 0) {
      traineeRows = await db.trainee.findMany({
        where: { id: { in: input.traineeIds }, deletedAt: null },
        select: { id: true, fullName: true, companyId: true, refNumber: true },
      });
      if (traineeRows.length !== input.traineeIds.length) {
        throw new ActionError(
          `${input.traineeIds.length - traineeRows.length} trainee(s) not found`,
          404, "TRAINEE_NOT_FOUND"
        );
      }
    }
    const capacity = input.capacity ?? course.maxTrainees;
    const warnings: { level: "info" | "warning" | "danger"; message: string; messageAr?: string }[] = [];
    if (traineeRows.length > capacity) {
      warnings.push({
        level: "warning",
        message: `${traineeRows.length} trainees requested but capacity is ${capacity}. Will enroll ${capacity} and skip the rest.`,
        messageAr: `${traineeRows.length} متدرب مطلوب لكن الطاقة ${capacity}. سيتم تسجيل ${capacity} وتخطي الباقي.`,
      });
    }
    return {
      actionType: "SESSION_CREATE",
      title: "Create Session",
      titleAr: "إنشاء الجلسة",
      summary: `Create session "${input.title}" for course ${course.title} on ${new Date(input.startDate).toLocaleDateString()}.`,
      summaryAr: `إنشاء جلسة "${input.title}" لدورة ${course.title} في ${new Date(input.startDate).toLocaleDateString()}.`,
      affectedRecords: [
        { entity: "COURSE", refNumber: course.refNumber, description: course.title },
        ...(input.trainerId ? [{ entity: "TRAINER", description: trainerName ?? "" }] : []),
        ...traineeRows.slice(0, 10).map((t) => ({ entity: "TRAINEE", refNumber: t.refNumber, description: t.fullName })),
      ],
      changes: [
        { field: "title", label: "Title", oldValue: null, newValue: input.title },
        { field: "course", label: "Course", oldValue: null, newValue: course.title },
        { field: "startDate", label: "Start Date", oldValue: null, newValue: input.startDate },
        { field: "capacity", label: "Capacity", oldValue: null, newValue: capacity },
        { field: "trainer", label: "Trainer", oldValue: null, newValue: trainerName ?? "Unassigned" },
        ...(traineeRows.length > 0 ? [{ field: "enrollments", label: "Trainees to Enroll", oldValue: null, newValue: traineeRows.length }] : []),
      ],
      warnings,
      expectedResult: `Session "${input.title}" will be created${traineeRows.length > 0 ? ` with ${traineeRows.length} trainee(s) enrolled` : ""}.`,
      expectedResultAr: `سيتم إنشاء الجلسة "${input.title}"${traineeRows.length > 0 ? ` مع تسجيل ${traineeRows.length} متدرب` : ""}.`,
      hydratedParams: {
        ...input,
        courseRef: course.refNumber,
        courseTitle: course.title,
        trainerName,
        traineeRows,
        capacity,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const refNumber = await nextRefNumber("SESSION");
    const qrToken = genQrToken();
    const course = await db.course.findFirst({ where: { id: p.courseId as string, deletedAt: null } });
    if (!course) throw new ActionError("Course no longer exists", 404, "NOT_FOUND");
    const finalDuration = (p.durationHours as number | undefined) ?? course.durationHours;

    const session = await db.$transaction(async (tx) => {
      const s = await tx.trainingSession.create({
        data: {
          refNumber,
          courseId: course.id,
          trainerId: (p.trainerId as string | undefined) ?? null,
          title: p.title as string,
          location: (p.location as string | undefined) ?? null,
          city: (p.city as string | undefined) ?? null,
          region: (p.region as string | undefined) ?? null,
          venue: (p.venue as string | undefined) ?? null,
          shift: (p.shift as string | undefined) ?? null,
          durationHours: finalDuration,
          capacity: (p.capacity as number) ?? course.maxTrainees,
          language: (p.language as string | undefined) ?? course.language,
          startDate: new Date(p.startDate as string),
          endDate: new Date(p.endDate as string),
          expectedTrainees: 0,
          actualTrainees: 0,
          status: "SCHEDULED",
          notes: (p.notes as string | undefined) ?? null,
          instituteName: (p.instituteName as string | undefined) ?? null,
          classification: (p.classification as string | undefined) ?? "COURSE",
          locationMapUrl: (p.locationMapUrl as string | undefined) ?? null,
          durationDays: (p.durationDays as number | undefined) ?? null,
          qrCodeToken: qrToken,
          qrCodeGeneratedAt: new Date(),
          createdBy: user.id,
          updatedBy: user.id,
        },
      });
      // Auto-enroll trainees
      const traineeRows = (p.traineeRows as Array<{ id: string; fullName: string; companyId: string; refNumber: string }>) ?? [];
      const capacity = (p.capacity as number) ?? course.maxTrainees;
      const toEnroll = traineeRows.slice(0, capacity);
      for (const t of toEnroll) {
        await copilotEnroll(s.id, t.id, t.companyId, user.id, { tx, enrollmentStatus: "CONFIRMED" });
      }
      await recomputeSessionCounts(s.id, tx);
      return s;
    });
    await copilotAudit({
      user,
      action: "CREATE",
      entity: "SESSION",
      entityId: session.id,
      entityRef: session.refNumber,
      description: `AI created session ${session.refNumber} (${session.title})`,
      descriptionAr: `أنشأ الذكاء الاصطناعي الجلسة ${session.refNumber} (${session.title})`,
      req,
      newValue: {
        courseId: course.id, trainerId: p.trainerId ?? null, capacity: session.capacity,
        startDate: session.startDate, enrolledCount: (p.traineeRows as unknown[])?.length ?? 0,
      },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "SESSION_CREATE",
      message: `Session ${session.refNumber} (${session.title}) created.`,
      messageAr: `تم إنشاء الجلسة ${session.refNumber} (${session.title}).`,
      results: [{ entity: "SESSION", id: session.id, refNumber: session.refNumber, description: session.title }],
    };
  },
};

// ─── SESSION_DUPLICATE ────────────────────────────────────────────────────
interface SessionDuplicateInput {
  sourceSessionId: string;
  newStartDate?: string;
  newEndDate?: string;
  newShift?: string;
  newTrainerId?: string | null;
  copyEnrollments?: boolean;
}
const duplicateSession: ActionHandler<SessionDuplicateInput> = {
  type: "SESSION_DUPLICATE",
  category: "SESSIONS",
  description: "Duplicate an existing session (optionally with new dates/shift/trainer and enrollments).",
  descriptionAr: "تكرار جلسة موجودة (اختيارياً بتواريخ/وردية/مدرب جديد والتسجيلات).",
  resolvePermission: () => ({ module: "sessions", action: "create" }),
  async preparePreview(input, _user) {
    if (!input.sourceSessionId) throw new ActionError("sourceSessionId is required", 422, "VALIDATION_ERROR");
    const source = await db.trainingSession.findFirst({
      where: { id: input.sourceSessionId, deletedAt: null },
      include: {
        course: { select: { id: true, title: true, refNumber: true, language: true, maxTrainees: true, durationHours: true } },
        enrollments: { where: { deletedAt: null, enrollmentStatus: { not: "CANCELLED" } }, select: { traineeId: true, companyId: true } },
      },
    });
    if (!source) throw new ActionError("Source session not found", 404, "NOT_FOUND");
    const newStartDate = input.newStartDate ?? source.startDate.toISOString();
    const newEndDate = input.newEndDate ?? source.endDate.toISOString();
    let newTrainerName: string | null = source.trainerId ? null : null;
    if (input.newTrainerId) {
      const trainer = await db.trainer.findFirst({ where: { id: input.newTrainerId, deletedAt: null } });
      if (!trainer) throw new ActionError("Trainer not found", 404, "NOT_FOUND");
      newTrainerName = trainer.nameEn;
    }
    return {
      actionType: "SESSION_DUPLICATE",
      title: "Duplicate Session",
      titleAr: "تكرار الجلسة",
      summary: `Duplicate ${source.refNumber} → new session on ${new Date(newStartDate).toLocaleDateString()}.`,
      summaryAr: `تكرار ${source.refNumber} → جلسة جديدة في ${new Date(newStartDate).toLocaleDateString()}.`,
      affectedRecords: [
        { entity: "SESSION", refNumber: source.refNumber, description: `Source: ${source.title}` },
        { entity: "SESSION", description: `New copy` },
      ],
      changes: [
        { field: "startDate", label: "Start Date", oldValue: source.startDate, newValue: newStartDate },
        { field: "endDate", label: "End Date", oldValue: source.endDate, newValue: newEndDate },
        { field: "shift", label: "Shift", oldValue: source.shift, newValue: input.newShift ?? source.shift },
        { field: "trainer", label: "Trainer", oldValue: source.trainerId, newValue: input.newTrainerId ?? source.trainerId },
        { field: "copyEnrollments", label: "Copy Enrollments", oldValue: false, newValue: input.copyEnrollments ?? false },
      ],
      warnings: input.copyEnrollments ? [{
        level: "info",
        message: `${source.enrollments.length} enrollment(s) will be copied.`,
        messageAr: `سيتم نسخ ${source.enrollments.length} تسجيل.`,
      }] : [],
      expectedResult: `A new session will be created as a duplicate of ${source.refNumber}.`,
      expectedResultAr: `سيتم إنشاء جلسة جديدة كنسخة من ${source.refNumber}.`,
      hydratedParams: {
        sourceId: source.id, sourceRef: source.refNumber,
        courseId: source.courseId, courseRef: source.course.refNumber, courseTitle: source.course.title,
        title: source.title, location: source.location, city: source.city, region: source.region,
        venue: source.venue, shift: input.newShift ?? source.shift,
        capacity: source.capacity, durationHours: source.durationHours, language: source.language,
        notes: source.notes, instituteName: source.instituteName, classification: source.classification,
        locationMapUrl: source.locationMapUrl, durationDays: source.durationDays,
        newStartDate, newEndDate,
        newTrainerId: input.newTrainerId ?? source.trainerId,
        newTrainerName,
        copyEnrollments: input.copyEnrollments ?? false,
        enrollments: source.enrollments,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const refNumber = await nextRefNumber("SESSION");
    const qrToken = genQrToken();
    const session = await db.$transaction(async (tx) => {
      const s = await tx.trainingSession.create({
        data: {
          refNumber,
          courseId: p.courseId as string,
          trainerId: (p.newTrainerId as string | null) ?? null,
          title: p.title as string,
          location: (p.location as string | null) ?? null,
          city: (p.city as string | null) ?? null,
          region: (p.region as string | null) ?? null,
          venue: (p.venue as string | null) ?? null,
          shift: (p.shift as string | null) ?? null,
          durationHours: p.durationHours as number,
          capacity: p.capacity as number,
          language: (p.language as string | null) ?? "en",
          startDate: new Date(p.newStartDate as string),
          endDate: new Date(p.newEndDate as string),
          expectedTrainees: 0,
          actualTrainees: 0,
          status: "SCHEDULED",
          notes: (p.notes as string | null) ?? null,
          instituteName: (p.instituteName as string | null) ?? null,
          classification: (p.classification as string) ?? "COURSE",
          locationMapUrl: (p.locationMapUrl as string | null) ?? null,
          durationDays: (p.durationDays as number | null) ?? null,
          qrCodeToken: qrToken,
          qrCodeGeneratedAt: new Date(),
          createdBy: user.id,
          updatedBy: user.id,
        },
      });
      if (p.copyEnrollments) {
        const enrollments = (p.enrollments as Array<{ traineeId: string; companyId: string }>) ?? [];
        for (const e of enrollments) {
          await upsertEnrollment(s.id, e.traineeId, e.companyId, user.id, { tx, enrollmentStatus: "CONFIRMED" });
        }
        await recomputeSessionCounts(s.id, tx);
      }
      return s;
    });
    await copilotAudit({
      user,
      action: "CREATE",
      entity: "SESSION",
      entityId: session.id,
      entityRef: session.refNumber,
      description: `AI duplicated session ${p.sourceRef} → ${session.refNumber}`,
      descriptionAr: `كرّر الذكاء الاصطناعي الجلسة ${p.sourceRef} → ${session.refNumber}`,
      req,
      newValue: { duplicatedFrom: p.sourceRef, copyEnrollments: p.copyEnrollments },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "SESSION_DUPLICATE",
      message: `Session duplicated: ${p.sourceRef} → ${session.refNumber}.`,
      messageAr: `تم تكرار الجلسة: ${p.sourceRef} → ${session.refNumber}.`,
      results: [{ entity: "SESSION", id: session.id, refNumber: session.refNumber, description: session.title }],
    };
  },
};

// ─── SESSION_SPLIT ────────────────────────────────────────────────────────
interface SplitOverride {
  shift?: string;
  startDate?: string;
  endDate?: string;
  capacity?: number;
  trainerId?: string | null;
  venue?: string;
  city?: string;
  region?: string;
  title?: string;
}
interface SessionSplitInput {
  sessionId: string;
  count: number;
  keepSource?: boolean;
  title?: string;
  splits?: SplitOverride[];
}
const splitSession: ActionHandler<SessionSplitInput> = {
  type: "SESSION_SPLIT",
  category: "SESSIONS",
  description: "Split a SCHEDULED session into N balanced sessions (round-robin distribution of trainees).",
  descriptionAr: "تقسيم جلسة مجدولة إلى N جلسات متوازنة (توزيع دائري للمتدربين).",
  resolvePermission: () => ({ module: "sessions", action: "edit" }),
  async preparePreview(input, _user) {
    if (!input.sessionId) throw new ActionError("sessionId is required", 422, "VALIDATION_ERROR");
    if (!Number.isInteger(input.count) || input.count < 2) {
      throw new ActionError("count must be an integer >= 2", 422, "VALIDATION_ERROR");
    }
    if (input.splits && input.splits.length !== input.count) {
      throw new ActionError(`splits array must have ${input.count} entries`, 422, "VALIDATION_ERROR");
    }
    const source = await db.trainingSession.findFirst({
      where: { id: input.sessionId, deletedAt: null },
      include: {
        course: { select: { id: true, title: true, refNumber: true, language: true, maxTrainees: true, durationHours: true } },
        enrollments: {
          where: { deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
          include: { trainee: { select: { id: true, companyId: true, fullName: true, refNumber: true } } },
        },
      },
    });
    if (!source) throw new ActionError("Session not found", 404, "NOT_FOUND");
    if (source.status !== "SCHEDULED") {
      throw new ActionError(`Cannot split: session status is ${source.status} (must be SCHEDULED)`, 400, "INVALID_STATUS");
    }
    const chunks = chunk(source.enrollments, input.count);
    return {
      actionType: "SESSION_SPLIT",
      title: "Split Session",
      titleAr: "تقسيم الجلسة",
      summary: `Split ${source.refNumber} into ${input.count} sessions with ${source.enrollments.length} trainees distributed (${chunks.map((c) => c.length).join(" + ")}).`,
      summaryAr: `تقسيم ${source.refNumber} إلى ${input.count} جلسات مع ${source.enrollments.length} متدرب موزع (${chunks.map((c) => c.length).join(" + ")}).`,
      affectedRecords: [
        { entity: "SESSION", refNumber: source.refNumber, description: `Source: ${source.title}` },
        ...chunks.map((_, i) => ({ entity: "SESSION", description: `Split ${i + 1}: ${chunks[i].length} trainees` })),
      ],
      changes: [
        { field: "count", label: "New Sessions", oldValue: 1, newValue: input.count },
        { field: "distribution", label: "Distribution", oldValue: source.enrollments.length, newValue: chunks.map((c) => c.length) },
        { field: "keepSource", label: "Keep Source", oldValue: null, newValue: input.keepSource ?? false },
      ],
      warnings: input.keepSource ? [] : [{
        level: "warning",
        message: `Source session ${source.refNumber} will be soft-deleted after split.`,
        messageAr: `سيتم حذف الجلسة المصدر ${source.refNumber} ناعماً بعد التقسيم.`,
      }],
      expectedResult: `${input.count} new sessions will be created.`,
      expectedResultAr: `سيتم إنشاء ${input.count} جلسات جديدة.`,
      hydratedParams: {
        sourceId: source.id, sourceRef: source.refNumber,
        course: source.course, count: input.count,
        keepSource: input.keepSource ?? false,
        titlePrefix: input.title ?? source.title,
        splits: input.splits ?? Array(input.count).fill({}),
        chunks: chunks.map((c) => c.map((e) => ({ traineeId: e.trainee.id, companyId: e.trainee.companyId, traineeRef: e.trainee.refNumber, traineeName: e.trainee.fullName }))),
        sourceFields: {
          title: source.title, location: source.location, city: source.city, region: source.region,
          venue: source.venue, shift: source.shift, capacity: source.capacity,
          durationHours: source.durationHours, language: source.language,
          notes: source.notes, instituteName: source.instituteName, classification: source.classification,
          locationMapUrl: source.locationMapUrl, durationDays: source.durationDays,
          startDate: source.startDate, endDate: source.endDate, trainerId: source.trainerId,
        },
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const created: { id: string; refNumber: string; title: string }[] = [];
    await db.$transaction(async (tx) => {
      const count = p.count as number;
      const chunks = p.chunks as Array<Array<{ traineeId: string; companyId: string; traineeRef: string; traineeName: string }>>;
      const splits = p.splits as SplitOverride[];
      const sourceFields = p.sourceFields as Record<string, unknown>;
      for (let i = 0; i < count; i++) {
        const refNumber = await nextRefNumber("SESSION", tx);
        const override = splits[i] ?? {};
        const chunk = chunks[i] ?? [];
        const s = await tx.trainingSession.create({
          data: {
            refNumber,
            courseId: (p.course as { id: string }).id,
            trainerId: override.trainerId !== undefined ? (override.trainerId ?? null) : (sourceFields.trainerId as string | null) ?? null,
            title: override.title ?? `${p.titlePrefix} - Split ${i + 1}`,
            location: sourceFields.location as string | null,
            city: override.city ?? (sourceFields.city as string | null) ?? null,
            region: override.region ?? (sourceFields.region as string | null) ?? null,
            venue: override.venue ?? (sourceFields.venue as string | null) ?? null,
            shift: (override.shift ?? sourceFields.shift ?? null) as string | null,
            durationHours: sourceFields.durationHours as number,
            capacity: override.capacity ?? (sourceFields.capacity as number),
            language: sourceFields.language as string,
            startDate: override.startDate ? new Date(override.startDate) : sourceFields.startDate as Date,
            endDate: override.endDate ? new Date(override.endDate) : sourceFields.endDate as Date,
            expectedTrainees: 0, actualTrainees: 0, status: "SCHEDULED",
            notes: sourceFields.notes as string | null,
            instituteName: sourceFields.instituteName as string | null,
            classification: sourceFields.classification as string,
            locationMapUrl: sourceFields.locationMapUrl as string | null,
            durationDays: sourceFields.durationDays as number | null,
            qrCodeToken: genQrToken(), qrCodeGeneratedAt: new Date(),
            createdBy: user.id, updatedBy: user.id,
          },
        });
        for (const e of chunk) {
          await upsertEnrollment(s.id, e.traineeId, e.companyId, user.id, { tx, enrollmentStatus: "CONFIRMED" });
        }
        await recomputeSessionCounts(s.id, tx);
        created.push({ id: s.id, refNumber: s.refNumber, title: s.title });
      }
      if (!(p.keepSource as boolean)) {
        await tx.trainingSession.update({
          where: { id: p.sourceId as string },
          data: { deletedAt: new Date(), updatedBy: user.id },
        });
      }
    });
    const truncated = truncateForAudit(created);
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: p.sourceId as string,
      entityRef: p.sourceRef as string,
      description: `AI split session ${p.sourceRef} into ${created.length} sessions`,
      descriptionAr: `قسّم الذكاء الاصطناعي الجلسة ${p.sourceRef} إلى ${created.length} جلسات`,
      req,
      oldValue: { sourceRef: p.sourceRef, keepSource: p.keepSource },
      newValue: { created: truncated },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "SESSION_SPLIT",
      message: `Session ${p.sourceRef} split into ${created.length} sessions: ${created.map((s) => s.refNumber).join(", ")}.`,
      messageAr: `تم تقسيم الجلسة ${p.sourceRef} إلى ${created.length} جلسات: ${created.map((s) => s.refNumber).join("، ")}.`,
      results: created.map((s) => ({ entity: "SESSION", id: s.id, refNumber: s.refNumber, description: s.title })),
    };
  },
};

// ─── SESSION_MERGE ────────────────────────────────────────────────────────
interface SessionMergeInput {
  sessionIds: string[];
  newTitle?: string;
  newShift?: string;
  newStartDate?: string;
  newEndDate?: string;
  newCapacity?: number;
  newTrainerId?: string | null;
  newVenue?: string;
  newCity?: string;
}
const mergeSessions: ActionHandler<SessionMergeInput> = {
  type: "SESSION_MERGE",
  category: "SESSIONS",
  description: "Merge N SCHEDULED sessions of the same course into one. Deduplicates trainees by traineeId.",
  descriptionAr: "دمج N جلسات مجدولة من نفس الدورة في جلسة واحدة. يزيل التكرار حسب معرف المتدرب.",
  resolvePermission: () => ({ module: "sessions", action: "edit" }),
  async preparePreview(input, _user) {
    if (!input.sessionIds || input.sessionIds.length < 2) {
      throw new ActionError("At least 2 sessions are required to merge", 422, "VALIDATION_ERROR");
    }
    const sessions = await db.trainingSession.findMany({
      where: { id: { in: input.sessionIds }, deletedAt: null },
      include: {
        course: { select: { id: true, title: true, refNumber: true, language: true, maxTrainees: true, durationHours: true } },
        enrollments: { where: { deletedAt: null, enrollmentStatus: { not: "CANCELLED" } }, include: { trainee: { select: { id: true, companyId: true, fullName: true, refNumber: true } } } },
      },
    });
    if (sessions.length !== input.sessionIds.length) {
      throw new ActionError(`${input.sessionIds.length - sessions.length} session(s) not found`, 404, "NOT_FOUND");
    }
    if (sessions.some((s) => s.status !== "SCHEDULED")) {
      throw new ActionError("All sessions must be in SCHEDULED status", 400, "INVALID_STATUS");
    }
    const courseIds = new Set(sessions.map((s) => s.courseId));
    if (courseIds.size > 1) throw new ActionError("All sessions must be of the same course", 400, "COURSE_MISMATCH");
    // Deduplicate trainees
    const seen = new Set<string>();
    const uniqueTrainees: { traineeId: string; companyId: string; traineeRef: string; traineeName: string }[] = [];
    for (const s of sessions) {
      for (const e of s.enrollments) {
        if (!seen.has(e.trainee.id)) {
          seen.add(e.trainee.id);
          uniqueTrainees.push({ traineeId: e.trainee.id, companyId: e.trainee.companyId, traineeRef: e.trainee.refNumber, traineeName: e.trainee.fullName });
        }
      }
    }
    const sourceCapacity = sessions.reduce((sum, s) => sum + s.capacity, 0);
    return {
      actionType: "SESSION_MERGE",
      title: "Merge Sessions",
      titleAr: "دمج الجلسات",
      summary: `Merge ${sessions.length} sessions into one. ${uniqueTrainees.length} unique trainees will be enrolled.`,
      summaryAr: `دمج ${sessions.length} جلسات في واحدة. سيتم تسجيل ${uniqueTrainees.length} متدرب فريد.`,
      affectedRecords: sessions.map((s) => ({ entity: "SESSION", refNumber: s.refNumber, description: s.title })),
      changes: [
        { field: "sessionCount", label: "Sessions", oldValue: sessions.length, newValue: 1 },
        { field: "uniqueTrainees", label: "Unique Trainees", oldValue: sessions.reduce((s, x) => s + x.enrollments.length, 0), newValue: uniqueTrainees.length },
        { field: "capacity", label: "Capacity", oldValue: sourceCapacity, newValue: input.newCapacity ?? sourceCapacity },
      ],
      warnings: [{
        level: "warning",
        message: `Source sessions (${sessions.map((s) => s.refNumber).join(", ")}) will be soft-deleted.`,
        messageAr: `سيتم حذف الجلسات المصدر (${sessions.map((s) => s.refNumber).join("، ")}) ناعماً.`,
      }],
      expectedResult: `A new merged session will be created with ${uniqueTrainees.length} trainees.`,
      expectedResultAr: `سيتم إنشاء جلسة مدمجة جديدة مع ${uniqueTrainees.length} متدرب.`,
      hydratedParams: {
        sourceIds: sessions.map((s) => s.id),
        sourceRefs: sessions.map((s) => s.refNumber),
        course: sessions[0].course,
        newTitle: input.newTitle ?? `Merged: ${sessions[0].course.title}`,
        newShift: input.newShift,
        newStartDate: input.newStartDate,
        newEndDate: input.newEndDate,
        newCapacity: input.newCapacity ?? sourceCapacity,
        newTrainerId: input.newTrainerId,
        newVenue: input.newVenue,
        newCity: input.newCity,
        uniqueTrainees,
        durationHours: sessions[0].durationHours,
        language: sessions[0].language ?? "en",
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const refNumber = await nextRefNumber("SESSION");
    const qrToken = genQrToken();
    const created = await db.$transaction(async (tx) => {
      const course = p.course as { id: string; title: string; refNumber: string; language: string; durationHours: number };
      const s = await tx.trainingSession.create({
        data: {
          refNumber,
          courseId: course.id,
          trainerId: (p.newTrainerId as string | null | undefined) ?? null,
          title: p.newTitle as string,
          location: null,
          city: (p.newCity as string | null) ?? null,
          region: null,
          venue: (p.newVenue as string | null) ?? null,
          shift: (p.newShift as string | null) ?? null,
          durationHours: p.durationHours as number,
          capacity: p.newCapacity as number,
          language: p.language as string,
          startDate: p.newStartDate ? new Date(p.newStartDate as string) : new Date(),
          endDate: p.newEndDate ? new Date(p.newEndDate as string) : new Date(Date.now() + 86400000),
          expectedTrainees: 0, actualTrainees: 0, status: "SCHEDULED",
          classification: "COURSE",
          qrCodeToken: qrToken, qrCodeGeneratedAt: new Date(),
          createdBy: user.id, updatedBy: user.id,
        },
      });
      const uniqueTrainees = (p.uniqueTrainees as Array<{ traineeId: string; companyId: string }>) ?? [];
      for (const t of uniqueTrainees) {
        await upsertEnrollment(s.id, t.traineeId, t.companyId, user.id, { tx, enrollmentStatus: "CONFIRMED" });
      }
      await recomputeSessionCounts(s.id, tx);
      // Soft-delete sources
      await tx.trainingSession.updateMany({
        where: { id: { in: p.sourceIds as string[] } },
        data: { deletedAt: new Date(), updatedBy: user.id },
      });
      return s;
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: created.id,
      entityRef: created.refNumber,
      description: `AI merged ${(p.sourceRefs as string[]).length} sessions into ${created.refNumber}`,
      descriptionAr: `دمج الذكاء الاصطناعي ${(p.sourceRefs as string[]).length} جلسات في ${created.refNumber}`,
      req,
      oldValue: { sourceRefs: truncateForAudit(p.sourceRefs as string[]) },
      newValue: { mergedRef: created.refNumber, uniqueTrainees: (p.uniqueTrainees as unknown[]).length },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "SESSION_MERGE",
      message: `Merged into ${created.refNumber} (${created.title}).`,
      messageAr: `تم الدمج في ${created.refNumber} (${created.title}).`,
      results: [{ entity: "SESSION", id: created.id, refNumber: created.refNumber, description: created.title }],
    };
  },
};

// ─── SESSION_ASSEMBLE ─────────────────────────────────────────────────────
interface SessionAssembleInput {
  courseId: string;
  traineeIds: string[];
  title?: string;
  shift?: string;
  startDate?: string;
  endDate?: string;
  capacity?: number;
  trainerId?: string;
  venue?: string;
  city?: string;
}
const assembleSessions: ActionHandler<SessionAssembleInput> = {
  type: "SESSION_ASSEMBLE",
  category: "SESSIONS",
  description: "Assemble a single session from trainees pulled from multiple sources (multi-contractor).",
  descriptionAr: "تجميع جلسة واحدة من متدربين من مصادر متعددة (مقاولين متعددين).",
  resolvePermission: () => ({ module: "sessions", action: "create" }),
  async preparePreview(input, _user) {
    if (!input.courseId || !input.traineeIds || input.traineeIds.length === 0) {
      throw new ActionError("courseId and traineeIds[] are required", 422, "VALIDATION_ERROR");
    }
    if (!input.startDate || !input.endDate) {
      throw new ActionError("startDate and endDate are required", 422, "VALIDATION_ERROR");
    }
    const course = await db.course.findFirst({ where: { id: input.courseId, deletedAt: null } });
    if (!course) throw new ActionError("Course not found", 404, "NOT_FOUND");
    const trainees = await db.trainee.findMany({
      where: { id: { in: input.traineeIds }, deletedAt: null },
      include: { company: { select: { id: true, name: true, refNumber: true } } },
    });
    if (trainees.length !== input.traineeIds.length) {
      throw new ActionError(`${input.traineeIds.length - trainees.length} trainee(s) not found`, 404, "TRAINEE_NOT_FOUND");
    }
    // Group by company
    const byCompany = new Map<string, { companyName: string; companyRef: string; count: number }>();
    for (const t of trainees) {
      const entry = byCompany.get(t.companyId) ?? { companyName: t.company.name, companyRef: t.company.refNumber, count: 0 };
      entry.count++;
      byCompany.set(t.companyId, entry);
    }
    const capacity = input.capacity ?? course.maxTrainees;
    const warnings: { level: "info" | "warning" | "danger"; message: string; messageAr?: string }[] = [];
    if (trainees.length > capacity) {
      warnings.push({
        level: "warning",
        message: `${trainees.length} trainees requested but capacity is ${capacity}. Will enroll ${capacity} and skip ${trainees.length - capacity}.`,
        messageAr: `${trainees.length} متدرب مطلوب لكن الطاقة ${capacity}. سيتم تسجيل ${capacity} وتخطي ${trainees.length - capacity}.`,
      });
    }
    return {
      actionType: "SESSION_ASSEMBLE",
      title: "Assemble Session",
      titleAr: "تجميع الجلسة",
      summary: `Assemble ${trainees.length} trainees from ${byCompany.size} contractor(s) into a new session for ${course.title}.`,
      summaryAr: `تجميع ${trainees.length} متدرب من ${byCompany.size} مقاول في جلسة جديدة لدورة ${course.title}.`,
      affectedRecords: [
        { entity: "COURSE", refNumber: course.refNumber, description: course.title },
        ...Array.from(byCompany.entries()).map(([_, v]) => ({ entity: "COMPANY", refNumber: v.companyRef, description: `${v.companyName} (${v.count} trainees)` })),
      ],
      changes: [
        { field: "course", label: "Course", oldValue: null, newValue: course.title },
        { field: "traineeCount", label: "Trainees", oldValue: 0, newValue: trainees.length },
        { field: "contractorCount", label: "Contractors", oldValue: 0, newValue: byCompany.size },
      ],
      warnings,
      expectedResult: `A new assembled session will be created with ${Math.min(trainees.length, capacity)} trainees.`,
      expectedResultAr: `سيتم إنشاء جلسة مجمعة جديدة مع ${Math.min(trainees.length, capacity)} متدرب.`,
      hydratedParams: {
        courseId: course.id, courseRef: course.refNumber, courseTitle: course.title,
        title: input.title ?? `Assembled: ${course.title}`,
        shift: input.shift, startDate: input.startDate, endDate: input.endDate,
        capacity, trainerId: input.trainerId, venue: input.venue, city: input.city,
        durationHours: course.durationHours, language: course.language,
        trainees: trainees.map((t) => ({ traineeId: t.id, companyId: t.companyId, traineeRef: t.refNumber, traineeName: t.fullName })),
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const refNumber = await nextRefNumber("SESSION");
    const qrToken = genQrToken();
    const created = await db.$transaction(async (tx) => {
      const s = await tx.trainingSession.create({
        data: {
          refNumber,
          courseId: p.courseId as string,
          trainerId: (p.trainerId as string | undefined) ?? null,
          title: p.title as string,
          location: null, city: (p.city as string | null) ?? null, region: null,
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
      const trainees = (p.trainees as Array<{ traineeId: string; companyId: string }>) ?? [];
      const capacity = p.capacity as number;
      const toEnroll = trainees.slice(0, capacity);
      for (const t of toEnroll) {
        await upsertEnrollment(s.id, t.traineeId, t.companyId, user.id, { tx, enrollmentStatus: "CONFIRMED" });
      }
      await recomputeSessionCounts(s.id, tx);
      return s;
    });
    await copilotAudit({
      user,
      action: "CREATE",
      entity: "SESSION",
      entityId: created.id,
      entityRef: created.refNumber,
      description: `AI assembled session ${created.refNumber} with ${(p.trainees as unknown[]).length} trainees`,
      descriptionAr: `جمّع الذكاء الاصطناعي الجلسة ${created.refNumber} مع ${(p.trainees as unknown[]).length} متدرب`,
      req,
      newValue: { traineeCount: (p.trainees as unknown[]).length },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "SESSION_ASSEMBLE",
      message: `Assembled session ${created.refNumber} created.`,
      messageAr: `تم إنشاء الجلسة المجمعة ${created.refNumber}.`,
      results: [{ entity: "SESSION", id: created.id, refNumber: created.refNumber, description: created.title }],
    };
  },
};

// ─── SESSION_MOVE_TRAINEES ────────────────────────────────────────────────
interface SessionMoveTraineesInput {
  fromSessionId: string;
  toSessionId: string;
  traineeIds: string[];
}
const moveTraineesBulk: ActionHandler<SessionMoveTraineesInput> = {
  type: "SESSION_MOVE_TRAINEES",
  category: "SESSIONS",
  description: "Move multiple trainees from one session to another (same course, both SCHEDULED).",
  descriptionAr: "نقل عدة متدربين من جلسة إلى أخرى (نفس الدورة، كلاهما مجدولة).",
  resolvePermission: () => ({ module: "sessions", action: "edit" }),
  async preparePreview(input, _user) {
    if (!input.fromSessionId || !input.toSessionId || !input.traineeIds || input.traineeIds.length === 0) {
      throw new ActionError("fromSessionId, toSessionId, traineeIds[] are required", 422, "VALIDATION_ERROR");
    }
    if (input.fromSessionId === input.toSessionId) {
      throw new ActionError("Source and target sessions are the same", 400, "SAME_SESSION");
    }
    const [from, to] = await Promise.all([
      db.trainingSession.findFirst({ where: { id: input.fromSessionId, deletedAt: null }, include: { course: { select: { id: true, title: true } } } }),
      db.trainingSession.findFirst({ where: { id: input.toSessionId, deletedAt: null }, include: { course: { select: { id: true, title: true } } } }),
    ]);
    if (!from || !to) throw new ActionError("Session not found", 404, "NOT_FOUND");
    if (from.courseId !== to.courseId) throw new ActionError("Sessions must be of the same course", 400, "COURSE_MISMATCH");
    if (from.status !== "SCHEDULED" || to.status !== "SCHEDULED") {
      throw new ActionError("Both sessions must be SCHEDULED", 400, "INVALID_STATUS");
    }
    const enrollments = await db.sessionEnrollment.findMany({
      where: { sessionId: from.id, traineeId: { in: input.traineeIds }, deletedAt: null },
      include: { trainee: { select: { id: true, refNumber: true, fullName: true, companyId: true } } },
    });
    if (enrollments.length === 0) throw new ActionError("No matching enrollments in source session", 400, "NOT_ENROLLED");
    // Check capacity at target
    const targetCount = await db.sessionEnrollment.count({
      where: { sessionId: to.id, deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
    });
    const warnings: { level: "info" | "warning" | "danger"; message: string; messageAr?: string }[] = [];
    if (targetCount + enrollments.length > to.capacity) {
      warnings.push({
        level: "warning",
        message: `Target has ${targetCount}/${to.capacity}. Moving ${enrollments.length} more will exceed capacity.`,
        messageAr: `الهدف به ${targetCount}/${to.capacity}. نقل ${enrollments.length} إضافي سيتجاوز الطاقة.`,
      });
    }
    return {
      actionType: "SESSION_MOVE_TRAINEES",
      title: "Move Trainees",
      titleAr: "نقل المتدربين",
      summary: `Move ${enrollments.length} trainee(s) from ${from.refNumber} to ${to.refNumber}.`,
      summaryAr: `نقل ${enrollments.length} متدرب من ${from.refNumber} إلى ${to.refNumber}.`,
      affectedRecords: [
        { entity: "SESSION", refNumber: from.refNumber, description: `From: ${from.course?.title}` },
        { entity: "SESSION", refNumber: to.refNumber, description: `To: ${to.course?.title}` },
        ...enrollments.slice(0, 10).map((e) => ({ entity: "TRAINEE", refNumber: e.trainee.refNumber, description: e.trainee.fullName })),
      ],
      changes: [
        { field: "count", label: "Trainees", oldValue: enrollments.length, newValue: 0 },
        { field: "from", label: "From Session", oldValue: from.refNumber, newValue: null },
        { field: "to", label: "To Session", oldValue: null, newValue: to.refNumber },
      ],
      warnings,
      expectedResult: `${enrollments.length} trainee(s) will be moved to ${to.refNumber}.`,
      expectedResultAr: `سيتم نقل ${enrollments.length} متدرب إلى ${to.refNumber}.`,
      hydratedParams: {
        fromSessionId: from.id, fromSessionRef: from.refNumber,
        toSessionId: to.id, toSessionRef: to.refNumber,
        enrollments: enrollments.map((e) => ({ enrollmentId: e.id, traineeId: e.trainee.id, companyId: e.trainee.companyId, traineeRef: e.trainee.refNumber, traineeName: e.trainee.fullName })),
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const enrollments = p.enrollments as Array<{ enrollmentId: string; traineeId: string; companyId: string; traineeRef: string; traineeName: string }>;
    await db.$transaction(async (tx) => {
      // Cancel all source enrollments
      await tx.sessionEnrollment.updateMany({
        where: { id: { in: enrollments.map((e) => e.enrollmentId) } },
        data: { enrollmentStatus: "CANCELLED", deletedAt: new Date(), updatedBy: user.id },
      });
      // Enroll at target (revive if exists)
      for (const e of enrollments) {
        await upsertEnrollment(p.toSessionId as string, e.traineeId, e.companyId, user.id, { tx, enrollmentStatus: "CONFIRMED" });
      }
      await Promise.all([
        recomputeSessionCounts(p.fromSessionId as string, tx),
        recomputeSessionCounts(p.toSessionId as string, tx),
      ]);
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: p.toSessionId as string,
      entityRef: p.toSessionRef as string,
      description: `AI moved ${enrollments.length} trainees from ${p.fromSessionRef} to ${p.toSessionRef}`,
      descriptionAr: `نقل الذكاء الاصطناعي ${enrollments.length} متدرب من ${p.fromSessionRef} إلى ${p.toSessionRef}`,
      req,
      oldValue: { fromSessionRef: p.fromSessionRef, count: enrollments.length },
      newValue: { toSessionRef: p.toSessionRef, count: enrollments.length },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "SESSION_MOVE_TRAINEES",
      message: `${enrollments.length} trainee(s) moved to ${p.toSessionRef}.`,
      messageAr: `تم نقل ${enrollments.length} متدرب إلى ${p.toSessionRef}.`,
      results: [],
    };
  },
};

// ─── Generic session field-update factory ─────────────────────────────────
type SessionFieldUpdateInput = {
  sessionId: string;
  // changes vary per action; defined per-handler
};

function makeSessionFieldUpdate(
  type: string,
  field: string,
  label: string,
  labelAr: string,
  extractValue: (input: Record<string, unknown>) => unknown,
  applyToDb: (input: Record<string, unknown>) => Record<string, unknown>,
  description: string,
  descriptionAr: string
): ActionHandler<SessionFieldUpdateInput & Record<string, unknown>> {
  return {
    type,
    category: "SESSIONS",
    description,
    descriptionAr,
    resolvePermission: () => ({ module: "sessions", action: "edit" }),
    async preparePreview(input, _user) {
      if (!input.sessionId) throw new ActionError("sessionId is required", 422, "VALIDATION_ERROR");
      const session = await db.trainingSession.findFirst({
        where: { id: input.sessionId, deletedAt: null },
        include: { course: { select: { id: true, title: true } } },
      });
      if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
      const newValue = extractValue(input);
      if (newValue === undefined) throw new ActionError(`New ${field} value is required`, 422, "VALIDATION_ERROR");
      const oldValue = (session as Record<string, unknown>)[field];
      return {
        actionType: type,
        title: label,
        titleAr: labelAr,
        summary: `Update ${label.toLowerCase()} on session ${session.refNumber}.`,
        summaryAr: `تحديث ${labelAr} للجلسة ${session.refNumber}.`,
        affectedRecords: [
          { entity: "SESSION", refNumber: session.refNumber, description: session.course?.title ?? session.title },
        ],
        changes: [{ field, label, oldValue, newValue }],
        warnings: [],
        expectedResult: `Session ${session.refNumber} will have its ${label.toLowerCase()} updated.`,
        expectedResultAr: `سيتم تحديث ${labelAr} للجلسة ${session.refNumber}.`,
        hydratedParams: {
          sessionId: session.id, sessionRef: session.refNumber,
          [field]: newValue, _applyData: applyToDb({ ...input, [field]: newValue }),
        },
      };
    },
    async execute(preview, user, req) {
      const p = preview.hydratedParams;
      const applyData = p._applyData as Record<string, unknown>;
      const before = await db.trainingSession.findUnique({ where: { id: p.sessionId as string } });
      if (!before) throw new ActionError("Session no longer exists", 404, "NOT_FOUND");
      const updated = await db.trainingSession.update({
        where: { id: p.sessionId as string },
        data: { ...applyData, updatedBy: user.id },
      });
      await copilotAudit({
        user,
        action: "UPDATE",
        entity: "SESSION",
        entityId: updated.id,
        entityRef: updated.refNumber,
        description: `AI updated ${field} on session ${updated.refNumber}`,
        descriptionAr: `حدّث الذكاء الاصطناعي ${labelAr} للجلسة ${updated.refNumber}`,
        req,
        oldValue: { [field]: (before as Record<string, unknown>)[field] },
        newValue: { [field]: (preview.hydratedParams as Record<string, unknown>)[field] },
        copilotActionType: type,
      });
      return {
        success: true,
        actionType: type,
        message: `${label} updated on ${updated.refNumber}.`,
        messageAr: `تم تحديث ${labelAr} للجلسة ${updated.refNumber}.`,
        results: [{ entity: "SESSION", id: updated.id, refNumber: updated.refNumber, description: updated.title }],
      };
    },
  };
}

const changeCourse = makeSessionFieldUpdate(
  "SESSION_CHANGE_COURSE", "courseId", "Course", "الدورة",
  (i) => i.courseId,
  (i) => ({ courseId: i.courseId as string }),
  "Change the course of a session.",
  "تغيير دورة الجلسة."
);

const changeTrainer = makeSessionFieldUpdate(
  "SESSION_CHANGE_TRAINER", "trainerId", "Trainer", "المدرب",
  (i) => i.trainerId,
  (i) => ({ trainerId: (i.trainerId as string | null) ?? null }),
  "Change the trainer of a session (set to null to unassign).",
  "تغيير مدرب الجلسة (null لإلغاء التعيين)."
);

const changeDates = makeSessionFieldUpdate(
  "SESSION_CHANGE_DATES", "startDate", "Dates", "التواريخ",
  (i) => ({ startDate: i.startDate, endDate: i.endDate }),
  (i) => ({
    startDate: new Date(i.startDate as string),
    endDate: new Date(i.endDate as string),
  }),
  "Change the start/end dates of a session.",
  "تغيير تواريخ بداية/نهاية الجلسة."
);

const changeLocation = makeSessionFieldUpdate(
  "SESSION_CHANGE_LOCATION", "location", "Location", "الموقع",
  (i) => ({ location: i.location, city: i.city, venue: i.venue, region: i.region }),
  (i) => ({
    location: (i.location as string | null) ?? null,
    city: (i.city as string | null) ?? null,
    venue: (i.venue as string | null) ?? null,
    region: (i.region as string | null) ?? null,
  }),
  "Change the location/city/venue/region of a session.",
  "تغيير موقع/مدينة/قاعة/منطقة الجلسة."
);

const changeCapacity = makeSessionFieldUpdate(
  "SESSION_CHANGE_CAPACITY", "capacity", "Capacity", "الطاقة",
  (i) => i.capacity,
  (i) => ({ capacity: Number(i.capacity) }),
  "Change the maximum capacity of a session.",
  "تغيير الطاقة القصوى للجلسة."
);

export const sessionActions: ActionHandler<any>[] = [
  createSession, duplicateSession, splitSession, mergeSessions, assembleSessions,
  moveTraineesBulk, changeCourse, changeTrainer, changeDates, changeLocation, changeCapacity,
];
