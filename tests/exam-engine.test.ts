// Grading is the highest-stakes pure logic in this codebase: its output decides who
// receives a compliance certificate. It had no tests at all.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeQuestion,
  makeQuestionSetItem,
  identityOrder,
  makeAttempt,
  type FakeQuestion,
} from "./factories";

const findUniqueAttempt = vi.fn();
const findManyQuestions = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    examAttempt: { findUnique: (...a: unknown[]) => findUniqueAttempt(...a) },
    question: { findMany: (...a: unknown[]) => findManyQuestions(...a) },
  },
}));

const { gradeExamAttempt, traineeIdentityWhere } = await import("@/lib/api/exam-engine");

/** Wire up the mocked database for one grading call. */
function stub(questions: FakeQuestion[], optionsOrders: Record<string, number[]>, passScore = 70) {
  const questionSet = questions.map((q, i) =>
    makeQuestionSetItem(q.id, i + 1, optionsOrders[q.id] ?? identityOrder(4))
  );
  findUniqueAttempt.mockResolvedValue(makeAttempt(questionSet, passScore));
  findManyQuestions.mockResolvedValue(questions);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("gradeExamAttempt — score denominator", () => {
  it("counts every question in the stored set, not just the answers submitted", async () => {
    // The exploit this guards: a 10-question exam where the client sends one correct
    // answer. Accumulating totalPoints inside the loop over `answers` scored that 100%
    // and issued a certificate.
    const questions = Array.from({ length: 10 }, (_, i) => makeQuestion(`q${i}`, { correctAnswers: [0] }));
    stub(questions, {});

    const result = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: [{ questionId: "q0", selectedAnswerIndices: [0] }],
    });

    expect(result.totalPoints).toBe(10);
    expect(result.earnedPoints).toBe(1);
    expect(result.scorePercent).toBe(10);
    expect(result.passed).toBe(false);
  });

  it("returns 100% only when every question is answered correctly", async () => {
    const questions = Array.from({ length: 4 }, (_, i) => makeQuestion(`q${i}`, { correctAnswers: [1] }));
    stub(questions, {});

    const result = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: questions.map((q) => ({ questionId: q.id, selectedAnswerIndices: [1] })),
    });

    expect(result.scorePercent).toBe(100);
    expect(result.passed).toBe(true);
  });

  it("weights questions by their points value", async () => {
    stub([
      makeQuestion("q1", { correctAnswers: [0], points: 1 }),
      makeQuestion("q2", { correctAnswers: [0], points: 9 }),
    ], {});

    const result = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: [{ questionId: "q2", selectedAnswerIndices: [0] }],
    });

    expect(result.totalPoints).toBe(10);
    expect(result.earnedPoints).toBe(9);
    expect(result.scorePercent).toBe(90);
  });

  it("does not double-count a question repeated in the payload", async () => {
    stub([makeQuestion("q1", { correctAnswers: [0] }), makeQuestion("q2", { correctAnswers: [0] })], {});

    const result = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: [
        { questionId: "q1", selectedAnswerIndices: [0] },
        { questionId: "q1", selectedAnswerIndices: [0] },
        { questionId: "q1", selectedAnswerIndices: [0] },
      ],
    });

    expect(result.totalPoints).toBe(2);
    expect(result.earnedPoints).toBe(1);
    expect(result.answers).toHaveLength(2);
  });

  it("ignores answers for questions that are not in the attempt's set", async () => {
    stub([makeQuestion("q1", { correctAnswers: [0] })], {});

    const result = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: [
        { questionId: "q1", selectedAnswerIndices: [0] },
        { questionId: "not-in-this-exam", selectedAnswerIndices: [0] },
      ],
    });

    expect(result.totalPoints).toBe(1);
    expect(result.answers).toHaveLength(1);
  });
});

describe("gradeExamAttempt — shuffled option mapping", () => {
  it("maps a selected displayed index back to its original index", async () => {
    // Displayed order [2,0,3,1]: the trainee picking displayed index 1 means original 0.
    stub([makeQuestion("q1", { correctAnswers: [0] })], { q1: [2, 0, 3, 1] });

    const correct = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: [{ questionId: "q1", selectedAnswerIndices: [1] }],
    });
    expect(correct.answers[0].isCorrect).toBe(true);
    expect(correct.answers[0].originalSelectedIndices).toEqual([0]);

    const wrong = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: [{ questionId: "q1", selectedAnswerIndices: [0] }],
    });
    expect(wrong.answers[0].isCorrect).toBe(false);
    expect(wrong.answers[0].originalSelectedIndices).toEqual([2]);
  });

  it("requires an exact match on multi-select questions", async () => {
    stub([makeQuestion("q1", { correctAnswers: [0, 2] })], { q1: [3, 2, 1, 0] });

    // Displayed indices 1 and 3 map to originals 2 and 0 — the full correct set.
    const exact = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: [{ questionId: "q1", selectedAnswerIndices: [1, 3] }],
    });
    expect(exact.answers[0].isCorrect).toBe(true);

    // A correct subset is not a correct answer.
    const partial = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: [{ questionId: "q1", selectedAnswerIndices: [1] }],
    });
    expect(partial.answers[0].isCorrect).toBe(false);
  });

  it("treats an out-of-range option index as a wrong answer, not a narrower one", async () => {
    // Dropping unmappable indices could shrink a wrong 2-option answer down to a
    // 1-option answer that happens to match the correct set.
    stub([makeQuestion("q1", { correctAnswers: [0] })], { q1: identityOrder(4) });

    const result = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: [{ questionId: "q1", selectedAnswerIndices: [0, 99] }],
    });

    expect(result.answers[0].isCorrect).toBe(false);
    expect(result.earnedPoints).toBe(0);
  });

  it("rejects a negative option index", async () => {
    stub([makeQuestion("q1", { correctAnswers: [0] })], { q1: identityOrder(4) });

    const result = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: [{ questionId: "q1", selectedAnswerIndices: [-1] }],
    });

    expect(result.answers[0].isCorrect).toBe(false);
  });
});

