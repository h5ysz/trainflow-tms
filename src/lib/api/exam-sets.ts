// GCCLAB TMS — Session Exam Question Sets
// =====================================================================
// The trainer-controlled question set a session's exam uses. The trainer
// generates a draft (random sample from the course Question Bank), reviews
// the preview — including the correct answers beside each question — then
// regenerates or approves. The exam engine only reads the LATEST APPROVED
// set; per-trainee question/option order is still randomized at attempt time.
//
// Nothing here runs automatically: no cron, no time-based regeneration. The
// Question Bank is never mutated — a set only stores question IDs.

import { db } from "@/lib/db";

export type ExamSetStatus = "DRAFT" | "APPROVED";
export type ExamSetTestType = "PRE_TEST" | "FINAL_TEST";

// Fisher-Yates shuffle (non-mutating)
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Select questions from the course Question Bank for a given test type.
 * Randomly samples when there are more questions than needed; otherwise
 * returns every active question (in `order`).
 */
export async function selectQuestionsFromBank(
  courseId: string,
  testType: ExamSetTestType,
  numQuestions?: number
) {
  const allQuestions = await db.question.findMany({
    where: { courseId, testType, isActive: true, deletedAt: null },
    orderBy: { order: "asc" },
  });
  if (allQuestions.length === 0) return [];
  if (numQuestions && numQuestions < allQuestions.length) {
    return shuffle(allQuestions).slice(0, numQuestions);
  }
  return allQuestions;
}

export interface ExamSetQuestion {
  id: string;
  text: string;
  textAr?: string | null;
  options: string[];
  optionsAr?: string[] | null;
  correctAnswers: number[];
  imageUrl?: string | null;
  type: string;
  points: number;
  category?: string | null;
  difficulty: string;
}

export interface ExamSetDto {
  id: string;
  sessionId: string;
  testType: ExamSetTestType;
  status: ExamSetStatus;
  version: number;
  numQuestions: number;
  questionIds: string[];
  questions: ExamSetQuestion[];
  approvedAt?: string | null;
  approvedBy?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
}

type QuestionRow = Awaited<ReturnType<typeof db.question.findMany>>[number];

export function parseQuestionIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toExamSetQuestion(q: QuestionRow): ExamSetQuestion {
  return {
    id: q.id,
    text: q.text,
    textAr: q.textAr,
    options: JSON.parse(q.options),
    optionsAr: q.optionsAr ? JSON.parse(q.optionsAr) : null,
    correctAnswers: JSON.parse(q.correctAnswers),
    imageUrl: q.imageUrl,
    type: q.type,
    points: q.points,
    category: q.category,
    difficulty: q.difficulty,
  };
}

/** Load the questions referenced by a set, preserving the stored order. */
async function loadSetQuestions(ids: string[], onlyActive = false): Promise<QuestionRow[]> {
  if (ids.length === 0) return [];
  const rows = await db.question.findMany({
    where: onlyActive ? { id: { in: ids }, isActive: true, deletedAt: null } : { id: { in: ids } },
  });
  const map = new Map(rows.map((q) => [q.id, q]));
  return ids.map((id) => map.get(id)).filter(Boolean) as QuestionRow[];
}

async function resolveUserName(id?: string | null): Promise<string | null> {
  if (!id) return null;
  const user = await db.user.findUnique({ where: { id }, select: { fullName: true } });
  return user?.fullName ?? null;
}

/** Serialize a set row into a DTO with fully resolved (bilingual) questions. */
export async function toExamSetDto(set: {
  id: string;
  sessionId: string;
  testType: ExamSetTestType;
  status: string;
  version: number;
  numQuestions: number;
  questionIds: string;
  approvedAt?: Date | null;
  approvedBy?: string | null;
  createdAt?: Date | null;
  createdBy?: string | null;
}): Promise<ExamSetDto> {
  const ids = parseQuestionIds(set.questionIds);
  const questions = (await loadSetQuestions(ids)).map(toExamSetQuestion);
  return {
    id: set.id,
    sessionId: set.sessionId,
    testType: set.testType,
    status: (set.status === "APPROVED" ? "APPROVED" : "DRAFT") as ExamSetStatus,
    version: set.version,
    numQuestions: set.numQuestions,
    questionIds: ids,
    questions,
    approvedAt: set.approvedAt ? set.approvedAt.toISOString() : null,
    approvedBy: await resolveUserName(set.approvedBy),
    createdAt: set.createdAt ? set.createdAt.toISOString() : null,
    createdBy: await resolveUserName(set.createdBy),
  };
}

/** Active bank questions count for a course + test type (the source pool). */
export async function countBankQuestions(courseId: string, testType: ExamSetTestType): Promise<number> {
  return db.question.count({
    where: { courseId, testType, isActive: true, deletedAt: null },
  });
}

