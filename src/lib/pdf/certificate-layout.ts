// Shared certificate PDF layout.
//
// This module is the single place that decides how a certificate PDF looks, and it is
// intentionally a mirror image of the browser template in
// src/components/certificates/certificate-template.tsx + .module.css: same typeface
// (the embedded Noto Naskh Arabic Regular/Bold shipped in public/fonts), same point
// sizes, same widths, same coordinates. Preview, print and download therefore render
// the same sheet — before this unification the PDF mixed pdfkit's Helvetica with the
// embedded Arabic font while the browser used Arial/Segoe UI, at different sizes and
// widths, so the outputs never matched.
//
// The module stays a pure function over a pdfkit document (no DB, no Next, no
// "server-only") so it can be unit-tested in node — including the "never more than one
// page" guarantee.
//
// The old inline implementation drew every block in pdfkit flow mode (`doc.text` with
// no width/height). pdfkit wraps long text and, when the wrapped text runs past the
// bottom of the page, starts a NEW page. A long trainee name, course title or info
// line could therefore push the certificate onto 2–3 pages. This module fixes that at
// the root: every block is drawn at an explicit coordinate with an explicit width and
// `lineBreak: false`, and font sizes auto-shrink until each line fits its box — so
// nothing can ever overflow onto a second page. Fonts only shrink as much as the
// content actually needs (a 22pt name stays 22pt; only a long one scales down).

import { orderTextForLtr } from "@/lib/pdf/bidi";

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
  /** Registered regular font (covers Latin + Arabic); null falls back to Helvetica. */
  fontName?: string | null;
  /** Registered bold font; null falls back to Helvetica-Bold. */
  fontNameBold?: string | null;
  /** Absolute path to the header logo, or null to fall back to text-only header. */
  logoPath?: string | null;
}

// A4 landscape in PostScript points (842 x 595).
const PAGE_W = 842;
const PAGE_H = 595;

const BURGUNDY = "#7B1E2B";
const DARK = "#1a1a1a";
const GRAY = "#666";
const LIGHT = "#999";

// Letter spacing (pt) on the uppercase title, matching `letter-spacing: 1.9pt` in the
// browser template.
const TITLE_SPACING = 1.9;

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
  charSpacing = 0,
): number {
  // widthOfString measures at the document's current font/size, so set them here;
  // centerLine sets the same values again right after, so there is no drift.
  let size = start;
  while (size > min) {
    doc.font(font).fontSize(size);
    const w = doc.widthOfString(text, { characterSpacing: charSpacing });
    if (w <= maxWidth) break;
    size -= 0.5;
  }
  return size;
}

/**
 * Draw one auto-fitted, centered, single line at an explicit position.
 * `cx` is the center x of the box (defaults to the page center) so bottom-row labels
 * can sit under their signature/seal lines instead of the middle of the page.
 */
function centerLine(
  doc: Doc,
  text: string,
  font: string,
  startSize: number,
  minSize: number,
  color: string,
  y: number,
  maxWidth: number,
  cx: number = PAGE_W / 2,
  charSpacing = 0,
) {
  // pdfkit draws LTR, so hand it the visual-order string (Arabic word order
  // reordered, embedded LTR runs kept intact). Fontkit re-shapes each word.
  text = orderTextForLtr(text);
  const size = fitSize(doc, text, font, startSize, minSize, maxWidth, charSpacing);
  doc
    .font(font)
    .fontSize(size)
    .fillColor(color)
    .text(text, cx - maxWidth / 2, y, {
      width: maxWidth,
      align: "center",
      lineBreak: false,
      characterSpacing: charSpacing || undefined,
    });
}

