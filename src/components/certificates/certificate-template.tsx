"use client";

// The certificate, as a printable A4 landscape sheet.
//
// This is the single source of truth for what the certificate LOOKS like in the
// browser: the on-screen preview and the print output both render this exact
// component at the exact same 842 x 595pt sheet. The server-side PDF download is
// drawn by the matching layout in src/lib/pdf/certificate-layout.ts — same typeface
// (the embedded Noto Naskh Arabic Regular/Bold), same point sizes, same widths, same
// coordinates — so preview, print and PDF are one design, not three.
//
// Long content never wraps onto a second page here: FitText shrinks the font size
// until the text fits on one line inside its box, mirroring how the PDF layout
// auto-fits with pdfkit.

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { QrImage } from "@/components/common/qr-image";
import styles from "./certificate-template.module.css";

export interface CertificateData {
  traineeName: string;
  courseTitle: string;
  courseCode: string;
  durationHours: number | null;
  finalScore: number | null;
  issuedAt: string | null;
  validUntil: string | null;
  refNumber: string;
  companyName?: string | null;
  trainerName?: string | null;
}

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

// Shared geometry, in points, matching src/lib/pdf/certificate-layout.ts.
const NAME_W = 722;
const INFO_W = 682;
const QR_PX = 107; // 80pt at 96dpi

/**
 * Renders a single line and shrinks the font until it fits `width` without wrapping.
 */
function FitText({
  children,
  width,
  startSize,
  minSize,
  className,
  color,
  weight,
}: {
  children: string;
  width: number;
  startSize: number;
  minSize: number;
  className?: string;
  color?: string;
  weight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(startSize);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = startSize;
    el.style.fontSize = `${size}pt`;
    while (size > minSize && el.scrollWidth > el.clientWidth + 1) {
      size -= 0.25;
      el.style.fontSize = `${size}pt`;
    }
    setFontSize(size);
  }, [children, width, startSize, minSize]);

  return (
    <div
      ref={ref}
      className={cn(styles.fitText, className)}
      style={{ width, fontSize: `${fontSize}pt`, color, fontWeight: weight }}
    >
      {children}
    </div>
  );
}

export function CertificateTemplate({
  data,
  verifyUrl,
}: {
  data: CertificateData;
  verifyUrl: string;
}) {
  const infoLine = [
    `Course Code: ${data.courseCode}`,
    `Duration: ${data.durationHours ?? 0} hours`,
    `Score: ${data.finalScore ?? 0}%`,
  ].join("  |  ");

  const dateLine = `Issued: ${fmtDate(data.issuedAt)}  |  Valid Until: ${fmtDate(data.validUntil)}`;

  return (
    <div className={styles.sheet}>
      <div className={styles.borderOuter} />
      <div className={styles.borderInner} />

      <div className={styles.logoWrap}>
        <img src="/gcclab-logo-official.png" alt="GCCLAB" className={styles.logo} />
      </div>

      <div className={styles.brand}>GCCLAB — Gulf Calibration Laboratory</div>
      <div className={styles.subBrand}>Training &amp; Certification Management System</div>
      <div className={styles.arabicBrand} lang="ar" dir="rtl">
        المختبر الخليجي
      </div>

      <div className={styles.title}>Certificate of Completion</div>
      <div className={styles.certify}>This is to certify that</div>

      <FitText
        className={cn(styles.fitLine, styles.name)}
        width={NAME_W}
        startSize={22}
        minSize={10}
        color="#7B1E2B"
        weight={700}
      >
        {data.traineeName}
      </FitText>

      <div className={styles.completed}>has successfully completed the training course</div>

      <FitText
        className={cn(styles.fitLine, styles.course)}
        width={NAME_W}
        startSize={16}
        minSize={9}
        color="#1a1a1a"
        weight={700}
      >
        {data.courseTitle}
      </FitText>

      <FitText className={cn(styles.fitLine, styles.meta)} width={INFO_W} startSize={10} minSize={7.5} color="#666">
        {infoLine}
      </FitText>

      <FitText className={cn(styles.fitLine, styles.dates)} width={INFO_W} startSize={9.5} minSize={7.5} color="#666">
        {dateLine}
      </FitText>

      <FitText className={cn(styles.fitLine, styles.certNo)} width={INFO_W} startSize={9} minSize={7} color="#999">
        {`Certificate No: ${data.refNumber}`}
      </FitText>

      <div className={styles.qrArea}>
        <QrImage value={verifyUrl} size={QR_PX} label="Scan to verify this certificate" />
      </div>
      <div className={styles.scanLabel}>Scan to verify this certificate</div>
      <div className={styles.url}>{verifyUrl}</div>

      {data.companyName && (
        <FitText className={cn(styles.fitLine, styles.extraCompany)} width={INFO_W} startSize={10} minSize={7.5} color="#666">
          {`Company: ${data.companyName}`}
        </FitText>
      )}

      {data.trainerName && (
        <FitText className={cn(styles.fitLine, styles.extraTrainer)} width={INFO_W} startSize={10} minSize={7.5} color="#666">
          {`Trainer: ${data.trainerName}`}
        </FitText>
      )}

      <div className={styles.sigBlock}>
        <div className={styles.sigLine} />
        <div className={styles.sigLabel}>Authorized Signature</div>
      </div>
      <div className={styles.sealBlock}>
        <div className={styles.sealLine} />
        <div className={styles.sealLabel}>GCCLAB</div>
        <div className={styles.sealArabic} lang="ar" dir="rtl">
          المختبر الخليجي
        </div>
      </div>
    </div>
  );
}
