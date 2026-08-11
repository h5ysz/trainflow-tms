// TRAINER OPPORTUNITY — feature verification
// =====================================================================
// The "Trainer Immediate Opportunity" (special test opportunity) is the
// delivery-only exception a TRAINER can grant to a trainee who FAILED the
// final assessment in the trainer's OWN session. This test proves the real
// route (through the actual guard chain) behaves per business rules:
//   1. Assigned trainer can mark pass/fail — once, before session COMPLETED,
//      only after a FAILED final test.
//   2. Non-assigned trainer, AUDITOR and CONTRACTOR are all blocked.
//   3. It creates NO ExamAttempt, NO RetestRequest and NO audit-log row, so it
//      is inherently invisible to the auditor in attempt lists, reports and logs.
// =====================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  actionPermissions,
} from "@/lib/auth/permissions";
import { verifyToken } from "@/lib/auth/jwt";

// ── Mocks (registered before any route module is imported) ──────────────
const { fakeDb } = vi.hoisted(() => {
  const m = () => vi.fn();
  return {
    fakeDb: {
      user: { findUnique: m() },
      sessionEnrollment: { findUnique: m(), update: m() },
      examAttempt: { findUnique: m(), findFirst: m(), findMany: m(), create: m() },
      auditLog: { create: m(), findMany: m(), findFirst: m(), count: m() },
      retestRequest: { create: m(), findFirst: m() },
    },
  };
});

vi.mock("@/lib/db", () => ({ db: fakeDb }));
vi.mock("@/lib/api/enrollment-sync", () => ({
  recalcCertificateEligibility: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: () => ({ value: "test-token" }),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));
vi.mock("@/lib/auth/jwt", () => ({
  verifyToken: vi.fn(),
  signToken: vi.fn(() => "signed-token"),
  verifyPassword: vi.fn(),
}));

// Route handler — imported AFTER the mocks above are registered.
import { POST as postTrainerOpportunity } from "@/app/api/sessions/[id]/enrollments/[enrollmentId]/trainer-opportunity/route";
import { recalcCertificateEligibility } from "@/lib/api/enrollment-sync";

// ── Fixtures ────────────────────────────────────────────────────────────
function permsOf(role: keyof typeof actionPermissions): string[] {
  const out: string[] = [];
  for (const [mod, actions] of Object.entries(actionPermissions[role])) {
    for (const a of actions) out.push(`${mod}.${a}`);
  }
  return out;
}

const DB_USER = (role: "TRAINER" | "AUDITOR" | "CONTRACTOR", trainerId: string | null) => ({
  id: "user-1",
  isActive: true,
  accountStatus: "ACTIVE",
  deletedAt: null,
  tokenVersion: 0,
  role,
  roleId: `role-${role.toLowerCase()}`,
  roleRecord: { permissions: permsOf(role) },
  companyId: null,
  trainerId,
  region: null,
  regionsCovered: null,
  language: "ar",
});

function enrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: "enr-1",
    deletedAt: null,
    sessionId: "sess-1",
    finalTestStatus: "FAILED",
    trainerOpportunityUsed: false,
    trainerOpportunityPassed: null,
    trainerOpportunityAt: null,
    trainerOpportunityBy: null,
    session: {
      id: "sess-1",
      refNumber: "SES-000001",
      trainerId: "tr-1",
      status: "ONGOING",
      lifecycleStatus: "IN_PROGRESS",
    },
    trainee: { id: "trn-1", fullName: "Trainee A", nationalId: "1234567890" },
    ...overrides,
  };
}

async function post(body: Record<string, unknown>, params: Record<string, string> = { id: "sess-1", enrollmentId: "enr-1" }) {
  return postTrainerOpportunity(
    new Request("http://localhost/api/sessions/sess-1/enrollments/enr-1/trainer-opportunity", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params },
  );
}

function mockAuthAs(role: "TRAINER" | "AUDITOR" | "CONTRACTOR", trainerId: string | null) {
  vi.mocked(verifyToken).mockReturnValue({
    sub: "user-1",
    role,
    tokenVersion: 0,
    email: "user@gcclab.com",
  } as any);
  fakeDb.user.findUnique.mockResolvedValue(DB_USER(role, trainerId) as any);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuthAs("TRAINER", "tr-1");
  fakeDb.sessionEnrollment.findUnique.mockResolvedValue(enrollment() as any);
  fakeDb.sessionEnrollment.update.mockResolvedValue(enrollment() as any);
  vi.mocked(recalcCertificateEligibility).mockResolvedValue(undefined as any);
});

async function json(res: Response) {
  return (await res.json()) as any;
}

