// TRAINER RBAC — delivery-scoped isolation verification
// =====================================================================
// 1. The permission matrix (actionPermissions.TRAINER) grants no administrative
//    module, no certificates module, and no create/delete on sessions.
// 2. Every trainer list query is scoped server-side to the authenticated
//    trainer's OWN records (trainerId derived from the user, never the client):
//    sessions, courses (via own sessions) and trainees (via own enrollments).
// 3. The real route guard chain (withModuleAction -> requireModuleAction ->
//    getCurrentUser) rejects direct-URL requests: admin APIs return 403, and a
//    trainer cannot open another trainer's session.
// =====================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  actionPermissions,
  canAccessModule,
  canPerformAction,
  getNavForRole,
  type RouteKey,
} from "@/lib/auth/permissions";
import {
  TEST_TRAINER_TRAINER_ID,
  isTestTrainer,
  trainerIdOf,
  scopeSessionList,
  trainerDeniedSession,
  trainerSessionFilter,
  trainerTraineeFilter,
  trainerWorkshopFilter,
  trainerEvaluationFilter,
} from "@/lib/api/trainer-scope";
import { verifyToken } from "@/lib/auth/jwt";

// ── Mocks (registered before any route module is imported) ──────────────
const { fakeDb } = vi.hoisted(() => {
  const m = () => vi.fn();
  return {
    fakeDb: {
      user: { findUnique: m(), findFirst: m(), findMany: m() },
      role: { findUnique: m() },
      trainingSession: { findMany: m(), count: m(), findUnique: m(), findFirst: m(), update: m() },
      workshop: { findMany: m(), count: m(), findUnique: m() },
      courseEvaluation: { findMany: m(), count: m() },
      trainee: { findMany: m(), count: m(), findUnique: m() },
      sessionEnrollment: { count: m(), findMany: m() },
      workshopTrainerAuthorization: { count: m(), findFirst: m() },
      attendance: { findUnique: m(), findFirst: m() },
      examAttempt: { findUnique: m(), findFirst: m(), findMany: m(), count: m(), update: m() },
      testResult: { findMany: m(), count: m(), create: m() },
      sessionLifecycleEvent: { findMany: m() },
      certificate: { findMany: m(), findFirst: m() },
      course: { findUnique: m(), findMany: m(), count: m() },
      refNumberCounter: { upsert: m() },
      auditLog: { create: m() },
      workerPassport: { findMany: m(), findFirst: m(), findUnique: m() },
    },
  };
});

vi.mock("@/lib/db", () => ({ db: fakeDb }));
vi.mock("exceljs", () => {
  function Workbook(this: any) {
    this.creator = "";
    this.created = null;
    this.addWorksheet = () => ({
      columns: [],
      rows: [],
      addRow: () => ({}),
      getRow: () => ({}),
    });
    this.xlsx = { writeBuffer: async () => new Uint8Array(0) };
  }
  return { Workbook, default: { Workbook } };
});
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

// Route handlers — imported AFTER the mocks above are registered.
import { GET as getSessions } from "@/app/api/sessions/route";
import { GET as getSessionById, PUT as putSessionById, DELETE as deleteSessionById } from "@/app/api/sessions/[id]/route";
import { POST as postCertificate } from "@/app/api/certificates/route";
import { GET as getPayments } from "@/app/api/payments/route";
import { GET as getRequests } from "@/app/api/requests/route";
import { GET as getWorkshops } from "@/app/api/workshops/route";
import { GET as getEvaluations } from "@/app/api/evaluations/route";
import { GET as getTrainees } from "@/app/api/trainees/route";
import { GET as getExamAttempts } from "@/app/api/exam-attempts/route";
import { GET as getExamAttemptById } from "@/app/api/exam-attempts/[id]/route";
import { POST as postReopenAttempt } from "@/app/api/exam-attempts/[id]/reopen/route";
import { PUT as putEditAttemptResult } from "@/app/api/exam-attempts/[id]/edit-result/route";
import { GET as getTestResults, POST as postTestResult } from "@/app/api/test-results/route";
import { GET as getSessionExport } from "@/app/api/sessions/export/route";
import { GET as getTrainingRecord } from "@/app/api/trainees/[id]/training-record/route";
import { GET as getTraineeHistory } from "@/app/api/trainees/[id]/history/route";
import { GET as getCourseById } from "@/app/api/courses/[id]/route";
import { GET as getCourses } from "@/app/api/courses/route";

// ── Fixtures ────────────────────────────────────────────────────────────
function trainerPerms(): string[] {
  const out: string[] = [];
  for (const [mod, actions] of Object.entries(actionPermissions.TRAINER)) {
    for (const a of actions) out.push(`${mod}.${a}`);
  }
  return out;
}

const TRAINER_A_DB = {
  id: "user-1",
  email: "trainer.a@gcclab.com",
  fullName: "Trainer A",
  role: "TRAINER",
  status: "ACTIVE",
  deletedAt: null,
  isActive: true,
  accountStatus: "ACTIVE",
  tokenVersion: 0,
  trainerId: "tr-1",
  region: null,
  regionsCovered: null,
  companyId: null,
  language: "ar",
  roleId: "role-trainer",
  roleRecord: { roleCode: "TRAINER", tokenVersion: 0, permissions: trainerPerms() },
};

