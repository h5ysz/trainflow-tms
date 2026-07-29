// GCCLAB TMS — Report Scheduler Service
// =====================================================================
// Evaluates cron expressions, computes next-run times, and determines
// which schedules are due for execution.
//
// Supports: WEEKLY, MONTHLY, DAILY, CUSTOM schedule types with
// configurable execution time + timezone.

export const DEFAULT_TIMEZONE = "Asia/Riyadh";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

interface ZonedParts {
  minute: number;
  hour: number;
  day: number;
  month: number;
  weekday: number;
}

/**
 * Break an instant into calendar fields *as observed in `timezone`*.
 *
 * Date.prototype.getHours() and friends report the server's local time. Render runs in
 * UTC, so a schedule configured for 09:00 Asia/Riyadh was firing at 09:00 UTC — three
 * hours late — and near midnight the day-of-week was wrong too. `schedule.timezone` was
 * stored on every row but never actually read.
 */
export function zonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    minute: "2-digit",
    hour: "2-digit",
    day: "2-digit",
    month: "2-digit",
    weekday: "short",
  });

  const parts: Record<string, string> = {};
  for (const { type, value } of formatter.formatToParts(date)) {
    parts[type] = value;
  }

  return {
    minute: parseInt(parts.minute, 10),
    // Intl emits "24" for midnight in hour12:false mode in some engines.
    hour: parseInt(parts.hour, 10) % 24,
    day: parseInt(parts.day, 10),
    month: parseInt(parts.month, 10),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
}

/**
 * Parse a cron expression (5-field: minute hour day-of-month month day-of-week)
 * and determine if it should fire at the given time, interpreted in `timezone`.
 * Supports: wildcard, specific values, ranges (1-5), lists (1,3,5), step values
 */
export function cronMatches(cronExpr: string, date: Date, timezone: string = DEFAULT_TIMEZONE): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minField, hourField, domField, monthField, dowField] = parts;
  const { minute, hour, day, month, weekday } = zonedParts(date, timezone);

  return (
    fieldMatches(minField, minute, 0, 59) &&
    fieldMatches(hourField, hour, 0, 23) &&
    fieldMatches(domField, day, 1, 31) &&
    fieldMatches(monthField, month, 1, 12) &&
    fieldMatches(dowField, weekday, 0, 6)
  );
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true;

  // Step: */N — counted from the field's minimum, not from zero. For day-of-month
  // (min 1) and month (min 1), `value % step` matched the wrong days: */5 hit the 5th
  // and 10th but never the 1st.
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) return false;
    return (value - min) % step === 0;
  }

  // List: 1,3,5
  if (field.includes(",")) {
    return field.split(",").some((f) => fieldMatches(f.trim(), value, min, max));
  }

  // Range: 1-5. A reversed range (5-1) is invalid rather than silently never matching.
  if (field.includes("-")) {
    const [start, end] = field.split("-").map((n) => parseInt(n, 10));
    if (isNaN(start) || isNaN(end) || start > end) return false;
    return value >= start && value <= end;
  }

  // Specific value
  const num = parseInt(field, 10);
  if (isNaN(num)) return false;
  return value === num;
}

/**
 * Compute the next run time for a cron expression after the given date.
 * Scans minute-by-minute (up to 7 days) to find the next match.
 */
export function getNextRunTime(
  cronExpr: string,
  after: Date = new Date(),
  timezone: string = DEFAULT_TIMEZONE
): Date {
  // Walk absolute instants a minute at a time and test each one *in the target zone*.
  // Stepping a Date by minutes is DST-safe here because the arithmetic is on the
  // underlying epoch value; only the comparison is zone-aware.
  const startMs = Math.floor(after.getTime() / 60000) * 60000 + 60000;

  const maxIterations = 366 * 24 * 60; // a full year — MONTHLY schedules can exceed a week
  for (let i = 0; i < maxIterations; i++) {
    const candidate = new Date(startMs + i * 60000);
    if (cronMatches(cronExpr, candidate, timezone)) {
      return candidate;
    }
  }

  // Fallback: a year out, so an unsatisfiable expression parks the schedule rather
  // than re-firing constantly.
  return new Date(startMs + maxIterations * 60000);
}

/**
 * Build a cron expression from schedule type + time + day params.
 * No hardcoded defaults — callers must provide the values (from Settings or schedule config).
 */
export function buildCronExpression(opts: {
  scheduleType: "WEEKLY" | "MONTHLY" | "DAILY" | "CUSTOM";
  executionTime?: string;  // "HH:mm"
  dayOfWeek?: number;      // 0-6 (for WEEKLY)
  dayOfMonth?: number;     // 1-31 (for MONTHLY)
  customCron?: string;     // full cron expression (for CUSTOM)
}): string {
  const time = opts.executionTime ?? "00:00";
  const [hour, min] = time.split(":").map(Number);

  switch (opts.scheduleType) {
    case "WEEKLY":
      return `${min} ${hour} * * ${opts.dayOfWeek ?? 0}`;
    case "MONTHLY":
      return `${min} ${hour} ${opts.dayOfMonth ?? 1} * *`;
    case "DAILY":
      return `${min} ${hour} * * *`;
    case "CUSTOM":
      return opts.customCron ?? "0 0 * * *";
    default:
      return "0 0 * * *";
  }
}

/**
 * Read schedule timing configuration from the Settings table.
 * This allows Super Admins to change execution time, day, timezone,
 * and enabled/disabled status without changing code.
 */
