// GCCLAB TMS — Trainer×Course certification matrix Excel import/export mapping.
// The sheet is a matrix: one row per course, one column per trainer, "X" marks
// a valid TrainerCertification for that (course, trainer) pair.

export const FIXED_HEADERS = ["#", "CODE", "Safety Certification Courses", "Duration (Day)"] as const;
export const TOTALS_ROW_LABEL = "Total no. of Courses for each Instructor till Now";

export interface MatrixCourse {
  code: string;
  title: string;
  durationHours: number;
  certifiedTrainerNames: Set<string>; // trainer fullName, exact match against the trainer column headers
}

/** Builds header row + course rows + a totals row, ready to feed into exceljs `sheet.addRow`. */
export function buildMatrixRows(
  courses: MatrixCourse[],
  trainerNames: string[]
): { header: string[]; rows: (string | number)[][]; totalsRow: (string | number)[] } {
  const header = [...FIXED_HEADERS, ...trainerNames];

  const rows = courses.map((c, i) => [
    i + 1,
    c.code,
    c.title,
    c.durationHours,
    ...trainerNames.map((name) => (c.certifiedTrainerNames.has(name) ? "X" : "")),
  ]);

  const totals = trainerNames.map(
    (name) => courses.filter((c) => c.certifiedTrainerNames.has(name)).length
  );
  const totalsRow: (string | number)[] = [TOTALS_ROW_LABEL, "", "", "", ...totals];

  return { header, rows, totalsRow };
}

export interface ParsedMatrixCourseRow {
  code: string;
  title: string;
  durationDays: number | null;
  certifiedTrainerNames: string[];
}

/**
 * Parses one data row against the trainer names taken from the header row's
 * columns after the 4 fixed columns (#, CODE, Title, Duration).
 */
export function parseMatrixRow(headerTrainerNames: string[], rowValues: unknown[]): ParsedMatrixCourseRow | null {
  // rowValues[0] = seq, [1] = code, [2] = title, [3] = duration, [4..] = trainer marks
  const code = cellToString(rowValues[1]);
  const title = cellToString(rowValues[2]);
  if (!title) return null;

  const duration = cellToNumber(rowValues[3]);
  const certifiedTrainerNames: string[] = [];
  headerTrainerNames.forEach((name, idx) => {
    const mark = cellToString(rowValues[4 + idx]);
    if (mark) certifiedTrainerNames.push(name);
  });

  return {
    code: code ?? "",
    title,
    durationDays: duration,
    certifiedTrainerNames,
  };
}

function cellToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v !== null && "text" in v) return String((v as { text: unknown }).text).trim() || null;
  if (typeof v === "object" && v !== null && "result" in v) return String((v as { result: unknown }).result).trim() || null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function cellToNumber(v: unknown): number | null {
  const s = cellToString(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}
