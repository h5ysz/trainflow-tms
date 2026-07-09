import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Narrow an API date (ISO datetime) to the `YYYY-MM-DD` that
 * `<Input type="date">` requires. Anything unparseable becomes "".
 */
export function toDateInput(value: unknown): string {
  if (!value) return ""
  const s = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ""
}

/** Same, for `<Input type="datetime-local">`, which wants `YYYY-MM-DDTHH:mm`. */
export function toDateTimeInput(value: unknown): string {
  if (!value) return ""
  const s = String(value)
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 16) : ""
}