const TRAINER_A = { role: "TRAINER", trainerId: "tr-1" };
const NON_TRAINER = { role: "COORDINATOR", trainerId: null };

async function json(res: Response) {
  return (await res.json()) as any;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(verifyToken).mockReturnValue({
    sub: "user-1",
    role: "TRAINER",
    tokenVersion: 0,
    email: "trainer.a@gcclab.com",
  } as any);
  fakeDb.user.findUnique.mockResolvedValue(TRAINER_A_DB as any);
});

// ── 1. Permission matrix: no administrative module ───────────────────────
const ADMIN_MODULES: RouteKey[] = [
  "companies",
  "company-contacts",
  "trainers",
  "trainer-qualifications",
  "requests",
  "scheduling",
  "certificates",
  "reports",
  "audit-log",
  "user-approvals",
  "user-management",
  "roles",
  "worker-passports",
  "compliance-matrix",
  "executive-dashboard",
  "renewal-dashboard",
  "settings",
  "payments",
  "invoices",
  "quotations",
  "receipts",
  "bank-accounts",
  "financial-settings",
  "financial-reports",
  "ai-dashboard",
];

describe("TRAINER permission matrix (delivery-scoped)", () => {
  it("grants no administrative module and no admin action", () => {
    const perms = trainerPerms();
    for (const mod of ADMIN_MODULES) {
      expect(canAccessModule(perms, mod)).toBe(false);
      expect(canPerformAction(perms, mod, "view")).toBe(false);
    }
  });

  it("grants the delivery modules the trainer needs", () => {
    const perms = trainerPerms();
    expect(canAccessModule(perms, "dashboard")).toBe(true);
    expect(canAccessModule(perms, "courses")).toBe(true);
    expect(canAccessModule(perms, "trainees")).toBe(true);
    expect(canAccessModule(perms, "sessions")).toBe(true);
    expect(canAccessModule(perms, "attendance")).toBe(true);
    expect(canAccessModule(perms, "qr-code")).toBe(true);
    expect(canAccessModule(perms, "pre-test")).toBe(true);
    expect(canAccessModule(perms, "final-test")).toBe(true);
    expect(canAccessModule(perms, "evaluation")).toBe(true);
    expect(canAccessModule(perms, "workshops")).toBe(true);
    expect(canAccessModule(perms, "notifications")).toBe(true);
  });

  it("keeps sessions read/edit for delivery but never create/delete", () => {
    const perms = trainerPerms();
    expect(canPerformAction(perms, "sessions", "edit")).toBe(true); // lifecycle (start/complete) on own sessions
    expect(canPerformAction(perms, "sessions", "create")).toBe(false);
    expect(canPerformAction(perms, "sessions", "delete")).toBe(false);
    expect(canPerformAction(perms, "attendance", "create")).toBe(true);
    expect(canPerformAction(perms, "attendance", "delete")).toBe(false);
    expect(canPerformAction(perms, "qr-code", "create")).toBe(true); // activate QR window on own sessions
    expect(canPerformAction(perms, "qr-code", "edit")).toBe(false);
    expect(canPerformAction(perms, "pre-test", "create")).toBe(true); // run exams
    expect(canPerformAction(perms, "pre-test", "edit")).toBe(true);   // manage questions
    expect(canPerformAction(perms, "final-test", "create")).toBe(true);
    expect(canPerformAction(perms, "final-test", "edit")).toBe(true);
    // Read-only visibility of the trainer's own courses + trainees; no writes.
    expect(canPerformAction(perms, "courses", "view")).toBe(true);
    expect(canPerformAction(perms, "courses", "create")).toBe(false);
    expect(canPerformAction(perms, "trainees", "view")).toBe(true);
    expect(canPerformAction(perms, "trainees", "edit")).toBe(false);
    // Certificates stay coordinator-only.
    expect(canPerformAction(perms, "certificates", "view")).toBe(false);
    expect(canPerformAction(perms, "certificates", "create")).toBe(false);
  });

  it("sidebar nav exposes only the trainer's scoped modules", () => {
    const keys = getNavForRole(trainerPerms()).map((i) => i.key);
    expect(keys).toContain("sessions");
    expect(keys).toContain("attendance");
    expect(keys).toContain("evaluation");
    expect(keys).toContain("courses");
    expect(keys).toContain("trainees");
    expect(keys).not.toContain("requests");
    expect(keys).not.toContain("certificates");
    expect(keys).not.toContain("companies");
    expect(keys).not.toContain("reports");
    expect(keys).not.toContain("audit-log");
    expect(keys).not.toContain("worker-passports");
    expect(keys).not.toContain("user-approvals");
    expect(keys).not.toContain("payments");
    expect(keys).not.toContain("ai-dashboard");
  });
});

