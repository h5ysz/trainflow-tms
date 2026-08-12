"use client";

// GCCLAB TMS — Session Contact & Follow-up (trainer)
// =====================================================================
// Renders the "التواصل والمتابعة" tab inside the session detail page. For a
// TRAINER it shows the companies participating in THIS session, each company's
// contact persons, and the enrolled trainees — with direct `tel:` / `mailto:`
// actions so the trainer can chase an absence or lateness immediately.
//
// The data comes from GET /api/sessions/[id]/contact-directory, which is
// ownership-scoped server-side (trainerDeniedSession), so nothing on this page
// can be widened by editing the URL or query parameters.
// =====================================================================
import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { api } from "@/lib/api/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { telHref, mailHref } from "@/lib/contact/links";
import {
  Building2, Phone, Mail, User, Users, Loader2, AlertCircle, PhoneCall,
  IdCard, Globe, Briefcase, Contact,
} from "lucide-react";

export interface ContactDirectoryContact {
  id: string;
  companyId: string;
  fullName: string | null;
  fullNameAr: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  preferredContact: string | null;
  contactType: string | null;
  isPrimary: boolean;
}

export interface ContactDirectoryTrainee {
  enrollmentId: string;
  traineeId: string | null;
  refNumber: string | null;
  fullName: string | null;
  nationalId: string | null;
  nationality: string | null;
  jobTitle: string | null;
  mobile: string | null;
  email: string | null;
  attendanceStatus: string;
}

export interface ContactDirectoryCompany {
  companyId: string;
  companyName: string | null;
  companyNameAr: string | null;
  companyRef: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  traineeCount: number;
  contacts: ContactDirectoryContact[];
  trainees: ContactDirectoryTrainee[];
}

export function SessionContactDirectory({ sessionId }: { sessionId: string }) {
  const { t, locale } = useI18n();
  const [companies, setCompanies] = useState<ContactDirectoryCompany[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ companies: ContactDirectoryCompany[] }>(
        `/sessions/${sessionId}/contact-directory`
      );
      setCompanies(data.companies ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Async data load; state is written from inside the awaited call.
  useEffect(() => {
    const handle = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(handle);
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin me-2" />
        {t("table.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" /> {error}
      </div>
    );
  }

  if (!companies || companies.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t("contactDirectory.noCompanies")}
        subtitle={t("contactDirectory.noCompaniesSubtitle")}
      />
    );
  }

  return (
    <div className="space-y-4">
      {companies.map((company) => (
        <CompanyCard key={company.companyId} company={company} />
      ))}
    </div>
  );
}

function CompanyCard({ company }: { company: ContactDirectoryCompany }) {
  const { t, locale } = useI18n();
  const companyName = locale === "ar" && company.companyNameAr
    ? company.companyNameAr
    : company.companyName ?? "—";

  return (
    <Card className="p-4 space-y-4">
      {/* Company header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">{companyName}</div>
            {company.companyRef && (
              <div className="text-[11px] font-mono text-muted-foreground">{company.companyRef}</div>
            )}
          </div>
        </div>
        <Badge variant="secondary" className="gap-1.5">
          <Users className="h-3 w-3" />
          {company.traineeCount} {t("contactDirectory.trainees")}
        </Badge>
      </div>

      {/* Company-level direct contact */}
      <div className="flex flex-wrap gap-2">
        <ContactAction
          label={t("contactDirectory.phone")}
          value={company.companyPhone}
          href={telHref(company.companyPhone)}
        />
        <ContactAction
          label={t("contactDirectory.email")}
          value={company.companyEmail}
          href={mailHref(company.companyEmail)}
        />
      </div>

      {/* Company contacts */}
      {company.contacts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Contact className="h-3.5 w-3.5" />
            {t("contactDirectory.companyContact")}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {company.contacts.map((c) => (
              <div key={c.id} className="rounded-lg border bg-muted/20 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {locale === "ar" && c.fullNameAr ? c.fullNameAr : c.fullName ?? "—"}
                  {c.isPrimary && (
                    <Badge variant="outline" className="ms-auto text-[10px]">
                      {t("contactDirectory.primary")}
                    </Badge>
                  )}
                </div>
                {c.jobTitle && (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Briefcase className="h-3 w-3" />
                    {c.jobTitle}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <ContactAction
                    label={c.mobile ?? c.phone}
                    value={c.mobile ?? c.phone}
                    href={telHref(c.mobile ?? c.phone)}
                    compact
                  />
                  <ContactAction
                    label={c.email}
                    value={c.email}
                    href={mailHref(c.email)}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trainees */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          {t("contactDirectory.trainees")} ({company.trainees.length})
        </div>
        {company.trainees.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            {t("contactDirectory.noTrainees")}
          </p>
        ) : (
          <div className="rounded-lg border divide-y">
            {company.trainees.map((tr) => (
              <div key={tr.enrollmentId} className="p-3 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {tr.fullName ?? "—"}
                    {tr.refNumber && (
                      <span className="text-[10px] font-mono text-muted-foreground">{tr.refNumber}</span>
                    )}
                  </div>
                  <StatusBadge status={tr.attendanceStatus ?? "NOT_STARTED"} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  {tr.nationalId && (
                    <span className="flex items-center gap-1 truncate">
                      <IdCard className="h-3 w-3 shrink-0" />
                      {tr.nationalId}
                    </span>
                  )}
                  {tr.nationality && (
                    <span className="flex items-center gap-1 truncate">
                      <Globe className="h-3 w-3 shrink-0" />
                      {tr.nationality}
                    </span>
                  )}
                  {tr.jobTitle && (
                    <span className="flex items-center gap-1 truncate">
                      <Briefcase className="h-3 w-3 shrink-0" />
                      {tr.jobTitle}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <ContactAction
                    label={tr.mobile}
                    value={tr.mobile}
                    href={telHref(tr.mobile)}
                    compact
                  />
                  <ContactAction
                    label={tr.email}
                    value={tr.email}
                    href={mailHref(tr.email)}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// A single call/email action. When the stored value is missing (or not a
// usable number) it renders "غير متوفر / Not available" WITHOUT a link — never
// a dead tel: button.
function ContactAction({
  label,
  value,
  href,
  compact,
}: {
  label: string | null | undefined;
  value: string | null | undefined;
  href: string | null;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const text = value && value.trim() ? value.trim() : null;

  if (!href || !text) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md border border-muted bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground"
      >
        <Phone className="h-3 w-3 opacity-60" />
        {t("contactDirectory.notAvailable")}
      </span>
    );
  }

  const isPhone = href.startsWith("tel:");
  return (
    <a
      href={href}
      dir="ltr"
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      title={isPhone ? t("contactDirectory.call") : t("contactDirectory.email")}
    >
      {isPhone ? <PhoneCall className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
      {text}
    </a>
  );
}
