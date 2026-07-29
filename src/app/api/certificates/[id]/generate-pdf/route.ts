// /api/certificates/[id]/generate-pdf — generate enterprise PDF certificate
// =====================================================================
// Sprint 6: Enhanced PDF with all required elements:
//   - GCCLAB Logo (top)
//   - Certificate Number (GCCLAB-ES-YYYY-NNNNNN format)
//   - Trainee Name + Masked National ID
//   - Company Name
//   - Course Name + Training Hours
//   - Trainer Name
//   - Issue Date + Expiry Date + Validity Period
//   - QR Code (points to https://training.gcclab.com/verify/{token})
//   - Digital Security Seal (custom-rendered)
//   - Official Signature Area
//   - Footer: "This certificate has been digitally issued and verified by GCCLAB"
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction, fail } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";
import { syncCertificateStatus } from "@/lib/api/enrollment-sync";
import PDFDocument from "pdfkit";
import { buildVerifyUrl, resolveOrigin } from "@/lib/qr/urls";
import { renderQrPng } from "@/lib/qr/server";
import { arabicFontPath } from "@/lib/pdf/fonts";
import { randomBytes } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";
import { maskNationalId, formatPdfDate, formatValidityMonths } from "@/lib/certificates/utils";

// Path to the official GCCLAB logo (color version, for light backgrounds).
// Falls back gracefully if the file is missing.
async function loadLogoBuffer(): Promise<Buffer | null> {
  const logoPaths = [
    join(process.cwd(), "public", "gcclab-logo-official.png"),
    join(process.cwd(), "public", "gcclab-icon.png"),
  ];
  for (const p of logoPaths) {
    try {
      const buf = await readFile(p);
      if (buf.length > 0) return buf;
    } catch {
      // try next path
    }
  }
  return null;
}