// ── 2. Scoping helpers — derived from the authenticated user ─────────────
describe("trainer-scope helpers", () => {
  it("derive trainerId from the authenticated user only", () => {
    expect(trainerIdOf(TRAINER_A as any)).toBe("tr-1");
    expect(trainerIdOf(NON_TRAINER as any)).toBeNull();
    expect(trainerIdOf({ role: "CONTRACTOR", trainerId: "c-1" } as any)).toBeNull();
    expect(trainerIdOf({ role: "TRAINER", trainerId: null } as any)).toBeNull();
  });

  it("scopeSessionList pins where.trainerId and overrides a crafted filter", () => {
    const where: Record<string, unknown> = {};
    scopeSessionList(where, TRAINER_A as any);
    expect(where.trainerId).toBe("tr-1");
    const crafted: Record<string, unknown> = { trainerId: "tr-2" };
    scopeSessionList(crafted, TRAINER_A as any);
    expect(crafted.trainerId).toBe("tr-1");
  });

  it("trainerDeniedSession blocks another trainer's session but never non-trainers", () => {
    expect(trainerDeniedSession(TRAINER_A as any, "tr-2")).toBe(true);
    expect(trainerDeniedSession(TRAINER_A as any, "tr-1")).toBe(false);
    expect(trainerDeniedSession(TRAINER_A as any, null)).toBe(true);
    expect(trainerDeniedSession(NON_TRAINER as any, "tr-2")).toBe(false);
  });

  it("builds relation filters scoped to the trainer", () => {
    expect(trainerSessionFilter(TRAINER_A as any)).toEqual({ session: { trainerId: "tr-1" } });
    expect(trainerTraineeFilter(TRAINER_A as any)).toEqual({
      sessionEnrollments: { some: { session: { trainerId: "tr-1" } } },
    });
    expect(trainerWorkshopFilter(TRAINER_A as any)).toEqual({
      authorizations: { some: { trainerId: "tr-1" } },
    });
    expect(trainerEvaluationFilter(TRAINER_A as any)).toEqual({ trainerId: "tr-1" });
    expect(trainerSessionFilter(NON_TRAINER as any)).toBeNull();
    expect(trainerTraineeFilter(NON_TRAINER as any)).toBeNull();
    expect(trainerWorkshopFilter(NON_TRAINER as any)).toBeNull();
    expect(trainerEvaluationFilter(NON_TRAINER as any)).toBeNull();
  });
});

