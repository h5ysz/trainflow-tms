// GCCLAB AI Copilot — Phase 2 — TRAINEES actions
// =====================================================================
// create / edit / move (to session) / copy / add_to_session /
// remove_from_session / register_re_exam / change_contractor
//
// All actions enforce contractor scoping (CONTRACTOR role can only operate
// on trainees in their own company).
import { db } from "@/lib/db";
import { nextRefNumber } from "@/lib/api/ref-number";
import { recomputeSessionCounts } from "@/lib/sessions/session-management";
import { copilotEnroll } from "./enroll";
import type { ActionHandler } from "./types";
import { ActionError } from "./types";
import { copilotAudit } from "./audit";

interface TraineeInput {
  fullName?: string;
  nationalId?: string;
  nationality?: string;
  jobTitle?: string;
  mobile?: string;
  email?: string;
  companyId?: string;
  status?: string;
  notes?: string;
  dateOfBirth?: string;
  idExpiry?: string;
}

function pickTraineeFields(input: TraineeInput) {
  return {
    fullName: input.fullName,
    nationalId: input.nationalId,
    nationality: input.nationality ?? null,
    jobTitle: input.jobTitle ?? null,
    mobile: input.mobile ?? null,
    email: input.email ?? null,
    companyId: input.companyId,
    status: input.status ?? "ACTIVE",
    notes: input.notes ?? null,
    dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
    idExpiry: input.idExpiry ? new Date(input.idExpiry) : null,
  };
}

