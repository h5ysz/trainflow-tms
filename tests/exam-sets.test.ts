// Unit tests for the trainer-controlled session exam question sets: generation,
// regeneration, approval, and the "approved set wins" resolution the exam engine
// relies on. The generator must never mutate the Question Bank, and nothing here
// can change a set automatically.
import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirstSet = vi.fn();
const findUniqueSet = vi.fn();
const createSet = vi.fn();
const updateSet = vi.fn();
const aggregateSet = vi.fn();
const findManyQuestions = vi.fn();
const countQuestions = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    sessionExamSet: {
      findFirst: (...a: unknown[]) => findFirstSet(...a),
      findUnique: (...a: unknown[]) => findUniqueSet(...a),
      create: (...a: unknown[]) => createSet(...a),
      update: (...a: unknown[]) => updateSet(...a),
      aggregate: (...a: unknown[]) => aggregateSet(...a),
    },
    question: {
      findMany: (...a: unknown[]) => findManyQuestions(...a),
      count: (...a: unknown[]) => countQuestions(...a),
    },
  },
}));

const {
  resolveActiveSetQuestions,
  parseQuestionIds,
  createDraftSet,
  regenerateDraftSet,
  approveSet,
  discardSet,
} = await import("@/lib/api/exam-sets");

interface FakeQuestionRow {
  id: string;
  courseId: string;
  testType: string;
  text: string;
  textAr?: string | null;
  options: string;
  optionsAr?: string | null;
  correctAnswers: string;
  points: number;
  order: number;
  isActive: boolean;
  imageUrl?: string | null;
  type: string;
  category?: string | null;
  difficulty: string;
  deletedAt: Date | null;
}

function makeQuestion(id: string, opts: { isActive?: boolean; deletedAt?: boolean } = {}): FakeQuestionRow {
  return {
    id,
    courseId: "course-1",
    testType: "PRE_TEST",
    text: `Question ${id}`,
    textAr: null,
    options: JSON.stringify(["A", "B", "C", "D"]),
    optionsAr: null,
    correctAnswers: JSON.stringify([0]),
    points: 1,
    order: 1,
    isActive: opts.isActive ?? true,
    imageUrl: `/question-images/figure-${id}.png`,
    type: "SINGLE_CHOICE",
    category: null,
    difficulty: "MEDIUM",
    deletedAt: opts.deletedAt ? new Date() : null,
  };
}

function makeSet(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "set-1",
    sessionId: "session-1",
    testType: "PRE_TEST",
    status: "DRAFT",
    version: 1,
    numQuestions: 2,
    questionIds: JSON.stringify(["a", "b"]),
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "user-1",
    updatedBy: "user-1",
    approvedAt: null,
    approvedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

// Simulate Prisma's `where` filtering for question.findMany so the resolver's
// isActive/deletedAt filters are exercised rather than ignored by the mock.
function mockBank(rows: FakeQuestionRow[]) {
  findManyQuestions.mockImplementation(
    ({ where }: { where?: Record<string, unknown> } = {}) => {
      let out = rows;
      const idIn = where?.id as { in?: string[] } | undefined;
      if (idIn?.in) out = out.filter((r) => idIn.in!.includes(r.id));
      if (where?.isActive === true) out = out.filter((r) => r.isActive === true);
      if (where?.deletedAt === null) out = out.filter((r) => r.deletedAt === null);
      return Promise.resolve(out);
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseQuestionIds", () => {
  it("parses a valid JSON array of ids", () => {
    expect(parseQuestionIds('["a","b","c"]')).toEqual(["a", "b", "c"]);
  });

  it("returns [] for null / empty / garbage", () => {
    expect(parseQuestionIds(null)).toEqual([]);
    expect(parseQuestionIds(undefined)).toEqual([]);
    expect(parseQuestionIds("not-json")).toEqual([]);
    expect(parseQuestionIds("{}")).toEqual([]);
  });
});

describe("resolveActiveSetQuestions", () => {
  it("returns the approved set's questions in the stored order", async () => {
    // Approved order is [c, a, b]; the resolver must preserve it, not the DB order.
    findFirstSet.mockResolvedValue(
      makeSet({ status: "APPROVED", approvedAt: new Date(), approvedBy: "user-1", questionIds: JSON.stringify(["c", "a", "b"]) })
    );
    findManyQuestions.mockResolvedValue([makeQuestion("a"), makeQuestion("b"), makeQuestion("c")]);

    const questions = await resolveActiveSetQuestions("session-1", "PRE_TEST");

    expect(questions?.map((q) => q.id)).toEqual(["c", "a", "b"]);
  });

  it("filters out questions deactivated or deleted since approval", async () => {
    findFirstSet.mockResolvedValue(
      makeSet({ status: "APPROVED", questionIds: JSON.stringify(["ok", "gone", "inactive"]) })
    );
    mockBank([
      makeQuestion("ok"),
      makeQuestion("gone", { deletedAt: true }),
      makeQuestion("inactive", { isActive: false }),
    ]);

    const questions = await resolveActiveSetQuestions("session-1", "PRE_TEST");

    expect(questions?.map((q) => q.id)).toEqual(["ok"]);
  });

  it("returns null when no approved set exists (fallback to the bank)", async () => {
    findFirstSet.mockResolvedValue(null);
    expect(await resolveActiveSetQuestions("session-1", "FINAL_TEST")).toBeNull();
  });

  it("returns null when the approved set's questions are all inactive", async () => {
    findFirstSet.mockResolvedValue(makeSet({ status: "APPROVED", questionIds: JSON.stringify(["x"]) }));
    mockBank([makeQuestion("x", { isActive: false })]);
    expect(await resolveActiveSetQuestions("session-1", "PRE_TEST")).toBeNull();
  });
});

describe("createDraftSet", () => {
  it("creates a DRAFT with the requested count and an incremented version", async () => {
    countQuestions.mockResolvedValue(3);
    findManyQuestions.mockResolvedValue([makeQuestion("a"), makeQuestion("b"), makeQuestion("c")]);
    aggregateSet.mockResolvedValue({ _max: { version: 2 } });
    createSet.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "set-3", ...data })
    );

    const set = await createDraftSet({
      sessionId: "session-1",
      courseId: "course-1",
      testType: "PRE_TEST",
      numQuestions: 2,
      userId: "user-1",
    });

    expect(createSet).toHaveBeenCalledTimes(1);
    const data = createSet.mock.calls[0][0].data;
    expect(data.status).toBe("DRAFT");
    expect(data.version).toBe(3);
    expect(data.numQuestions).toBe(2);
    expect(JSON.parse(data.questionIds)).toHaveLength(2);
    expect(data.createdBy).toBe("user-1");
    expect(set?.id).toBe("set-3");
  });

  it("returns null when the bank has no active questions", async () => {
    countQuestions.mockResolvedValue(0);
    const set = await createDraftSet({
      sessionId: "session-1",
      courseId: "course-1",
      testType: "PRE_TEST",
      userId: "user-1",
    });
    expect(set).toBeNull();
    expect(createSet).not.toHaveBeenCalled();
  });
});

