// Shared certificate PDF layout.
//
// This module is the single place that decides how a certificate PDF looks. It is
// deliberately a pure function over a pdfkit document (no DB, no Next, no "server-only")
// so it can be unit-tested in node — including the "never more than one page" guarantee.
//
// The old inline implementation drew every block in pdfkit flow mode (`doc.text` with
// no width/height). pdfkit wraps long text and, when the wrapped text runs past the
// bottom of the page, starts a NEW page. A long trainee name, course title or info
// line could therefore push the certificate onto 2–3 pages. This module fixes that at
// the root: every block is drawn at an explicit coordinate with an explicit width and
// `lineBreak: false`, and font sizes auto-shrink until each line fits its box — so
// nothing can ever overflow onto a second page. Fonts only shrink as much as the
// content actually needs (a 24pt name stays 24pt; only a long one scales down).

// pdfkit ships no bundled types (and @types/pdfkit is not installed), so the
// document instance is typed `any` here. This module only reads/writes a handful of
// pdfkit methods and is exercised end-to-end by tests/certificate-pdf.test.ts.
type Doc = any;

export interface CertificateLayoutData {
  traineeName: string;
  courseTitle: string;
  courseCode: string;
  durationHours: number | null;
  finalScore: number | null;
  issuedAt: Date | null;
  validUntil: Date | null;
  refNumber: string;
  companyName?: string | null;
  trainerName?: string | null;
  verifyUrl: string;
  /** PNG buffer for the QR code; omitted in tests. */
  qrPng?: Buffer | null;
}

export interface CertificateLayoutOptions {
  /** Registered font name to use for Arabic text, or null to skip Arabic. */
  arabicFontName?: string | null;
  /** Absolute path to the header logo, or null to fall back to text-only header. */
  logoPath?: string | null;
}

// A4 landscape in PostScript points (842 x 595).
const PAGE_W = 842;
const PAGE_H = 595;

const BOLD = "Helvetica-Bold";
const REGULAR = "Helvetica";

const BURGUNDY = "#7B1E2B";
const DARK = "#1a1a1a";
const GRAY = "#666";
const LIGHT = "#999";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** Largest font size (stepping 0.5) at which `text` fits `maxWidth` on one line. */
function fitSize(
  doc: Doc,
  text: string,
  font: string,
  start: number,
  min: number,
  maxWidth: number,
): number {
  let size = start;
  while (size > min && doc.widthOfString(text, { font, size }) > maxWidth) size -= 0.5;
  return size;
}

/** Draw one auto-fitted, centered, single line at an explicit position. */
function centerLine(
  doc: Doc,
  text: string,
  font: string,
  startSize: number,
  minSize: number,
  color: string,
  y: number,
  maxWidth: number,
) {
  const size = fitSize(doc, text, font, startSize, minSize, maxWidth);
  doc
    .font(font)
    .fontSize(size)
    .fillColor(color)
    .text(text, (PAGE_W - maxWidth) / 2, y, { width: maxWidth, align: "center", lineBreak: false });
}