export const POST = withModuleAction("certificates", "create", async ({ req, params, user }) => {
  const id = params.id as string;
  const cert = await db.certificate.findUnique({
    where: { id },
    include: {
      course: true,
      session: {
        include: {
          trainer: { select: { fullName: true, refNumber: true } },
        },
      },
      company: { select: { name: true, refNumber: true } },
    },
  });

  if (!cert || cert.deletedAt) return fail("Certificate not found", 404);

  // Contractors may only generate PDFs for their own company's certificates.
  if (user.role === "CONTRACTOR" && cert.companyId !== user.companyId) {
    return fail("Certificate not found", 404);
  }

  // ── Initialize PDF document ────────────────────────────────────────
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: { top: 50, bottom: 50, left: 60, right: 60 },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const pdfPromise = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  // Arabic font (optional — graceful fallback)
  const arabicFont = arabicFontPath();
  if (arabicFont) doc.registerFont("Arabic", arabicFont);

  // ── Helper: draw decorative borders ────────────────────────────────
  const burgundy = "#7B1E2B";
  const goldAccent = "#C9A961";

  // Outer border (double-line: burgundy thick + thin gold inside)
  doc
    .rect(25, 25, doc.page.width - 50, doc.page.height - 50)
    .lineWidth(3)
    .strokeColor(burgundy)
    .stroke();
  doc
    .rect(32, 32, doc.page.width - 64, doc.page.height - 64)
    .lineWidth(0.5)
    .strokeColor(goldAccent)
    .stroke();
  doc
    .rect(38, 38, doc.page.width - 76, doc.page.height - 76)
    .lineWidth(0.3)
    .strokeColor(burgundy)
    .opacity(0.3)
    .stroke()
    .opacity(1);

  // ── GCCLAB Logo (top-center) ───────────────────────────────────────
  const logoBuffer = await loadLogoBuffer();
  const logoWidth = 110;
  const logoX = (doc.page.width - logoWidth) / 2;
  const logoY = 55;
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, logoX, logoY, { width: logoWidth, align: "center" });
    } catch {
      // If image embed fails, fall back to text-only header
      doc
        .fontSize(18)
        .fillColor(burgundy)
        .font("Helvetica-Bold")
        .text("GCCLAB", 0, logoY + 10, { align: "center", width: doc.page.width });
    }
  } else {
    doc
      .fontSize(18)
      .fillColor(burgundy)
      .font("Helvetica-Bold")
      .text("GCCLAB", 0, logoY + 10, { align: "center", width: doc.page.width });
  }

  // Header strapline
  doc
    .fontSize(11)
    .fillColor("#666")
    .font("Helvetica-Bold")
    .text("GULF CALIBRATION LABORATORY", 0, logoY + logoWidth * 0.5 + 10, { align: "center" })
    .fontSize(8)
    .fillColor("#999")
    .font("Helvetica")
    .text("Training & Certification Management System", { align: "center" });

  if (arabicFont) {
    doc.font("Arabic").fontSize(9).fillColor("#666").text("المختبر الخليجي للمعايرة", { align: "center" });
    doc.font("Helvetica");
  }

  // ── Title ──────────────────────────────────────────────────────────
  doc
    .fontSize(28)
    .fillColor("#1a1a1a")
    .font("Helvetica-Bold")
    .text("Certificate of Completion", 0, 165, { align: "center" });

  // Decorative line under title
  doc
    .moveTo(doc.page.width / 2 - 100, 200)
    .lineTo(doc.page.width / 2 + 100, 200)
    .lineWidth(1)
    .strokeColor(goldAccent)
    .stroke();

  // ── Trainee section ────────────────────────────────────────────────
  doc
    .fontSize(11)
    .fillColor("#666")
    .font("Helvetica")
    .text("This is to certify that", 0, 215, { align: "center" });

  doc
    .fontSize(24)
    .fillColor(burgundy)
    .font("Helvetica-Bold")
    .text(cert.traineeName, 0, 235, { align: "center" });

  // Masked National ID (if present)
  const maskedId = maskNationalId(cert.traineeIdNational);
  if (maskedId) {
    doc
      .fontSize(9)
      .fillColor("#999")
      .font("Helvetica")
      .text(`National ID: ${maskedId}`, 0, 268, { align: "center" });
  }

  doc
    .fontSize(11)
    .fillColor("#666")
    .font("Helvetica")
    .text("has successfully completed the training course", 0, 285, { align: "center" });

  // ── Course section ─────────────────────────────────────────────────
  doc
    .fontSize(18)
    .fillColor("#1a1a1a")
    .font("Helvetica-Bold")
    .text(cert.course.title, 0, 310, { align: "center" });

  // Course details row
  const courseDetails = [
    `Course Code: ${cert.course.code}`,
    `Training Hours: ${cert.course.durationHours}`,
    `Final Score: ${cert.finalScore}%`,
  ].join("    |    ");
  doc
    .fontSize(9)
    .fillColor("#666")
    .font("Helvetica")
    .text(courseDetails, 0, 340, { align: "center" });

  // Company
  if (cert.company?.name) {
    doc
      .fontSize(10)
      .fillColor("#666")
      .font("Helvetica-Bold")
      .text(`Company: ${cert.company.name}`, 0, 360, { align: "center" });
  }

  // Trainer
  if (cert.session?.trainer?.fullName) {
    doc
      .fontSize(10)
      .fillColor("#666")
      .font("Helvetica")
      .text(`Trainer: ${cert.session.trainer.fullName}`, 0, 376, { align: "center" });
  }

  // ── Dates + validity period ────────────────────────────────────────
  const issueDate = formatPdfDate(cert.issuedAt);
  const expiryDate = formatPdfDate(cert.validUntil);
  const validityStr = formatValidityMonths(cert.course.validityMonths);

  doc
    .fontSize(9)
    .fillColor("#666")
    .font("Helvetica-Bold")
    .text(`Issue Date: ${issueDate}    |    Expiry Date: ${expiryDate}    |    Validity: ${validityStr}`, 0, 400, { align: "center" });

  // Certificate number (prominent)
  doc
    .fontSize(11)
    .fillColor(burgundy)
    .font("Helvetica-Bold")
    .text(`Certificate No: ${cert.refNumber}`, 0, 420, { align: "center" });

  // ── QR Code (bottom-left) ──────────────────────────────────────────
  const verificationToken = cert.verificationToken ?? randomBytes(16).toString("hex");
  const verifyUrl = buildVerifyUrl(resolveOrigin(req), verificationToken);
  const qrPng = await renderQrPng(verifyUrl, { width: 240, margin: 1 });

  const qrSize = 80;
  const qrX = 70;
  const qrY = 445;
  doc.image(qrPng, qrX, qrY, { width: qrSize });
  doc
    .fontSize(6)
    .fillColor("#999")
    .font("Helvetica")
    .text("Scan to verify", qrX, qrY + qrSize + 2, { width: qrSize, align: "center" });

  // ── Digital Security Seal (bottom-right) ───────────────────────────
  // Custom-rendered circular seal with concentric rings + text.
  const sealCenterX = doc.page.width - 110;
  const sealCenterY = 485;
  const sealRadius = 38;

  // Outer ring
  doc
    .circle(sealCenterX, sealCenterY, sealRadius)
    .lineWidth(2)
    .strokeColor(burgundy)
    .stroke();
  // Inner ring
  doc
    .circle(sealCenterX, sealCenterY, sealRadius - 4)
    .lineWidth(0.5)
    .strokeColor(goldAccent)
    .stroke();
  // Innermost ring
  doc
    .circle(sealCenterX, sealCenterY, sealRadius - 12)
    .lineWidth(0.3)
    .strokeColor(burgundy)
    .opacity(0.5)
    .stroke()
    .opacity(1);

  // Seal text (top half)
  doc
    .fontSize(7)
    .fillColor(burgundy)
    .font("Helvetica-Bold")
    .text("GCCLAB", sealCenterX - 30, sealCenterY - 14, { width: 60, align: "center" });
  doc
    .fontSize(5)
    .fillColor("#666")
    .font("Helvetica")
    .text("Official Digital", sealCenterX - 30, sealCenterY - 4, { width: 60, align: "center" });
  doc
    .fontSize(5)
    .fillColor("#666")
    .text("Certificate", sealCenterX - 30, sealCenterY + 1, { width: 60, align: "center" });

  // Seal text (bottom half)
  doc
    .fontSize(4)
    .fillColor("#999")
    .text("Verified by GCCLAB", sealCenterX - 30, sealCenterY + 10, { width: 60, align: "center" });
  doc
    .fontSize(4)
    .fillColor("#999")
    .text("Digitally Secured", sealCenterX - 30, sealCenterY + 15, { width: 60, align: "center" });

  // Certificate ID in seal
  doc
    .fontSize(4)
    .fillColor(burgundy)
    .font("Helvetica-Bold")
    .text(`ID: ${cert.refNumber.slice(-8)}`, sealCenterX - 30, sealCenterY + 20, { width: 60, align: "center" });

  // ── Signature area (bottom-center) ─────────────────────────────────
  const sigY = 490;
  doc
    .moveTo(doc.page.width / 2 - 80, sigY)
    .lineTo(doc.page.width / 2 + 80, sigY)
    .lineWidth(0.5)
    .strokeColor("#999")
    .stroke();
  doc
    .fontSize(8)
    .fillColor("#666")
    .font("Helvetica")
    .text("Authorized Signature", doc.page.width / 2 - 80, sigY + 4, { width: 160, align: "center" });
  doc
    .fontSize(6)
    .fillColor("#999")
    .text("GCCLAB Administration", doc.page.width / 2 - 80, sigY + 14, { width: 160, align: "center" });

  // ── Footer ─────────────────────────────────────────────────────────
  doc
    .fontSize(7)
    .fillColor("#999")
    .font("Helvetica-Oblique")
    .text(
      "This certificate has been digitally issued and verified by GCCLAB (Gulf Laboratory).",
      60,
      doc.page.height - 50,
      { width: doc.page.width - 120, align: "center" }
    );
  doc
    .fontSize(6)
    .fillColor("#bbb")
    .text(
      `Verify online: ${verifyUrl}`,
      60,
      doc.page.height - 38,
      { width: doc.page.width - 120, align: "center" }
    );

  // ── Finalize PDF ───────────────────────────────────────────────────
  doc.end();
  const pdfBuffer = await pdfPromise;

  // ── Persist PDF metadata + verification token ──────────────────────
  await db.certificate.update({
    where: { id: cert.id },
    data: {
      pdfGeneratedAt: new Date(),
      // Persist a token generated above, so the QR on the printed page resolves.
      ...(cert.verificationToken ? {} : { verificationToken }),
      // Sprint 6: bump status to ISSUED if it was APPROVED or legacy VALID
      ...(cert.status === "APPROVED" || cert.status === "VALID" || cert.status === "PENDING_APPROVAL"
        ? { status: "ISSUED" }
        : {}),
      updatedBy: user.id,
    },
  });

  // ── Sync SessionEnrollment: certificate ISSUED ──
  await syncCertificateStatus({
    sessionId: cert.sessionId,
    traineeName: cert.traineeName,
    traineeIdNational: cert.traineeIdNational ?? undefined,
    attendanceId: cert.attendanceId ?? undefined,
    status: "ISSUED",
    userId: user.id,
  });

  // ── Audit: CERTIFICATE_GENERATE ────────────────────────────────────
  await recordAudit({
    userId: user.id,
    action: "CERTIFICATE_GENERATE",
    entity: "CERTIFICATE",
    entityId: cert.id,
    entityRef: cert.refNumber,
    description: `Generated PDF for certificate ${cert.refNumber}`,
    descriptionAr: `تم توليد PDF للشهادة ${cert.refNumber}`,
    req,
    metadata: {
      verificationToken: cert.verificationToken,
      refNumber: cert.refNumber,
      traineeName: cert.traineeName,
      courseCode: cert.course.code,
    },
  });

  // Node's Buffer is typed over ArrayBufferLike, which doesn't satisfy the web
  // BodyInit; re-wrap as a plain Uint8Array.
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="certificate-${cert.refNumber}.pdf"`,
      "Content-Length": pdfBuffer.length.toString(),
    },
  });
});
