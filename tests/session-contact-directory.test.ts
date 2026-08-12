// TRAINER "Contact & Follow-up" — session-scoped contact directory
// =====================================================================
// Covers the communication feature added to the session detail page:
//   1. A TRAINER can read the contact-directory of their OWN session.
//   2. A TRAINER cannot read another trainer's session (direct URL / id swap).
//   3. Query parameters cannot widen the scope (the session comes from the URL
//      path, never from the client, and ownership is re-checked server-side).
//   4. Only the companies/trainees/contacts OF THE SESSION are returned, each
//      company's trainee count is computed independently, no record from
//      another session leaks.
//   5. Missing numbers surface as null so the UI renders "غير متوفر" without a
//      dead tel: button (link helpers are unit-tested directly).
//   6. The enrollments GET endpoint (which feeds the enrollments tab) applies
//      the same trainerDeniedSession ownership rule.
// =====================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { actionPermissions } from "@/lib/auth/permissions";
import { verifyToken } from "@/lib/auth/jwt";
import { telHref, mailHref } from "@/lib/contact/links";

// ── Mocks (registered before any route module is imported) ──────────────
const { fakeDb } = vi.hoisted(() => {
  const m = () => vi.fn();
  return {
    fakeDb: {
      user: { findUnique: m(), findFirst: m(), findMany: m() },
      role: { findUnique: m() },
      trainingSession: { findFirst: m(), findUnique: m(), findMany: m(), count: m() },
      sessionEnrollment: { findMany: m(), count: m() },
      companyContact: { findMany: m() },
      sessionCompany: { findMany: m() },
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
import { GET as getContactDirectory } from "@/app/api/sessions/[id]/contact-directory/route";
import { GET as getEnrollments } from "@/app/api/sessions/[id]/enrollments/route";

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

const COMPANY_A = { id: "comp-a", name: "Company A", nameAr: "الشركة أ", refNumber: "COM-000001" };
const COMPANY_B = { id: "comp-b", name: "Company B", nameAr: "الشركة ب", refNumber: "COM-000002" };
const COMPANY_C = { id: "comp-c", name: "Company C", nameAr: "الشركة ج", refNumber: "COM-000003" };

function trainee(id: string, ref: string, name: string, opts: {
  nationalId?: string; nationality?: string; jobTitle?: string;
  mobile?: string | null; email?: string | null;
} = {}) {
  return {
    id, refNumber: ref, fullName: name,
    nationalId: opts.nationalId ?? "1000000000",
    nationality: opts.nationality ?? "Saudi",
    jobTitle: opts.jobTitle ?? "Technician",
    mobile: opts.mobile ?? null,
    email: opts.email ?? null,
  };
}

function enr(id: string, sessionId: string, company: typeof COMPANY_A, t: ReturnType<typeof trainee>, attendanceStatus: string) {
  return { id, sessionId, companyId: company.id, attendanceStatus, trainee: t, company };
}

// sess-1 (own): Company A → 2 trainees, Company B → 5 trainees, Company C → 1.
// A sess-2 enrollment in the SAME company (comp-a) must never leak into a
// sess-1 response.
const ENROLLMENTS = [
  enr("e1", "sess-1", COMPANY_A, trainee("t-a1", "TRA-000001", "Trainee A1", { nationalId: "1000000001", jobTitle: "Engineer", mobile: "0501111111", email: "a1@comp-a.com" }), "PRESENT"),
  enr("e2", "sess-1", COMPANY_A, trainee("t-a2", "TRA-000002", "Trainee A2", { nationalId: "1000000002", jobTitle: "Technician", mobile: "0502222222", email: null }), "LATE"),
  enr("e3", "sess-1", COMPANY_B, trainee("t-b1", "TRA-000003", "Trainee B1", { mobile: "0503333333" }), "ABSENT"),
  enr("e4", "sess-1", COMPANY_B, trainee("t-b2", "TRA-000004", "Trainee B2", { mobile: "0504444444" }), "PRESENT"),
  enr("e5", "sess-1", COMPANY_B, trainee("t-b3", "TRA-000005", "Trainee B3", { mobile: null }), "LATE"),
  enr("e6", "sess-1", COMPANY_B, trainee("t-b4", "TRA-000006", "Trainee B4", { mobile: "0506666666" }), "NOT_STARTED"),
  enr("e7", "sess-1", COMPANY_B, trainee("t-b5", "TRA-000007", "Trainee B5", { mobile: "0507777777" }), "PRESENT"),
  enr("e8", "sess-1", COMPANY_C, trainee("t-c1", "TRA-000008", "Trainee C1", { mobile: "0508888888", email: "c1@comp-c.com" }), "ABSENT"),
  // OTHER session — must never appear in a sess-1 response
  enr("e9", "sess-2", COMPANY_A, trainee("t-x", "TRA-000009", "Other Session Trainee", { mobile: "0509999999" }), "PRESENT"),
];

const CONTACTS = [
  // Company A — full contact info
  { id: "c1", companyId: "comp-a", fullName: "Ali Al-Mansour", fullNameAr: "علي المنصور", jobTitle: "HR Manager", email: "ali@comp-a.com", phone: "0112223333", mobile: "0551112222", preferredContact: "MOBILE", contactType: "HR", isPrimary: true, isActive: true, deletedAt: null },
  // Company B — contact WITHOUT phone/mobile (only email): UI must show "غير متوفر"
  { id: "c2", companyId: "comp-b", fullName: "Sara Al-Ghamdi", fullNameAr: "سارة الغامدي", jobTitle: "Admin", email: "sara@comp-b.com", phone: null, mobile: null, preferredContact: "EMAIL", contactType: "ADMIN", isPrimary: true, isActive: true, deletedAt: null },
  // Company C — no contacts at all
];

const SESSION_COMPANIES = [
  { companyId: "comp-a", traineeCount: 2, company: { id: "comp-a", name: "Company A", refNumber: "COM-000001" } },
  { companyId: "comp-b", traineeCount: 5, company: { id: "comp-b", name: "Company B", refNumber: "COM-000002" } },
  { companyId: "comp-c", traineeCount: 1, company: { id: "comp-c", name: "Company C", refNumber: "COM-000003" } },
];

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

  // Ownership lookup: sess-1 → tr-1 (own), sess-2 → tr-2 (other), else missing.
  fakeDb.trainingSession.findFirst.mockImplementation((args: any) => {
    const id = args?.where?.id;
    if (id === "sess-1") return Promise.resolve({ id: "sess-1", trainerId: "tr-1" });
    if (id === "sess-2") return Promise.resolve({ id: "sess-2", trainerId: "tr-2" });
    return Promise.resolve(null);
  });

  // sessionEnrollment.findMany honours the sessionId filter (like Prisma).
  fakeDb.sessionEnrollment.findMany.mockImplementation((args: any) => {
    const where = args?.where ?? {};
    return Promise.resolve(ENROLLMENTS.filter((e) => (where.sessionId ? e.sessionId === where.sessionId : true)));
  });
  fakeDb.sessionEnrollment.count.mockImplementation((args: any) => {
    const where = args?.where ?? {};
    return Promise.resolve(ENROLLMENTS.filter((e) => (where.sessionId ? e.sessionId === where.sessionId : true)).length);
  });

  fakeDb.companyContact.findMany.mockImplementation((args: any) => {
    const inIds = args?.where?.companyId?.in ?? [];
    return Promise.resolve(CONTACTS.filter((c) => inIds.includes(c.companyId)));
  });

  fakeDb.sessionCompany.findMany.mockResolvedValue(SESSION_COMPANIES as any);
});

function contactReq(sessionId: string, query = ""): Request {
  return new Request(`http://localhost/api/sessions/${sessionId}/contact-directory${query}`);
}

// ── Contact-directory: ownership scope ───────────────────────────────────
describe("contact-directory ownership scope", () => {
  it("returns 200 for the trainer's own session", async () => {
    const res = await getContactDirectory(contactReq("sess-1"), { params: { id: "sess-1" } });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.data.companies).toHaveLength(3);
  });

  it("returns 403 for another trainer's session (direct-URL / id swap)", async () => {
    const res = await getContactDirectory(contactReq("sess-2"), { params: { id: "sess-2" } });
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown session", async () => {
    const res = await getContactDirectory(contactReq("sess-999"), { params: { id: "sess-999" } });
    expect(res.status).toBe(404);
  });

  it("query parameters cannot widen the scope", async () => {
    // A crafted query tries to point at another session / company / trainer.
    const res = await getContactDirectory(
      contactReq("sess-1", "?sessionId=sess-9&companyId=comp-x&trainerId=tr-2&pageSize=200"),
      { params: { id: "sess-1" } }
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    const ids = body.data.companies.map((c: any) => c.companyId);
    expect(ids.sort()).toEqual(["comp-a", "comp-b", "comp-c"]);
  });

  it("companies queried for contacts are limited to the session's companies", async () => {
    await getContactDirectory(contactReq("sess-1"), { params: { id: "sess-1" } });
    expect(fakeDb.companyContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: { in: expect.arrayContaining(["comp-a", "comp-b", "comp-c"]) } }),
      })
    );
  });
});

