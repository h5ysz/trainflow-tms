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
    required: true,
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
    required: true,
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

/** Normalize a header string for matching: lowercase, trim, collapse spaces. */
function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[()]/g, "")
    .replace(/[/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
      // If required columns are missing entirely, flag every row
      errors.push("Required column(s) missing from file");
    } else {
      if (!data.name) errors.push("Missing trainee name");
      if (!data.nationalId) errors.push("Missing national ID / Iqama");
      if (!data.companyName) errors.push("Missing company name");
      if (!data.courseTitle) errors.push("Missing course title");
    }

    if (duplicateRowSet.has(rowNumber)) {
      errors.push("Duplicate national ID in file");
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
