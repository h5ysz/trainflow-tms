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

<<<<<<< Updated upstream
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
=======

// V2: Header-based column matching — universal parser
// Works with SAP, Oracle, ERP, HR systems, Google Sheets, standard Excel,
// GCC Lab template, and custom contractor templates.
// Never depends on row numbers, column order, or a specific template.
export interface ColumnAlias { field: keyof ParsedRegistrationRow; required: boolean; aliases: string[]; }
export const COLUMN_ALIASES: ColumnAlias[] = [
  { field: "name", required: true, aliases: [
    // Arabic
    "الاسم", "اسم المتدرب", "اسم الموظف", "الاسم باللغة الإنجليزية", "الاسم بالانجليزية",
    "الاسم باللغة الإنجليزية name", "الاسم بالانجليزية name", "الاسم بالانجليزية / name", "الاسم / name",
    "اسم العامل", "اسم الموظف بالكامل", "الاسم الكامل", "الاسم الثلاثي",
    // English — standard
    "name", "full name", "worker name", "employee name", "trainee name",
    "candidate name", "person name", "staff name", "participant name",
    // English — SAP/Oracle/ERP
    "employee name", "first name", "last name", "first name last name",
    "ename", "emp name", "empname", "person full name",
    "worker", "employee", "candidate", "participant", "staff",
    // English — HR systems
    "worker name", "full name (english)", "name (english)", "name in english",
    "arabic name", "name (arabic)", "الاسم العربي",
  ]},
  { field: "nationalId", required: true, aliases: [
    // Arabic
    "رقم الهوية", "رقم الاقامة", "رقم الإقامة", "الهوية", "الاقامة", "الإقامة",
    "رقم الاقامة / الهوية / id", "رقم الهوية / الإقامة", "رقم الاقامة الهوية id",
    "رقم الهوية الإقامة", "رقم الإقامه الهوية id", "رقم الإقامه / الهوية / id",
    "بطاقة الأحوال", "رقم بطاقة الأحوال", "رقم بطاقة الأحوال الإقامة",
    "رقم بطاقة الأحوال / الإقامة", "هوية الموظف", "رقم هوية الموظف",
    // English — standard
    "id", "national id", "iqama number", "iqama", "identity number",
    "id number", "national id number", "identity card", "id card",
    "residence id", "residency number", "resident id",
    // English — SAP/Oracle/ERP
    "employee id", "emp id", "empid", "person id", "person number",
    "personnel number", "personnel id", "staff id", "worker id",
    "national identifier", "government id", "govt id", "document number",
    // English — HR systems
    "passport number", "border id", "saudi id", "ksa id",
    "civil id", "civil registration number", "personal number", "ic number", "ic no", "ic", "pernr", "personnel no",
  ]},
  { field: "nationality", required: false, aliases: [
    "الجنسية", "جنسية", "جنسيه", "nationality", "national", "country",
    "country of origin", "citizenship", "nationality code", "nation",
  ]},
  { field: "jobTitle", required: false, aliases: [
    // Arabic
    "المهنة", "الوظيفة", "المسمى الوظيفي", "المهنة المسجلة بالهوية",
    "المهنة المسجلة بالهوية job", "الوظيفة job", "المهنة طبقا للإقامة",
    "المسمي الوظيفي", "العمل", "نوع العمل",
    // English — standard
    "job", "job title", "occupation", "position", "title", "role",
    "designation", "job role", "profession", "trade",
    // English — SAP/Oracle/ERP
    "job position", "position title", "job code", "job description",
    "employee position", "work position", "function",
  ]},
  { field: "companyName", required: false, aliases: [
    // Arabic
    "اسم الشركة", "الشركة", "اسم الشركة المقاول", "اسم الشركة المقاول باللغة الإنجليزية",
    "اسم الشركة / company name", "الشركة / company", "اسم الشركة company",
    "اسم الشركة المقاول باللغة الإنجليزية c", "اسم الشركة المقاول باللغة الإنجليزية company name",
    "اسم الشركة باللغة الإنجليزية", "الشركة المقاول", "اسم المقاول",
    // English — standard
    "company name", "company", "employer", "organization", "organisation",
    "contractor", "contractor name", "vendor", "vendor name",
    "client", "client name", "firm", "firm name", "business name",
    // English — SAP/Oracle/ERP
    "company code", "company description", "org unit", "department",
    "cost center", "business unit", "legal entity",
  ]},
  { field: "activity", required: false, aliases: [
    "النشاط", "activity", "work activity", "business activity",
    "industry", "sector", "field of work",
  ]},
  { field: "region", required: false, aliases: [
    "المنطقة", "region", "area", "province", "zone", "district",
    "territory", "governorate", "محافظة", "المنطقة / region",
  ]},
  { field: "city", required: false, aliases: [
    "المدينة", "city", "town", "location", "municipality",
    "المدينه", "المدينه لللمقاول", "city of work", "work city",
  ]},
  { field: "phone", required: false, aliases: [
    // Arabic
    "رقم الجوال", "الجوال", "رقم الهاتف", "الهاتف", "رقم الهاتف المحمول",
    "الجوال للمقاول", "رقم جوال المسؤول",
    // English
    "phone", "phone number", "mobile", "mobile number", "tel", "telephone",
    "contact number", "contact phone", "cell", "cell phone", "cellphone",
    "phone no", "tel no", "telephone number", "mobile no",
    // SAP/Oracle
    "work phone", "office phone", "extension", "contact",
  ]},
  { field: "email", required: false, aliases: [
    "البريد الإلكتروني", "البريد", "الايميل", "email", "e-mail", "mail",
    "email address", "email id", "electronic mail", "work email",
    "company email", "email address 1", "email1",
  ]},
  { field: "courseTitle", required: false, aliases: [
    // Arabic
    "اسم الدورة", "الدورة", "الدورة التدريبية", "اسم الحدث", "الحدث",
    "اسم الحدث course title", "اسم الحدث course", "اسم الدورة التدريبية",
    "الدورة المطلوبة", "اسم البرنامج التدريبي",
    // English
    "course title", "course", "course name", "training course", "training",
    "course code", "program", "program name", "event", "event name",
    "training program", "workshop", "workshop name", "module",
  ]},
  { field: "duration", required: false, aliases: [
    "المدة", "duration", "hours", "duration hours", "course duration",
    "training hours", "contact hours", "credit hours", "no of hours",
    "number of hours", "hours count", "total hours",
  ]},
];
function normalizeHeader(h: string): string {
  if (!h) return "";
  // 1. Replace newlines/tabs with spaces
  let s = h.replace(/[\n\r\t]+/g, " ");
  // 2. If the header is bilingual (Arabic + English on separate lines),
  //    extract both parts and try each. For matching, use the full normalized string.
  // 3. Lowercase + collapse spaces
  s = s.toLowerCase().trim().replace(/\s+/g, " ");
  // 4. Remove common punctuation that varies between files
  s = s.replace(/[/\\()\[\]{}:;,.'"!?]/g, " ").replace(/\s+/g, " ").trim();
  return s;
}
export interface ColumnMappingResult { mapping: Partial<Record<keyof ParsedRegistrationRow, number>>; matchedHeaders: Partial<Record<keyof ParsedRegistrationRow, string>>; unmatchedHeaders: string[]; missingRequired: { field: keyof ParsedRegistrationRow; canonicalAlias: string }[]; }
export function resolveColumnMapping(headers: string[]): ColumnMappingResult {
  const mapping: Partial<Record<keyof ParsedRegistrationRow, number>> = {};
  const matchedHeaders: Partial<Record<keyof ParsedRegistrationRow, string>> = {};
  const unmatchedHeaders: string[] = [];
  const missingRequired: { field: keyof ParsedRegistrationRow; canonicalAlias: string }[] = [];
  const normalizedHeaders = headers.map((h, idx) => ({ index: idx, raw: h, normalized: normalizeHeader(h ?? "") }));

  // Phase 1: Exact match (after normalization)
  for (const aliasEntry of COLUMN_ALIASES) {
    let found = false;
    const usedIndices = new Set(Object.values(mapping));
    for (const alias of aliasEntry.aliases) {
      const normalizedAlias = normalizeHeader(alias);
      const match = normalizedHeaders.find((h) => h.normalized === normalizedAlias && !usedIndices.has(h.index));
      if (match) {
        mapping[aliasEntry.field] = match.index;
        matchedHeaders[aliasEntry.field] = match.raw;
        found = true;
        break;
      }
    }
    if (!found && aliasEntry.required) {
      missingRequired.push({ field: aliasEntry.field, canonicalAlias: aliasEntry.aliases[0] });
    }
  }

  // Phase 2: Fuzzy substring match (fallback for unmatched fields)
  // If a field wasn't matched in Phase 1, try checking if any header CONTAINS
  // one of the aliases as a substring (case-insensitive, after normalization).
  // This catches headers like "Employee Full Name (English)" that don't exactly
  // match any alias but contain "name" or "full name" as a substring.
  for (const aliasEntry of COLUMN_ALIASES) {
    if (mapping[aliasEntry.field] !== undefined) continue; // already matched
    const usedIndices = new Set(Object.values(mapping));
    let found = false;
    for (const alias of aliasEntry.aliases) {
      const normalizedAlias = normalizeHeader(alias);
      // Only use substring match for aliases that are at least 4 chars
      // (avoids matching "id" against every header containing "id")
      if (normalizedAlias.length < 4) continue;
      const match = normalizedHeaders.find((h) => {
        if (usedIndices.has(h.index) || h.normalized === "") return false;
        // Check if the header contains the alias as a substring
        // OR if the alias contains the header as a substring
        return h.normalized.includes(normalizedAlias) || normalizedAlias.includes(h.normalized);
      });
      if (match) {
        mapping[aliasEntry.field] = match.index;
        matchedHeaders[aliasEntry.field] = match.raw;
        found = true;
        break;
      }
    }
    // If it was required and still not found, it's already in missingRequired from Phase 1
    if (found) {
      // Remove from missingRequired if it was added in Phase 1
      const idx = missingRequired.findIndex((m) => m.field === aliasEntry.field);
      if (idx !== -1) missingRequired.splice(idx, 1);
    }
  }

  const matchedIndices = new Set(Object.values(mapping));
  for (const h of normalizedHeaders) {
    if (!matchedIndices.has(h.index) && h.normalized !== "") unmatchedHeaders.push(h.raw);
  }
  return { mapping, matchedHeaders, unmatchedHeaders, missingRequired };
}
export function parseRegistrationRowByMapping(mapping: ColumnMappingResult, getCell: (colIndex: number) => unknown): ParsedRegistrationRow { const get = (field: keyof ParsedRegistrationRow): unknown => { const idx = mapping.mapping[field]; return idx === undefined ? null : getCell(idx); }; return { name: cellToString(get("name")) ?? "", nationalId: cellToString(get("nationalId")) ?? "", nationality: cellToString(get("nationality")), jobTitle: cellToString(get("jobTitle")), companyName: cellToString(get("companyName")) ?? "", activity: cellToString(get("activity")), region: cellToString(get("region")), city: cellToString(get("city")), phone: cellToString(get("phone")), email: cellToString(get("email")), courseTitle: cellToString(get("courseTitle")) ?? "", duration: cellToNumber(get("duration")) }; }
export interface ImportPreview { totalRows: number; validRows: number; invalidRows: number; duplicateNationalIds: { nationalId: string; rows: number[] }[]; rows: { rowNumber: number; name: string; nationalId: string; nationality: string | null; jobTitle: string | null; companyName: string; courseTitle: string; phone: string | null; email: string | null; valid: boolean; errors: string[] }[]; missingRequiredColumns: { field: string; canonicalAlias: string }[]; matchedColumns: { field: string; header: string }[]; unmatchedHeaders: string[]; traineeCount: number; }
export function buildPreview(parsedRows: { rowNumber: number; parsed: ParsedRegistrationRow }[], mappingResult: ColumnMappingResult): ImportPreview {
  const missingRequiredColumns = mappingResult.missingRequired.map((m) => ({ field: String(m.field), canonicalAlias: m.canonicalAlias }));
  const matchedColumns = Object.entries(mappingResult.matchedHeaders).map(([field, header]) => ({ field: String(field), header: String(header) }));
  const requiredFieldsMissing = missingRequiredColumns.length > 0;

  // Detect duplicate national IDs — guard against null/empty
  const nationalIdRows = new Map<string, number[]>();
  for (const { rowNumber, parsed } of parsedRows) {
    const id = parsed?.nationalId?.trim();
    if (!id) continue;
    const key = id.toLowerCase();
>>>>>>> Stashed changes
    if (!nationalIdRows.has(key)) nationalIdRows.set(key, []);
    nationalIdRows.get(key)!.push(rowNumber);
  }
  const duplicateNationalIds = Array.from(nationalIdRows.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([nationalId, rows]) => ({ nationalId, rows }));
<<<<<<< Updated upstream

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
=======
  const duplicateRowSet = new Set<number>();
  for (const { rows } of duplicateNationalIds) for (const r of rows) duplicateRowSet.add(r);

  // Build preview rows — all fields default to empty string if null/undefined
  const previewRows = parsedRows.map(({ rowNumber, parsed }) => {
    const errors: string[] = [];
    if (requiredFieldsMissing) {
      errors.push("Required column(s) missing");
    } else {
      // Only validate fields that have a matched column — if the Excel file
      // doesn't have a company/course column, those values come from the
      // request form context, not the Excel rows.
      if (mappingResult.mapping.name !== undefined && !parsed?.name?.trim()) errors.push("Missing name");
      if (mappingResult.mapping.nationalId !== undefined && !parsed?.nationalId?.trim()) errors.push("Missing ID");
      if (mappingResult.mapping.companyName !== undefined && !parsed?.companyName?.trim()) errors.push("Missing company");
      if (mappingResult.mapping.courseTitle !== undefined && !parsed?.courseTitle?.trim()) errors.push("Missing course");
    }
    if (duplicateRowSet.has(rowNumber)) errors.push("Duplicate ID");
    return {
      rowNumber,
      name: parsed?.name ?? "",
      nationalId: parsed?.nationalId ?? "",
      nationality: parsed?.nationality ?? null,
      jobTitle: parsed?.jobTitle ?? null,
      companyName: parsed?.companyName ?? "",
      courseTitle: parsed?.courseTitle ?? "",
      phone: parsed?.phone ?? null,
      email: parsed?.email ?? null,
>>>>>>> Stashed changes
      valid: errors.length === 0,
      errors,
    };
  });

  const validRows = previewRows.filter((r) => r.valid).length;
<<<<<<< Updated upstream
  const invalidRows = previewRows.length - validRows;

  return {
    totalRows: parsedRows.length,
    validRows,
    invalidRows,
=======
  return {
    totalRows: parsedRows.length,
    validRows,
    invalidRows: parsedRows.length - validRows,
>>>>>>> Stashed changes
    duplicateNationalIds,
    rows: previewRows,
    missingRequiredColumns,
    matchedColumns,
    unmatchedHeaders: mappingResult.unmatchedHeaders,
<<<<<<< Updated upstream
    traineeCount: validRows, // auto-populated trainee count = number of valid rows
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Legacy: fixed-position parsing (kept for backward compatibility with export)
// ─────────────────────────────────────────────────────────────────────────

=======
    traineeCount: validRows,
  };
}

>>>>>>> Stashed changes
/** `values` must be in REQUEST_COLUMNS order (index 0 = seq, ignored). */
export function parseRegistrationRow(values: unknown[]): ParsedRegistrationRow {
  const [, name, nationalId, jobTitle, companyName, activity, region, city, phone, email, courseTitle, duration] = values;
  return {
    name: cellToString(name) ?? "",
    nationality: null,
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
  if (typeof v === "object" && v !== null) {
    if ("richText" in v && Array.isArray((v as { richText: unknown[] }).richText)) {
      const parts = (v as { richText: { text?: string }[] }).richText.map((r) => r?.text ?? "").join("");
      return parts.trim() || null;
    }
    if ("result" in v) {
      const r = (v as { result: unknown }).result;
      if (r === null || r === undefined) return null;
      if (typeof r === "number") return Number.isNaN(r) ? null : String(r);
      if (r instanceof Date) return r.toISOString().split("T")[0];
      const s = String(r).trim();
      return s === "" ? null : s;
    }
    if ("text" in v) {
      const s = String((v as { text: unknown }).text).trim();
      return s === "" ? null : s;
    }
    if ("hyperlink" in v) return null;
    const s = String(v).trim();
    return s === "" || s === "[object Object]" ? null : s;
  }
  if (typeof v === "number") return Number.isNaN(v) ? null : String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString().split("T")[0];
  const s = String(v).trim();
  return s === "" || s === "NaN" || s === "undefined" || s === "null" ? null : s;
}

function cellToNumber(v: unknown): number | null {
  const s = cellToString(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}
