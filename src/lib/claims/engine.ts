// GCCLAB TMS — Trainer Claim calculation engine
// =====================================================================
// Pure functions (no DB, no Next, no "server-only") so every business rule is
// unit-testable in node. Training Sessions are the single source of truth:
// this engine turns a session list into daily claim rows, exactly the shape of
// the real Yasser OT Approval Sheet (one row per training day).
//
// Business rules implemented here:
//   OVERTIME (employee): fixed DAILY allowance, NOT duration minus working
//     hours. Sun–Thu = 4h/day, Fri = 12h/day, Sat = 12h/day. Multiple sessions
//     in one day still total the daily cap (the cap is split across the day's
//     sessions proportionally to their actual duration, so two 6h sessions on
//     a Friday render as 6 + 6 = 12, exactly like the reference sheet).
//   OVERTIME (contractor): contractors have NO overtime. Their rows carry the
//     actual session hours and are labeled "Regular Hours" — never OT.
//   BUSINESS_MISSION: a qualifying day is a day with any session outside the
//     main work location. One mission day per qualifying day regardless of how
//     many sessions the day has. Days whose location is missing are flagged for
//     review (and conservatively counted, so the reviewer must confirm them).
//     Day value is 1; amount = 1 × daily allowance (employee 600 / contractor
//     900 SAR/day, both configurable — the engine only receives the resolved
//     rate and never hardcodes it).

export type EngagementType = "EMPLOYEE" | "CONTRACTOR";
export type ClaimType = "OVERTIME" | "BUSINESS_MISSION";

export interface ClaimSessionInput {
  id: string;
  courseCode?: string | null;
  courseTitle?: string | null;
  /** Session city — the claim Location shown on the sheet (e.g. "Al Qassim"). */
  city?: string | null;
  /** Session venue/location — used only when city is missing. */
  location?: string | null;
  shift?: string | null; // MORNING | EVENING
  /** Actual session hours for one training day. */
  durationHours: number;
  startDate: Date;
  endDate: Date;
}

export interface ClaimConfigInput {
  /** Main work location (e.g. "Dammam"). Days outside it are business missions. */
  mainLocation: string;
  /** SAR/day for employee business missions. */
  employeeDailyAllowance: number;
  /** SAR/day for contractor business missions. */
  contractorDailyAllowance: number;
}

export interface ClaimEngineRow {
  sessionId: string;
  date: string; // YYYY-MM-DD (UTC)
  weekdayIndex: number; // 0=Sunday … 6=Saturday
  courseCode: string | null;
  courseTitle: string | null;
  /** Claim location: session city ?? venue, or null when the day has no location. */
  location: string | null;
  locationFlagged: boolean;
  flagReason: string | null;
  shift: string | null;
  actualHours: number;
  /** The claimable value: OT cap hours / regular hours for OT; 1 day for BM. */
  value: number;
  unit: "HOURS" | "DAYS";
  rate: number | null; // BM daily allowance (SAR); null for OT
  amount: number | null; // BM: value × rate; null for OT
}

export interface ClaimEngineResult {
  items: ClaimEngineRow[];
  totalHours: number;
  totalDays: number;
  totalAmount: number;
}

const WEEKDAY_CAP_HOURS = 4; // Sun–Thu
const WEEKEND_CAP_HOURS = 12; // Fri, Sat

const UTC_DAY_MS = 86_400_000;

/** YYYY-MM-DD key of a Date (UTC), matching how session dates are stored. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 0=Sunday … 6=Saturday from the UTC day. */
export function utcWeekday(date: Date): number {
  return date.getUTCDay();
}

/** The fixed daily OT allowance for an employee on a given date. */
export function overtimeCapHours(date: Date): number {
  return utcWeekday(date) <= 4 ? WEEKDAY_CAP_HOURS : WEEKEND_CAP_HOURS;
}

