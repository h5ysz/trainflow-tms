// The permission helpers gate every API route and every nav item. They are pure
// functions with zero setup cost and were entirely untested.
import { describe, it, expect } from "vitest";
import {
  canAccessModule,
  canPerformAction,
  getNavForRole,
  navItems,
  ALL_MODULES,
  type RouteKey,
} from "@/lib/auth/permissions";

describe("canAccessModule", () => {
  it("grants everything to the superuser wildcard", () => {
    expect(canAccessModule(["*"], "settings")).toBe(true);
    expect(canAccessModule(["*"], "dashboard")).toBe(true);
  });

  it("grants a module from an explicit view permission", () => {
    expect(canAccessModule(["companies.view"], "companies")).toBe(true);
  });

  it("requires view specifically — another action alone does not open the module", () => {
    // Deliberate: a role granted `delete` but not `view` cannot reach the page. It is a
    // nonsensical configuration, and failing closed is the right response to it.
    expect(canAccessModule(["companies.delete"], "companies")).toBe(false);
  });

  it("grants a module from its own wildcard", () => {
    expect(canAccessModule(["companies.*"], "companies")).toBe(true);
  });

  it("does not leak one module's permissions into another", () => {
    expect(canAccessModule(["companies.*"], "trainers")).toBe(false);
  });

  it("denies everything for an empty permission set", () => {
    // This is the fail-closed path resolveEffectivePermissions() returns when a user's
    // role cannot be resolved. It is load-bearing.
    expect(canAccessModule([], "dashboard")).toBe(false);
    expect(canAccessModule([], "settings")).toBe(false);
  });

  it("does not match on a shared prefix", () => {
    // "companiesX.view" must not satisfy the "companies" module.
    expect(canAccessModule(["companiesX.view"], "companies")).toBe(false);
  });
});

describe("canPerformAction", () => {
  it("honours the superuser wildcard", () => {
    expect(canPerformAction(["*"], "companies", "delete")).toBe(true);
  });

  it("honours a per-module wildcard", () => {
    expect(canPerformAction(["companies.*"], "companies", "delete")).toBe(true);
  });

  it("matches an exact action", () => {
    expect(canPerformAction(["reports.view"], "reports", "view")).toBe(true);
  });

  it("does not let view imply create", () => {
    expect(canPerformAction(["reports.view"], "reports", "create")).toBe(false);
    expect(canPerformAction(["requests.view", "requests.create"], "requests", "edit")).toBe(false);
  });

  it("denies everything for an empty permission set", () => {
    expect(canPerformAction([], "companies", "view")).toBe(false);
  });
});

describe("module aliases", () => {
  it("resolves session-detail through the sessions module", () => {
    expect(canAccessModule(["sessions.view"], "session-detail")).toBe(true);
  });

  it("resolves exam-attempts from either assessment module", () => {
    // Deliberately an OR: a role holding only final-test still reaches exam attempts.
    expect(canAccessModule(["pre-test.view"], "exam-attempts")).toBe(true);
    expect(canAccessModule(["final-test.view"], "exam-attempts")).toBe(true);
    expect(canAccessModule(["companies.view"], "exam-attempts")).toBe(false);
  });

  it("resolves exam-attempts from a direct results-only grant", () => {
    // The coordinator's read-only results access: `exam-attempts.view` alone
    // opens the results page (but grants no pre-test/final-test module access).
    expect(canAccessModule(["exam-attempts.view"], "exam-attempts")).toBe(true);
    expect(canAccessModule(["exam-attempts.view"], "pre-test")).toBe(false);
    expect(canAccessModule(["exam-attempts.view"], "final-test")).toBe(false);
    expect(canAccessModule(["exam-attempts.view"], "exam-sets")).toBe(false);
  });
});

describe("getNavForRole", () => {
  it("returns every nav item for the superuser wildcard", () => {
    const keys = getNavForRole(["*"]).map((n) => n.key);
    // "exam-attempts" is a results-only entry: the superuser reaches attempts from
    // the pre-test/final-test pages, so it is deliberately not duplicated in nav.
    expect(keys.length).toBe(navItems.length - 1);
    expect(keys).not.toContain("exam-attempts");
  });

  it("returns nothing for an empty permission set", () => {
    expect(getNavForRole([])).toEqual([]);
  });

  it("shows the results-only nav entry only without a dedicated exam module", () => {
    // Coordinator-style: results-only access → the standalone entry appears.
    const resultsOnly = getNavForRole(["exam-attempts.view"]);
    expect(resultsOnly.map((n) => n.key)).toContain("exam-attempts");
    // Trainer/auditor-style: pre-test module present → no duplicate entry.
    expect(getNavForRole(["pre-test.view"]).map((n) => n.key)).not.toContain("exam-attempts");
  });

  it("returns only the modules the permissions cover", () => {
    const nav = getNavForRole(["dashboard.view", "requests.view"]);
    const keys = nav.map((n) => n.key);
    expect(keys).toContain("dashboard");
    expect(keys).toContain("requests");
    expect(keys).not.toContain("settings");
  });

  it("never shows trainer-delivery modules in the coordinator menu, even if re-granted", () => {
    // A stale Role row could re-grant qr-code.*, but the session barcode belongs
    // to the Trainer / Training Admin — the coordinator menu must not list it.
    const staleQr = ["sessions.view", "exam-attempts.view", "qr-code.view", "qr-code.create"];
    const keys = getNavForRole(staleQr, "COORDINATOR").map((n) => n.key);
    expect(keys).not.toContain("qr-code");
    // The results-only entry is still the coordinator's exam access point.
    expect(keys).toContain("exam-attempts");
    expect(keys).toContain("sessions");

    // Even a wholesale re-grant of the delivery modules never surfaces them.
    const wholesale = getNavForRole(["sessions.view", "qr-code.view", "pre-test.view", "final-test.view", "exam-sets.view"], "COORDINATOR").map((n) => n.key);
    expect(wholesale).not.toContain("qr-code");
    expect(wholesale).not.toContain("pre-test");
    expect(wholesale).not.toContain("final-test");
    expect(wholesale).not.toContain("exam-sets");

    // The same grants DO surface for a trainer (who also holds the exam modules,
    // so the standalone results-only entry stays suppressed for them).
    const trainerKeys = getNavForRole(["sessions.view", "qr-code.view", "qr-code.create", "pre-test.view", "final-test.view"], "TRAINER").map((n) => n.key);
    expect(trainerKeys).toContain("qr-code");
    expect(trainerKeys).not.toContain("exam-attempts");
  });
});

