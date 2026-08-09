import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { existsSync } from "fs";
import { join } from "path";
import { drawCertificateLayout, type CertificateLayoutData } from "@/lib/pdf/certificate-layout";

// The whole point of the layout rewrite: a certificate PDF must ALWAYS be exactly
// one A4 landscape page, no matter how long the trainee name, course title, company
// or trainer happen to be. The old implementation drew in pdfkit flow mode, which
// silently started new pages when long text wrapped past the bottom.
//
// pdfkit stores every page as a `/Type /Page` object (the pages tree root is
// `/Type /Pages`), so counting them from the raw buffer is a reliable page count.

function countPages(buffer: Buffer): number {
  const text = buffer.toString("latin1");
  return (text.match(/\/Type\s*\/Page\b/g) ?? []).length;
}

const ARABIC_FONT = join(process.cwd(), "public", "fonts", "NotoNaskhArabic-Regular.ttf");
const hasArabicFont = existsSync(ARABIC_FONT);

function render(data: CertificateLayoutData, withArabic = false) {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  let arabicName: string | null = null;
  if (withArabic && hasArabicFont) {
    doc.registerFont("Arabic", ARABIC_FONT);
    arabicName = "Arabic";
  }
  drawCertificateLayout(doc, data, { arabicFontName: arabicName, logoPath: null });
  doc.end();
  return done;
}

const base: CertificateLayoutData = {
  traineeName: "Mohammed Abdullah Al-Qahtani",
  courseTitle: "Occupational Safety and Health Administration (OSHA)",
  courseCode: "OSH-101",
  durationHours: 24,
  finalScore: 92,
  issuedAt: new Date("2026-06-15"),
  validUntil: new Date("2027-06-14"),
  refNumber: "CERT-2026-000001",
  companyName: "Gulf Star Contracting Est.",
  trainerName: "Eng. Khalid Al-Rashid",
  verifyUrl: "https://gcc-lab.example/verify/abc123def456abc123def456",
};

describe("certificate PDF layout", () => {
  it("renders a normal certificate on exactly one page", async () => {
    expect(countPages(await render(base))).toBe(1);
  });

  it("stays on one page when the Arabic font is embedded (taller line metrics)", async () => {
    // Regression guard: the Arabic seal line at the bottom once crossed the 535pt
    // bottom margin (Noto Naskh Arabic has taller line heights), and pdfkit started
    // a second page for it.
    const data = { ...base, companyName: null, trainerName: null };
    expect(countPages(await render(data, true))).toBe(1);
    expect(countPages(await render(base, true))).toBe(1);
  });

  it("stays on one page with a very long trainee name", async () => {
    const data = {
      ...base,
      traineeName:
        "Abdulrahman bin Mohammed bin Abdulaziz bin Fahad Al Saud Al-Qahtani Al-Mutairi Al-Otaibi",
    };
    expect(countPages(await render(data))).toBe(1);
  });

  it("stays on one page with a very long course title", async () => {
    const data = {
      ...base,
      courseTitle:
        "Advanced Integrated Firefighting, First Aid, Confined Space Entry, and Working at Height Training Program (Level 2)",
    };
    expect(countPages(await render(data))).toBe(1);
  });

  it("stays on one page when every field is maximally long", async () => {
    const data: CertificateLayoutData = {
      traineeName:
        "Abdulrahman Mohammed Abdullah Al-Qahtani Al-Mutairi Al-Otaibi Al-Shammari Al-Harbi",
      courseTitle:
        "Comprehensive Industrial Safety, H2S Awareness, Rig Pass, Hazardous Materials Handling, and Emergency Response Training Course",
      courseCode: "HSE-2026-0248-BR",
      durationHours: 120,
      finalScore: 99,
      issuedAt: new Date("2026-06-15"),
      validUntil: new Date("2027-06-14"),
      refNumber: "CERT-2026-000421",
      companyName: "Arabian Gulf Oilfield Services Company Limited W.L.L.",
      trainerName: "Senior Instructor Ahmed Hassan Ibrahim Al-Mahmoud",
      verifyUrl: "https://gcc-lab.example/verify/9f2c4e8a7b1d5f6a0c3e9b2d7a4f6c1e8a5b3d7c9e2f0a4b6d8c1e3a5f7b9d",
    };
    expect(countPages(await render(data))).toBe(1);
  });
});