export async function getScheduleSettings(): Promise<{
  weekly: {
    enabled: boolean;
    executionTime: string;
    dayOfWeek: number;
    cronExpression: string;
  };
  monthly: {
    enabled: boolean;
    executionTime: string;
    dayOfMonth: number;
    cronExpression: string;
  };
  timezone: string;
}> {
  const { db } = await import("@/lib/db");
  const settings = await db.setting.findMany({
    where: { key: { startsWith: "schedule." } },
  });
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;

  const wTime = map["schedule.weekly.executionTime"] ?? "09:00";
  const wDay = parseInt(map["schedule.weekly.dayOfWeek"] ?? "4", 10);
  const wEnabled = map["schedule.weekly.enabled"] !== "false";

  const mTime = map["schedule.monthly.executionTime"] ?? "09:00";
  const mDay = parseInt(map["schedule.monthly.dayOfMonth"] ?? "1", 10);
  const mEnabled = map["schedule.monthly.enabled"] !== "false";

  const tz = map["schedule.timezone"] ?? DEFAULT_TIMEZONE;

  const [wHour, wMin] = wTime.split(":").map(Number);
  const [mHour, mMin] = mTime.split(":").map(Number);

  return {
    weekly: {
      enabled: wEnabled,
      executionTime: wTime,
      dayOfWeek: wDay,
      cronExpression: `${wMin} ${wHour} * * ${wDay}`,
    },
    monthly: {
      enabled: mEnabled,
      executionTime: mTime,
      dayOfMonth: mDay,
      cronExpression: `${mMin} ${mHour} ${mDay} * *`,
    },
    timezone: tz,
  };
}

/**
 * Sync a ReportSchedule's cron expression + timing fields with the
 * current Settings values. Called before each scheduler tick to ensure
 * schedules always use the latest Settings configuration.
 */
export async function syncScheduleFromSettings(scheduleId: string): Promise<void> {
  const { db } = await import("@/lib/db");
  const schedule = await db.reportSchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule || schedule.deletedAt) return;

  const settings = await getScheduleSettings();

  let newCron = schedule.cronExpression;
  let newTime = schedule.executionTime;
  let newDayOfWeek = schedule.dayOfWeek;
  let newDayOfMonth = schedule.dayOfMonth;
  let newTimezone = schedule.timezone;
  let newIsActive = schedule.isActive;

  if (schedule.scheduleType === "WEEKLY") {
    newTime = settings.weekly.executionTime;
    newDayOfWeek = settings.weekly.dayOfWeek;
    newCron = settings.weekly.cronExpression;
    newIsActive = settings.weekly.enabled;
    newTimezone = settings.timezone;
  } else if (schedule.scheduleType === "MONTHLY") {
    newTime = settings.monthly.executionTime;
    newDayOfMonth = settings.monthly.dayOfMonth;
    newCron = settings.monthly.cronExpression;
    newIsActive = settings.monthly.enabled;
    newTimezone = settings.timezone;
  }

  // Only update if something changed
  if (
    newCron !== schedule.cronExpression ||
    newTime !== schedule.executionTime ||
    newDayOfWeek !== schedule.dayOfWeek ||
    newDayOfMonth !== schedule.dayOfMonth ||
    newTimezone !== schedule.timezone ||
    newIsActive !== schedule.isActive
  ) {
    const nextRun = getNextRunTime(newCron, new Date(), newTimezone);
    await db.reportSchedule.update({
      where: { id: scheduleId },
      data: {
        cronExpression: newCron,
        executionTime: newTime,
        dayOfWeek: newDayOfWeek,
        dayOfMonth: newDayOfMonth,
        timezone: newTimezone,
        isActive: newIsActive,
        nextRunAt: nextRun,
        updatedAt: new Date(),
      },
    });
  }
}

/**
 * Get all schedules that are due for execution (nextRunAt <= now).
 */
export async function getDueSchedules(): Promise<any[]> {
  const { db } = await import("@/lib/db");
  const now = new Date();

  const schedules = await db.reportSchedule.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      OR: [
        { nextRunAt: { lte: now } },
        { nextRunAt: null }, // never run yet
      ],
    },
    orderBy: { nextRunAt: "asc" },
  });

  return schedules;
}

/**
 * Update the nextRunAt for a schedule after execution.
 */
export async function updateNextRun(
  scheduleId: string,
  cronExpr: string,
  timezone: string = DEFAULT_TIMEZONE
): Promise<void> {
  const { db } = await import("@/lib/db");
  const nextRun = getNextRunTime(cronExpr, new Date(), timezone);

  await db.reportSchedule.update({
    where: { id: scheduleId },
    data: {
      nextRunAt: nextRun,
      updatedAt: new Date(),
    },
  });
}

/**
 * Format a cron expression for human-readable display.
 */
export function describeCron(cronExpr: string): string {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return cronExpr;

  const [min, hour, dom, month, dow] = parts;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const timeStr = hour === "*" ? "every hour" : `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;

  if (dom === "*" && month === "*" && dow !== "*") {
    const dayNum = parseInt(dow, 10);
    if (!isNaN(dayNum)) return `Every ${days[dayNum]} at ${timeStr}`;
  }
  if (dom !== "*" && month === "*" && dow === "*") {
    return `On day ${dom} of every month at ${timeStr}`;
  }
  if (dom === "*" && month === "*" && dow === "*") {
    return `Every day at ${timeStr}`;
  }

  return `Cron: ${cronExpr}`;
}