// ── 1. Assigned trainer can grant the opportunity ───────────────────────
describe("TRAINER — assigned trainer (own session)", () => {
  it("marks PASS and continues the certificate workflow", async () => {
    const res = await post({ passed: true });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.data.trainerOpportunityUsed).toBe(true);
    expect(body.data.trainerOpportunityPassed).toBe(true);
    expect(body.data.finalTestStatus).toBe("PASSED");

    expect(fakeDb.sessionEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "enr-1" },
        data: expect.objectContaining({
          trainerOpportunityUsed: true,
          trainerOpportunityPassed: true,
          finalTestStatus: "PASSED",
          trainerOpportunityBy: "user-1",
          trainerOpportunityAt: expect.any(Date),
        }),
      })
    );
    // Passed -> eligibility recalculation runs (no audit, no retest).
    expect(recalcCertificateEligibility).toHaveBeenCalledTimes(1);
    expect(fakeDb.examAttempt.create).not.toHaveBeenCalled();
    expect(fakeDb.retestRequest.create).not.toHaveBeenCalled();
    expect(fakeDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("marks FAIL and leaves the trainee awaiting official retest", async () => {
    const res = await post({ passed: false });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.trainerOpportunityPassed).toBe(false);
    expect(body.data.finalTestStatus).toBe("FAILED");

    const call = fakeDb.sessionEnrollment.update.mock.calls[0][0] as any;
    expect(call.data).toMatchObject({
      trainerOpportunityUsed: true,
      trainerOpportunityPassed: false,
      trainerOpportunityBy: "user-1",
    });
    expect(call.data.finalTestStatus).toBeUndefined();
    // Failed -> no eligibility recalculation.
    expect(recalcCertificateEligibility).not.toHaveBeenCalled();
    expect(fakeDb.auditLog.create).not.toHaveBeenCalled();
  });

  it("is allowed only once per enrollment", async () => {
    fakeDb.sessionEnrollment.findUnique.mockResolvedValue(
      enrollment({ trainerOpportunityUsed: true, trainerOpportunityPassed: true }) as any
    );
    const res = await post({ passed: true });
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.code).toBe("TRAINER_OPPORTUNITY_ALREADY_USED");
    expect(fakeDb.sessionEnrollment.update).not.toHaveBeenCalled();
  });

  it("is unavailable after the session is COMPLETED", async () => {
    fakeDb.sessionEnrollment.findUnique.mockResolvedValue(
      enrollment({ session: { id: "sess-1", refNumber: "SES-000001", trainerId: "tr-1", status: "COMPLETED", lifecycleStatus: "COMPLETED" } }) as any
    );
    const res = await post({ passed: true });
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.code).toBe("SESSION_COMPLETED");
    expect(fakeDb.sessionEnrollment.update).not.toHaveBeenCalled();
  });

  it("is available only after a FAILED final test", async () => {
    fakeDb.sessionEnrollment.findUnique.mockResolvedValue(
      enrollment({ finalTestStatus: "PASSED" }) as any
    );
    const res = await post({ passed: true });
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.code).toBe("FINAL_TEST_NOT_FAILED");
    expect(fakeDb.sessionEnrollment.update).not.toHaveBeenCalled();
  });

  it("rejects a request without the passed flag", async () => {
    const res = await post({});
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(fakeDb.sessionEnrollment.update).not.toHaveBeenCalled();
  });

  it("rejects an enrollment that does not belong to the session", async () => {
    fakeDb.sessionEnrollment.findUnique.mockResolvedValue(
      enrollment({ sessionId: "sess-other" }) as any
    );
    const res = await post({ passed: true });
    expect(res.status).toBe(404);
    expect(fakeDb.sessionEnrollment.update).not.toHaveBeenCalled();
  });
});

// ── 2. Ownership — only the session's assigned trainer ──────────────────
describe("TRAINER ownership enforcement", () => {
  it("blocks a trainer who is NOT assigned to the session", async () => {
    mockAuthAs("TRAINER", "tr-2"); // user's trainer is tr-2, session trainer is tr-1
    const res = await post({ passed: true });
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.code).toBe("NOT_ASSIGNED_TRAINER");
    expect(fakeDb.sessionEnrollment.update).not.toHaveBeenCalled();
    expect(recalcCertificateEligibility).not.toHaveBeenCalled();
  });
});

// ── 3. AUDITOR & CONTRACTOR are blocked at the guard ────────────────────
describe("AUDITOR / CONTRACTOR isolation", () => {
  it("AUDITOR is rejected (read-only sessions.view, no edit)", async () => {
    mockAuthAs("AUDITOR", null);
    const res = await post({ passed: true });
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.success).toBe(false);
    // No enrollment data may leak to the auditor.
    expect(body.data).toBeUndefined();
    expect(body.enrollmentId).toBeUndefined();
    expect(fakeDb.sessionEnrollment.update).not.toHaveBeenCalled();
  });

  it("CONTRACTOR is rejected (no sessions module at all)", async () => {
    mockAuthAs("CONTRACTOR", null);
    const res = await post({ passed: true });
    expect(res.status).toBe(403);
    expect(fakeDb.sessionEnrollment.update).not.toHaveBeenCalled();
  });
});