// ── 3. API-level protection (real guard chain, mocked auth/db) ───────────
describe("TRAINER API protection", () => {
  it("sessions list returns only the trainer's own sessions", async () => {
    const sessions = [
      {
        id: "sess-1", trainerId: "tr-1", refNumber: "SES-000001", title: "A", deletedAt: null, status: "SCHEDULED",
        _count: { attendance: 0, certificates: 0 },
      },
      {
        id: "sess-2", trainerId: "tr-2", refNumber: "SES-000002", title: "B", deletedAt: null, status: "SCHEDULED",
        _count: { attendance: 0, certificates: 0 },
      },
    ];
    const own = (where: any) => sessions.filter((s) => (where.trainerId ? s.trainerId === where.trainerId : true));
    fakeDb.trainingSession.findMany.mockImplementation((args: any) => Promise.resolve(own(args?.where ?? {})));
    fakeDb.trainingSession.count.mockImplementation((args: any) => Promise.resolve(own(args?.where ?? {}).length));

    const res = await getSessions(new Request("http://localhost/api/sessions"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("sess-1");
    expect(fakeDb.trainingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ trainerId: "tr-1" }) })
    );
  });

  it("session detail returns 403 for another trainer's session and 200 for own", async () => {
    fakeDb.trainingSession.findUnique.mockResolvedValue({
      id: "sess-2",
      trainerId: "tr-2",
      deletedAt: null,
      title: "B",
    } as any);
    let res = await getSessionById(new Request("http://localhost/api/sessions/sess-2"), {
      params: { id: "sess-2" },
    } as any);
    expect(res.status).toBe(403);

    fakeDb.trainingSession.findUnique.mockResolvedValue({
      id: "sess-1",
      trainerId: "tr-1",
      deletedAt: null,
      title: "A",
    } as any);
    res = await getSessionById(new Request("http://localhost/api/sessions/sess-1"), {
      params: { id: "sess-1" },
    } as any);
    expect(res.status).toBe(200);
  });

  it("trainees list returns only trainees enrolled in the trainer's own sessions", async () => {
    // A trainer has no standalone admin trainees module — trainee visibility is
    // scoped to enrollments in the trainer's OWN sessions, derived from the
    // authenticated user's trainerId server-side.
    const trainees = [
      { id: "tr-1", fullName: "Enrolled Trainee", refNumber: "TRA-000001", deletedAt: null, _count: { requestCourses: 0 } },
      { id: "tr-2", fullName: "Other Trainee", refNumber: "TRA-000002", deletedAt: null, _count: { requestCourses: 0 } },
    ];
    const scoped = (where: any) => {
      const trainerId = where.sessionEnrollments?.some?.session?.trainerId;
      return trainees.filter((t) => (trainerId ? t.id === "tr-1" : true));
    };
    fakeDb.trainee.findMany.mockImplementation((args: any) => Promise.resolve(scoped(args?.where ?? {})));
    fakeDb.trainee.count.mockImplementation((args: any) => Promise.resolve(scoped(args?.where ?? {}).length));
    fakeDb.workerPassport.findMany.mockResolvedValue([]);

    const res = await getTrainees(new Request("http://localhost/api/trainees"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.map((r: any) => r.id)).toEqual(["tr-1"]);
    expect(fakeDb.trainee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sessionEnrollments: { some: { session: { trainerId: "tr-1" } } } }) })
    );
  });

  it("workshops list returns only the trainer's authorized workshops", async () => {
    const workshops = [
      { id: "w1", code: "WSH-000001", title: "Workshop 1", ownerTrainerId: "tr-1", deletedAt: null },
      { id: "w2", code: "WSH-000002", title: "Workshop 2", ownerTrainerId: "tr-2", deletedAt: null },
    ];
    const owned = (where: any) => {
      const t = where.authorizations?.some?.trainerId;
      return workshops.filter((w) => (t ? w.ownerTrainerId === t : true));
    };
    fakeDb.workshop.findMany.mockImplementation((args: any) =>
      Promise.resolve(owned(args?.where ?? {}).map((w) => ({ ...w, _count: { authorizations: 0 } })))
    );
    fakeDb.workshop.count.mockImplementation((args: any) => Promise.resolve(owned(args?.where ?? {}).length));

    const res = await getWorkshops(new Request("http://localhost/api/workshops"));
    const body = await json(res);
    expect(fakeDb.workshop.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ authorizations: { some: { trainerId: "tr-1" } } }) })
    );
    expect(body.data.map((r: any) => r.id)).toEqual(["w1"]);
  });

  it("workshops list is empty when the trainer has no authorized workshop", async () => {
    fakeDb.workshop.findMany.mockResolvedValue([]);
    fakeDb.workshop.count.mockResolvedValue(0);
    const res = await getWorkshops(new Request("http://localhost/api/workshops"));
    const body = await json(res);
    expect(body.data).toEqual([]);
    expect(fakeDb.workshop.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ authorizations: { some: { trainerId: "tr-1" } } }) })
    );
  });

  it("evaluations list returns only evaluations that rate the trainer", async () => {
    const evals = [
      { id: "e-1", sessionId: "sess-1", trainerId: "tr-1", traineeName: "X" },
      { id: "e-2", sessionId: "sess-2", trainerId: "tr-2", traineeName: "Y" },
    ];
    fakeDb.courseEvaluation.findMany.mockImplementation((args: any) => {
      const where = args?.where ?? {};
      return Promise.resolve(evals.filter((e) => (where.trainerId ? e.trainerId === where.trainerId : true)));
    });
    fakeDb.courseEvaluation.count.mockImplementation((args: any) => {
      const where = args?.where ?? {};
      return Promise.resolve(evals.filter((e) => (where.trainerId ? e.trainerId === where.trainerId : true)).length);
    });

    const res = await getEvaluations(new Request("http://localhost/api/evaluations"));
    const body = await json(res);
    expect(fakeDb.courseEvaluation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ trainerId: "tr-1" }) })
    );
    expect(body.data.map((r: any) => r.id)).toEqual(["e-1"]);
  });

  it("certificates issuance returns 403 even when the sidebar is bypassed", async () => {
    const res = await postCertificate(new Request("http://localhost/api/certificates", { method: "POST", body: "{}" }));
    expect(res.status).toBe(403);
  });

  it("payments API returns 403 for a trainer", async () => {
    const res = await getPayments(new Request("http://localhost/api/payments"));
    expect(res.status).toBe(403);
  });

  it("training requests API returns 403 for a trainer", async () => {
    const res = await getRequests(new Request("http://localhost/api/requests"));
    expect(res.status).toBe(403);
  });

  // ── Session-detail ownership: trainers may only open/update their OWN ──
  it("session detail returns 200 for the trainer's own session", async () => {
    const own = {
      id: "sess-1", trainerId: "tr-1", refNumber: "SES-000001", status: "SCHEDULED",
      deletedAt: null, course: {}, trainer: {},
    };
    fakeDb.trainingSession.findUnique.mockResolvedValue(own as any);
    const res = await getSessionById(new Request("http://localhost/api/sessions/sess-1"), { params: { id: "sess-1" } });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.id).toBe("sess-1");
  });

  it("session detail returns 403 for another trainer's session", async () => {
    fakeDb.trainingSession.findUnique.mockResolvedValue({
      id: "sess-2", trainerId: "tr-2", refNumber: "SES-000002", status: "SCHEDULED", deletedAt: null,
    } as any);
    const res = await getSessionById(new Request("http://localhost/api/sessions/sess-2"), { params: { id: "sess-2" } });
    expect(res.status).toBe(403);
    expect(fakeDb.trainingSession.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sess-2" } })
    );
  });

  it("session update returns 403 for another trainer's session (ownership enforced server-side)", async () => {
    fakeDb.trainingSession.findUnique.mockResolvedValue({
      id: "sess-2", trainerId: "tr-2", refNumber: "SES-000002", status: "SCHEDULED", deletedAt: null,
    } as any);
    const res = await putSessionById(
      new Request("http://localhost/api/sessions/sess-2", { method: "PUT", body: JSON.stringify({ title: "hijack" }) }),
      { params: { id: "sess-2" } }
    );
    expect(res.status).toBe(403);
    expect(fakeDb.trainingSession.update).not.toHaveBeenCalled();
  });

  it("session delete is blocked for a trainer (no sessions.delete in the matrix)", async () => {
    const res = await deleteSessionById(new Request("http://localhost/api/sessions/sess-2", { method: "DELETE" }), {
      params: { id: "sess-2" },
    });
    expect(res.status).toBe(403);
  });
});