describe("course-materials module (trainer-managed materials)", () => {
  it("gives the trainer upload/replace/delete on materials only", () => {
    const trainer = ["courses.view", "course-materials.view", "course-materials.create", "course-materials.edit", "course-materials.delete"];
    expect(canPerformAction(trainer, "course-materials", "create")).toBe(true);
    expect(canPerformAction(trainer, "course-materials", "edit")).toBe(true);
    expect(canPerformAction(trainer, "course-materials", "delete")).toBe(true);
    expect(canPerformAction(trainer, "course-materials", "view")).toBe(true);
  });

  it("does NOT leak material management into full course editing", () => {
    // The whole point of the dedicated module: a trainer can manage files but
    // still cannot edit the course records themselves.
    const trainer = ["courses.view", "course-materials.create", "course-materials.edit", "course-materials.delete"];
    expect(canPerformAction(trainer, "courses", "edit")).toBe(false);
    expect(canPerformAction(trainer, "courses", "create")).toBe(false);
    expect(canPerformAction(trainer, "courses", "delete")).toBe(false);
    expect(canAccessModule(["course-materials.edit"], "courses")).toBe(false);
  });

  it("stays a standalone module (no alias onto courses)", () => {
    // courses.view alone must NOT unlock material management.
    expect(canPerformAction(["courses.view"], "course-materials", "create")).toBe(false);
    // and the module wildcard grants every material action directly.
    expect(canPerformAction(["course-materials.*"], "course-materials", "delete")).toBe(true);
  });

  it("does NOT let a courses-only role manage materials (coordinator no longer has course-materials)", () => {
    // Curriculum + AI test generation are trainer-only. A coordinator holding
    // `courses.*` must NOT unlock material management.
    const coordinator = ["courses.*"];
    expect(canPerformAction(coordinator, "course-materials", "view")).toBe(false);
    expect(canPerformAction(coordinator, "course-materials", "create")).toBe(false);
    expect(canPerformAction(coordinator, "courses", "edit")).toBe(true);
  });
});

describe("nav/module registry consistency", () => {
  it("gives every nav item a module in ALL_MODULES", () => {
    const modules = new Set<string>(ALL_MODULES as readonly string[]);
    const orphans = navItems.filter((item) => !modules.has(item.key));
    expect(orphans.map((o) => o.key)).toEqual([]);
  });

  it("has no duplicate nav keys", () => {
    const keys = navItems.map((n) => n.key as RouteKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("CONTRACTOR trainee delete permission", () => {
  const contractorPermissions = [
    "dashboard.view",
    "trainees.view",
    "trainees.create",
    "trainees.edit",
    "trainees.delete",
    "requests.view",
    "requests.create",
    "certificates.view",
    "notifications.view",
    "copilot.view",
  ];

  it("grants trainees.delete to the CONTRACTOR role", () => {
    expect(canPerformAction(contractorPermissions, "trainees", "delete")).toBe(true);
  });

  it("grants trainees.view, create, edit to the CONTRACTOR role", () => {
    expect(canPerformAction(contractorPermissions, "trainees", "view")).toBe(true);
    expect(canPerformAction(contractorPermissions, "trainees", "create")).toBe(true);
    expect(canPerformAction(contractorPermissions, "trainees", "edit")).toBe(true);
  });

  it("does NOT grant trainees actions to roles without the permission", () => {
    const viewerPermissions = ["dashboard.view", "trainees.view"];
    expect(canPerformAction(viewerPermissions, "trainees", "delete")).toBe(false);
    expect(canPerformAction(viewerPermissions, "trainees", "create")).toBe(false);
    expect(canPerformAction(viewerPermissions, "trainees", "edit")).toBe(false);
  });

  it("does NOT leak trainees.delete into other modules", () => {
    expect(canPerformAction(contractorPermissions, "companies", "delete")).toBe(false);
    expect(canPerformAction(contractorPermissions, "certificates", "delete")).toBe(false);
  });
});