export function drawCertificateLayout(
  doc: Doc,
  data: CertificateLayoutData,
  opts: CertificateLayoutOptions = {},
) {
  // The embedded family covers Arabic too, so a single font renders both scripts.
  // The Helvetica pair is only the no-font fallback so tests and fontless deploys
  // still produce a valid (English-only) PDF.
  const REGULAR = opts.fontName ?? "Helvetica";
  const BOLD = opts.fontNameBold ?? "Helvetica-Bold";
  const arabic = opts.fontName ?? null;

  // ── Border frame (double burgundy line) ─────────────────────────────
  doc.rect(30, 30, PAGE_W - 60, PAGE_H - 60).lineWidth(3).strokeColor(BURGUNDY).stroke();
  doc.rect(40, 40, PAGE_W - 80, PAGE_H - 80).lineWidth(1).strokeColor(BURGUNDY).opacity(0.35).stroke().opacity(1);

  // ── Header ──────────────────────────────────────────────────────────
  let headerTop = 106;
  if (opts.logoPath) {
    // `fit: [170, 40]` scales the image to fit the box while preserving aspect ratio,
    // so the drawn width (82.7pt for the 310x150 logo) is smaller than the box. Center
    // the actual drawn image rather than the 170pt box — the browser template centers
    // the <img> itself, and centering the box left the logo 44pt off-center.
    const logo = doc.openImage(opts.logoPath);
    const logoScale = Math.min(170 / logo.width, 40 / logo.height);
    const logoW = logo.width * logoScale;
    const logoH = logo.height * logoScale;
    doc.image(logo, (PAGE_W - logoW) / 2, 58, { width: logoW, height: logoH });
  }

  centerLine(doc, "GCCLAB — Gulf Calibration Laboratory", BOLD, 13, 10.5, BURGUNDY, headerTop, PAGE_W - 120);
  centerLine(doc, "Training & Certification Management System", REGULAR, 9, 8, GRAY, headerTop + 16, PAGE_W - 120);
  if (arabic) {
    centerLine(doc, "المختبر الخليجي", REGULAR, 9, 8, GRAY, headerTop + 30, PAGE_W - 120);
  }

  // ── Title (uppercase + letter-spaced, like the browser template) ────
  centerLine(doc, "CERTIFICATE OF COMPLETION", BOLD, 22, 16, DARK, 156, PAGE_W - 80, PAGE_W / 2, TITLE_SPACING);
  centerLine(doc, "This is to certify that", REGULAR, 12, 10, GRAY, 194, PAGE_W - 80);

  // ── Trainee name (auto-fit, always one line) ────────────────────────
  centerLine(doc, data.traineeName, BOLD, 22, 10, BURGUNDY, 212, PAGE_W - 120);

  centerLine(doc, "has successfully completed the training course", REGULAR, 12, 10, GRAY, 236, PAGE_W - 80);

  // ── Course title (auto-fit, always one line) ────────────────────────
  centerLine(doc, data.courseTitle, BOLD, 16, 9, DARK, 254, PAGE_W - 120);

  // ── Course code / duration / score ──────────────────────────────────
  const infoLine = [
    `Course Code: ${data.courseCode}`,
    `Duration: ${data.durationHours ?? 0} hours`,
    `Score: ${data.finalScore ?? 0}%`,
  ].join("  |  ");
  centerLine(doc, infoLine, REGULAR, 10, 7.5, GRAY, 282, PAGE_W - 160);

  // ── Issue + expiry dates ────────────────────────────────────────────
  const dateLine = `Issued: ${fmtDate(data.issuedAt)}  |  Valid Until: ${fmtDate(data.validUntil)}`;
  centerLine(doc, dateLine, REGULAR, 9.5, 7.5, GRAY, 298, PAGE_W - 160);

  // ── Certificate ref number ──────────────────────────────────────────
  centerLine(doc, `Certificate No: ${data.refNumber}`, REGULAR, 9, 7, LIGHT, 314, PAGE_W - 160);

  // ── Verification QR + URL ───────────────────────────────────────────
  if (data.qrPng) {
    doc.image(data.qrPng, (PAGE_W - 80) / 2, 330, { width: 80 });
  }
  centerLine(doc, "Scan to verify this certificate", REGULAR, 8, 7, LIGHT, 416, PAGE_W - 80);
  centerLine(doc, data.verifyUrl, REGULAR, 7, 6, LIGHT, 429, PAGE_W - 200);

  // ── Company / trainer (only when present) ───────────────────────────
  if (data.companyName) {
    centerLine(doc, `Company: ${data.companyName}`, REGULAR, 10, 7.5, GRAY, 448, PAGE_W - 160);
  }
  if (data.trainerName) {
    centerLine(doc, `Trainer: ${data.trainerName}`, REGULAR, 10, 7.5, GRAY, 465, PAGE_W - 160);
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
  centerLine(doc, "Authorized Signature", REGULAR, 9, 8, GRAY, 498, 200, 240);

  doc.moveTo(PAGE_W - 340, bottomY).lineTo(PAGE_W - 140, bottomY).lineWidth(1).stroke();
  centerLine(doc, "GCCLAB", BOLD, 9, 8, GRAY, 498, 200, PAGE_W - 240);
  if (arabic) {
    centerLine(doc, "المختبر الخليجي", REGULAR, 9, 8, GRAY, 512, 200, PAGE_W - 240);
  }
}