// ── 4. Own-sessions-only data isolation (exam attempts / results / export) ──
// The trainer holds pre-test/final-test view+create+edit, so every assessment
// endpoint they can reach must stay pinned to THEIR sessions. These tests hit
// the real route guard chain and assert that another trainer's records are
// rejected and that lists are filtered server-side.
describe("TRAINER own-sessions-only data isolation", () => {
  it("exam attempts list returns only attempts from the trainer's own sessions", async () => {
    const attempts = [
      { id: "att-1", testType: "FINAL_TEST", session: { trainerId: "tr-1" } },
      { id: "att-2", testType: "FINAL_TEST", session: { trainerId: "tr-2" } },
    ];
    fakeDb.examAttempt.findMany.mockImplementation((args: any) => {
      const t = args?.where?.session?.trainerId;
      return Promise.resolve(attempts.filter((a) => (t ? a.session.trainerId === t : true)));
    });
    fakeDb.examAttempt.count.mockImplementation((args: any) => {
      const t = args?.where?.session?.trainerId;
      return Promise.resolve(attempts.filter((a) => (t ? a.session.trainerId === t : true)).length);
    });

    const res = await getExamAttempts(new Request("http://localhost/api/exam-attempts"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.map((r: any) => r.id)).toEqual(["att-1"]);
    expect(fakeDb.examAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ session: { trainerId: "tr-1" } }) })
    );
  });

  it("exam attempt detail returns 403 for another trainer's session attempt", async () => {
    fakeDb.examAttempt.findUnique.mockResolvedValue({
      id: "att-2", testType: "FINAL_TEST", deletedAt: null,
      session: { id: "sess-2", refNumber: "SES-000002", title: "B", trainerId: "tr-2", course: {} },
    } as any);
    const res = await getExamAttemptById(new Request("http://localhost/api/exam-attempts/att-2"), {
      params: { id: "att-2" },
    } as any);
    expect(res.status).toBe(403);
  });

  it("exam attempt detail returns 200 for the trainer's own session attempt", async () => {
    fakeDb.examAttempt.findUnique.mockResolvedValue({
      id: "att-1", testType: "FINAL_TEST", deletedAt: null,
      session: { id: "sess-1", refNumber: "SES-000001", title: "A", trainerId: "tr-1", course: {} },
    } as any);
    const res = await getExamAttemptById(new Request("http://localhost/api/exam-attempts/att-1"), {
      params: { id: "att-1" },
    } as any);
    expect(res.status).toBe(200);
  });

  it("reopen returns 403 for another trainer's session attempt", async () => {
    fakeDb.examAttempt.findUnique.mockResolvedValue({
      id: "att-2", testType: "FINAL_TEST", deletedAt: null, status: "GRADED",
      session: { id: "sess-2", refNumber: "SES-000002", trainerId: "tr-2" },
    } as any);
    const res = await postReopenAttempt(
      new Request("http://localhost/api/exam-attempts/att-2/reopen", { method: "POST", body: JSON.stringify({ reason: "x" }) }),
      { params: { id: "att-2" } } as any
    );
    expect(res.status).toBe(403);
    expect(fakeDb.examAttempt.update).not.toHaveBeenCalled();
  });

  it("edit-result returns 403 for another trainer's session attempt", async () => {
    fakeDb.examAttempt.findUnique.mockResolvedValue({
      id: "att-2", testType: "FINAL_TEST", deletedAt: null, status: "GRADED",
      session: { id: "sess-2", refNumber: "SES-000002", courseId: "c-2", trainerId: "tr-2", course: { passScore: 70 } },
    } as any);
    const res = await putEditAttemptResult(
      new Request("http://localhost/api/exam-attempts/att-2/edit-result", { method: "PUT", body: JSON.stringify({ scorePercent: 90 }) }),
      { params: { id: "att-2" } } as any
    );
    expect(res.status).toBe(403);
    expect(fakeDb.examAttempt.update).not.toHaveBeenCalled();
  });

  it("test results list returns only results from the trainer's own sessions", async () => {
    const results = [
      { id: "res-1", testType: "FINAL_TEST", session: { trainerId: "tr-1", refNumber: "SES-000001", title: "A", course: {} } },
      { id: "res-2", testType: "FINAL_TEST", session: { trainerId: "tr-2", refNumber: "SES-000002", title: "B", course: {} } },
    ];
    fakeDb.testResult.findMany.mockImplementation((args: any) => {
      const t = args?.where?.session?.trainerId;
      return Promise.resolve(results.filter((r) => (t ? r.session.trainerId === t : true)));
    });
    fakeDb.testResult.count.mockImplementation((args: any) => {
      const t = args?.where?.session?.trainerId;
      return Promise.resolve(results.filter((r) => (t ? r.session.trainerId === t : true)).length);
    });

    const res = await getTestResults(new Request("http://localhost/api/test-results"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.map((r: any) => r.id)).toEqual(["res-1"]);
    expect(fakeDb.testResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ session: { trainerId: "tr-1" } }) })
    );
  });

  it("test-results POST blocks adding a result to another trainer's session", async () => {
    fakeDb.trainingSession.findFirst.mockResolvedValue({
      id: "sess-2", trainerId: "tr-2", deletedAt: null, course: { passScore: 70 },
    } as any);
    const res = await postTestResult(
      new Request("http://localhost/api/test-results", {
        method: "POST",
        body: JSON.stringify({ sessionId: "sess-2", testType: "FINAL_TEST", traineeName: "X", scorePercent: 90 }),
      })
    );
    expect(res.status).toBe(403);
    expect(fakeDb.testResult.create).not.toHaveBeenCalled();
  });

  it("sessions export only includes the trainer's own sessions", async () => {
    fakeDb.trainingSession.findMany.mockResolvedValue([
      {
        refNumber: "SES-000001",
        instituteName: "I",
        classification: null,
        expectedTrainees: 10,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-03"),
        durationDays: 3,
        shift: "MORNING",
        region: null,
        city: null,
        venue: null,
        locationMapUrl: null,
        notes: null,
        course: { title: "C" },
        trainer: { nameEn: "T" },
      },
    ] as any);
    const res = await getSessionExport(new Request("http://localhost/api/sessions/export"));
    expect(res.status).toBe(200);
    expect(fakeDb.trainingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ trainerId: "tr-1" }) })
    );
  });

  it("training-record returns 404 for a trainee not enrolled in the trainer's sessions", async () => {
    fakeDb.trainee.findUnique.mockResolvedValue({
      id: "t-2", fullName: "Other", nationalId: "N2", deletedAt: null, companyId: "c-2", company: {}, requestCourses: [],
    } as any);
    fakeDb.sessionEnrollment.count.mockResolvedValue(0);
    const res = await getTrainingRecord(new Request("http://localhost/api/trainees/t-2/training-record"), {
      params: { id: "t-2" },
    } as any);
    expect(res.status).toBe(404);
  });

  it("training-record returns 200 for a trainee enrolled in the trainer's session", async () => {
    fakeDb.trainee.findUnique.mockResolvedValue({
      id: "t-1", refNumber: "TRA-000001", fullName: "Mine", nationalId: "N1", nationality: "SA",
      jobTitle: "T", mobile: "0", email: "x@y.z", status: "ACTIVE", companyId: "c-1",
      company: { id: "c-1", name: "C", refNumber: "CMP-1" }, idAttachmentUrl: null,
      documents: null, requestCourses: [], deletedAt: null,
    } as any);
    fakeDb.sessionEnrollment.count.mockResolvedValue(1);
    fakeDb.certificate.findMany.mockResolvedValue([]);
    fakeDb.testResult.findMany.mockResolvedValue([]);
    const res = await getTrainingRecord(new Request("http://localhost/api/trainees/t-1/training-record"), {
      params: { id: "t-1" },
    } as any);
    expect(res.status).toBe(200);
  });

  it("history returns 404 for a trainee not enrolled in the trainer's sessions", async () => {
    fakeDb.trainee.findUnique.mockResolvedValue({
      id: "t-2", fullName: "Other", nationalId: "N2", deletedAt: null, companyId: "c-2", company: {},
    } as any);
    fakeDb.sessionEnrollment.count.mockResolvedValue(0);
    const res = await getTraineeHistory(new Request("http://localhost/api/trainees/t-2/history"), {
      params: { id: "t-2" },
    } as any);
    expect(res.status).toBe(404);
  });

  it("history returns 200 for a trainee enrolled in the trainer's session", async () => {
    fakeDb.trainee.findUnique.mockResolvedValue({
      id: "t-1", refNumber: "TRA-000001", fullName: "Mine", nationalId: "N1", nationality: "SA",
      jobTitle: "T", mobile: "0", email: "x@y.z", status: "ACTIVE", companyId: "c-1",
      company: { id: "c-1", name: "C", refNumber: "CMP-1" }, documents: null, deletedAt: null,
    } as any);
    fakeDb.sessionEnrollment.count.mockResolvedValue(1);
    fakeDb.sessionEnrollment.findMany.mockResolvedValue([]);
    fakeDb.certificate.findMany.mockResolvedValue([]);
    const res = await getTraineeHistory(new Request("http://localhost/api/trainees/t-1/history"), {
      params: { id: "t-1" },
    } as any);
    expect(res.status).toBe(200);
  });

  it("course detail returns 404 when the trainer has no session for that course", async () => {
    fakeDb.course.findUnique.mockResolvedValue({
      id: "c-2", code: "CRS-2", deletedAt: null,
      _count: { requests: 0, sessions: 0, certificates: 0, questions: 0 },
    } as any);
    fakeDb.trainingSession.count.mockResolvedValue(0);
    const res = await getCourseById(new Request("http://localhost/api/courses/c-2"), { params: { id: "c-2" } });
    expect(res.status).toBe(404);
  });

  it("course detail returns 200 for a course linked to the trainer's session", async () => {
    fakeDb.course.findUnique.mockResolvedValue({
      id: "c-1", code: "CRS-1", deletedAt: null,
      _count: { requests: 0, sessions: 0, certificates: 0, questions: 0 },
    } as any);
    fakeDb.trainingSession.count.mockResolvedValue(1);
    const res = await getCourseById(new Request("http://localhost/api/courses/c-1"), { params: { id: "c-1" } });
    expect(res.status).toBe(200);
  });
});

