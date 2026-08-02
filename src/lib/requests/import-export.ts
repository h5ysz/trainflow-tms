// GCCLAB TMS — Training request / registration-sheet Excel import/export mapping.
// Flat, one row per trainee — subsumes both the "course request form" (all rows
// share one company + one course) and the richer "registration sheet" layout.
//
// V2: Header-based column matching with Arabic + English aliases. Column order
// no longer matters — the parser reads row 1 (headers), matches each header
// against a set of aliases, and builds a fieldKey→columnIndex mapping. Rows
// are then read by column index, not by fixed position.

export const REQUEST_COLUMNS = [
  { key: "seq", header: "م", width: 6 },
  { key: "name", header: "الاسم بالانجليزية / Name", width: 28 },
  { key: "nationalId", header: "رقم الاقامة / الهوية / ID", width: 16 },
  { key: "jobTitle", header: "الوظيفة / Job", width: 18 },
  { key: "companyName", header: "اسم الشركة / Company name", width: 26 },
  { key: "activity", header: "النشاط / Activity", width: 20 },
  { key: "region", header: "المنطقة / Region", width: 16 },
  { key: "city", header: "المدينة / City", width: 16 },
  { key: "phone", header: "رقم الجوال / Phone", width: 16 },
  { key: "email", header: "البريد الإلكتروني / Email", width: 24 },
  { key: "courseTitle", header: "اسم الدورة / Course Title", width: 30 },
  { key: "duration", header: "المدة / Duration", width: 10 },
] as const;

// ─────────────────────────────────────────────────────────────────────────
// V2: Header alias mapping — column matching by header name (not position)
// ─────────────────────────────────────────────────────────────────────────
// Each field maps to an array of accepted header aliases. Matching is
// case-insensitive, trimmed, and ignores diacritics on the Arabic side.
// The first alias is the "canonical" form (used in export headers + error
// messages).

export interface ColumnAlias {
  field: keyof ParsedRegistrationRow;
  required: boolean;
  aliases: string[]; // Arabic + English aliases, case-insensitive
}

export const COLUMN_ALIASES: ColumnAlias[] = [
  {
    field: "name",
    required: true,
    aliases: [
      "الاسم",
      "اسم المتدرب",
      "اسم الموظف",
      "الاسم بالانجليزية / name",
      "الاسم / name",
      "employee name",
      "trainee name",
      "name",
      "full name",
      "worker name",
    ],
  },
  {
    field: "nationalId",
    required: true,
    aliases: [
      "رقم الهوية",
      "رقم الاقامة",
      "رقم الإقامة",
      "الهوية",
      "الاقامة",
      "الإقامة",
      "رقم الاقامة / الهوية / id",
      "رقم الهوية / الإقامة",
      "id number",
      "id",
      "national id",
      "iqama number",
      "iqama",
      "nationality id",
      "identity number",
    ],
  },
  {
    field: "nationality",
    required: false,
    aliases: [
      "الجنسية",
      "جنسية",
      "الجنسية / nationality",
      "nationality",
      "national",
    ],
  },
  {
    field: "jobTitle",
    required: false,
    aliases: [
      "المهنة",
      "الوظيفة",
      "الوظيفة / job",
      "المسمى الوظيفي",
      "job",
      "job title",
      "occupation",
      "position",
      "title",
    ],
  },
  {
    field: "companyName",
    // NOT required at the Excel-column level: contractors usually select the
    // company in the parent request form, not per-row in the Excel sheet.
    // The validation in buildPreview() only enforces name + nationalId.
    required: false,
    aliases: [
      "اسم الشركة",
      "الشركة",
      "اسم الشركة / company name",
      "الشركة / company",
      "company name",
      "company",
      "employer",
      "organization",
    ],
  },
  {
    field: "activity",
    required: false,
    aliases: [
      "النشاط",
      "النشاط / activity",
      "activity",
      "work activity",
    ],
  },
  {
    field: "region",
    required: false,
    aliases: [
      "المنطقة",
      "المنطقة / region",
      "region",
      "area",
      "province",
    ],
  },
  {
    field: "city",
    required: false,
    aliases: [
      "المدينة",
      "المدينة / city",
      "city",
      "town",
      "location",
    ],
  },
  {
    field: "phone",
    required: false,
    aliases: [
      "رقم الجوال",
      "الجوال",
      "رقم الهاتف",
      "الهاتف",
      "رقم الجوال / phone",
      "phone",
      "phone number",
      "mobile",
      "mobile number",
      "tel",
      "telephone",
      "contact number",
    ],
  },
  {
    field: "email",
    required: false,
    aliases: [
      "البريد الإلكتروني",
      "البريد",
      "الايميل",
      "البريد الإلكتروني / email",
      "email",
      "e-mail",
      "mail",
      "email address",
    ],
  },
  {
    field: "courseTitle",
    // NOT required at the Excel-column level: the course is selected in the
    // parent request form. Many real Excel sheets don't have a course column
    // at all (the whole sheet is for one course).
    required: false,
    aliases: [
      "اسم الدورة",
      "الدورة",
      "اسم الدورة / course title",
      "الدورة التدريبية",
      "course title",
      "course",
      "course name",
      "training course",
      "training",
    ],
  },
  {
    field: "duration",
    required: false,
    aliases: [
      "المدة",
      "المدة / duration",
      "duration",
      "duration (hours)",
      "hours",
      "duration hours",
    ],
  },
];

