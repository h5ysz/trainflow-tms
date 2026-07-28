// GCCLAB TMS — Training request / registration-sheet Excel import/export mapping.
// Flat, one row per trainee — subsumes both the "course request form" (all rows
// share one company + one course) and the richer "registration sheet" layout.

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

export interface RegistrationExportRow {
  name: string;
  nationalId: string;
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

/** `values` must be in REQUEST_COLUMNS order (index 0 = seq, ignored). */
export function parseRegistrationRow(values: unknown[]): ParsedRegistrationRow {
  const [, name, nationalId, jobTitle, companyName, activity, region, city, phone, email, courseTitle, duration] = values;
  return {
    name: cellToString(name) ?? "",
    nationalId: cellToString(nationalId) ?? "",
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
