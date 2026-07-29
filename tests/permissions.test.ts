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
});

describe("getNavForRole", () => {
  it("returns every nav item for the superuser wildcard", () => {
    expect(getNavForRole(["*"])).toHaveLength(navItems.length);
  });

  it("returns nothing for an empty permission set", () => {
    expect(getNavForRole([])).toEqual([]);
  });

  it("returns only the modules the permissions cover", () => {
    const nav = getNavForRole(["dashboard.view", "requests.view"]);
    const keys = nav.map((n) => n.key);
    expect(keys).toContain("dashboard");
    expect(keys).toContain("requests");
    expect(keys).not.toContain("settings");
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
