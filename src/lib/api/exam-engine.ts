// GCCLAB TMS — Exam Engine
// =====================================================================
// Handles:
//   - Selecting questions from the course Question Bank
//   - Randomizing question order per trainee
//   - Randomizing answer choice order per trainee
//   - Generating unique exam versions (questionSet snapshots)
//   - Grading submitted answers against the randomized set

import { db } from "@/lib/db";
import { nextRefNumber } from "@/lib/api/ref-number";

export interface QuestionSetItem {
  questionId: string;
  order: number;           // the display order for this trainee
  optionsOrder: number[];  // shuffled indices of the original options
}

export interface ExamVersion {
  refNumber: string;
  questionSet: QuestionSetItem[];
  questions: Array<{
    id: string;
    text: string;
    textAr?: string | null;
    type: string;
    points: number;
    order: number;
    options: string[];      // reordered options
    originalOptions: string[];
  }>;
  passScore: number;
}

export interface GradedAnswer {
  questionId: string;
  selectedAnswerIndices: number[];  // indices in the SHUFFLED order
  originalSelectedIndices: number[]; // mapped back to original
  correctAnswerIndices: number[];   // original correct indices
  isCorrect: boolean;
  pointsAwarded: number;
  maxPoints: number;
}

export interface GradingResult {
  scorePercent: number;
  passed: boolean;
  totalPoints: number;
  earnedPoints: number;
  answers: GradedAnswer[];
}

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
 * Randomly selects if there are more questions than needed.
 *
 * @param courseId - the course to pull questions from
 * @param testType - PRE_TEST or FINAL_TEST
 * @param numQuestions - max questions to select (null = all active questions)
 */
export async function selectQuestionsFromBank(
  courseId: string,
  testType: "PRE_TEST" | "FINAL_TEST",
  numQuestions?: number
) {
  const allQuestions = await db.question.findMany({
    where: {
      courseId,
      testType,
      isActive: true,
      deletedAt: null,
    },
    orderBy: { order: "asc" },
  });

  if (allQuestions.length === 0) return [];

  // If numQuestions specified and we have more than needed, randomly sample
  if (numQuestions && numQuestions < allQuestions.length) {
    return shuffle(allQuestions).slice(0, numQuestions);
  }

  return allQuestions;
}

/**
 * Identify a trainee within a session. The national ID is authoritative when present;
 * the display name is only a fallback for records captured without one.
 */
export function traineeIdentityWhere(opts: {
  traineeName: string;
  traineeIdNational?: string | null;
}): Record<string, unknown> {
  const nationalId = opts.traineeIdNational?.trim();
  if (nationalId) return { traineeIdNational: nationalId };
  return { traineeName: opts.traineeName.trim() };
}

/**
 * Create a randomized exam version for a specific trainee.
 * Each trainee gets:
 *   - A different random order of questions
 *   - A different random order of answer choices per question
 *
 * Returns an ExamAttempt record + the exam version for display.
 */
export async function createExamAttempt(opts: {
  sessionId: string;
  attendanceId?: string;
  testType: "PRE_TEST" | "FINAL_TEST";
  traineeName: string;
  traineeEmail?: string;
  traineeIdNational?: string;
  companyId?: string;
  numQuestions?: number;
  createdBy: string | null;
}): Promise<{ attemptId: string; refNumber: string; questionSet: QuestionSetItem[]; passScore: number }> {
  const { sessionId, attendanceId, testType, traineeName, traineeEmail, traineeIdNational, companyId, numQuestions, createdBy } = opts;

  // Get session + course
  const session = await db.trainingSession.findUnique({
    where: { id: sessionId },
    include: { course: true },
  });
  if (!session) throw new Error("Session not found");
  if (!session.course) throw new Error("Course not found");

  const passScore = session.course.passScore;

  // Select questions from bank
  const questions = await selectQuestionsFromBank(session.courseId, testType, numQuestions);
  if (questions.length === 0) {
    throw new Error(`No active ${testType} questions found in the Question Bank for course ${session.course.code}`);
  }

  // Randomize question order
  const shuffledQuestions = shuffle(questions);

  // Build questionSet with randomized option order per question
  const questionSet: QuestionSetItem[] = shuffledQuestions.map((q, index) => {
    const originalOptions: string[] = JSON.parse(q.options);
    const optionsOrder = shuffle(originalOptions.map((_, i) => i));
    return {
      questionId: q.id,
      order: index + 1,
      optionsOrder,
    };
  });

  // Generate ref number
  const refNumber = await nextRefNumber("EXAM");

  // Check existing attempt count for this trainee + session + testType.
  // Prefer the national ID: matching on display name alone made two trainees called
  // "Mohammed Al-Otaibi" share one attempt budget, while a stray space or a casing
  // difference handed the same person a fresh one.
  const existingAttempts = await db.examAttempt.count({
    where: {
      sessionId,
      testType,
      ...traineeIdentityWhere({ traineeName, traineeIdNational }),
      deletedAt: null,
    },
  });

  // Create the ExamAttempt record
  const attempt = await db.examAttempt.create({
    data: {
      refNumber,
      sessionId,
      attendanceId: attendanceId ?? null,
      testType,
      traineeName,
      traineeEmail: traineeEmail ?? null,
      traineeIdNational: traineeIdNational ?? null,
      companyId: companyId ?? null, // trainee's original company — preserved
      questionSet: JSON.stringify(questionSet),
      status: "ASSIGNED",
      attemptNumber: existingAttempts + 1,
      maxAttempts: 1, // one attempt by default
      passScore,
      createdBy,
      updatedBy: createdBy,
    },
  });

  return {
    attemptId: attempt.id,
    refNumber: attempt.refNumber,
    questionSet,
    passScore,
  };
}

