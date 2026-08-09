// GCCLAB AI Copilot — Phase 2 — TRAINERS actions
// =====================================================================
// create / assign / replace / remove
import { db } from "@/lib/db";
import { nextRefNumber } from "@/lib/api/ref-number";
import { validateTrainerAssignment } from "@/lib/api/trainer-assignment";
import type { ActionHandler } from "./types";
import { ActionError } from "./types";
import { copilotAudit } from "./audit";

interface TrainerInput {
  nameEn?: string;
  nameAr?: string;
  nationalId?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  gender?: string;
  nationality?: string;
  country?: string;
  city?: string;
  address?: string;
  bio?: string;
  status?: string;
  hireDate?: string;
}

function pickTrainerFields(input: TrainerInput) {
  return {
    nameEn: input.nameEn,
    nameAr: input.nameAr ?? null,
    nationalId: input.nationalId ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    mobile: input.mobile ?? null,
    gender: input.gender ?? null,
    nationality: input.nationality ?? null,
    country: input.country ?? null,
    city: input.city ?? null,
    address: input.address ?? null,
    bio: input.bio ?? null,
    status: input.status ?? "ACTIVE",
    hireDate: input.hireDate ? new Date(input.hireDate) : null,
  };
}

// ─── TRAINER_CREATE ───────────────────────────────────────────────────────
const createTrainer: ActionHandler<TrainerInput> = {
  type: "TRAINER_CREATE",
  category: "TRAINERS",
  description: "Create a new trainer record (name, contact, nationality, hire date).",
  descriptionAr: "إنشاء سجل مدرب جديد (الاسم، الاتصال، الجنسية، تاريخ التوظيف).",
  resolvePermission: () => ({ module: "trainers", action: "create" }),
  async preparePreview(input, _user) {
    if (!input.nameEn) throw new ActionError("nameEn is required", 422, "VALIDATION_ERROR");
    if (input.email) {
      const dup = await db.trainer.findFirst({ where: { email: input.email, deletedAt: null } });
      if (dup) throw new ActionError(`Trainer email "${input.email}" already exists`, 400, "DUPLICATE_EMAIL");
    }
    if (input.nationalId) {
      const dup = await db.trainer.findFirst({ where: { nationalId: input.nationalId, deletedAt: null } });
      if (dup) throw new ActionError(`Trainer national ID "${input.nationalId}" already exists`, 400, "DUPLICATE_NATIONAL_ID");
    }
    const fields = pickTrainerFields(input);
    return {
      actionType: "TRAINER_CREATE",
      title: "Create Trainer",
      titleAr: "إنشاء مدرب",
      summary: `Create trainer "${fields.nameEn}".`,
      summaryAr: `إنشاء مدرب "${fields.nameEn}".`,
      affectedRecords: [{ entity: "TRAINER", description: `New trainer: ${fields.nameEn}` }],
      changes: [
        { field: "nameEn", label: "Full Name", oldValue: null, newValue: fields.nameEn },
        { field: "email", label: "Email", oldValue: null, newValue: fields.email ?? "—" },
        { field: "mobile", label: "Mobile", oldValue: null, newValue: fields.mobile ?? "—" },
        { field: "nationality", label: "Nationality", oldValue: null, newValue: fields.nationality ?? "—" },
      ],
      warnings: [],
      expectedResult: `New trainer "${fields.nameEn}" will appear in the Trainers list.`,
      expectedResultAr: `سيظهر المدرب الجديد "${fields.nameEn}" في قائمة المدربين.`,
      hydratedParams: { input: fields },
    };
  },
  async execute(preview, user, req) {
    const input = preview.hydratedParams.input as TrainerInput;
    const refNumber = await nextRefNumber("TRAINER");
    const fields = pickTrainerFields(input);
    const trainer = await db.trainer.create({
      data: {
        refNumber,
        nameEn: fields.nameEn!,
        nameAr: fields.nameAr,
        nationalId: fields.nationalId,
        email: fields.email,
        phone: fields.phone,
        mobile: fields.mobile,
        gender: fields.gender,
        nationality: fields.nationality,
        country: fields.country,
        city: fields.city,
        address: fields.address,
        bio: fields.bio,
        status: fields.status!,
        hireDate: fields.hireDate,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
    await copilotAudit({
      user,
      action: "CREATE",
      entity: "TRAINER",
      entityId: trainer.id,
      entityRef: trainer.refNumber,
      description: `AI created trainer ${trainer.refNumber} (${trainer.nameEn})`,
      descriptionAr: `أنشأ الذكاء الاصطناعي مدرب ${trainer.refNumber} (${trainer.nameEn})`,
      req,
      newValue: fields,
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "TRAINER_CREATE",
      message: `Trainer ${trainer.refNumber} (${trainer.nameEn}) created.`,
      messageAr: `تم إنشاء المدرب ${trainer.refNumber} (${trainer.nameEn}).`,
      results: [{ entity: "TRAINER", id: trainer.id, refNumber: trainer.refNumber, description: trainer.nameEn }],
    };
  },
};

// ─── TRAINER_ASSIGN ───────────────────────────────────────────────────────
interface TrainerAssignInput {
  trainerId: string;
  sessionId: string;
}
const assignTrainer: ActionHandler<TrainerAssignInput> = {
  type: "TRAINER_ASSIGN",
  category: "TRAINERS",
  description: "Assign a trainer to a session (validates certification + scheduling conflict).",
  descriptionAr: "تعيين مدرب لجلسة (يتحقق من الشهادة وتضارب الجدول).",
  resolvePermission: () => ({ module: "sessions", action: "edit" }),
  async preparePreview(input, user) {
    if (!input.trainerId || !input.sessionId) {
      throw new ActionError("trainerId and sessionId are required", 422, "VALIDATION_ERROR");
    }
    const session = await db.trainingSession.findFirst({
      where: { id: input.sessionId, deletedAt: null },
      include: { course: { select: { id: true, title: true } }, trainer: { select: { id: true, nameEn: true, refNumber: true } } },
    });
    if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
    if (session.trainerId) {
      throw new ActionError(
        `Session already has a trainer: ${session.trainer?.nameEn} (${session.trainer?.refNumber}). Use TRAINER_REPLACE instead.`,
        400,
        "TRAINER_ALREADY_ASSIGNED"
      );
    }
    const trainer = await db.trainer.findFirst({ where: { id: input.trainerId, deletedAt: null } });
    if (!trainer) throw new ActionError("Trainer not found", 404, "NOT_FOUND");

    const validation = await validateTrainerAssignment({
      user,
      trainerId: trainer.id,
      courseId: session.courseId,
      startDate: session.startDate,
      endDate: session.endDate,
    });
    const warnings: { level: "info" | "warning" | "danger"; message: string; messageAr?: string }[] = [];
    if (!validation.valid && validation.error) {
      // Single error string from validator — treat as a hard block.
      throw new ActionError("Trainer assignment blocked: " + validation.error, 400, "ASSIGNMENT_BLOCKED");
    }

    return {
      actionType: "TRAINER_ASSIGN",
      title: "Assign Trainer",
      titleAr: "تعيين المدرب",
      summary: `Assign ${trainer.nameEn} (${trainer.refNumber}) to session ${session.refNumber}.`,
      summaryAr: `تعيين ${trainer.nameEn} (${trainer.refNumber}) للجلسة ${session.refNumber}.`,
      affectedRecords: [
        { entity: "TRAINER", refNumber: trainer.refNumber, description: trainer.nameEn },
        { entity: "SESSION", refNumber: session.refNumber, description: session.course?.title ?? session.title },
      ],
      changes: [{ field: "trainerId", label: "Trainer", oldValue: null, newValue: `${trainer.nameEn} (${trainer.refNumber})` }],
      warnings,
      expectedResult: `${trainer.nameEn} will be assigned to session ${session.refNumber}.`,
      expectedResultAr: `سيتم تعيين ${trainer.nameEn} للجلسة ${session.refNumber}.`,
      hydratedParams: {
        sessionId: session.id, sessionRef: session.refNumber,
        trainerId: trainer.id, trainerRef: trainer.refNumber, trainerName: trainer.nameEn,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const before = await db.trainingSession.findUnique({ where: { id: p.sessionId as string }, select: { trainerId: true } });
    if (!before) throw new ActionError("Session no longer exists", 404, "NOT_FOUND");
    const updated = await db.trainingSession.update({
      where: { id: p.sessionId as string },
      data: { trainerId: p.trainerId as string, updatedBy: user.id },
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: updated.id,
      entityRef: updated.refNumber,
      description: `AI assigned trainer ${p.trainerRef} to session ${p.sessionRef}`,
      descriptionAr: `عيّن الذكاء الاصطناعي المدرب ${p.trainerRef} للجلسة ${p.sessionRef}`,
      req,
      oldValue: { trainerId: before.trainerId },
      newValue: { trainerId: p.trainerId },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "TRAINER_ASSIGN",
      message: `${p.trainerName} assigned to ${p.sessionRef}.`,
      messageAr: `تم تعيين ${p.trainerName} للجلسة ${p.sessionRef}.`,
      results: [{ entity: "TRAINER", refNumber: p.trainerRef as string, description: p.trainerName as string }],
    };
  },
};

// ─── TRAINER_REPLACE ──────────────────────────────────────────────────────
interface TrainerReplaceInput {
  trainerId: string;
  sessionId: string;
}
const replaceTrainer: ActionHandler<TrainerReplaceInput> = {
  type: "TRAINER_REPLACE",
  category: "TRAINERS",
  description: "Replace the current trainer of a session with a different trainer.",
  descriptionAr: "استبدال المدرب الحالي لجلسة بمدرب آخر.",
  resolvePermission: () => ({ module: "sessions", action: "edit" }),
  async preparePreview(input, user) {
    if (!input.trainerId || !input.sessionId) {
      throw new ActionError("trainerId and sessionId are required", 422, "VALIDATION_ERROR");
    }
    const session = await db.trainingSession.findFirst({
      where: { id: input.sessionId, deletedAt: null },
      include: { course: { select: { id: true, title: true } }, trainer: { select: { id: true, nameEn: true, refNumber: true } } },
    });
    if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
    if (!session.trainerId) {
      throw new ActionError("Session has no trainer to replace. Use TRAINER_ASSIGN instead.", 400, "NO_TRAINER");
    }
    if (session.trainerId === input.trainerId) {
      throw new ActionError("New trainer is the same as the current trainer", 400, "SAME_TRAINER");
    }
    const newTrainer = await db.trainer.findFirst({ where: { id: input.trainerId, deletedAt: null } });
    if (!newTrainer) throw new ActionError("Trainer not found", 404, "NOT_FOUND");

    const validation = await validateTrainerAssignment({
      user, trainerId: newTrainer.id, courseId: session.courseId,
      startDate: session.startDate, endDate: session.endDate,
    });
    const warnings: { level: "info" | "warning" | "danger"; message: string; messageAr?: string }[] = [];
    if (!validation.valid && validation.error) {
      throw new ActionError("Replacement blocked: " + validation.error, 400, "ASSIGNMENT_BLOCKED");
    }
    return {
      actionType: "TRAINER_REPLACE",
      title: "Replace Trainer",
      titleAr: "استبدال المدرب",
      summary: `Replace ${session.trainer?.nameEn} with ${newTrainer.nameEn} on session ${session.refNumber}.`,
      summaryAr: `استبدال ${session.trainer?.nameEn} بـ ${newTrainer.nameEn} في الجلسة ${session.refNumber}.`,
      affectedRecords: [
        { entity: "TRAINER", refNumber: session.trainer?.refNumber, description: `From: ${session.trainer?.nameEn}` },
        { entity: "TRAINER", refNumber: newTrainer.refNumber, description: `To: ${newTrainer.nameEn}` },
        { entity: "SESSION", refNumber: session.refNumber, description: session.course?.title ?? session.title },
      ],
      changes: [{
        field: "trainerId", label: "Trainer",
        oldValue: `${session.trainer?.nameEn} (${session.trainer?.refNumber})`,
        newValue: `${newTrainer.nameEn} (${newTrainer.refNumber})`,
      }],
      warnings,
      expectedResult: `${newTrainer.nameEn} will be the new trainer for session ${session.refNumber}.`,
      expectedResultAr: `سيكون ${newTrainer.nameEn} المدرب الجديد للجلسة ${session.refNumber}.`,
      hydratedParams: {
        sessionId: session.id, sessionRef: session.refNumber,
        oldTrainerId: session.trainerId, oldTrainerName: session.trainer?.nameEn,
        newTrainerId: newTrainer.id, newTrainerRef: newTrainer.refNumber, newTrainerName: newTrainer.nameEn,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const updated = await db.trainingSession.update({
      where: { id: p.sessionId as string },
      data: { trainerId: p.newTrainerId as string, updatedBy: user.id },
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: updated.id,
      entityRef: updated.refNumber,
      description: `AI replaced trainer (${p.oldTrainerName} → ${p.newTrainerName}) on session ${p.sessionRef}`,
      descriptionAr: `استبدل الذكاء الاصطناعي المدرب (${p.oldTrainerName} → ${p.newTrainerName}) في الجلسة ${p.sessionRef}`,
      req,
      oldValue: { trainerId: p.oldTrainerId, trainerName: p.oldTrainerName },
      newValue: { trainerId: p.newTrainerId, trainerName: p.newTrainerName },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "TRAINER_REPLACE",
      message: `Trainer replaced: ${p.oldTrainerName} → ${p.newTrainerName} on ${p.sessionRef}.`,
      messageAr: `تم استبدال المدرب: ${p.oldTrainerName} → ${p.newTrainerName} في ${p.sessionRef}.`,
      results: [{ entity: "TRAINER", refNumber: p.newTrainerRef as string, description: p.newTrainerName as string }],
    };
  },
};

// ─── TRAINER_REMOVE ───────────────────────────────────────────────────────
interface TrainerRemoveInput { sessionId: string; }
const removeTrainer: ActionHandler<TrainerRemoveInput> = {
  type: "TRAINER_REMOVE",
  category: "TRAINERS",
  description: "Remove the trainer from a session (sets trainerId = null).",
  descriptionAr: "إزالة المدرب من جلسة (تعيين trainerId = null).",
  resolvePermission: () => ({ module: "sessions", action: "edit" }),
  async preparePreview(input, _user) {
    if (!input.sessionId) throw new ActionError("sessionId is required", 422, "VALIDATION_ERROR");
    const session = await db.trainingSession.findFirst({
      where: { id: input.sessionId, deletedAt: null },
      include: { trainer: { select: { id: true, nameEn: true, refNumber: true } } },
    });
    if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
    if (!session.trainerId) throw new ActionError("Session has no trainer to remove", 400, "NO_TRAINER");
    return {
      actionType: "TRAINER_REMOVE",
      title: "Remove Trainer",
      titleAr: "إزالة المدرب",
      summary: `Remove ${session.trainer?.nameEn} from session ${session.refNumber}.`,
      summaryAr: `إزالة ${session.trainer?.nameEn} من الجلسة ${session.refNumber}.`,
      affectedRecords: [
        { entity: "TRAINER", refNumber: session.trainer?.refNumber, description: session.trainer?.nameEn ?? "" },
        { entity: "SESSION", refNumber: session.refNumber, description: session.title },
      ],
      changes: [{
        field: "trainerId", label: "Trainer",
        oldValue: `${session.trainer?.nameEn} (${session.trainer?.refNumber})`,
        newValue: null,
      }],
      warnings: [{
        level: "warning",
        message: "Session will have no trainer assigned. Schedule a replacement before the start date.",
        messageAr: "لن يكون للجلسة مدرب معيّن. ابحث عن بديل قبل تاريخ البدء.",
      }],
      expectedResult: `${session.trainer?.nameEn} will be unassigned from session ${session.refNumber}.`,
      expectedResultAr: `سيتم إلغاء تعيين ${session.trainer?.nameEn} من الجلسة ${session.refNumber}.`,
      hydratedParams: {
        sessionId: session.id, sessionRef: session.refNumber,
        oldTrainerId: session.trainerId, oldTrainerName: session.trainer?.nameEn, oldTrainerRef: session.trainer?.refNumber,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const updated = await db.trainingSession.update({
      where: { id: p.sessionId as string },
      data: { trainerId: null, updatedBy: user.id },
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: updated.id,
      entityRef: updated.refNumber,
      description: `AI removed trainer ${p.oldTrainerRef} from session ${p.sessionRef}`,
      descriptionAr: `أزال الذكاء الاصطناعي المدرب ${p.oldTrainerRef} من الجلسة ${p.sessionRef}`,
      req,
      oldValue: { trainerId: p.oldTrainerId, trainerName: p.oldTrainerName },
      newValue: { trainerId: null },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "TRAINER_REMOVE",
      message: `Trainer ${p.oldTrainerName} removed from ${p.sessionRef}.`,
      messageAr: `تمت إزالة المدرب ${p.oldTrainerName} من ${p.sessionRef}.`,
      results: [],
    };
  },
};

export const trainerActions: ActionHandler<any>[] = [createTrainer, assignTrainer, replaceTrainer, removeTrainer];
