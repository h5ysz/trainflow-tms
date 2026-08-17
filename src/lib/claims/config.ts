// GCCLAB TMS — Claim configuration service
// =====================================================================
// Claim settings live in the ClaimSetting table with effective-date history:
// the current value for a key is the row with the latest effectiveFrom <= now.
// A change ALWAYS inserts a new row (old rows are never updated), so a claim
// can record which rate/location was in force when it was generated and a
// settings rollback is a matter of adding another row, not rewriting history.
//
// Keys:
//   MAIN_LOCATION                — main work location (default "Dammam")
//   EMPLOYEE_DAILY_ALLOWANCE     — SAR/day business-mission allowance (600)
//   CONTRACTOR_DAILY_ALLOWANCE   — SAR/day business-mission allowance (900)

import { db } from "@/lib/db";

export const CLAIM_SETTING_KEYS = {
  MAIN_LOCATION: "MAIN_LOCATION",
  EMPLOYEE_DAILY_ALLOWANCE: "EMPLOYEE_DAILY_ALLOWANCE",
  CONTRACTOR_DAILY_ALLOWANCE: "CONTRACTOR_DAILY_ALLOWANCE",
  NORMAL_WORKING_HOURS_PER_DAY: "NORMAL_WORKING_HOURS_PER_DAY",
  CONTRACTOR_RATE_PER_DAY: "CONTRACTOR_RATE_PER_DAY",
} as const;

export type ClaimSettingKey = (typeof CLAIM_SETTING_KEYS)[keyof typeof CLAIM_SETTING_KEYS];

export const CLAIM_SETTING_DEFAULTS: Record<ClaimSettingKey, { value: string; description: string }> = {
  MAIN_LOCATION: { value: "Dammam", description: "Main work location. Training days outside it qualify as business missions." },
  EMPLOYEE_DAILY_ALLOWANCE: { value: "600", description: "Employee business-mission daily allowance (SAR/day)." },
  CONTRACTOR_DAILY_ALLOWANCE: { value: "900", description: "Contractor business-mission daily allowance (SAR/day)." },
  NORMAL_WORKING_HOURS_PER_DAY: { value: "8", description: "Normal working hours per day for HRD-FO-052 form." },
  CONTRACTOR_RATE_PER_DAY: { value: "700", description: "Default contractor daily rate (SAR/day) for timesheet/invoice." },
};

export interface ClaimConfig {
  mainLocation: string;
  employeeDailyAllowance: number;
  contractorDailyAllowance: number;
  normalWorkingHoursPerDay: number;
  contractorRatePerDay: number;
}

/**
 * The resolved claim configuration effective on `asOf`. Falls back to the
 * defaults when a key has no row yet, so the engine never receives a gap.
 */
export async function getClaimConfig(asOf: Date = new Date()): Promise<ClaimConfig> {
  const keys = Object.values(CLAIM_SETTING_KEYS) as ClaimSettingKey[];
  const rows = await db.claimSetting.findMany({
    where: { key: { in: keys }, effectiveFrom: { lte: asOf } },
    orderBy: { effectiveFrom: "desc" },
  });
  const byKey = new Map<string, { value: string; effectiveFrom: Date }>();
  for (const row of rows) {
    if (!byKey.has(row.key)) byKey.set(row.key, { value: row.value, effectiveFrom: row.effectiveFrom });
  }
  return {
    mainLocation: byKey.get(CLAIM_SETTING_KEYS.MAIN_LOCATION)?.value ?? CLAIM_SETTING_DEFAULTS.MAIN_LOCATION.value,
    employeeDailyAllowance: parseRate(byKey.get(CLAIM_SETTING_KEYS.EMPLOYEE_DAILY_ALLOWANCE)?.value ?? CLAIM_SETTING_DEFAULTS.EMPLOYEE_DAILY_ALLOWANCE.value),
    contractorDailyAllowance: parseRate(byKey.get(CLAIM_SETTING_KEYS.CONTRACTOR_DAILY_ALLOWANCE)?.value ?? CLAIM_SETTING_DEFAULTS.CONTRACTOR_DAILY_ALLOWANCE.value),
    normalWorkingHoursPerDay: parseRate(byKey.get(CLAIM_SETTING_KEYS.NORMAL_WORKING_HOURS_PER_DAY)?.value ?? CLAIM_SETTING_DEFAULTS.NORMAL_WORKING_HOURS_PER_DAY.value),
    contractorRatePerDay: parseRate(byKey.get(CLAIM_SETTING_KEYS.CONTRACTOR_RATE_PER_DAY)?.value ?? CLAIM_SETTING_DEFAULTS.CONTRACTOR_RATE_PER_DAY.value),
  };
}

function parseRate(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export interface ClaimSettingRow {
  id: string;
  key: ClaimSettingKey;
  value: string;
  effectiveFrom: Date;
  createdAt: Date;
  updatedBy: string | null;
  description: string | null;
}

/** Full effective-date history for a key, newest first. */
export async function claimSettingHistory(key: ClaimSettingKey): Promise<ClaimSettingRow[]> {
  const rows = await db.claimSetting.findMany({
    where: { key },
    orderBy: { effectiveFrom: "desc" },
  });
  return rows.map((row) => ({ ...row, key: row.key as ClaimSettingKey }));
}

/**
 * Insert a new value for a key effective from `effectiveFrom`. Idempotent per
 * (key, value, effectiveFrom): if that exact change already exists it returns
 * the existing row instead of creating a duplicate.
 */
export async function setClaimSetting(
  key: ClaimSettingKey,
  value: string,
  effectiveFrom: Date,
  updatedBy: string | null,
): Promise<ClaimSettingRow> {
  const normalized = value.trim();
  const existing = await db.claimSetting.findFirst({
    where: { key, value: normalized, effectiveFrom },
  });
  if (existing) return { ...existing, key: existing.key as ClaimSettingKey };
  const created = await db.claimSetting.create({
    data: {
      key,
      value: normalized,
      effectiveFrom,
      updatedBy,
      description: CLAIM_SETTING_DEFAULTS[key].description,
    },
  });
  return { ...created, key: created.key as ClaimSettingKey };
}

/**
 * Seed the defaults once (no-op when a row already exists for a key). Safe to
 * run on every deploy and on first access of the settings page.
 */
export async function ensureDefaultClaimSettings(updatedBy: string | null = null): Promise<void> {
  const keys = Object.values(CLAIM_SETTING_KEYS) as ClaimSettingKey[];
  for (const key of keys) {
    const exists = await db.claimSetting.findFirst({ where: { key } });
    if (!exists) {
      await db.claimSetting.create({
        data: {
          key,
          value: CLAIM_SETTING_DEFAULTS[key].value,
          effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
          updatedBy,
          description: CLAIM_SETTING_DEFAULTS[key].description,
        },
      });
    }
  }
}