/** The latest APPROVED set for a session + test type, or null. */
export async function findActiveSet(sessionId: string, testType: ExamSetTestType) {
  return db.sessionExamSet.findFirst({
    where: { sessionId, testType, status: "APPROVED", deletedAt: null },
    orderBy: { approvedAt: "desc" },
  });
}

/**
 * The questions the session's exam must use — the trainer-approved set, in its
 * approved order, filtered to still-active questions. Returns null when no
 * approved set exists so the caller can fall back to the Question Bank.
 */
export async function resolveActiveSetQuestions(
  sessionId: string,
  testType: ExamSetTestType
): Promise<QuestionRow[] | null> {
  const set = await findActiveSet(sessionId, testType);
  if (!set) return null;
  const ids = parseQuestionIds(set.questionIds);
  const ordered = await loadSetQuestions(ids, true);
  return ordered.length > 0 ? ordered : null;
}

function targetCount(requested: number | undefined, bankSize: number): number {
  if (requested && requested > 0 && requested <= bankSize) return requested;
  return bankSize;
}

/** Generate a new DRAFT set for a session + test type. Returns null when the bank is empty. */
export async function createDraftSet(opts: {
  sessionId: string;
  courseId: string;
  testType: ExamSetTestType;
  numQuestions?: number;
  userId: string;
}) {
  const bankSize = await db.question.count({
    where: { courseId: opts.courseId, testType: opts.testType, isActive: true, deletedAt: null },
  });
  if (bankSize === 0) return null;

  const sampled = await selectQuestionsFromBank(
    opts.courseId,
    opts.testType,
    targetCount(opts.numQuestions, bankSize)
  );

  const lastVersion = await db.sessionExamSet.aggregate({
    _max: { version: true },
    where: { sessionId: opts.sessionId, testType: opts.testType, deletedAt: null },
  });

  return db.sessionExamSet.create({
    data: {
      sessionId: opts.sessionId,
      testType: opts.testType,
      status: "DRAFT",
      version: (lastVersion._max.version ?? 0) + 1,
      numQuestions: sampled.length,
      questionIds: JSON.stringify(sampled.map((q) => q.id)),
      createdBy: opts.userId,
      updatedBy: opts.userId,
    },
  });
}

/** Draw a new random sample into an existing DRAFT set (a genuinely different one when the pool allows). */
export async function regenerateDraftSet(opts: {
  setId: string;
  courseId: string;
  numQuestions?: number;
  userId: string;
}) {
  const set = await db.sessionExamSet.findUnique({ where: { id: opts.setId } });
  if (!set || set.deletedAt) throw new Error("Exam question set not found");
  if (set.status !== "DRAFT") throw new Error("Only a draft set can be regenerated");

  const bankSize = await db.question.count({
    where: { courseId: opts.courseId, testType: set.testType, isActive: true, deletedAt: null },
  });
  if (bankSize === 0) throw new Error("No active questions in the Question Bank");

  const target = targetCount(opts.numQuestions, bankSize);
  const previous = parseQuestionIds(set.questionIds).sort().join("|");

  let sampled = await selectQuestionsFromBank(opts.courseId, set.testType, target);
  for (let attempt = 0; attempt < 8; attempt++) {
    const ids = sampled.map((q) => q.id).sort().join("|");
    if (ids !== previous) break;
    sampled = await selectQuestionsFromBank(opts.courseId, set.testType, target);
  }

  return db.sessionExamSet.update({
    where: { id: opts.setId },
    data: {
      numQuestions: sampled.length,
      questionIds: JSON.stringify(sampled.map((q) => q.id)),
      updatedBy: opts.userId,
    },
  });
}

/** Approve a DRAFT — it becomes the set the session's exam uses. */
export async function approveSet(opts: { setId: string; userId: string }) {
  const set = await db.sessionExamSet.findUnique({ where: { id: opts.setId } });
  if (!set || set.deletedAt) throw new Error("Exam question set not found");
  if (set.status !== "DRAFT") throw new Error("Only a draft set can be approved");
  return db.sessionExamSet.update({
    where: { id: opts.setId },
    data: { status: "APPROVED", approvedAt: new Date(), approvedBy: opts.userId, updatedBy: opts.userId },
  });
}

/** Discard a DRAFT (soft delete). Approved sets are kept for audit. */
export async function discardSet(opts: { setId: string; userId: string }) {
  const set = await db.sessionExamSet.findUnique({ where: { id: opts.setId } });
  if (!set || set.deletedAt) throw new Error("Exam question set not found");
  if (set.status !== "DRAFT") throw new Error("Only a draft set can be discarded");
  return db.sessionExamSet.update({
    where: { id: opts.setId },
    data: { deletedAt: new Date(), updatedBy: opts.userId },
  });
}
