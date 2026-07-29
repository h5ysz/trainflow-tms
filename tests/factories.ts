// Minimal shapes for the records the units under test read. Deliberately not full
// Prisma models — each factory carries only the fields the code path touches, cast at
// the call site, so a schema addition doesn't break every test.
import type { QuestionSetItem } from "@/lib/api/exam-engine";

export interface FakeQuestion {
  id: string;
  options: string;          // JSON array of option strings
  correctAnswers: string;   // JSON array of original indices
  points: number;
  testType: string;
}

export function makeQuestion(
  id: string,
  opts: {
    optionCount?: number;
    correctAnswers?: number[];
    points?: number;
    testType?: string;
  } = {}
): FakeQuestion {
  const optionCount = opts.optionCount ?? 4;
  return {
    id,
    options: JSON.stringify(Array.from({ length: optionCount }, (_, i) => `Option ${i}`)),
    correctAnswers: JSON.stringify(opts.correctAnswers ?? [0]),
    points: opts.points ?? 1,
    testType: opts.testType ?? "PRE_TEST",
  };
}

/**
 * A questionSet entry. `optionsOrder[displayedIndex] = originalIndex`, i.e. the trainee
 * saw the options in this order.
 */
export function makeQuestionSetItem(
  questionId: string,
  order: number,
  optionsOrder: number[]
): QuestionSetItem {
  return { questionId, order, optionsOrder };
}

/** Identity mapping — the trainee saw the options in their original order. */
export function identityOrder(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

export interface FakeAttempt {
  id: string;
  deletedAt: Date | null;
  questionSet: string;
  passScore: number | null;
}

export function makeAttempt(questionSet: QuestionSetItem[], passScore = 70): FakeAttempt {
  return {
    id: "attempt-1",
    deletedAt: null,
    questionSet: JSON.stringify(questionSet),
    passScore,
  };
}
