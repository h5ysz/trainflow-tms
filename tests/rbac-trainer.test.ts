// TRAINER RBAC — delivery-only isolation verification
// =====================================================================
// 1. The permission matrix (actionPermissions.TRAINER) grants no administrative
//    module and no create/delete on sessions/certificates/etc.
// 2. Every trainer list query is scoped server-side to the authenticated
//    trainer's OWN records (trainerId derived from the user, never the client).
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
      sessionEnrollment: { count: m() },
      workshopTrainerAuthorization: { count: m(), findFirst: m() },
      attendance: { findUnique: m(), findFirst: m() },
      examAttempt: { findUnique: m(), findFirst: m() },
      sessionLifecycleEvent: { findMany: m() },
    },
  };
});

vi.mock("@/lib/db", () => ({ db: fakeDb }));
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
  "trainees",
  "courses",
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

describe("TRAINER permission matrix (delivery-only)", () => {
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
    expect(canPerformAction(perms, "certificates", "create")).toBe(false);
    expect(canPerformAction(perms, "pre-test", "create")).toBe(true); // run exams
    expect(canPerformAction(perms, "final-test", "create")).toBe(true);
  });

  it("sidebar nav exposes only delivery modules for a trainer", () => {
    const keys = getNavForRole(trainerPerms()).map((i) => i.key);
    expect(keys).toContain("sessions");
    expect(keys).toContain("attendance");
    expect(keys).toContain("evaluation");
    expect(keys).not.toContain("requests");
    expect(keys).not.toContain("certificates");
    expect(keys).not.toContain("companies");
    expect(keys).not.toContain("trainees");
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

  it("trainees module returns 403 for a trainer — trainee visibility is session-scoped only", async () => {
    // A trainer has no standalone trainees module (the admin matrix grants it to
    // coordinators). Trainee data reaches a trainer exclusively through their own
    // session records, which are scoped + ownership-checked server-side.
    const res = await getTrainees(new Request("http://localhost/api/trainees"));
    expect(res.status).toBe(403);
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