describe("gradeExamAttempt — degenerate questions", () => {
  it("never awards points for a question with no correct answers configured", async () => {
    // An empty submission against an empty correct set is `[] === []`, which the old
    // exact-match check scored as correct — free points for skipping.
    stub([makeQuestion("q1", { correctAnswers: [] })], {});

    const skipped = await gradeExamAttempt({ attemptId: "attempt-1", answers: [] });
    expect(skipped.earnedPoints).toBe(0);
    expect(skipped.answers[0].isCorrect).toBe(false);

    const attempted = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: [{ questionId: "q1", selectedAnswerIndices: [0] }],
    });
    expect(attempted.earnedPoints).toBe(0);
  });

  it("scores an entirely empty submission as zero, not a division by zero", async () => {
    stub([makeQuestion("q1", { correctAnswers: [0] }), makeQuestion("q2", { correctAnswers: [1] })], {});

    const result = await gradeExamAttempt({ attemptId: "attempt-1", answers: [] });

    expect(result.scorePercent).toBe(0);
    expect(result.totalPoints).toBe(2);
    expect(result.passed).toBe(false);
  });

  it("skips a question deleted from the bank since the attempt was created", async () => {
    const questionSet = [
      makeQuestionSetItem("q1", 1, identityOrder(4)),
      makeQuestionSetItem("gone", 2, identityOrder(4)),
    ];
    findUniqueAttempt.mockResolvedValue(makeAttempt(questionSet));
    findManyQuestions.mockResolvedValue([makeQuestion("q1", { correctAnswers: [0] })]);

    const result = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: [{ questionId: "q1", selectedAnswerIndices: [0] }],
    });

    expect(result.totalPoints).toBe(1);
    expect(result.scorePercent).toBe(100);
  });
});

describe("gradeExamAttempt — pass threshold", () => {
  it("passes at exactly the pass score", async () => {
    stub(
      Array.from({ length: 10 }, (_, i) => makeQuestion(`q${i}`, { correctAnswers: [0] })),
      {},
      70
    );

    const result = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: Array.from({ length: 7 }, (_, i) => ({ questionId: `q${i}`, selectedAnswerIndices: [0] })),
    });

    expect(result.scorePercent).toBe(70);
    expect(result.passed).toBe(true);
  });

  it("fails just below the pass score", async () => {
    stub(
      Array.from({ length: 10 }, (_, i) => makeQuestion(`q${i}`, { correctAnswers: [0] })),
      {},
      70
    );

    const result = await gradeExamAttempt({
      attemptId: "attempt-1",
      answers: Array.from({ length: 6 }, (_, i) => ({ questionId: `q${i}`, selectedAnswerIndices: [0] })),
    });

    expect(result.scorePercent).toBe(60);
    expect(result.passed).toBe(false);
  });

  it("throws when the attempt does not exist", async () => {
    findUniqueAttempt.mockResolvedValue(null);
    await expect(gradeExamAttempt({ attemptId: "nope", answers: [] })).rejects.toThrow(
      "Exam attempt not found"
    );
  });
});

describe("traineeIdentityWhere", () => {
  it("keys on the national ID when one is present", () => {
    expect(traineeIdentityWhere({ traineeName: "Mohammed", traineeIdNational: "1234567890" }))
      .toEqual({ traineeIdNational: "1234567890" });
  });

  it("falls back to the trimmed name when there is no national ID", () => {
    expect(traineeIdentityWhere({ traineeName: "  Mohammed Al-Otaibi  " }))
      .toEqual({ traineeName: "Mohammed Al-Otaibi" });
  });

  it("ignores a whitespace-only national ID", () => {
    expect(traineeIdentityWhere({ traineeName: "Sara", traineeIdNational: "   " }))
      .toEqual({ traineeName: "Sara" });
  });
});