// ── Contact-directory: data shape ────────────────────────────────────────
describe("contact-directory data shape", () => {
  it("returns only the session's companies (no other-session companies)", async () => {
    const res = await getContactDirectory(contactReq("sess-1"), { params: { id: "sess-1" } });
    const body = await json(res);
    expect(body.data.companies.map((c: any) => c.companyId).sort()).toEqual(["comp-a", "comp-b", "comp-c"]);
  });

  it("computes the trainee count per company independently", async () => {
    const res = await getContactDirectory(contactReq("sess-1"), { params: { id: "sess-1" } });
    const body = await json(res);
    const byId = Object.fromEntries(body.data.companies.map((c: any) => [c.companyId, c]));
    expect(byId["comp-a"].traineeCount).toBe(2);
    expect(byId["comp-b"].traineeCount).toBe(5);
    expect(byId["comp-c"].traineeCount).toBe(1);
    expect(byId["comp-a"].trainees).toHaveLength(2);
    expect(byId["comp-b"].trainees).toHaveLength(5);
    expect(byId["comp-c"].trainees).toHaveLength(1);
  });

  it("returns the full trainee data under the correct company", async () => {
    const res = await getContactDirectory(contactReq("sess-1"), { params: { id: "sess-1" } });
    const body = await json(res);
    const a = body.data.companies.find((c: any) => c.companyId === "comp-a");
    const a1 = a.trainees.find((t: any) => t.traineeId === "t-a1");
    expect(a1.fullName).toBe("Trainee A1");
    expect(a1.nationalId).toBe("1000000001");
    expect(a1.nationality).toBe("Saudi");
    expect(a1.jobTitle).toBe("Engineer");
    expect(a1.mobile).toBe("0501111111");
    expect(a1.email).toBe("a1@comp-a.com");
    expect(a1.attendanceStatus).toBe("PRESENT");
    const a2 = a.trainees.find((t: any) => t.traineeId === "t-a2");
    expect(a2.attendanceStatus).toBe("LATE");
    expect(a2.email).toBeNull();
  });

  it("includes the company contact when one exists", async () => {
    const res = await getContactDirectory(contactReq("sess-1"), { params: { id: "sess-1" } });
    const body = await json(res);
    const a = body.data.companies.find((c: any) => c.companyId === "comp-a");
    expect(a.contacts).toHaveLength(1);
    expect(a.contacts[0].fullName).toBe("Ali Al-Mansour");
    expect(a.contacts[0].phone).toBe("0112223333");
    expect(a.contacts[0].mobile).toBe("0551112222");
    expect(a.contacts[0].email).toBe("ali@comp-a.com");
    expect(a.contacts[0].preferredContact).toBe("MOBILE");
    expect(a.contacts[0].isPrimary).toBe(true);
  });

  it("exposes null phone/mobile for a contact without numbers (UI shows 'غير متوفر', no call button)", async () => {
    const res = await getContactDirectory(contactReq("sess-1"), { params: { id: "sess-1" } });
    const body = await json(res);
    const b = body.data.companies.find((c: any) => c.companyId === "comp-b");
    expect(b.contacts[0].phone).toBeNull();
    expect(b.contacts[0].mobile).toBeNull();
    // Company C has no contacts at all
    const c = body.data.companies.find((x: any) => x.companyId === "comp-c");
    expect(c.contacts).toEqual([]);
  });

  it("never leaks trainees or companies from another session", async () => {
    const res = await getContactDirectory(contactReq("sess-1"), { params: { id: "sess-1" } });
    const body = await json(res);
    const allTraineeIds = body.data.companies.flatMap((c: any) => c.trainees.map((t: any) => t.traineeId));
    expect(allTraineeIds).not.toContain("t-x");
    expect(allTraineeIds).toHaveLength(8);
    // Every enrollment id belongs to sess-1 (the sess-2 one is excluded)
    const allEnrollmentIds = body.data.companies.flatMap((c: any) => c.trainees.map((t: any) => t.enrollmentId));
    expect(allEnrollmentIds).not.toContain("e9");
  });
});

