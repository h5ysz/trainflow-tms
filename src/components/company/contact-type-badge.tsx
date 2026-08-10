"use client";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/context";
import { CONTACT_TYPE_LABELS, isContactType } from "@/lib/contact-types";

interface Props {
  value?: string | null;
}

/** Small outline badge showing the contact's purpose/type, localized. */
export function ContactTypeBadge({ value }: Props) {
  const { locale } = useI18n();
  if (!isContactType(value)) return null;
  const label = CONTACT_TYPE_LABELS[value][locale === "ar" ? "ar" : "en"];
  return <Badge variant="outline" className="text-[10px] font-medium text-muted-foreground">{label}</Badge>;
}
