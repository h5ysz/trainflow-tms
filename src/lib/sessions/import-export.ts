// GCCLAB TMS — Training session Excel import/export column mapping
// =====================================================================
// Single source of truth for the Arabic column layout used by both the
// export route (/api/sessions/export) and the import route
// (/api/sessions/import), so the two stay in sync.

export interface SessionExportInput {
  refNumber: string;
  instituteName: string | null;
  courseTitle: string;
  classification: string; // COURSE | EXAM
  expectedTrainees: number;
  startDate: Date;
  endDate: Date;
  durationDays: number | null;
  shift: string | null; // MORNING | EVENING
  region: string | null;
  city: string | null;
  venue: string | null;
  locationMapUrl: string | null;
  trainerName: string | null;
  notes: string | null;
}

export interface SessionImportRow {
  instituteName: string | null;
  courseTitle: string;
  classification: string;
  expectedTrainees: number;
  startDate: Date | null;
  endDate: Date | null;
  durationDays: number | null;
  shift: string | null;
  region: string | null;
  city: string | null;
  venue: string | null;
  locationMapUrl: string | null;
  trainerName: string | null;
  notes: string | null;
}

export const SESSION_COLUMNS = [
  { key: "seq", header: "م", width: 6 },
  { key: "instituteName", header: "اسم المعهد المنفذ", width: 20 },
  { key: "courseTitle", header: "اسم البرنامج التدريبي", width: 30 },
  { key: "classification", header: "التصنيف دورة / إختبار", width: 14 },
  { key: "expectedTrainees", header: "عدد المرشحين", width: 12 },
  { key: "startDate", header: "تاريخ بدء الدورة", width: 14 },
  { key: "endDate", header: "تاريخ نهاية الدورة", width: 14 },
  { key: "durationDays", header: "مدة الدورة", width: 10 },
  { key: "shift", header: "وقت تنفيذ البرنامج ( صباحا / مساءا )", width: 16 },
  { key: "region", header: "منطقة الاعمال المنفذ بها البرنامج", width: 18 },
  { key: "city", header: "اسم المدينة", width: 14 },
  { key: "venue", header: "موقع تنفيذ الدورة", width: 20 },
  { key: "locationMapUrl", header: "احداثيات الموقع", width: 28 },
  { key: "trainerName", header: "اسم المدرب", width: 18 },
  { key: "notes", header: "ملاحظات", width: 20 },
] as const;

const CLASSIFICATION_AR: Record<string, string> = { COURSE: "دورة", EXAM: "إختبار" };
const CLASSIFICATION_EN: Record<string, string> = { "دورة": "COURSE", "اختبار": "EXAM", "إختبار": "EXAM" };

const SHIFT_AR: Record<string, string> = { MORNING: "صباحي", EVENING: "مسائي" };
const SHIFT_EN: Record<string, string> = { "صباحي": "MORNING", "صباحا": "MORNING", "مسائي": "EVENING", "مساءا": "EVENING", "مساء": "EVENING" };

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Maps a session (with course/trainer joined) to a row of cell values, in column order. */
export function sessionToRow(session: SessionExportInput, seq: number): (string | number)[] {
  return [
    seq,
    session.instituteName ?? "",
    session.courseTitle,
    CLASSIFICATION_AR[session.classification] ?? session.classification,
    session.expectedTrainees,
    formatDate(session.startDate),
    formatDate(session.endDate),
    session.durationDays ?? "",
    session.shift ? (SHIFT_AR[session.shift] ?? session.shift) : "",
    session.region ?? "",
    session.city ?? "",
    session.venue ?? "",
    session.locationMapUrl ?? "",
    session.trainerName ?? "",
    session.notes ?? "",
  ];
}

function cellToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v !== null && "text" in v) return String((v as { text: unknown }).text).trim() || null;
  if (typeof v === "object" && v !== null && "result" in v) return String((v as { result: unknown }).result).trim() || null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function cellToDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v;
  const s = cellToString(v);
  if (!s) return null;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function cellToNumber(v: unknown): number | null {
  const s = cellToString(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/** Parses a raw Excel row (array of cell values, in SESSION_COLUMNS order minus "seq") into session fields. */
export function parseImportRow(values: unknown[]): SessionImportRow {
  // values[0] is the "seq" column — skip it.
  const [, instituteName, courseTitle, classificationRaw, traineesRaw, startRaw, endRaw, durationRaw, shiftRaw, region, city, venue, locationMapUrl, trainerName, notes] = values;

  const classificationText = cellToString(classificationRaw);
  const shiftText = cellToString(shiftRaw);

  return {
    instituteName: cellToString(instituteName),
    courseTitle: cellToString(courseTitle) ?? "",
    classification: classificationText ? (CLASSIFICATION_EN[classificationText] ?? classificationText.toUpperCase()) : "COURSE",
    expectedTrainees: cellToNumber(traineesRaw) ?? 0,
    startDate: cellToDate(startRaw),
    endDate: cellToDate(endRaw),
    durationDays: cellToNumber(durationRaw),
    shift: shiftText ? (SHIFT_EN[shiftText] ?? shiftText.toUpperCase()) : null,
    region: cellToString(region),
    city: cellToString(city),
    venue: cellToString(venue),
    locationMapUrl: cellToString(locationMapUrl),
    trainerName: cellToString(trainerName),
    notes: cellToString(notes),
  };
}
