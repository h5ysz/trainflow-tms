// Company contact types — single source of truth for the contactType field.
// Bilingual labels follow the src/lib/regions.ts convention.

export const CONTACT_TYPES = ["OPERATIONS", "HR", "ADMIN", "PAYROLL", "QUALITY", "OTHER"] as const;

export type ContactTypeCode = (typeof CONTACT_TYPES)[number];

export const CONTACT_TYPE_LABELS: Record<ContactTypeCode, { en: string; ar: string }> = {
  OPERATIONS: { en: "Operations", ar: "العمليات" },
  HR: { en: "HR", ar: "الموارد البشرية" },
  ADMIN: { en: "Admin", ar: "الإدارة" },
  PAYROLL: { en: "Payroll", ar: "الرواتب" },
  QUALITY: { en: "Quality", ar: "الجودة" },
  OTHER: { en: "Other", ar: "أخرى" },
};

export function isContactType(value: unknown): value is ContactTypeCode {
  return typeof value === "string" && (CONTACT_TYPES as readonly string[]).includes(value);
}