export function weekdayName(index: number, locale: "en" | "ar" = "en"): string {
  const en = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ar = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  return (locale === "ar" ? ar : en)[index] ?? "";
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** True when a session's location is set (city or venue). */
function hasLocation(session: ClaimSessionInput): boolean {
  return Boolean(session.city?.trim() || session.location?.trim());
}

/** The display location of a session: city ?? venue. */
export function sessionLocation(session: ClaimSessionInput): string | null {
  const city = session.city?.trim();
  const venue = session.location?.trim();
  return city || venue || null;
}

function isAtMainLocation(session: ClaimSessionInput, mainLocation: string): boolean {
  const target = normalize(mainLocation);
  if (!target) return false;
  const city = normalize(session.city);
  const venue = normalize(session.location);
  return city === target || (venue === target && !city);
}

/** Clips a session to the claim period and expands it into one entry per day. */
export function expandSessionDays(
  session: ClaimSessionInput,
  periodFrom: Date,
  periodTo: Date,
): Array<{ date: Date; actualHours: number }> {
  const start = session.startDate.getTime() > periodFrom.getTime() ? session.startDate : periodFrom;
  const end = session.endDate.getTime() < periodTo.getTime() ? session.endDate : periodTo;
  const days: Array<{ date: Date; actualHours: number }> = [];
  // Normalize to UTC midnights so day keys are timezone-independent (Dammam is
  // UTC+3; building dates with the local constructor would shift rows by a day).
  const startKey = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endKey = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const hours = Number.isFinite(session.durationHours) && session.durationHours > 0 ? session.durationHours : 0;
  for (let t = startKey.getTime(); t <= endKey.getTime(); t += UTC_DAY_MS) {
    days.push({ date: new Date(t), actualHours: hours });
  }
  return days;
}

interface DayGroup {
  date: Date;
  sessions: Array<ClaimSessionInput & { actualHours: number }>;
}

function groupByDay(
  sessions: ClaimSessionInput[],
  periodFrom: Date,
  periodTo: Date,
): DayGroup[] {
  const byKey = new Map<string, DayGroup>();
  for (const session of sessions) {
    for (const day of expandSessionDays(session, periodFrom, periodTo)) {
      const key = dayKey(day.date);
      const existing = byKey.get(key);
      if (existing) {
        existing.sessions.push({ ...session, actualHours: day.actualHours });
      } else {
        byKey.set(key, { date: day.date, sessions: [{ ...session, actualHours: day.actualHours }] });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

function employeeOvertimeRows(days: DayGroup[]): ClaimEngineRow[] {
  const rows: ClaimEngineRow[] = [];
  for (const day of days) {
    const cap = overtimeCapHours(day.date);
    const totalDuration = day.sessions.reduce((sum, s) => sum + (s.actualHours || 0), 0);
    let allocated = 0;
    day.sessions.forEach((session, i) => {
      const isLast = i === day.sessions.length - 1;
      let value: number;
      if (totalDuration > 0) {
        value = round2((cap * (session.actualHours || 0)) / totalDuration);
        if (isLast) value = round2(cap - allocated);
      } else {
        value = round2(cap / day.sessions.length);
      }
      allocated = round2(allocated + value);
      rows.push(rowFor(day.date, session, value, "HOURS", null, null));
    });
  }
  return rows;
}

function contractorRegularRows(days: DayGroup[]): ClaimEngineRow[] {
  const rows: ClaimEngineRow[] = [];
  for (const day of days) {
    for (const session of day.sessions) {
      const value = round2(session.actualHours || 0);
      rows.push(rowFor(day.date, session, value, "HOURS", null, null));
    }
  }
  return rows;
}

function businessMissionRows(days: DayGroup[], mainLocation: string, rate: number): ClaimEngineRow[] {
  const rows: ClaimEngineRow[] = [];
  for (const day of days) {
    // A day qualifies when ANY of its sessions is outside the main location.
    // Days with no location at all are conservatively counted and flagged.
    const withLocation = day.sessions.filter((s) => hasLocation(s));
    const away = withLocation.filter((s) => !isAtMainLocation(s, mainLocation));
    const qualifies = withLocation.length === 0 || away.length > 0;
    if (!qualifies) continue;

    const first = day.sessions[0];
    let location: string | null = null;
    let flagged = false;
    let flagReason: string | null = null;

    if (withLocation.length === 0) {
      flagged = true;
      flagReason = "Missing location — confirm this training day qualifies as a business mission.";
    } else if (away.length < withLocation.length) {
      flagged = true;
      flagReason = "Mixed locations on the same day (main + away) — confirm this day qualifies as a business mission.";
      location = sessionLocation(away[0]);
    } else {
      const unique = [...new Set(withLocation.map((s) => sessionLocation(s) ?? "").filter(Boolean))];
      location = unique.length === 1 ? unique[0] : sessionLocation(away[0]);
    }

    rows.push({
      ...rowFor(day.date, first, 1, "DAYS", rate, rate),
      location,
      locationFlagged: flagged,
      flagReason,
    });
  }
  return rows;
}

function rowFor(
  date: Date,
  session: ClaimSessionInput & { actualHours: number },
  value: number,
  unit: "HOURS" | "DAYS",
  rate: number | null,
  amount: number | null,
): ClaimEngineRow {
  const city = session.city?.trim();
  const venue = session.location?.trim();
  return {
    sessionId: session.id,
    date: dayKey(date),
    weekdayIndex: utcWeekday(date),
    courseCode: session.courseCode ?? null,
    courseTitle: session.courseTitle ?? null,
    location: city || venue || null,
    locationFlagged: false,
    flagReason: null,
    shift: session.shift ?? null,
    actualHours: round2(session.actualHours || 0),
    value: round2(value),
    unit,
    rate,
    amount: amount !== null ? round2(amount) : null,
  };
}

/**
 * Compute the claim rows for a trainer's sessions inside a period.
 * Pure — no DB reads. Sessions are the source of truth; every row derives from
 * session data and the (already-resolved) claim configuration.
 */
export function computeClaim(
  sessions: ClaimSessionInput[],
  opts: {
    claimType: ClaimType;
    engagementType: EngagementType;
    periodFrom: Date;
    periodTo: Date;
    config: ClaimConfigInput;
  },
): ClaimEngineResult {
  const { claimType, engagementType, periodFrom, periodTo, config } = opts;
  const days = groupByDay(sessions, periodFrom, periodTo);

  let items: ClaimEngineRow[];
  if (claimType === "BUSINESS_MISSION") {
    const rate =
      engagementType === "CONTRACTOR" ? config.contractorDailyAllowance : config.employeeDailyAllowance;
    items = businessMissionRows(days, config.mainLocation, rate);
  } else if (engagementType === "CONTRACTOR") {
    items = contractorRegularRows(days);
  } else {
    items = employeeOvertimeRows(days);
  }

  let totalHours = 0;
  let totalDays = 0;
  let totalAmount = 0;
  for (const item of items) {
    if (item.unit === "HOURS") totalHours = round2(totalHours + item.value);
    else totalDays += 1;
    if (item.amount !== null) totalAmount = round2(totalAmount + item.amount);
  }

  return { items, totalHours, totalDays, totalAmount };
}