// ── 5. QA Test Trainer — test-wide scope ──────────────────────────────────
// The QA Test Trainer (trainer@gcclab.com) shares the exact TRAINER permission
// matrix (19 permissions, no admin module) but its data scope is OPEN: every
// trainer-scope helper resolves to null so all sessions/courses/trainees/
// workshops/evaluations are visible and editable, while admin routes stay 403.
const TEST_TRAINER_DB = {
  id: "user-test-trainer",
  email: "trainer@gcclab.com",
  fullName: "Test Trainer",
  role: "TRAINER",
  status: "ACTIVE",
  deletedAt: null,
  isActive: true,
  accountStatus: "ACTIVE",
  tokenVersion: 0,
  trainerId: TEST_TRAINER_TRAINER_ID,
  region: null,
  regionsCovered: null,
  companyId: null,
  language: "ar",
  roleId: "role-trainer",
  roleRecord: { roleCode: "TRAINER", tokenVersion: 0, permissions: trainerPerms() },
};

describe("QA Test Trainer — test-wide scope", () => {
  beforeEach(() => {
    fakeDb.user.findUnique.mockResolvedValue(TEST_TRAINER_DB as any);
  });

  it("isTestTrainer recognizes the test trainer and nothing else", () => {
    expect(isTestTrainer(TEST_TRAINER_DB as any)).toBe(true);
    expect(isTestTrainer(TRAINER_A_DB as any)).toBe(false);
    expect(isTestTrainer({ role: "TRAINER", trainerId: null } as any)).toBe(false);
    expect(isTestTrainer({ role: "CONTRACTOR", trainerId: TEST_TRAINER_TRAINER_ID } as any)).toBe(false);
  });

  it("trainerIdOf is null for the test trainer so all scope helpers open", () => {
    expect(trainerIdOf(TEST_TRAINER_DB as any)).toBeNull();
    expect(scopeSessionList({ trainerId: "tr-2" }, TEST_TRAINER_DB as any)).toBeUndefined();
    expect(trainerDeniedSession(TEST_TRAINER_DB as any, "tr-2")).toBe(false);
    expect(trainerDeniedSession(TEST_TRAINER_DB as any, null)).toBe(false);
    expect(trainerSessionFilter(TEST_TRAINER_DB as any)).toBeNull();
    expect(trainerTraineeFilter(TEST_TRAINER_DB as any)).toBeNull();
    expect(trainerWorkshopFilter(TEST_TRAINER_DB as any)).toBeNull();
    expect(trainerEvaluationFilter(TEST_TRAINER_DB as any)).toBeNull();
  });

  it("sessions list returns ALL sessions (test-wide), no trainerId pin", async () => {
    const sessions = [
      {
        id: "sess-1", trainerId: "tr-1", refNumber: "SES-000001", title: "A", deletedAt: null, status: "SCHEDULED",
        _count: { attendance: 0, certificates: 0 },
      },
      {
        id: "sess-2", trainerId: "tr-2", refNumber: "SES-000002", title: "B", deletedAt: null, status: "SCHEDULED",
        _count: { attendance: 0, certificates: 0 },
      },
    ];
    fakeDb.trainingSession.findMany.mockImplementation((args: any) =>
      Promise.resolve(sessions.filter((s) => (args?.where?.trainerId ? s.trainerId === args.where.trainerId : true)))
    );
    fakeDb.trainingSession.count.mockImplementation((args: any) =>
      Promise.resolve(sessions.filter((s) => (args?.where?.trainerId ? s.trainerId === args.where.trainerId : true)).length)
    );

    const res = await getSessions(new Request("http://localhost/api/sessions"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.map((r: any) => r.id)).toEqual(["sess-1", "sess-2"]);
    const whereArg = fakeDb.trainingSession.findMany.mock.calls[0][0].where;
    expect(whereArg.trainerId).toBeUndefined();
  });

  it("session detail returns 200 for another trainer's session", async () => {
    fakeDb.trainingSession.findUnique.mockResolvedValue({
      id: "sess-2", trainerId: "tr-2", refNumber: "SES-000002", status: "SCHEDULED", deletedAt: null,
    } as any);
    const res = await getSessionById(new Request("http://localhost/api/sessions/sess-2"), { params: { id: "sess-2" } });
    expect(res.status).toBe(200);
  });

  it("courses list returns ALL courses (no own-sessions filter)", async () => {
    const courses = [
      { id: "c-1", code: "CRS-1", deletedAt: null, _count: { requests: 0, sessions: 0, certificates: 0, questions: 0 } },
      { id: "c-2", code: "CRS-2", deletedAt: null, _count: { requests: 0, sessions: 0, certificates: 0, questions: 0 } },
    ];
    fakeDb.course.findMany.mockResolvedValue(courses as any);
    fakeDb.course.count.mockResolvedValue(courses.length);

    const res = await getCourses(new Request("http://localhost/api/courses"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.map((r: any) => r.id)).toEqual(["c-1", "c-2"]);
    const whereArg = fakeDb.course.findMany.mock.calls[0][0].where;
    expect(whereArg.sessions).toBeUndefined();
  });

  it("course detail returns 200 for a course with NO own session (count not consulted)", async () => {
    fakeDb.course.findUnique.mockResolvedValue({
      id: "c-2", code: "CRS-2", deletedAt: null,
      _count: { requests: 0, sessions: 0, certificates: 0, questions: 0 },
    } as any);
    const res = await getCourseById(new Request("http://localhost/api/courses/c-2"), { params: { id: "c-2" } });
    expect(res.status).toBe(200);
    expect(fakeDb.trainingSession.count).not.toHaveBeenCalled();
  });

  it("trainees list returns ALL trainees (no enrollment pin)", async () => {
    const trainees = [
      { id: "t-1", fullName: "One", refNumber: "TRA-000001", deletedAt: null, _count: { requestCourses: 0 } },
      { id: "t-2", fullName: "Two", refNumber: "TRA-000002", deletedAt: null, _count: { requestCourses: 0 } },
    ];
    fakeDb.trainee.findMany.mockResolvedValue(trainees as any);
    fakeDb.trainee.count.mockResolvedValue(trainees.length);
    fakeDb.workerPassport.findMany.mockResolvedValue([]);

    const res = await getTrainees(new Request("http://localhost/api/trainees"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.map((r: any) => r.id)).toEqual(["t-1", "t-2"]);
    const whereArg = fakeDb.trainee.findMany.mock.calls[0][0].where;
    expect(whereArg.sessionEnrollments).toBeUndefined();
  });

  it("training-record returns 200 for a trainee NOT enrolled in the trainer's sessions", async () => {
    fakeDb.trainee.findUnique.mockResolvedValue({
      id: "t-2", refNumber: "TRA-000002", fullName: "Other", nationalId: "N2", nationality: "SA",
      jobTitle: "T", mobile: "0", email: "x@y.z", status: "ACTIVE", companyId: "c-2",
      company: { id: "c-2", name: "C", refNumber: "CMP-2" }, idAttachmentUrl: null,
      documents: null, requestCourses: [], deletedAt: null,
    } as any);
    fakeDb.certificate.findMany.mockResolvedValue([]);
    fakeDb.testResult.findMany.mockResolvedValue([]);
    const res = await getTrainingRecord(new Request("http://localhost/api/trainees/t-2/training-record"), {
      params: { id: "t-2" },
    } as any);
    expect(res.status).toBe(200);
    expect(fakeDb.sessionEnrollment.count).not.toHaveBeenCalled();
  });

  it("history returns 200 for a trainee NOT enrolled in the trainer's sessions", async () => {
    fakeDb.trainee.findUnique.mockResolvedValue({
      id: "t-2", refNumber: "TRA-000002", fullName: "Other", nationalId: "N2", nationality: "SA",
      jobTitle: "T", mobile: "0", email: "x@y.z", status: "ACTIVE", companyId: "c-2",
      company: { id: "c-2", name: "C", refNumber: "CMP-2" }, documents: null, deletedAt: null,
    } as any);
    fakeDb.sessionEnrollment.findMany.mockResolvedValue([]);
    fakeDb.certificate.findMany.mockResolvedValue([]);
    const res = await getTraineeHistory(new Request("http://localhost/api/trainees/t-2/history"), {
      params: { id: "t-2" },
    } as any);
    expect(res.status).toBe(200);
    expect(fakeDb.sessionEnrollment.count).not.toHaveBeenCalled();
  });

  it("exam attempts list returns attempts from ANY session (test-wide)", async () => {
    const attempts = [
      { id: "att-1", testType: "FINAL_TEST", session: { trainerId: "tr-1" } },
      { id: "att-2", testType: "FINAL_TEST", session: { trainerId: "tr-2" } },
    ];
    fakeDb.examAttempt.findMany.mockImplementation((args: any) =>
      Promise.resolve(attempts.filter((a) => (args?.where?.session?.trainerId ? a.session.trainerId === args.where.session.trainerId : true)))
    );
    fakeDb.examAttempt.count.mockImplementation((args: any) =>
      Promise.resolve(attempts.filter((a) => (args?.where?.session?.trainerId ? a.session.trainerId === args.where.session.trainerId : true)).length)
    );

    const res = await getExamAttempts(new Request("http://localhost/api/exam-attempts"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.map((r: any) => r.id)).toEqual(["att-1", "att-2"]);
    const whereArg = fakeDb.examAttempt.findMany.mock.calls[0][0].where;
    expect(whereArg.session?.trainerId).toBeUndefined();
  });

  it("test-results POST allows recording a result on another trainer's session", async () => {
    fakeDb.trainingSession.findFirst.mockResolvedValue({
      id: "sess-2", trainerId: "tr-2", deletedAt: null, course: { passScore: 70 },
    } as any);
    fakeDb.sessionEnrollment.count.mockResolvedValue(0);
    fakeDb.refNumberCounter.upsert.mockResolvedValue({ sequence: 1, entityType: "TEST_RESULT", year: 0 } as any);
    fakeDb.auditLog.create.mockResolvedValue({} as any);
    fakeDb.testResult.create.mockResolvedValue({ id: "res-1" } as any);
    const res = await postTestResult(
      new Request("http://localhost/api/test-results", {
        method: "POST",
        body: JSON.stringify({ sessionId: "sess-2", testType: "FINAL_TEST", traineeName: "X", scorePercent: 90 }),
      })
    );
    expect(res.status).toBe(201);
    expect(fakeDb.testResult.create).toHaveBeenCalled();
  });

  it("certificates issuance still returns 403 (no admin permission)", async () => {
    const res = await postCertificate(new Request("http://localhost/api/certificates", { method: "POST", body: "{}" }));
    expect(res.status).toBe(403);
  });

  it("payments and requests APIs still return 403", async () => {
    const payments = await getPayments(new Request("http://localhost/api/payments"));
    expect(payments.status).toBe(403);
    const requests = await getRequests(new Request("http://localhost/api/requests"));
    expect(requests.status).toBe(403);
  });
});
