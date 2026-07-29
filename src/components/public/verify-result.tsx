"use client";

import { useI18n } from "@/lib/i18n/context";
import { Card } from "@/components/ui/card";
import { BadgeCheck, CircleAlert, CircleX, ShieldQuestion, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CertificateValidity } from "@/lib/certificates/verify";

export interface PublicCertificate {
  refNumber: string;
  traineeName: string;
  courseTitle: string;
  courseCode: string;
  durationHours: number | null;
  finalScore: number | null;
  issuedAt: string;
  validUntil: string;
  status: string;
  sessionRef: string;
  companyName: string | null;
  verificationCount: number;
}

const TONE: Record<CertificateValidity, { icon: LucideIcon; card: string; badge: string }> = {
  VALID: {
    icon: BadgeCheck,
    card: "border-success/40 bg-success/5",
    badge: "bg-success/15 text-success border-success/30",
  },
  EXPIRED: {
    icon: CircleAlert,
    card: "border-warning/40 bg-warning/5",
    badge: "bg-warning/15 text-warning border-warning/30",
  },
  REVOKED: {
    icon: CircleX,
    card: "border-destructive/40 bg-destructive/5",
    badge: "bg-destructive/15 text-destructive border-destructive/30",
  },
  NOT_FOUND: {
    icon: ShieldQuestion,
    card: "border-destructive/40 bg-destructive/5",
    badge: "bg-destructive/15 text-destructive border-destructive/30",
  },
};

function Row({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b last:border-b-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-end break-words">
        {value === null || value === "" ? "—" : value}
      </span>
    </div>
  );
}

export function VerifyResult({
  validity,
  certificate,
}: {
  validity: CertificateValidity;
  certificate: PublicCertificate | null;
}) {
  const { t, locale } = useI18n();
  const tone = TONE[validity];
  const Icon = tone.icon;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  const headline =
    validity === "VALID" ? t("verify.valid")
    : validity === "EXPIRED" ? t("verify.expired")
    : validity === "REVOKED" ? t("verify.revoked")
    : t("verify.notFound");

  const detail =
    validity === "VALID" ? t("verify.validDetail")
    : validity === "EXPIRED" ? t("verify.expiredDetail")
    : validity === "REVOKED" ? t("verify.revokedDetail")
    : t("verify.notFoundDetail");

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-md space-y-4">
        <div className="flex flex-col items-center text-center gap-2">
          { }
          <img src="/gcclab-logo-official.png" alt="GCC Lab" className="h-14 w-auto" />
          <h1 className="text-lg font-semibold">{t("verify.title")}</h1>
        </div>

        <Card className={cn("p-6 space-y-4 border-2", tone.card)}>
          <div className="flex flex-col items-center text-center gap-2">
            <Icon className="h-12 w-12" />
            <div className={cn("rounded-full border px-3 py-1 text-sm font-semibold", tone.badge)}>
              {headline}
            </div>
            <p className="text-xs text-muted-foreground max-w-xs">{detail}</p>
          </div>

          {certificate && (
            <div className="rounded-lg border bg-background px-4">
              <Row label={t("certificates.certificateNumber")} value={certificate.refNumber} />
              <Row label={t("certificates.traineeName")} value={certificate.traineeName} />
              <Row label={t("certificates.course")} value={certificate.courseTitle} />
              {/* A revoked certificate shows identity only — no scores, no validity dates
                  that might read as an endorsement. */}
              {validity !== "REVOKED" && (
                <>
                  {certificate.companyName && (
                    <Row label={t("certificates.company")} value={certificate.companyName} />
                  )}
                  {certificate.finalScore !== null && (
                    <Row label={t("certificates.finalScore")} value={`${certificate.finalScore}%`} />
                  )}
                  <Row label={t("certificates.issuedAt")} value={fmtDate(certificate.issuedAt)} />
                  <Row label={t("certificates.validUntil")} value={fmtDate(certificate.validUntil)} />
                  <Row label={t("certificates.session")} value={certificate.sessionRef} />
                </>
              )}
            </div>
          )}
        </Card>

        <p className="text-center text-[11px] text-muted-foreground">{t("verify.footer")}</p>
      </div>
    </main>
  );
}