// ── Link helpers (drives the "غير متوفر / no call button" UI rule) ──────
describe("contact link helpers", () => {
  it("builds a tel: href from a stored number", () => {
    expect(telHref("0501111111")).toBe("tel:0501111111");
    expect(telHref("+966 50 123 4567")).toBe("tel:+966501234567");
    expect(telHref("011 123 4567")).toBe("tel:0111234567");
  });

  it("returns null when there is no usable number (UI must show 'غير متوفر')", () => {
    expect(telHref(null)).toBeNull();
    expect(telHref(undefined)).toBeNull();
    expect(telHref("")).toBeNull();
    expect(telHref("   ")).toBeNull();
    expect(telHref("not a number")).toBeNull();
    expect(telHref("12")).toBeNull();
  });

  it("builds a mailto: href only for a real email", () => {
    expect(mailHref("a1@comp-a.com")).toBe("mailto:a1@comp-a.com");
    expect(mailHref("  a@b.com  ")).toBe("mailto:a@b.com");
    expect(mailHref(null)).toBeNull();
    expect(mailHref(undefined)).toBeNull();
    expect(mailHref("   ")).toBeNull();
  });
});

// ── Enrollments GET: the trainerDeniedSession fix ────────────────────────
describe("GET /api/sessions/[id]/enrollments ownership (vulnerability fix)", () => {
  it("returns 200 for the trainer's own session", async () => {
    const res = await getEnrollments(
      new Request("http://localhost/api/sessions/sess-1/enrollments"),
      { params: { id: "sess-1" } }
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
  });

  it("returns 403 for another trainer's session", async () => {
    const res = await getEnrollments(
      new Request("http://localhost/api/sessions/sess-2/enrollments"),
      { params: { id: "sess-2" } }
    );
    expect(res.status).toBe(403);
  });
});