// ─── TRAINEE_CREATE ───────────────────────────────────────────────────────
const createTrainee: ActionHandler<TraineeInput> = {
  type: "TRAINEE_CREATE",
  category: "TRAINEES",
  description: "Create a new trainee record (full name, national ID, company, contact).",
  descriptionAr: "إنشاء سجل متدرب جديد (الاسم الكامل، الهوية الوطنية، الشركة، الاتصال).",
  resolvePermission: () => ({ module: "trainees", action: "create" }),
  async preparePreview(input, user) {
    if (!input.fullName || !input.nationalId) {
      throw new ActionError("fullName and nationalId are required", 422, "VALIDATION_ERROR");
    }
    // Contractor scoping
    const companyId = user.role === "CONTRACTOR" && user.companyId
      ? user.companyId
      : input.companyId;
    if (!companyId) throw new ActionError("companyId is required", 422, "VALIDATION_ERROR");

    const company = await db.company.findFirst({ where: { id: companyId, deletedAt: null } });
    if (!company) throw new ActionError("Company not found", 404, "NOT_FOUND");

    const existing = await db.trainee.findFirst({
      where: { nationalId: input.nationalId, companyId, deletedAt: null },
    });
    if (existing) {
      throw new ActionError(
        `Trainee with National ID "${input.nationalId}" already exists (${existing.refNumber})`,
        400,
        "DUPLICATE_NATIONAL_ID"
      );
    }
    const fields = pickTraineeFields({ ...input, companyId });
    return {
      actionType: "TRAINEE_CREATE",
      title: "Create Trainee",
      titleAr: "إنشاء متدرب",
      summary: `Create trainee "${fields.fullName}" (ID ${fields.nationalId}) at ${company.name}.`,
      summaryAr: `إنشاء متدرب "${fields.fullName}" (هوية ${fields.nationalId}) في ${company.name}.`,
      affectedRecords: [
        { entity: "TRAINEE", description: `New trainee: ${fields.fullName}` },
        { entity: "COMPANY", refNumber: company.refNumber, description: company.name },
      ],
      changes: [
        { field: "fullName", label: "Full Name", oldValue: null, newValue: fields.fullName },
        { field: "nationalId", label: "National ID", oldValue: null, newValue: fields.nationalId },
        { field: "companyId", label: "Company", oldValue: null, newValue: company.name },
        { field: "jobTitle", label: "Job Title", oldValue: null, newValue: fields.jobTitle ?? "—" },
        { field: "mobile", label: "Mobile", oldValue: null, newValue: fields.mobile ?? "—" },
        { field: "email", label: "Email", oldValue: null, newValue: fields.email ?? "—" },
      ],
      warnings: [],
      expectedResult: `New trainee "${fields.fullName}" will appear in ${company.name}'s trainee list.`,
      expectedResultAr: `سيظهر المتدرب الجديد "${fields.fullName}" في قائمة متدربي ${company.name}.`,
      hydratedParams: { input: fields },
    };
  },
  async execute(preview, user, req) {
    const input = preview.hydratedParams.input as TraineeInput;
    const refNumber = await nextRefNumber("TRAINEE");
    const fields = pickTraineeFields(input);
    const trainee = await db.trainee.create({
      data: {
        refNumber,
        fullName: fields.fullName!,
        nationalId: fields.nationalId!,
        nationality: fields.nationality,
        jobTitle: fields.jobTitle,
        mobile: fields.mobile,
        email: fields.email,
        companyId: fields.companyId!,
        status: fields.status!,
        notes: fields.notes,
        dateOfBirth: fields.dateOfBirth,
        idExpiry: fields.idExpiry,
        createdBy: user.id,
        updatedBy: user.id,
      },
      include: { company: { select: { name: true, refNumber: true } } },
    });
    await copilotAudit({
      user,
      action: "CREATE",
      entity: "TRAINEE",
      entityId: trainee.id,
      entityRef: trainee.refNumber,
      description: `AI created trainee ${trainee.refNumber} (${trainee.fullName}) for ${trainee.company?.name}`,
      descriptionAr: `أنشأ الذكاء الاصطناعي متدرب ${trainee.refNumber} (${trainee.fullName}) لـ ${trainee.company?.name}`,
      req,
      newValue: fields,
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "TRAINEE_CREATE",
      message: `Trainee ${trainee.refNumber} (${trainee.fullName}) created.`,
      messageAr: `تم إنشاء المتدرب ${trainee.refNumber} (${trainee.fullName}).`,
      results: [{ entity: "TRAINEE", id: trainee.id, refNumber: trainee.refNumber, description: trainee.fullName }],
    };
  },
};

// ─── TRAINEE_EDIT ─────────────────────────────────────────────────────────
interface TraineeEditInput {
  traineeId: string;
  changes: Partial<TraineeInput>;
}
const editTrainee: ActionHandler<TraineeEditInput> = {
  type: "TRAINEE_EDIT",
  category: "TRAINEES",
  description: "Edit a trainee's profile (name, contact, status, ID expiry, etc.).",
  descriptionAr: "تعديل ملف المتدرب (الاسم، الاتصال، الحالة، انتهاء الهوية، إلخ).",
  resolvePermission: () => ({ module: "trainees", action: "edit" }),
  async preparePreview(input, user) {
    if (!input.traineeId) throw new ActionError("traineeId is required", 422, "VALIDATION_ERROR");
    if (!input.changes || Object.keys(input.changes).length === 0) {
      throw new ActionError("No changes provided", 422, "VALIDATION_ERROR");
    }
    const where = user.role === "CONTRACTOR" && user.companyId
      ? { id: input.traineeId, companyId: user.companyId, deletedAt: null }
      : { id: input.traineeId, deletedAt: null };
    const trainee = await db.trainee.findFirst({ where, include: { company: { select: { name: true, refNumber: true } } } });
    if (!trainee) throw new ActionError("Trainee not found", 404, "NOT_FOUND");

    const allowed: Array<keyof TraineeInput> = [
      "fullName", "nationalId", "nationality", "jobTitle", "mobile", "email",
      "status", "notes", "dateOfBirth", "idExpiry",
    ];
    // CONTRACTOR cannot change companyId
    if (user.role !== "CONTRACTOR") allowed.push("companyId");
    const changes: Record<string, unknown> = {};
    for (const k of allowed) {
      if (input.changes[k] !== undefined) changes[k] = input.changes[k]!;
    }
    if (Object.keys(changes).length === 0) {
      throw new ActionError("No editable fields supplied", 422, "VALIDATION_ERROR");
    }
    if (changes.nationalId) {
      const dup = await db.trainee.findFirst({
        where: { nationalId: changes.nationalId as string, companyId: trainee.companyId, deletedAt: null, NOT: { id: trainee.id } },
      });
      if (dup) throw new ActionError(`National ID already used by ${dup.refNumber}`, 400, "DUPLICATE_NATIONAL_ID");
    }
    const changeRows = Object.entries(changes).map(([k, v]) => ({
      field: k, label: k,
      oldValue: (trainee as Record<string, unknown>)[k] ?? null,
      newValue: v,
    }));
    return {
      actionType: "TRAINEE_EDIT",
      title: "Edit Trainee",
      titleAr: "تعديل المتدرب",
      summary: `Update ${Object.keys(changes).length} field(s) on trainee ${trainee.refNumber}.`,
      summaryAr: `تحديث ${Object.keys(changes).length} حقل(حقول) للمتدرب ${trainee.refNumber}.`,
      affectedRecords: [
        { entity: "TRAINEE", refNumber: trainee.refNumber, description: trainee.fullName },
      ],
      changes: changeRows,
      warnings: [],
      expectedResult: `Trainee ${trainee.refNumber} will reflect the new values.`,
      expectedResultAr: `سيعكس المتدرب ${trainee.refNumber} القيم الجديدة.`,
      hydratedParams: { traineeId: trainee.id, changes },
    };
  },
  async execute(preview, user, req) {
    const traineeId = preview.hydratedParams.traineeId as string;
    const changes = preview.hydratedParams.changes as Record<string, unknown>;
    // Normalize date strings
    if (changes.dateOfBirth) changes.dateOfBirth = new Date(changes.dateOfBirth as string);
    if (changes.idExpiry) changes.idExpiry = new Date(changes.idExpiry as string);
    const before = await db.trainee.findUnique({ where: { id: traineeId } });
    if (!before) throw new ActionError("Trainee no longer exists", 404, "NOT_FOUND");
    const updated = await db.trainee.update({
      where: { id: traineeId },
      data: { ...changes, updatedBy: user.id },
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "TRAINEE",
      entityId: updated.id,
      entityRef: updated.refNumber,
      description: `AI updated trainee ${updated.refNumber}`,
      descriptionAr: `حدّث الذكاء الاصطناعي المتدرب ${updated.refNumber}`,
      req,
      oldValue: before,
      newValue: updated,
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "TRAINEE_EDIT",
      message: `Trainee ${updated.refNumber} updated.`,
      messageAr: `تم تحديث المتدرب ${updated.refNumber}.`,
      results: [{ entity: "TRAINEE", id: updated.id, refNumber: updated.refNumber, description: updated.fullName }],
    };
  },
};

// ─── TRAINEE_ADD_TO_SESSION ───────────────────────────────────────────────
interface AddToSessionInput {
  traineeId: string;
  sessionId: string;
  isReExam?: boolean;
}
const addToSession: ActionHandler<AddToSessionInput> = {
  type: "TRAINEE_ADD_TO_SESSION",
  category: "TRAINEES",
  description: "Enroll an existing trainee into a session. Detects re-exam automatically if they have a prior enrollment in the same course.",
  descriptionAr: "تسجيل متدرب موجود في جلسة. يكتشف إعادة الامتحان تلقائياً عند وجود تسجيل سابق في نفس الدورة.",
  resolvePermission: (role) => {
    // Trainer can add trainees to their own sessions (emergency add)
    if (role === "TRAINER") return { module: "sessions", action: "edit" };
    if (role === "SUPER_ADMIN" || role === "COORDINATOR") return { module: "sessions", action: "edit" };
    return null; // CONTRACTOR + others: not permitted
  },
  async preparePreview(input, user) {
    if (!input.traineeId || !input.sessionId) {
      throw new ActionError("traineeId and sessionId are required", 422, "VALIDATION_ERROR");
    }
    const session = await db.trainingSession.findFirst({
      where: { id: input.sessionId, deletedAt: null },
      include: { course: { select: { id: true, title: true, code: true } } },
    });
    if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");

    // Trainer scoping: only their sessions
    if (user.role === "TRAINER" && session.trainerId !== user.trainerId) {
      throw new ActionError("Trainers can only add trainees to their own sessions", 403, "FORBIDDEN");
    }

    const trainee = await db.trainee.findFirst({
      where: { id: input.traineeId, deletedAt: null },
      include: { company: { select: { name: true, refNumber: true } } },
    });
    if (!trainee) throw new ActionError("Trainee not found", 404, "NOT_FOUND");

    const existing = await db.sessionEnrollment.findFirst({
      where: { sessionId: session.id, traineeId: trainee.id, deletedAt: null },
    });
    if (existing) throw new ActionError("Trainee already enrolled in this session", 400, "ALREADY_ENROLLED");

    // Re-exam detection: any prior PASSED/FAILED final test in the same course
    const priorEnrollments = await db.sessionEnrollment.findMany({
      where: { traineeId: trainee.id, deletedAt: null, session: { courseId: session.courseId } },
      include: { session: { select: { refNumber: true, startDate: true } } },
    });
    const isReExam = input.isReExam ?? priorEnrollments.length > 0;

    // Capacity check
    const enrolled = await db.sessionEnrollment.count({
      where: { sessionId: session.id, deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
    });
    const warnings = enrolled >= session.capacity
      ? [{
          level: "warning" as const,
          message: `Session is at full capacity (${enrolled}/${session.capacity}). Trainee will be enrolled over capacity.`,
          messageAr: `الجلسة ممتلئة (${enrolled}/${session.capacity}). سيتم تسجيل المتدرب فوق الطاقة.`,
        }]
      : [];

    return {
      actionType: "TRAINEE_ADD_TO_SESSION",
      title: "Add Trainee to Session",
      titleAr: "إضافة متدرب إلى الجلسة",
      summary: `Enroll ${trainee.fullName} (${trainee.refNumber}) into session ${session.refNumber}.`,
      summaryAr: `تسجيل ${trainee.fullName} (${trainee.refNumber}) في الجلسة ${session.refNumber}.`,
      affectedRecords: [
        { entity: "TRAINEE", refNumber: trainee.refNumber, description: trainee.fullName },
        { entity: "SESSION", refNumber: session.refNumber, description: session.course?.title ?? session.title },
      ],
      changes: [
        { field: "enrollment", label: "Enrollment", oldValue: null, newValue: "CONFIRMED" },
        { field: "isReExam", label: "Re-Exam", oldValue: null, newValue: isReExam },
      ],
      warnings,
      expectedResult: `${trainee.fullName} will be enrolled in session ${session.refNumber}.`,
      expectedResultAr: `سيتم تسجيل ${trainee.fullName} في الجلسة ${session.refNumber}.`,
      hydratedParams: {
        traineeId: trainee.id, sessionId: session.id, companyId: trainee.companyId,
        isReExam, enrollmentSource: user.role === "TRAINER" ? "TRAINER" : "COORDINATOR",
        addedByTrainer: user.role === "TRAINER",
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    await db.$transaction(async (tx) => {
      await copilotEnroll(
        p.sessionId as string,
        p.traineeId as string,
        p.companyId as string,
        user.id,
        {
          tx,
          enrollmentStatus: "CONFIRMED",
          isReExam: p.isReExam as boolean,
          enrollmentSource: p.enrollmentSource as string,
          addedByTrainer: p.addedByTrainer as boolean,
        }
      );
      await recomputeSessionCounts(p.sessionId as string, tx);
    });
    const trainee = await db.trainee.findUnique({ where: { id: p.traineeId as string } });
    const session = await db.trainingSession.findUnique({ where: { id: p.sessionId as string } });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: session?.id,
      entityRef: session?.refNumber,
      description: `AI enrolled trainee ${trainee?.refNumber} into session ${session?.refNumber}`,
      descriptionAr: `سجّل الذكاء الاصطناعي المتدرب ${trainee?.refNumber} في الجلسة ${session?.refNumber}`,
      req,
      newValue: { traineeId: p.traineeId, sessionId: p.sessionId, isReExam: p.isReExam },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "TRAINEE_ADD_TO_SESSION",
      message: `${trainee?.fullName} enrolled in ${session?.refNumber}.`,
      messageAr: `تم تسجيل ${trainee?.fullName} في ${session?.refNumber}.`,
      results: [
        { entity: "TRAINEE", id: trainee?.id, refNumber: trainee?.refNumber, description: trainee?.fullName ?? "" },
        { entity: "SESSION", id: session?.id, refNumber: session?.refNumber, description: session?.title ?? "" },
      ],
    };
  },
};

// ─── TRAINEE_REMOVE_FROM_SESSION ──────────────────────────────────────────
interface RemoveFromSessionInput {
  traineeId: string;
  sessionId: string;
  reason?: string;
}
const removeFromSession: ActionHandler<RemoveFromSessionInput> = {
  type: "TRAINEE_REMOVE_FROM_SESSION",
  category: "TRAINEES",
  description: "Cancel a trainee's enrollment in a session (soft-delete). Their progress is preserved.",
  descriptionAr: "إلغاء تسجيل متدرب في جلسة (حذف ناعم). يُحفظ تقدمه.",
  resolvePermission: (role) => {
    if (role === "TRAINER") return { module: "sessions", action: "edit" };
    if (role === "SUPER_ADMIN" || role === "COORDINATOR") return { module: "sessions", action: "edit" };
    return null;
  },
  async preparePreview(input, user) {
    if (!input.traineeId || !input.sessionId) {
      throw new ActionError("traineeId and sessionId are required", 422, "VALIDATION_ERROR");
    }
    const session = await db.trainingSession.findFirst({ where: { id: input.sessionId, deletedAt: null } });
    if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
    if (user.role === "TRAINER" && session.trainerId !== user.trainerId) {
      throw new ActionError("Trainers can only remove trainees from their own sessions", 403, "FORBIDDEN");
    }
    const enrollment = await db.sessionEnrollment.findFirst({
      where: { sessionId: session.id, traineeId: input.traineeId, deletedAt: null },
      include: { trainee: { select: { refNumber: true, fullName: true } } },
    });
    if (!enrollment) throw new ActionError("Trainee is not enrolled in this session", 400, "NOT_ENROLLED");

    return {
      actionType: "TRAINEE_REMOVE_FROM_SESSION",
      title: "Remove Trainee from Session",
      titleAr: "إزالة متدرب من الجلسة",
      summary: `Cancel enrollment of ${enrollment.trainee.fullName} from session ${session.refNumber}.`,
      summaryAr: `إلغاء تسجيل ${enrollment.trainee.fullName} من الجلسة ${session.refNumber}.`,
      affectedRecords: [
        { entity: "TRAINEE", refNumber: enrollment.trainee.refNumber, description: enrollment.trainee.fullName },
        { entity: "SESSION", refNumber: session.refNumber, description: session.title },
      ],
      changes: [
        { field: "enrollmentStatus", label: "Enrollment Status", oldValue: enrollment.enrollmentStatus, newValue: "CANCELLED" },
        { field: "deletedAt", label: "Deleted At", oldValue: null, newValue: new Date().toISOString() },
      ],
      warnings: [{
        level: "info",
        message: "Existing progress (attendance, test scores) is preserved for audit history.",
        messageAr: "يُحفظ التقدم الحالي (الحضور، درجات الاختبار) لتاريخ المراجعة.",
      }],
      expectedResult: `${enrollment.trainee.fullName} will be removed from session ${session.refNumber}.`,
      expectedResultAr: `سيتم إزالة ${enrollment.trainee.fullName} من الجلسة ${session.refNumber}.`,
      hydratedParams: {
        enrollmentId: enrollment.id, traineeId: input.traineeId, sessionId: session.id,
        traineeRef: enrollment.trainee.refNumber, traineeName: enrollment.trainee.fullName,
        sessionRef: session.refNumber, reason: input.reason ?? null,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    await db.$transaction(async (tx) => {
      await tx.sessionEnrollment.update({
        where: { id: p.enrollmentId as string },
        data: { enrollmentStatus: "CANCELLED", deletedAt: new Date(), updatedBy: user.id },
      });
      await recomputeSessionCounts(p.sessionId as string, tx);
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: p.sessionId as string,
      entityRef: p.sessionRef as string,
      description: `AI removed trainee ${p.traineeRef} from session ${p.sessionRef}`,
      descriptionAr: `أزال الذكاء الاصطناعي المتدرب ${p.traineeRef} من الجلسة ${p.sessionRef}`,
      req,
      oldValue: { enrollmentStatus: "CONFIRMED" },
      newValue: { enrollmentStatus: "CANCELLED" },
      reason: (p.reason as string | null) ?? null,
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "TRAINEE_REMOVE_FROM_SESSION",
      message: `${p.traineeName} removed from ${p.sessionRef}.`,
      messageAr: `تمت إزالة ${p.traineeName} من ${p.sessionRef}.`,
      results: [],
    };
  },
};

// ─── TRAINEE_MOVE ─────────────────────────────────────────────────────────
interface TraineeMoveInput {
  traineeId: string;
  fromSessionId: string;
  toSessionId: string;
}
const moveTrainee: ActionHandler<TraineeMoveInput> = {
  type: "TRAINEE_MOVE",
  category: "TRAINEES",
  description: "Move a trainee from one session to another (same course). Preserves progress.",
  descriptionAr: "نقل متدرب من جلسة إلى أخرى (نفس الدورة). يحافظ على التقدم.",
  resolvePermission: () => ({ module: "sessions", action: "edit" }),
  async preparePreview(input, _user) {
    if (!input.traineeId || !input.fromSessionId || !input.toSessionId) {
      throw new ActionError("traineeId, fromSessionId, toSessionId are required", 422, "VALIDATION_ERROR");
    }
    if (input.fromSessionId === input.toSessionId) {
      throw new ActionError("Source and target sessions are the same", 400, "SAME_SESSION");
    }
    const [fromSession, toSession] = await Promise.all([
      db.trainingSession.findFirst({ where: { id: input.fromSessionId, deletedAt: null }, include: { course: { select: { id: true, title: true } } } }),
      db.trainingSession.findFirst({ where: { id: input.toSessionId, deletedAt: null }, include: { course: { select: { id: true, title: true } } } }),
    ]);
    if (!fromSession || !toSession) throw new ActionError("Session not found", 404, "NOT_FOUND");
    if (fromSession.courseId !== toSession.courseId) {
      throw new ActionError(
        `Cannot move between courses: ${fromSession.course?.title} → ${toSession.course?.title}`,
        400,
        "COURSE_MISMATCH"
      );
    }
    if (fromSession.status !== "SCHEDULED" || toSession.status !== "SCHEDULED") {
      throw new ActionError("Both sessions must be in SCHEDULED status", 400, "INVALID_STATUS");
    }
    const enrollment = await db.sessionEnrollment.findFirst({
      where: { sessionId: fromSession.id, traineeId: input.traineeId, deletedAt: null },
      include: { trainee: { select: { refNumber: true, fullName: true, companyId: true } } },
    });
    if (!enrollment) throw new ActionError("Trainee not enrolled in source session", 400, "NOT_ENROLLED");
    const already = await db.sessionEnrollment.findFirst({
      where: { sessionId: toSession.id, traineeId: input.traineeId, deletedAt: null },
    });
    if (already) throw new ActionError("Trainee already enrolled in target session", 400, "ALREADY_ENROLLED");
    const targetCount = await db.sessionEnrollment.count({
      where: { sessionId: toSession.id, deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
    });
    const warnings = targetCount >= toSession.capacity
      ? [{
          level: "warning" as const,
          message: `Target session is at full capacity (${targetCount}/${toSession.capacity}).`,
          messageAr: `الجلسة الهدف ممتلئة (${targetCount}/${toSession.capacity}).`,
        }]
      : [];

    return {
      actionType: "TRAINEE_MOVE",
      title: "Move Trainee",
      titleAr: "نقل المتدرب",
      summary: `Move ${enrollment.trainee.fullName} from ${fromSession.refNumber} to ${toSession.refNumber}.`,
      summaryAr: `نقل ${enrollment.trainee.fullName} من ${fromSession.refNumber} إلى ${toSession.refNumber}.`,
      affectedRecords: [
        { entity: "TRAINEE", refNumber: enrollment.trainee.refNumber, description: enrollment.trainee.fullName },
        { entity: "SESSION", refNumber: fromSession.refNumber, description: `Source: ${fromSession.course?.title}` },
        { entity: "SESSION", refNumber: toSession.refNumber, description: `Target: ${toSession.course?.title}` },
      ],
      changes: [
        { field: "sessionId", label: "Session", oldValue: fromSession.refNumber, newValue: toSession.refNumber },
      ],
      warnings,
      expectedResult: `${enrollment.trainee.fullName} will be enrolled in ${toSession.refNumber} and removed from ${fromSession.refNumber}.`,
      expectedResultAr: `سيتم تسجيل ${enrollment.trainee.fullName} في ${toSession.refNumber} وإزالته من ${fromSession.refNumber}.`,
      hydratedParams: {
        traineeId: input.traineeId, traineeRef: enrollment.trainee.refNumber, traineeName: enrollment.trainee.fullName,
        companyId: enrollment.trainee.companyId,
        fromSessionId: fromSession.id, fromSessionRef: fromSession.refNumber,
        toSessionId: toSession.id, toSessionRef: toSession.refNumber,
        enrollmentId: enrollment.id,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    await db.$transaction(async (tx) => {
      // Cancel old enrollment
      await tx.sessionEnrollment.update({
        where: { id: p.enrollmentId as string },
        data: { enrollmentStatus: "CANCELLED", deletedAt: new Date(), updatedBy: user.id },
      });
      // Create new enrollment (revive if exists)
      await copilotEnroll(
        p.toSessionId as string,
        p.traineeId as string,
        p.companyId as string,
        user.id,
        { tx, enrollmentStatus: "CONFIRMED", enrollmentSource: "MANUAL" }
      );
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
      description: `AI moved trainee ${p.traineeRef} from ${p.fromSessionRef} to ${p.toSessionRef}`,
      descriptionAr: `نقل الذكاء الاصطناعي المتدرب ${p.traineeRef} من ${p.fromSessionRef} إلى ${p.toSessionRef}`,
      req,
      oldValue: { sessionId: p.fromSessionId },
      newValue: { sessionId: p.toSessionId },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "TRAINEE_MOVE",
      message: `${p.traineeName} moved to ${p.toSessionRef}.`,
      messageAr: `تم نقل ${p.traineeName} إلى ${p.toSessionRef}.`,
      results: [],
    };
  },
};

// ─── TRAINEE_COPY ─────────────────────────────────────────────────────────
interface TraineeCopyInput {
  traineeId: string;
  toSessionId: string;
}
const copyTrainee: ActionHandler<TraineeCopyInput> = {
  type: "TRAINEE_COPY",
  category: "TRAINEES",
  description: "Enroll a trainee in an additional session WITHOUT removing them from the source (parallel enrollment in another session of same course = re-exam).",
  descriptionAr: "تسجيل متدرب في جلسة إضافية دون إزالته من المصدر (تسجيل موازٍ = إعادة امتحان).",
  resolvePermission: () => ({ module: "sessions", action: "edit" }),
  async preparePreview(input, _user) {
    if (!input.traineeId || !input.toSessionId) {
      throw new ActionError("traineeId and toSessionId are required", 422, "VALIDATION_ERROR");
    }
    const session = await db.trainingSession.findFirst({ where: { id: input.toSessionId, deletedAt: null } });
    if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
    const trainee = await db.trainee.findFirst({ where: { id: input.traineeId, deletedAt: null } });
    if (!trainee) throw new ActionError("Trainee not found", 404, "NOT_FOUND");
    const already = await db.sessionEnrollment.findFirst({
      where: { sessionId: session.id, traineeId: trainee.id, deletedAt: null },
    });
    if (already) throw new ActionError("Trainee already enrolled in target session", 400, "ALREADY_ENROLLED");
    const priorInCourse = await db.sessionEnrollment.findFirst({
      where: { traineeId: trainee.id, deletedAt: null, session: { courseId: session.courseId } },
    });
    return {
      actionType: "TRAINEE_COPY",
      title: "Copy Trainee",
      titleAr: "نسخ المتدرب",
      summary: `Enroll ${trainee.fullName} into ${session.refNumber} (preserves existing enrollments).`,
      summaryAr: `تسجيل ${trainee.fullName} في ${session.refNumber} (يحافظ على التسجيلات الحالية).`,
      affectedRecords: [
        { entity: "TRAINEE", refNumber: trainee.refNumber, description: trainee.fullName },
        { entity: "SESSION", refNumber: session.refNumber, description: session.title },
      ],
      changes: [
        { field: "enrollment", label: "New Enrollment", oldValue: null, newValue: "CONFIRMED" },
        { field: "isReExam", label: "Re-Exam", oldValue: null, newValue: !!priorInCourse },
      ],
      warnings: priorInCourse
        ? [{
            level: "info" as const,
            message: "Trainee has prior enrollments in this course — will be marked as re-exam.",
            messageAr: "للمتدرب تسجيلات سابقة في هذه الدورة — سيُعلّم كإعادة امتحان.",
          }]
        : [],
      expectedResult: `${trainee.fullName} will be enrolled in ${session.refNumber}.`,
      expectedResultAr: `سيتم تسجيل ${trainee.fullName} في ${session.refNumber}.`,
      hydratedParams: {
        traineeId: trainee.id, sessionId: session.id, companyId: trainee.companyId,
        isReExam: !!priorInCourse, sessionRef: session.refNumber, traineeName: trainee.fullName, traineeRef: trainee.refNumber,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    await db.$transaction(async (tx) => {
      await copilotEnroll(
        p.sessionId as string,
        p.traineeId as string,
        p.companyId as string,
        user.id,
        { tx, enrollmentStatus: "CONFIRMED", isReExam: p.isReExam as boolean, enrollmentSource: "MANUAL" }
      );
      await recomputeSessionCounts(p.sessionId as string, tx);
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: p.sessionId as string,
      entityRef: p.sessionRef as string,
      description: `AI copied trainee ${p.traineeRef} into session ${p.sessionRef}`,
      descriptionAr: `نسخ الذكاء الاصطناعي المتدرب ${p.traineeRef} إلى الجلسة ${p.sessionRef}`,
      req,
      newValue: { traineeId: p.traineeId, sessionId: p.sessionId, isReExam: p.isReExam },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "TRAINEE_COPY",
      message: `${p.traineeName} copied to ${p.sessionRef}.`,
      messageAr: `تم نسخ ${p.traineeName} إلى ${p.sessionRef}.`,
      results: [],
    };
  },
};

// ─── TRAINEE_REGISTER_RE_EXAM ─────────────────────────────────────────────
interface ReExamInput {
  traineeId: string;
  sessionId: string;
}
const registerReExam: ActionHandler<ReExamInput> = {
  type: "TRAINEE_REGISTER_RE_EXAM",
  category: "TRAINEES",
  description: "Register a trainee for a re-exam session (marks enrollment as re-exam).",
  descriptionAr: "تسجيل متدرب في جلسة إعادة امتحان (يُعلّم التسجيل كإعادة امتحان).",
  resolvePermission: () => ({ module: "sessions", action: "edit" }),
  async preparePreview(input, _user) {
    if (!input.traineeId || !input.sessionId) {
      throw new ActionError("traineeId and sessionId are required", 422, "VALIDATION_ERROR");
    }
    const session = await db.trainingSession.findFirst({ where: { id: input.sessionId, deletedAt: null } });
    if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
    const trainee = await db.trainee.findFirst({ where: { id: input.traineeId, deletedAt: null } });
    if (!trainee) throw new ActionError("Trainee not found", 404, "NOT_FOUND");
    const existing = await db.sessionEnrollment.findFirst({
      where: { sessionId: session.id, traineeId: trainee.id, deletedAt: null },
    });
    if (existing) throw new ActionError("Trainee already enrolled", 400, "ALREADY_ENROLLED");

    return {
      actionType: "TRAINEE_REGISTER_RE_EXAM",
      title: "Register Re-Exam",
      titleAr: "تسجيل إعادة امتحان",
      summary: `Register ${trainee.fullName} for re-exam in session ${session.refNumber}.`,
      summaryAr: `تسجيل ${trainee.fullName} لإعادة الامتحان في الجلسة ${session.refNumber}.`,
      affectedRecords: [
        { entity: "TRAINEE", refNumber: trainee.refNumber, description: trainee.fullName },
        { entity: "SESSION", refNumber: session.refNumber, description: session.title },
      ],
      changes: [
        { field: "enrollment", label: "Enrollment", oldValue: null, newValue: "CONFIRMED" },
        { field: "isReExam", label: "Re-Exam", oldValue: null, newValue: true },
        { field: "enrollmentSource", label: "Source", oldValue: null, newValue: "RE_EXAM" },
      ],
      warnings: [],
      expectedResult: `${trainee.fullName} will be registered as a re-exam candidate.`,
      expectedResultAr: `سيتم تسجيل ${trainee.fullName} كمرشح لإعادة الامتحان.`,
      hydratedParams: {
        traineeId: trainee.id, sessionId: session.id, companyId: trainee.companyId,
        traineeRef: trainee.refNumber, traineeName: trainee.fullName, sessionRef: session.refNumber,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    await db.$transaction(async (tx) => {
      await copilotEnroll(
        p.sessionId as string, p.traineeId as string, p.companyId as string, user.id,
        { tx, enrollmentStatus: "CONFIRMED", isReExam: true, enrollmentSource: "RE_EXAM" }
      );
      await recomputeSessionCounts(p.sessionId as string, tx);
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: p.sessionId as string,
      entityRef: p.sessionRef as string,
      description: `AI registered re-exam for ${p.traineeRef} in ${p.sessionRef}`,
      descriptionAr: `سجّل الذكاء الاصطناعي إعادة امتحان لـ ${p.traineeRef} في ${p.sessionRef}`,
      req,
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "TRAINEE_REGISTER_RE_EXAM",
      message: `${p.traineeName} registered for re-exam in ${p.sessionRef}.`,
      messageAr: `تم تسجيل ${p.traineeName} لإعادة الامتحان في ${p.sessionRef}.`,
      results: [],
    };
  },
};

// ─── TRAINEE_CHANGE_CONTRACTOR ────────────────────────────────────────────
interface ChangeContractorInput {
  traineeId: string;
  newCompanyId: string;
}
const changeContractor: ActionHandler<ChangeContractorInput> = {
  type: "TRAINEE_CHANGE_CONTRACTOR",
  category: "TRAINEES",
  description: "Move a trainee to a different contractor (company). Future enrollments will use the new company.",
  descriptionAr: "نقل متدرب إلى مقاول (شركة) آخر. التسجيلات المستقبلية ستستخدم الشركة الجديدة.",
  resolvePermission: (role) => {
    // Contractor scoping: a contractor cannot move their own trainee to
    // another company — that requires administrative authority.
    if (role === "SUPER_ADMIN" || role === "COORDINATOR") {
      return { module: "trainees", action: "edit" };
    }
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.traineeId || !input.newCompanyId) {
      throw new ActionError("traineeId and newCompanyId are required", 422, "VALIDATION_ERROR");
    }
    const trainee = await db.trainee.findFirst({
      where: { id: input.traineeId, deletedAt: null },
      include: { company: { select: { id: true, name: true, refNumber: true } } },
    });
    if (!trainee) throw new ActionError("Trainee not found", 404, "NOT_FOUND");
    if (trainee.companyId === input.newCompanyId) {
      throw new ActionError("Trainee is already at this company", 400, "SAME_COMPANY");
    }
    const newCompany = await db.company.findFirst({ where: { id: input.newCompanyId, deletedAt: null } });
    if (!newCompany) throw new ActionError("New company not found", 404, "NOT_FOUND");

    return {
      actionType: "TRAINEE_CHANGE_CONTRACTOR",
      title: "Change Contractor",
      titleAr: "تغيير المقاول",
      summary: `Move ${trainee.fullName} from ${trainee.company?.name} to ${newCompany.name}.`,
      summaryAr: `نقل ${trainee.fullName} من ${trainee.company?.name} إلى ${newCompany.name}.`,
      affectedRecords: [
        { entity: "TRAINEE", refNumber: trainee.refNumber, description: trainee.fullName },
        { entity: "COMPANY", refNumber: trainee.company?.refNumber, description: `From: ${trainee.company?.name}` },
        { entity: "COMPANY", refNumber: newCompany.refNumber, description: `To: ${newCompany.name}` },
      ],
      changes: [
        { field: "companyId", label: "Company", oldValue: trainee.company?.name, newValue: newCompany.name },
      ],
      warnings: [{
        level: "info",
        message: "Existing session enrollments keep their original company snapshot. Only future enrollments use the new company.",
        messageAr: "تحتفظ التسجيلات الحالية بلقطة الشركة الأصلية. التسجيلات المستقبلية فقط تستخدم الشركة الجديدة.",
      }],
      expectedResult: `${trainee.fullName} will be moved to ${newCompany.name}.`,
      expectedResultAr: `سيتم نقل ${trainee.fullName} إلى ${newCompany.name}.`,
      hydratedParams: {
        traineeId: trainee.id, newCompanyId: newCompany.id,
        traineeRef: trainee.refNumber, traineeName: trainee.fullName,
        oldCompanyName: trainee.company?.name, newCompanyName: newCompany.name, newCompanyRef: newCompany.refNumber,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const before = await db.trainee.findUnique({ where: { id: p.traineeId as string } });
    if (!before) throw new ActionError("Trainee no longer exists", 404, "NOT_FOUND");
    const updated = await db.trainee.update({
      where: { id: p.traineeId as string },
      data: { companyId: p.newCompanyId as string, updatedBy: user.id },
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "TRAINEE",
      entityId: updated.id,
      entityRef: updated.refNumber,
      description: `AI changed contractor for ${p.traineeRef} from ${p.oldCompanyName} to ${p.newCompanyName}`,
      descriptionAr: `غيّر الذكاء الاصطناعي المقاول لـ ${p.traineeRef} من ${p.oldCompanyName} إلى ${p.newCompanyName}`,
      req,
      oldValue: { companyId: before.companyId, company: p.oldCompanyName },
      newValue: { companyId: p.newCompanyId, company: p.newCompanyName },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "TRAINEE_CHANGE_CONTRACTOR",
      message: `${p.traineeName} moved to ${p.newCompanyName}.`,
      messageAr: `تم نقل ${p.traineeName} إلى ${p.newCompanyName}.`,
      results: [{ entity: "COMPANY", refNumber: p.newCompanyRef as string, description: p.newCompanyName as string }],
    };
  },
};

export const traineeActions: ActionHandler<any>[] = [
  createTrainee, editTrainee, addToSession, removeFromSession,
  moveTrainee, copyTrainee, registerReExam, changeContractor,
];