export function drawCertificateLayout(
  doc: Doc,
  data: CertificateLayoutData,
  opts: CertificateLayoutOptions = {},
) {
  const arabic = opts.arabicFontName ?? null;

  // ── Border frame (double burgundy line) ─────────────────────────────
  doc.rect(30, 30, PAGE_W - 60, PAGE_H - 60).lineWidth(3).strokeColor(BURGUNDY).stroke();
  doc.rect(40, 40, PAGE_W - 80, PAGE_H - 80).lineWidth(1).strokeColor(BURGUNDY).opacity(0.3).stroke().opacity(1);

  // ── Header ──────────────────────────────────────────────────────────
  // Logo first (brand identity); the text header sits below it so the page
  // budget never depends on whether a logo file is present.
  let headerTop = 62;
  if (opts.logoPath) {
    doc.image(opts.logoPath, (PAGE_W - 170) / 2, 58, { fit: [170, 40] });
    headerTop = 106;
  }

  centerLine(doc, "GCCLAB — Gulf Calibration Laboratory", BOLD, 14, 11, BURGUNDY, headerTop, PAGE_W - 120);
  centerLine(doc, "Training & Certification Management System", REGULAR, 10, 8, GRAY, headerTop + 16, PAGE_W - 120);
  if (arabic) {
    centerLine(doc, "المختبر الخليجي", arabic, 10, 8, GRAY, headerTop + 30, PAGE_W - 120);
  }

  // ── Title ───────────────────────────────────────────────────────────
  centerLine(doc, "Certificate of Completion", BOLD, 30, 20, DARK, 156, PAGE_W - 80);
  centerLine(doc, "This is to certify that", REGULAR, 13, 11, GRAY, 194, PAGE_W - 80);

  // ── Trainee name (auto-fit, always one line) ────────────────────────
  centerLine(doc, data.traineeName, BOLD, 26, 14, BURGUNDY, 212, PAGE_W - 120);

  centerLine(doc, "has successfully completed the training course", REGULAR, 13, 11, GRAY, 236, PAGE_W - 80);

  // ── Course title (auto-fit, always one line) ────────────────────────
  centerLine(doc, data.courseTitle, BOLD, 20, 11, DARK, 254, PAGE_W - 120);

  // ── Course code / duration / score ──────────────────────────────────
  const infoLine = [
    `Course Code: ${data.courseCode}`,
    `Duration: ${data.durationHours ?? 0} hours`,
    `Score: ${data.finalScore ?? 0}%`,
  ].join("  |  ");
  centerLine(doc, infoLine, REGULAR, 11, 8, GRAY, 282, PAGE_W - 160);

  // ── Issue + expiry dates ────────────────────────────────────────────
  const dateLine = `Issued: ${fmtDate(data.issuedAt)}  |  Valid Until: ${fmtDate(data.validUntil)}`;
  centerLine(doc, dateLine, REGULAR, 10.5, 8, GRAY, 298, PAGE_W - 160);

  // ── Certificate ref number ──────────────────────────────────────────
  centerLine(doc, `Certificate No: ${data.refNumber}`, REGULAR, 10, 8, LIGHT, 314, PAGE_W - 160);

  // ── Verification QR + URL ───────────────────────────────────────────
  if (data.qrPng) {
    doc.image(data.qrPng, (PAGE_W - 80) / 2, 330, { width: 80 });
  }
  centerLine(doc, "Scan to verify this certificate", REGULAR, 8, 7, LIGHT, 416, PAGE_W - 80);
  centerLine(doc, data.verifyUrl, REGULAR, 7, 6, LIGHT, 429, PAGE_W - 200);

  // ── Company / trainer (only when present) ───────────────────────────
  if (data.companyName) {
    centerLine(doc, `Company: ${data.companyName}`, REGULAR, 11, 8, GRAY, 448, PAGE_W - 160);
  }
  if (data.trainerName) {
    centerLine(doc, `Trainer: ${data.trainerName}`, REGULAR, 11, 8, GRAY, 465, PAGE_W - 160);
  }

  // ── Signature (bottom-left) + GCCLAB seal (bottom-right) ────────────
  // The Arabic seal line has a taller line height (Noto Naskh Arabic), so the whole
  // bottom row sits well above the 535pt bottom margin — pdfkit starts a new page
  // the moment a block's box crosses it, which used to spill onto page 2.
  const bottomY = 490;
  doc
    .moveTo(140, bottomY)
    .lineTo(340, bottomY)
    .lineWidth(1)
    .strokeColor("#999")
    .stroke();
  centerLine(doc, "Authorized Signature", REGULAR, 10, 8, GRAY, 498, 200);

  doc.moveTo(PAGE_W - 340, bottomY).lineTo(PAGE_W - 140, bottomY).lineWidth(1).stroke();
  centerLine(doc, "GCCLAB", BOLD, 10, 8, GRAY, 498, 180);
  if (arabic) {
    centerLine(doc, "المختبر الخليجي", arabic, 10, 8, GRAY, 512, 180);
  }
}