/** Normalize a header string for matching:
 *  - lowercase
 *  - replace newlines/tabs with spaces
 *  - trim
 *  - collapse multiple spaces
 *  - strip parentheses and slash/backslash (so "Name (English)" → "name english",
 *    "الإقامة/الهوية" → "اقامة الهوية")
 *  - strip Arabic diacritics (tashkeel) for more lenient matching
 */
function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[\r\n\t]+/g, " ")          // newlines/tabs → space (bilingual headers like "الاسم\nName")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[()]/g, "")
    .replace(/[/\\]/g, " ")
    .replace(/[\u064B-\u065F\u0670]/g, "") // Arabic diacritics
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Auto-detect which row in the first `maxScan` rows is the header row.
 *
 * Real-world Saudi training-registration sheets often have 1-5 rows of
 * instructions (long Arabic + English text in merged cells) BEFORE the
 * actual column headers. Hardcoding row 1 as headers causes every column
 * to be "missing" and every row to be invalid.
 *
 * Strategy: scan the first `maxScan` rows, run resolveColumnMapping on each,
 * and pick the row with the highest number of matched fields. Ties are
 * broken by the lowest row number (earliest header wins).
 *
 * Returns { headerRowNumber, headers } where headerRowNumber is 1-indexed
 * (Excel's row numbering). If no row matches any alias, returns row 1 as
 * a safe fallback so the UI can still show "missing required columns".
 */
export interface HeaderDetectionResult {
  headerRowNumber: number;        // 1-indexed
  headers: string[];              // raw header strings from that row
  matchCount: number;             // how many fields were matched
}

export function detectHeaderRow(
  getRow: (rowNumber: number) => { getCell: (colIndex: number) => unknown; cellCount: number } | null,
  maxScan = 10
): HeaderDetectionResult {
  let best: { rowNumber: number; headers: string[]; matchCount: number } = {
    rowNumber: 1,
    headers: [],
    matchCount: -1,
  };

  for (let r = 1; r <= maxScan; r++) {
    const row = getRow(r);
    if (!row) break;
    const headers: string[] = [];
    let nonEmptyCount = 0;
    let maxCellLen = 0;
    let totalCellLen = 0;
    for (let c = 1; c <= Math.max(row.cellCount, 1); c++) {
      const raw = cellToString(row.getCell(c)) ?? "";
      headers.push(raw);
      if (raw.trim() !== "") nonEmptyCount++;
      maxCellLen = Math.max(maxCellLen, raw.length);
      totalCellLen += raw.length;
    }
    // Skip rows with only ONE non-empty cell — these are typically
    // instruction banners spanning merged cells.
    if (nonEmptyCount < 2) continue;
    // Skip rows where any single cell is very long (>80 chars) — these are
    // instruction paragraphs, not column headers. Real header cells are
    // short labels like "Name", "الاسم", "National ID".
    if (maxCellLen > 80) continue;
    // Skip rows where the average cell length is >40 chars — even if no
    // single cell is huge, a row full of medium-length instructional text
    // is not a header row.
    if (nonEmptyCount > 0 && totalCellLen / nonEmptyCount > 40) continue;

    // Count how many fields this row would match.
    const mapping = resolveColumnMapping(headers);
    const matchCount = Object.keys(mapping.mapping).length;
    if (matchCount > best.matchCount) {
      best = { rowNumber: r, headers, matchCount };
    }
    // If we found a row that matches 3+ fields, that's almost certainly
    // the header row — stop scanning.
    if (matchCount >= 3) break;
  }

  return {
    headerRowNumber: best.rowNumber,
    headers: best.headers,
    matchCount: best.matchCount,
  };
}

/**
 * Resolve which column index maps to which field key, by reading row 1 (headers)
 * and matching each header against the alias lists. Returns:
 *   - mapping: { fieldKey → columnIndex }
 *   - matchedHeaders: { fieldKey → originalHeaderText } (for display)
 *   - unmatchedHeaders: string[] (headers that didn't match any field — for display)
 *   - missingRequired: { fieldKey → canonicalAlias }[] (required fields with no match)
 */
export interface ColumnMappingResult {
  mapping: Partial<Record<keyof ParsedRegistrationRow, number>>;
  matchedHeaders: Partial<Record<keyof ParsedRegistrationRow, string>>;
  unmatchedHeaders: string[];
  missingRequired: { field: keyof ParsedRegistrationRow; canonicalAlias: string }[];
}

export function resolveColumnMapping(headers: string[]): ColumnMappingResult {
  const mapping: Partial<Record<keyof ParsedRegistrationRow, number>> = {};
  const matchedHeaders: Partial<Record<keyof ParsedRegistrationRow, string>> = {};
  const unmatchedHeaders: string[] = [];
  const missingRequired: { field: keyof ParsedRegistrationRow; canonicalAlias: string }[] = [];

  // Build a lookup: normalizedAlias → { field, columnIndex }
  // We match each header cell against ALL aliases of ALL fields.
  const normalizedHeaders = headers.map((h, idx) => ({
    index: idx,
    raw: h,
    normalized: normalizeHeader(cellToString(h) ?? ""),
  }));

  // Pass 1: exact normalized match (strictest — highest confidence).
  for (const aliasEntry of COLUMN_ALIASES) {
    let found = false;
    const usedIndices = new Set(Object.values(mapping));
    for (const alias of aliasEntry.aliases) {
      const normalizedAlias = normalizeHeader(alias);
      const match = normalizedHeaders.find(
        (h) => h.normalized === normalizedAlias && !usedIndices.has(h.index)
      );
      if (match) {
        mapping[aliasEntry.field] = match.index;
        matchedHeaders[aliasEntry.field] = match.raw;
        found = true;
        break;
      }
    }
    if (!found && aliasEntry.required) {
      missingRequired.push({
        field: aliasEntry.field,
        canonicalAlias: aliasEntry.aliases[0],
      });
    }
  }

  // Pass 2: partial (contains) match for fields that didn't get an exact match.
  // This catches headers like "الاسم باللغة الإنجليزية" (contains "الاسم") or
  // "رقم بطاقة الأحوال / الإقامة" (contains "الاقامة" AND "الهوية" — but
  // those are separate aliases so each will match independently).
  //
  // IMPORTANT: only allow HEADER to contain ALIAS (not the other way around).
  // Allowing alias-to-contain-header would cause short headers like "م" (the
  // Arabic sequence-number column) to match aliases like "الاسم" (which ends
  // in "م") — a false positive. We also require the header to be at least 4
  // chars and the alias to be at least 4 chars to avoid noise.
  for (const aliasEntry of COLUMN_ALIASES) {
    if (mapping[aliasEntry.field] !== undefined) continue; // already matched in pass 1
    const usedIndices = new Set(Object.values(mapping));
    for (const alias of aliasEntry.aliases) {
      const normalizedAlias = normalizeHeader(alias);
      // Skip very short aliases (e.g., "id", "م") — they'd match too many headers.
      if (normalizedAlias.length < 4) continue;
      const match = normalizedHeaders.find((h) => {
        if (usedIndices.has(h.index)) return false;
        if (h.normalized.length < 4) return false; // skip very short headers too
        if (h.normalized.length === 0) return false;
        // Only allow HEADER to contain ALIAS. The reverse (alias contains
        // header) causes false positives as described above.
        return h.normalized.includes(normalizedAlias);
      });
      if (match) {
        mapping[aliasEntry.field] = match.index;
        matchedHeaders[aliasEntry.field] = match.raw;
        break;
      }
    }
    // If still not matched and the field is required, it's already in
    // missingRequired from pass 1 — no need to re-add.
  }

  // Recompute missingRequired: a field is only "missing required" if it's
  // required AND has no mapping after both passes.
  const finalMissing: typeof missingRequired = [];
  for (const aliasEntry of COLUMN_ALIASES) {
    if (aliasEntry.required && mapping[aliasEntry.field] === undefined) {
      finalMissing.push({
        field: aliasEntry.field,
        canonicalAlias: aliasEntry.aliases[0],
      });
    }
  }
  missingRequired.length = 0;
  missingRequired.push(...finalMissing);

  // Identify unmatched headers (for informational display)
  const matchedIndices = new Set(Object.values(mapping));
  for (const h of normalizedHeaders) {
    if (!matchedIndices.has(h.index) && h.normalized !== "") {
      unmatchedHeaders.push(h.raw);
    }
  }

  return { mapping, matchedHeaders, unmatchedHeaders, missingRequired };
}

// ─────────────────────────────────────────────────────────────────────────
// Row parsing — uses the header-based mapping
// ─────────────────────────────────────────────────────────────────────────

export interface RegistrationExportRow {
  name: string;
  nationalId: string;
  nationality?: string | null; // optional — not in legacy export layout
  jobTitle: string | null;
  companyName: string;
  activity: string | null;
  region: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  courseTitle: string;
  duration: number;
}

export function rowToValues(row: RegistrationExportRow, seq: number): (string | number)[] {
  return [
    seq,
    row.name,
    row.nationalId,
    row.jobTitle ?? "",
    row.companyName,
    row.activity ?? "",
    row.region ?? "",
    row.city ?? "",
    row.phone ?? "",
    row.email ?? "",
    row.courseTitle,
    row.duration,
  ];
}

export interface ParsedRegistrationRow {
  name: string;
  nationalId: string;
  nationality: string | null;
  jobTitle: string | null;
  companyName: string;
  activity: string | null;
  region: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  courseTitle: string;
  duration: number | null;
}

/**
 * Parse a single row using the header-based column mapping.
 * `mapping` comes from resolveColumnMapping(). `getRowCell(idx)` returns the
 * cell value at column index `idx` for the current row.
 */
export function parseRegistrationRowByMapping(
  mapping: Partial<Record<keyof ParsedRegistrationRow, number>>,
  getCell: (colIndex: number) => unknown
): ParsedRegistrationRow {
  const get = (field: keyof ParsedRegistrationRow): unknown => {
    const idx = mapping[field];
    if (idx === undefined) return null;
    return getCell(idx);
  };

  return {
    name: cellToString(get("name")) ?? "",
    nationalId: cellToString(get("nationalId")) ?? "",
    nationality: cellToString(get("nationality")),
    jobTitle: cellToString(get("jobTitle")),
    companyName: cellToString(get("companyName")) ?? "",
    activity: cellToString(get("activity")),
    region: cellToString(get("region")),
    city: cellToString(get("city")),
    phone: cellToString(get("phone")),
    email: cellToString(get("email")),
    courseTitle: cellToString(get("courseTitle")) ?? "",
    duration: cellToNumber(get("duration")),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Preview validation — called before saving to show the user what will import
// ─────────────────────────────────────────────────────────────────────────

export interface PreviewRow {
  rowNumber: number;
  name: string;
  nationalId: string;
  nationality: string | null;
  jobTitle: string | null;
  companyName: string;
  courseTitle: string;
  phone: string | null;
  email: string | null;
  valid: boolean;
  errors: string[];
}

export interface ImportPreview {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateNationalIds: { nationalId: string; rows: number[] }[];
  rows: PreviewRow[];
  missingRequiredColumns: { field: keyof ParsedRegistrationRow; canonicalAlias: string }[];
  matchedColumns: { field: keyof ParsedRegistrationRow; header: string }[];
  unmatchedHeaders: string[];
  traineeCount: number; // auto-populated count of valid trainee rows
}

/**
 * Build a preview from parsed rows. Detects:
 *   - Missing required fields per row (name, nationalId, companyName, courseTitle)
 *   - Duplicate national IDs within the file
 * Returns a structured preview object for UI display.
 */
export function buildPreview(
  parsedRows: { rowNumber: number; data: ParsedRegistrationRow }[],
  mappingResult: ColumnMappingResult
): ImportPreview {
  const missingRequiredColumns = mappingResult.missingRequired;
  const matchedColumns = Object.entries(mappingResult.matchedHeaders).map(([field, header]) => ({
    field: field as keyof ParsedRegistrationRow,
    header: header as string,
  }));

  // If required columns are missing, every row is invalid by definition.
  const requiredFieldsMissing = missingRequiredColumns.length > 0;

  // Detect duplicate national IDs within the file
  const nationalIdRows = new Map<string, number[]>();
  for (const { rowNumber, data } of parsedRows) {
    if (!data.nationalId) continue;
    const key = data.nationalId.trim().toLowerCase();
    if (!nationalIdRows.has(key)) nationalIdRows.set(key, []);
    nationalIdRows.get(key)!.push(rowNumber);
  }
  const duplicateNationalIds = Array.from(nationalIdRows.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([nationalId, rows]) => ({ nationalId, rows }));

  const duplicateRowSet = new Set<number>();
  for (const { rows } of duplicateNationalIds) {
    for (const r of rows) duplicateRowSet.add(r);
  }

  const previewRows: PreviewRow[] = parsedRows.map(({ rowNumber, data }) => {
    const errors: string[] = [];

    if (requiredFieldsMissing) {
      // If required columns are missing entirely, flag every row — but only
      // if the row has ANY data. Completely empty rows are skipped silently
      // below (see the empty-row filter in the route).
      if (!data.name && !data.nationalId && !data.jobTitle && !data.nationality && !data.companyName) {
        // Completely empty row — don't add an error, it'll be filtered out.
      } else {
        errors.push("MISSING_REQUIRED_COLUMNS");
      }
    } else {
      // Only validate the trainee-essential fields: name + nationalId.
      // Company name and course title are NOT required on every Excel row
      // because they're often set at the request level (the parent form),
      // not per-trainee. This matches the contractor workflow where one
      // Excel sheet = one company + one course.
      if (!data.name) errors.push("MISSING_NAME");
      if (!data.nationalId) errors.push("MISSING_NATIONAL_ID");
    }

    if (duplicateRowSet.has(rowNumber)) {
      errors.push("DUPLICATE_NATIONAL_ID");
    }

    return {
      rowNumber,
      name: data.name,
      nationalId: data.nationalId,
      nationality: data.nationality,
      jobTitle: data.jobTitle,
      companyName: data.companyName,
      courseTitle: data.courseTitle,
      phone: data.phone,
      email: data.email,
      valid: errors.length === 0,
      errors,
    };
  });

  const validRows = previewRows.filter((r) => r.valid).length;
  const invalidRows = previewRows.length - validRows;

  return {
    totalRows: parsedRows.length,
    validRows,
    invalidRows,
    duplicateNationalIds,
    rows: previewRows,
    missingRequiredColumns,
    matchedColumns,
    unmatchedHeaders: mappingResult.unmatchedHeaders,
    traineeCount: validRows, // auto-populated trainee count = number of valid rows
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Legacy: fixed-position parsing (kept for backward compatibility with export)
// ─────────────────────────────────────────────────────────────────────────

/** `values` must be in REQUEST_COLUMNS order (index 0 = seq, ignored). */
export function parseRegistrationRow(values: unknown[]): ParsedRegistrationRow {
  const [, name, nationalId, jobTitle, companyName, activity, region, city, phone, email, courseTitle, duration] = values;
  return {
    name: cellToString(name) ?? "",
    nationalId: cellToString(nationalId) ?? "",
    nationality: null, // not in legacy layout
    jobTitle: cellToString(jobTitle),
    companyName: cellToString(companyName) ?? "",
    activity: cellToString(activity),
    region: cellToString(region),
    city: cellToString(city),
    phone: cellToString(phone),
    email: cellToString(email),
    courseTitle: cellToString(courseTitle) ?? "",
    duration: cellToNumber(duration),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Cell helpers
// ─────────────────────────────────────────────────────────────────────────

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
