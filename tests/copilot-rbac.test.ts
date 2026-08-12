// Copilot RBAC — every /api/copilot/* endpoint must require ai-dashboard.view
// =====================================================================
// The AI dashboard and its underlying APIs are NOT for delivery-only trainers:
// a TRAINER must get 403 from every Copilot endpoint even when calling the URL
// directly (defense in depth — the sidebar only hides the nav item).
//
// Expected statuses mirror the LIVE permissions stored in the DB (checked via
// db.role.permissions):
//   SUPER_ADMIN ["*"]                       -> 200
//   COORDINATOR (has ai-dashboard.view)     -> 200
//   TRAINER    (delivery-only, no ai-dash)  -> 403
//   AUDITOR    (no ai-dashboard.view)       -> 403
//   CONTRACTOR (no ai-dashboard.view)       -> 403
// =====================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { canAccessModule, canPerformAction } from "@/lib/auth/permissions";

// ── Mocks (registered before any route module is imported) ──────────────
const { fakeDb } = vi.hoisted(() => {
  const m = () => vi.fn();
  return {
    fakeDb: {
      user: { findUnique: m() },
      role: { findUnique: m() },
      auditLog: { create: m() },
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

// Analytics / AI plumbing is not under test here — only the auth guard chain.
// Plain (non-mock) implementations survive vi.resetAllMocks() in beforeEach.
vi.mock("@/lib/ai/analytics/kpis", () => ({
  computeKpis: async () => ({ groups: [] }),
}));
vi.mock("@/lib/ai/analytics/charts", () => ({
  computeCharts: async () => ({ charts: [] }),
}));
vi.mock("@/lib/ai/analytics/recommendations", () => ({
  computeRecommendations: async () => ({ recommendations: [] }),
}));
vi.mock("@/lib/ai/analytics/risks", () => ({
  computeRisks: async () => ({ risks: [] }),
}));
vi.mock("@/lib/ai/analytics/forecasting", () => ({
  computeForecast: async () => ({ series: [] }),
}));
vi.mock("@/lib/ai/analytics/nl-query", () => ({
  answerNlQuery: async () => ({ kind: "text", answer: "ok" }),
}));
vi.mock("@/lib/ai/analytics/reports", () => ({
  generateReport: async () => ({
    buffer: Buffer.from("ok"),
    mimeType: "application/pdf",
    filename: "report.pdf",
    auditDescription: "ok",
    auditDescriptionAr: "ok",
  }),
}));
vi.mock("@/lib/ai/copilot-context", () => ({
  buildCopilotContext: async () => ({ systemPrompt: "p", contextData: "c" }),
}));
vi.mock("@/lib/ai/provider", () => ({
  getAIProvider: () => ({ chat: async () => ({ content: "hi" }) }),
}));
vi.mock("@/lib/ai/actions/registry", () => ({
  getActionCatalog: () => [],
  getActionHandler: () => ({
    description: "d",
    descriptionAr: "d",
    preparePreview: async () => ({ hydratedParams: {} }),
    execute: async () => ({ ok: true }),
  }),
  resolveActionPermission: () => ({ module: "ai-dashboard", action: "view" }),
}));
vi.mock("@/lib/ai/actions/preview-token", () => ({
  signPreviewToken: async () => "signed-preview-token",
  verifyPreviewToken: async () => ({
    userId: "user-1",
    actionType: "SUGGEST_BEST_TRAINER",
    hydratedParams: {},
  }),
}));
vi.mock("@/lib/auth/audit", () => ({
  recordAudit: async () => {},
}));

// Route handlers — imported AFTER the mocks above are registered.
import { GET as getKpis } from "@/app/api/copilot/analytics/kpis/route";
import { GET as getCharts } from "@/app/api/copilot/analytics/charts/route";
import { GET as getRecommendations } from "@/app/api/copilot/analytics/recommendations/route";
import { GET as getRisks } from "@/app/api/copilot/analytics/risks/route";
import { GET as getForecast } from "@/app/api/copilot/analytics/forecast/route";
import { POST as postQuery } from "@/app/api/copilot/analytics/query/route";
import { POST as postReports } from "@/app/api/copilot/analytics/reports/route";
import { POST as postChat } from "@/app/api/copilot/chat/route";
import { GET as getSuggestions, POST as postSuggestions } from "@/app/api/copilot/suggestions/route";
import { POST as postPreview } from "@/app/api/copilot/actions/preview/route";
import { POST as postExecute } from "@/app/api/copilot/actions/execute/route";
import { verifyToken } from "@/lib/auth/jwt";

// ── Role fixtures: permission strings mirror the live DB Role rows ──────
const TRAINER_PERMS = [
  "dashboard.view", "sessions.view", "sessions.edit", "attendance.view",
  "attendance.create", "attendance.edit", "qr-code.view", "pre-test.view",
  "pre-test.create", "final-test.view", "final-test.create", "evaluation.view",
  "workshops.view", "notifications.view",
];

const AUDITOR_PERMS = [
  "companies.view", "company-contacts.view", "trainers.view", "trainer-qualifications.view",
  "trainees.view", "courses.view", "requests.view", "sessions.view", "scheduling.view",
  "attendance.view", "qr-code.view", "pre-test.view", "final-test.view", "evaluation.view",
  "certificates.view", "reports.view", "notifications.view", "audit-log.view",
  "worker-passports.view", "compliance-matrix.view", "executive-dashboard.view",
  "renewal-dashboard.view", "invoices.view", "quotations.view", "payments.view",
  "receipts.view", "bank-accounts.view", "financial-reports.view", "financial-settings.view",
];

const CONTRACTOR_PERMS = [
  "trainees.view", "trainees.create", "trainees.edit", "requests.view",
  "requests.create", "courses.view", "certificates.view", "notifications.view",
  "worker-passports.view", "renewal-dashboard.view",
];

const COORDINATOR_PERMS = [
  ...TRAINER_PERMS,
  "companies.view", "trainees.view", "requests.view", "scheduling.view",
  "certificates.view", "reports.view", "ai-dashboard.view",
];

function dbUserFor(role: string, permissions: string[]) {
  return {
    id: "user-1",
    email: `${role.toLowerCase()}@gcclab.com`,
    fullName: role,
    role,
    status: "ACTIVE",
    deletedAt: null,
    isActive: true,
    accountStatus: "ACTIVE",
    tokenVersion: 0,
    trainerId: role === "TRAINER" ? "tr-1" : null,
    region: null,
    regionsCovered: null,
    companyId: role === "CONTRACTOR" ? "com-1" : null,
    language: "en",
    roleId: `role-${role.toLowerCase()}`,
    roleRecord: { roleCode: role, tokenVersion: 0, permissions },
  };
}

async function json(res: Response) {
  return (await res.json()) as any;
}

// ── Endpoint matrix ──────────────────────────────────────────────────────
interface Endpoint {
  name: string;
  run: () => Promise<Response>;
}

const GET = (handler: any, path: string) => () => handler(new Request(`http://localhost${path}`));
const POST = (handler: any, path: string, body: unknown) => () =>
  handler(new Request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) }));

const ENDPOINTS: Endpoint[] = [
  { name: "analytics/kpis (GET)", run: GET(getKpis, "/api/copilot/analytics/kpis") },
  { name: "analytics/charts (GET)", run: GET(getCharts, "/api/copilot/analytics/charts") },
  { name: "analytics/recommendations (GET)", run: GET(getRecommendations, "/api/copilot/analytics/recommendations") },
  { name: "analytics/risks (GET)", run: GET(getRisks, "/api/copilot/analytics/risks") },
  { name: "analytics/forecast (GET)", run: GET(getForecast, "/api/copilot/analytics/forecast") },
  { name: "analytics/query (POST)", run: POST(postQuery, "/api/copilot/analytics/query", { question: "how many sessions?" }) },
  { name: "analytics/reports (POST)", run: POST(postReports, "/api/copilot/analytics/reports", { type: "monthly", format: "pdf" }) },
  { name: "chat (POST)", run: POST(postChat, "/api/copilot/chat", { message: "hello" }) },
  { name: "suggestions (GET)", run: GET(getSuggestions, "/api/copilot/suggestions") },
  { name: "suggestions (POST)", run: POST(postSuggestions, "/api/copilot/suggestions", { suggestionType: "SUGGEST_BEST_TRAINER" }) },
  { name: "actions/preview (POST)", run: POST(postPreview, "/api/copilot/actions/preview", { actionType: "SUGGEST_BEST_TRAINER", params: {} }) },
  { name: "actions/execute (POST)", run: POST(postExecute, "/api/copilot/actions/execute", { previewToken: "token" }) },
];

beforeEach(() => {
  vi.resetAllMocks();
  fakeDb.user.findUnique.mockResolvedValue(dbUserFor("SUPER_ADMIN", ["*"]) as any);
});

// ── Pure permission-matrix assertions ────────────────────────────────────
describe("Copilot module permission matrix", () => {
  it("TRAINER has no ai-dashboard access in its permission strings", () => {
    expect(canAccessModule(TRAINER_PERMS, "ai-dashboard")).toBe(false);
    expect(canPerformAction(TRAINER_PERMS, "ai-dashboard", "view")).toBe(false);
  });

  it("AUDITOR has no ai-dashboard access in its actual DB permission strings", () => {
    expect(canAccessModule(AUDITOR_PERMS, "ai-dashboard")).toBe(false);
  });

  it("CONTRACTOR has no ai-dashboard access", () => {
    expect(canAccessModule(CONTRACTOR_PERMS, "ai-dashboard")).toBe(false);
  });

  it("COORDINATOR has ai-dashboard.view", () => {
    expect(canAccessModule(COORDINATOR_PERMS, "ai-dashboard")).toBe(true);
    expect(canPerformAction(COORDINATOR_PERMS, "ai-dashboard", "view")).toBe(true);
  });

  it("SUPER_ADMIN wildcard covers ai-dashboard", () => {
    expect(canAccessModule(["*"], "ai-dashboard")).toBe(true);
  });
});

// ── Live guard-chain assertions (withModuleAction -> requireModuleAction) ─
describe("Copilot API endpoints reject roles without ai-dashboard.view", () => {
  const denied = [
    { role: "TRAINER", perms: TRAINER_PERMS },
    { role: "AUDITOR", perms: AUDITOR_PERMS },
    { role: "CONTRACTOR", perms: CONTRACTOR_PERMS },
  ];

  for (const { role, perms } of denied) {
    describe(`${role} → 403 on every Copilot endpoint`, () => {
      beforeEach(() => {
        vi.mocked(verifyToken).mockReturnValue({
          sub: "user-1",
          role,
          tokenVersion: 0,
          email: `${role.toLowerCase()}@gcclab.com`,
        } as any);
        fakeDb.user.findUnique.mockResolvedValue(dbUserFor(role, perms) as any);
      });

      for (const ep of ENDPOINTS) {
        it(`${ep.name} returns 403`, async () => {
          const res = await ep.run();
          expect(res.status).toBe(403);
          const body = await json(res);
          expect(body.error).toBeTruthy();
        });
      }
    });
  }
});

describe("Copilot API endpoints allow roles with ai-dashboard.view", () => {
  const allowed = [
    { role: "SUPER_ADMIN", perms: ["*"] },
    { role: "COORDINATOR", perms: COORDINATOR_PERMS },
  ];

  for (const { role, perms } of allowed) {
    describe(`${role} → 200 on every Copilot endpoint`, () => {
      beforeEach(() => {
        vi.mocked(verifyToken).mockReturnValue({
          sub: "user-1",
          role,
          tokenVersion: 0,
          email: `${role.toLowerCase()}@gcclab.com`,
        } as any);
        fakeDb.user.findUnique.mockResolvedValue(dbUserFor(role, perms) as any);
      });

      for (const ep of ENDPOINTS) {
        it(`${ep.name} returns 200`, async () => {
          const res = await ep.run();
          expect(res.status).toBe(200);
        });
      }
    });
  }
});
