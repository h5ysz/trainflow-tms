// Three lines of assertion that protect every feature added to this app.
//
// The English and Arabic dictionaries are parallel objects with no structural link, so
// a new key added to one and forgotten in the other renders the raw key string to
// Arabic users. That is exactly what happened while building the /verify page.
import { describe, it, expect } from "vitest";
import { dict } from "@/lib/i18n/translations";

describe("translation dictionaries", () => {
  it("has the same keys in English and Arabic", () => {
    expect(Object.keys(dict.en).sort()).toEqual(Object.keys(dict.ar).sort());
  });

  it("has no accidentally empty values", () => {
    // The dashboard nav group is deliberately unlabelled — it holds a single top-level
    // item that renders without a group heading.
    const intentionallyEmpty = new Set(["nav.group.dashboard"]);
    const empty = Object.entries(dict.en)
      .filter(([k, v]) => !String(v).trim() && !intentionallyEmpty.has(k))
      .map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it("has genuinely Arabic values, not copied English", () => {
    // A handful of keys are legitimately identical across locales (brand names, format
    // codes). Everything else should differ.
    const identical = Object.keys(dict.en).filter(
      (k) => dict.en[k as keyof typeof dict.en] === dict.ar[k as keyof typeof dict.ar]
    );
    // Guard against wholesale copying rather than demanding zero overlap.
    expect(identical.length).toBeLessThan(Object.keys(dict.en).length * 0.15);
  });

  it("uses matching interpolation placeholders in both locales", () => {
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    const mismatched: string[] = [];
    for (const key of Object.keys(dict.en)) {
      const en = placeholders(String(dict.en[key as keyof typeof dict.en]));
      const ar = placeholders(String(dict.ar[key as keyof typeof dict.ar] ?? ""));
      if (JSON.stringify(en) !== JSON.stringify(ar)) mismatched.push(key);
    }
    expect(mismatched).toEqual([]);
  });
});
