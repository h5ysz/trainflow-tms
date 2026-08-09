// GCCLAB TMS — Region codes (coordinator assignment + coverage + company region)
//
// Single source of truth for the four operational regions. Region assignment
// is a per-user (coordinator) attribute, NOT a role — see the User model's
// `region` / `regionsCovered` columns and src/lib/api/region-scope.ts for the
// authorization effect. Coverage lets an admin temporarily grant a coordinator
// a backup scope over other regions without changing roles or permissions.
//
// Companies carry their own `region` (Company.region); scoping matches the
// coordinator's scope against the company's region.

export const REGIONS = ["CENTRAL", "EASTERN", "WESTERN", "SOUTHERN"] as const;

export type RegionCode = (typeof REGIONS)[number];

export const REGION_LABELS: Record<RegionCode, { en: string; ar: string }> = {
  CENTRAL: { en: "Central", ar: "الوسطى" },
  EASTERN: { en: "Eastern", ar: "الشرقية" },
  WESTERN: { en: "Western", ar: "الغربية" },
  SOUTHERN: { en: "Southern", ar: "الجنوبية" },
};

export function isRegionCode(value: unknown): value is RegionCode {
  return typeof value === "string" && (REGIONS as readonly string[]).includes(value);
}