describe("regenerateDraftSet", () => {
  it("rejects an approved set", async () => {
    findUniqueSet.mockResolvedValue(makeSet({ status: "APPROVED" }));
    await expect(
      regenerateDraftSet({ setId: "set-1", courseId: "course-1", userId: "user-1" })
    ).rejects.toThrow("Only a draft set can be regenerated");
  });

  it("draws a fresh sample into the draft and updates it", async () => {
    findUniqueSet.mockResolvedValue(makeSet({ status: "DRAFT", questionIds: JSON.stringify(["a", "b"]) }));
    countQuestions.mockResolvedValue(4);
    findManyQuestions.mockResolvedValue([makeQuestion("a"), makeQuestion("b"), makeQuestion("c"), makeQuestion("d")]);
    updateSet.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "set-1", ...data })
    );

    const updated = await regenerateDraftSet({ setId: "set-1", courseId: "course-1", numQuestions: 2, userId: "user-1" });

    const data = updateSet.mock.calls[0][0].data;
    expect(updated).not.toBeNull();
    expect(data.numQuestions).toBe(2);
    expect(JSON.parse(data.questionIds)).toHaveLength(2);
    expect(data.updatedBy).toBe("user-1");
  });
});

describe("approveSet", () => {
  it("approves a draft and stamps approvedAt / approvedBy", async () => {
    findUniqueSet.mockResolvedValue(makeSet({ status: "DRAFT" }));
    updateSet.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "set-1", ...data })
    );

    const approved = await approveSet({ setId: "set-1", userId: "user-1" });

    const data = updateSet.mock.calls[0][0].data;
    expect(data.status).toBe("APPROVED");
    expect(data.approvedBy).toBe("user-1");
    expect(data.approvedAt).toBeInstanceOf(Date);
    expect(approved).not.toBeNull();
  });

  it("rejects approving an already-approved set", async () => {
    findUniqueSet.mockResolvedValue(makeSet({ status: "APPROVED" }));
    await expect(approveSet({ setId: "set-1", userId: "user-1" })).rejects.toThrow(
      "Only a draft set can be approved"
    );
  });
});

describe("discardSet", () => {
  it("soft-deletes a draft", async () => {
    findUniqueSet.mockResolvedValue(makeSet({ status: "DRAFT" }));
    updateSet.mockResolvedValue({ id: "set-1" });

    await discardSet({ setId: "set-1", userId: "user-1" });

    const data = updateSet.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
  });

  it("rejects discarding an approved set (kept for audit)", async () => {
    findUniqueSet.mockResolvedValue(makeSet({ status: "APPROVED" }));
    await expect(discardSet({ setId: "set-1", userId: "user-1" })).rejects.toThrow(
      "Only a draft set can be discarded"
    );
  });
});
