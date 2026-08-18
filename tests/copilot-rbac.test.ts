// Copilot RBAC — every /api/copilot/* endpoint requires authentication
// =====================================================================
// The Floating AI Copilot is available to ALL authenticated users.
// Routes use withAuth (authentication only, no module permission check).
//
// Expected statuses:
//   Any authenticated user (SUPER_ADMIN, COORDINATOR, TRAINER, etc.) -> 200
//   Unauthenticated / invalid token                                  -> 401/403
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
  resolveActionPermission: () => ({ module: "copilot", action: "view" }),
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

// ── Minimal DB user fixture ────────────────────────────────────────────
// withAuth only checks that the user exists and is active — no permission check.
// The permissions array includes "copilot.view" because the action endpoints
// (suggestions, preview, execute) have internal canPerformAction checks.
function dbUserFor(role: string) {
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
    roleRecord: { roleCode: role, tokenVersion: 0, permissions: ["copilot.view"] },
  };
}

async function json(res: Response) {
  return (await res.json()) as any;
}

// ── Endpoint matrix ──────────────────────────────────────────────────────
interface Endpoint {
  name: string;
  run: () => Promise<Response>;
  contractorRun?: () => Promise<Response>;
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
  { name: "analytics/reports (POST)", run: POST(postReports, "/api/copilot/analytics/reports", { type: "monthly", format: "pdf" }), contractorRun: POST(postReports, "/api/copilot/analytics/reports", { type: "contractor", format: "pdf" }) },
  { name: "chat (POST)", run: POST(postChat, "/api/copilot/chat", { message: "hello" }) },
  { name: "suggestions (GET)", run: GET(getSuggestions, "/api/copilot/suggestions") },
  { name: "suggestions (POST)", run: POST(postSuggestions, "/api/copilot/suggestions", { suggestionType: "SUGGEST_BEST_TRAINER" }) },
  { name: "actions/preview (POST)", run: POST(postPreview, "/api/copilot/actions/preview", { actionType: "SUGGEST_BEST_TRAINER", params: {} }) },
  { name: "actions/execute (POST)", run: POST(postExecute, "/api/copilot/actions/execute", { previewToken: "token" }) },
];

beforeEach(() => {
  vi.resetAllMocks();
  fakeDb.user.findUnique.mockResolvedValue(dbUserFor("SUPER_ADMIN") as any);
});

// ── Pure permission-matrix assertions (permissions.ts is still correct) ─
describe("Copilot module permission matrix (permissions.ts)", () => {
  it("TRAINER has copilot in moduleAccess", () => {
    const perms = ["copilot.view"];
    expect(canAccessModule(perms, "copilot")).toBe(true);
    expect(canPerformAction(perms, "copilot", "view")).toBe(true);
  });

  it("copilot is independent of ai-dashboard", () => {
    expect(canAccessModule(["copilot.view"], "ai-dashboard")).toBe(false);
    expect(canAccessModule(["ai-dashboard.view"], "copilot")).toBe(false);
  });
});

// ── Live guard-chain: unauthenticated → rejected ────────────────────────
describe("Copilot API endpoints reject unauthenticated requests", () => {
  it("returns 401/403 when verifyToken returns null", async () => {
    vi.mocked(verifyToken).mockReturnValue(null as any);

    for (const ep of ENDPOINTS) {
      const res = await ep.run();
      expect([401, 403]).toContain(res.status);
    }
  });
});

// ── Live guard-chain: all authenticated roles → 200 ─────────────────────
describe("Copilot API endpoints allow ALL authenticated users", () => {
  const roles = ["SUPER_ADMIN", "COORDINATOR", "TRAINER", "AUDITOR", "CONTRACTOR"];

  for (const role of roles) {
    describe(`${role} → 200 on every Copilot endpoint`, () => {
      beforeEach(() => {
        vi.mocked(verifyToken).mockReturnValue({
          sub: "user-1",
          role,
          tokenVersion: 0,
          email: `${role.toLowerCase()}@gcclab.com`,
        } as any);
        fakeDb.user.findUnique.mockResolvedValue(dbUserFor(role) as any);
      });

      for (const ep of ENDPOINTS) {
        it(`${ep.name} returns 200`, async () => {
          const run = role === "CONTRACTOR" && ep.contractorRun ? ep.contractorRun : ep.run;
          const res = await run();
          expect(res.status).toBe(200);
        });
      }
    });
  }
});
