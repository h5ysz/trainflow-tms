import type { Locale } from "./translations";

export interface TrainerNamed {
  nameEn: string;
  nameAr?: string | null;
}

// Shows the trainer's Arabic name when the system locale is Arabic and one is
// stored; otherwise the English name. Falls back to the English name rather than
// showing a blank when only one of the two names exists.
export function trainerName(t: TrainerNamed | null | undefined, locale: Locale): string {
  if (!t) return "—";
  if (locale === "ar" && t.nameAr) return t.nameAr;
  return t.nameEn;
}
