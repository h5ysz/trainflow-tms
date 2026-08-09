// GCCLAB TMS — Coordinator region scoping
//
// A coordinator with a `region` assignment is restricted (server-side) to
// companies whose `Company.region` falls inside their scope:
//
//   scope = [user.region, ...regionsCovered]
//
// A coordinator WITHOUT a region assignment is unscoped and sees everything —
// this keeps existing installations backward-compatible until an admin assigns
// regions. Only the COORDINATOR role is scoped; other roles (and users without
// a region) are never affected.
//
// Coverage (`regionsCovered`, JSON array of region codes) is purely an admin
// assignment on the user record: it widens the scope without changing the role
// or granting any trainer-level permission.

import type { AuthUser } from "@/lib/auth/api";
import { REGIONS } from "@/lib/regions";

export interface RegionScopeUser {
  role?: string | null;
  region?: string | null;
  regionsCovered?: string | null;
}

/**
 * Parse a JSON-encoded array of region codes stored on the user record.
 * Tolerant of malformed/missing values — returns an empty array.
 */
export function parseRegionsCovered(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is string => typeof r === "string" && (REGIONS as readonly string[]).includes(r));
  } catch {
    return [];
  }
}

/**
 * Normalize a regionsCovered payload (array or JSON string) into its canonical
 * JSON string form. Returns a JSON array string of valid region codes, or null
 * when the input is empty/undefined. Throws a RangeError on invalid codes so
 * API routes can 422.
 */
export function validateRegionsCovered(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { value?: unknown })?.value) ? (raw as { value: unknown[] }).value : [raw];
  const codes = arr.filter((r): r is string => typeof r === "string" && (REGIONS as readonly string[]).includes(r));
  if (codes.length !== arr.length) {
    throw new RangeError(`Invalid region code in coverage. Valid: ${REGIONS.join(", ")}`);
  }
  return codes.length > 0 ? JSON.stringify(codes) : null;
}

/**
 * Compute a coordinator's region scope, or null when the user is NOT a
 * coordinator or has no region assignment (unscoped → full visibility).
 */
export function coordinatorRegionScope(user: RegionScopeUser): string[] | null {
  if (user.role !== "COORDINATOR") return null;
  if (!user.region) return null;
  const primary = user.region;
  const covered = parseRegionsCovered(user.regionsCovered);
  return Array.from(new Set([primary, ...covered]));
}

/**
 * True when the given company region is inside the coordinator's scope.
 * Assumes `scope` came from coordinatorRegionScope() (non-null).
 */
export function companyRegionInScope(companyRegion: string | null | undefined, scope: string[]): boolean {
  return !!companyRegion && scope.includes(companyRegion);
}

/**
 * Helper for routes that take an AuthUser directly.
 */
export function coordinatorRegionScopeForUser(user: AuthUser): string[] | null {
  return coordinatorRegionScope(user as RegionScopeUser);
}