/**
 * Resolve a questionSet into displayable questions with shuffled options.
 * Used when a trainee starts an exam (GET the exam to display).
 */
export async function resolveExamVersion(attemptId: string): Promise<ExamVersion | null> {
  const attempt = await db.examAttempt.findUnique({
    where: { id: attemptId },
  });
  if (!attempt || attempt.deletedAt) return null;

  const questionSet: QuestionSetItem[] = JSON.parse(attempt.questionSet);
  const questionIds = questionSet.map((q) => q.questionId);

  const questions = await db.question.findMany({
    where: { id: { in: questionIds } },
  });

  const questionMap = new Map(questions.map((q) => [q.id, q]));

  const resolvedQuestions = questionSet
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const q = questionMap.get(item.questionId);
      if (!q) return null;
      const originalOptions: string[] = JSON.parse(q.options);
      const reorderedOptions = item.optionsOrder.map((i) => originalOptions[i] ?? `Option ${i + 1}`);
      return {
        id: q.id,
        text: q.text,
        textAr: q.textAr,
        type: q.type,
        points: q.points,
        order: item.order,
        options: reorderedOptions,
        originalOptions,
      };
    })
    .filter(Boolean) as ExamVersion["questions"];

  return {
    refNumber: attempt.refNumber,
    questionSet,
    questions: resolvedQuestions,
    passScore: attempt.passScore ?? 70,
  };
}

/**
 * Grade a submitted exam against the stored questionSet.
 * Maps the trainee's selected indices (in shuffled order) back to original
 * indices, then compares with the correct answers.
 */
export async function gradeExamAttempt(opts: {
  attemptId: string;
  answers: Array<{ questionId: string; selectedAnswerIndices: number[] }>; // indices in SHUFFLED order
}): Promise<GradingResult> {
  const { attemptId, answers } = opts;

  const attempt = await db.examAttempt.findUnique({
    where: { id: attemptId },
  });
  if (!attempt || attempt.deletedAt) throw new Error("Exam attempt not found");

  const questionSet: QuestionSetItem[] = JSON.parse(attempt.questionSet);
  const questionIds = questionSet.map((q) => q.questionId);

  const questions = await db.question.findMany({
    where: { id: { in: questionIds } },
  });
  const questionMap = new Map(questions.map((q) => [q.id, q]));

  let totalPoints = 0;
  let earnedPoints = 0;
  const gradedAnswers: GradedAnswer[] = [];

  // Index the submission by question id. The first entry for a question wins, so a
  // payload repeating the same questionId cannot be counted more than once.
  const submitted = new Map<string, number[]>();
  for (const answer of answers) {
    if (!submitted.has(answer.questionId)) {
      submitted.set(answer.questionId, answer.selectedAnswerIndices ?? []);
    }
  }

  // Iterate the stored questionSet, NOT the submitted answers. Driving the loop off
  // the request body meant the denominator only counted questions the client chose to
  // send — submitting a single correct answer to a twenty-question exam scored 100%
  // and earned a certificate. Unanswered questions must still count against the total.
  for (const qsItem of questionSet) {
    const q = questionMap.get(qsItem.questionId);
    if (!q) continue; // question deleted from the bank since assignment

    const correctAnswers: number[] = JSON.parse(q.correctAnswers);
    const maxPoints = q.points;
    totalPoints += maxPoints;

    const selectedAnswerIndices = submitted.get(qsItem.questionId) ?? [];

    // Map selected indices from shuffled → original.
    // qsItem.optionsOrder[i] = original index of the i-th shuffled option,
    // so a selected shuffled index j maps to qsItem.optionsOrder[j].
    const mapped = selectedAnswerIndices.map((shuffledIdx) => qsItem.optionsOrder[shuffledIdx]);
    // An out-of-range index is a malformed submission, not a narrower answer.
    // Filtering it out would silently shrink a wrong 3-option answer into a 2-option
    // one that could match the correct set, so the whole answer is invalidated instead.
    const hasInvalidIndex = mapped.some((idx) => idx === undefined);
    const originalSelectedIndices = hasInvalidIndex
      ? []
      : [...mapped].sort((a, b) => a - b);
    const sortedCorrect = [...correctAnswers].sort((a, b) => a - b);

    // Correct if the selected indices exactly match the correct indices. A question
    // with no correct answers configured can never be satisfied — otherwise an empty
    // submission would trivially "match" it and score free points.
    const isCorrect =
      !hasInvalidIndex &&
      sortedCorrect.length > 0 &&
      originalSelectedIndices.length === sortedCorrect.length &&
      originalSelectedIndices.every((val, i) => val === sortedCorrect[i]);

    const pointsAwarded = isCorrect ? maxPoints : 0;
    earnedPoints += pointsAwarded;

    gradedAnswers.push({
      questionId: qsItem.questionId,
      selectedAnswerIndices,
      originalSelectedIndices,
      correctAnswerIndices: correctAnswers,
      isCorrect,
      pointsAwarded,
      maxPoints,
    });
  }

  const scorePercent = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
  const passed = scorePercent >= (attempt.passScore ?? 70);

  return {
    scorePercent,
    passed,
    totalPoints,
    earnedPoints,
    answers: gradedAnswers,
  };
}
