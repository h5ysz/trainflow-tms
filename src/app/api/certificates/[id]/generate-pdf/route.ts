// /api/certificates/[id]/generate-pdf — generate PDF certificate with QR verification
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

// Gated on `create`, not `view`: this handler writes `pdfGeneratedAt` and transitions
// the certificate to ISSUED, so read-only roles must not be able to trigger it.
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

  // Generate PDF
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const pdfPromise = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  // ─── Certificate Design ──────────────────────────────────────────────
  // Border
  doc
    .rect(30, 30, doc.page.width - 60, doc.page.height - 60)
    .lineWidth(3)
    .strokeColor("#7B1E2B")
    .stroke();

  // Inner border
  doc
    .rect(40, 40, doc.page.width - 80, doc.page.height - 80)
    .lineWidth(1)
    .strokeColor("#7B1E2B")
    .opacity(0.3)
    .stroke()
    .opacity(1);

  // Header. The Arabic half of the strapline is only drawn when an Arabic-capable font
  // is installed — Helvetica has no Arabic glyphs, so it previously rendered as boxes.
  const arabicFont = arabicFontPath();
  if (arabicFont) doc.registerFont("Arabic", arabicFont);

  doc
    .fontSize(14)
    .fillColor("#7B1E2B")
    .font("Helvetica-Bold")
    .text("GCCLAB — Gulf Calibration Laboratory", 0, 70, { align: "center" })
    .fontSize(10)
    .fillColor("#666")
    .font("Helvetica")
    .text("Training & Certification Management System", { align: "center" });

  if (arabicFont) {
    doc.font("Arabic").fontSize(10).fillColor("#666").text("المختبر الخليجي", { align: "center" });
    doc.font("Helvetica");
  }

  // Title
  doc
    .fontSize(36)
    .fillColor("#1a1a1a")
    .font("Helvetica-Bold")
    .text("Certificate of Completion", 0, 120, { align: "center" });

  // Subtitle
  doc
    .fontSize(14)
    .fillColor("#666")
    .font("Helvetica")
    .text("This is to certify that", 0, 170, { align: "center" });

  // Trainee name
  doc
    .fontSize(28)
    .fillColor("#7B1E2B")
    .font("Helvetica-Bold")
    .text(cert.traineeName, 0, 200, { align: "center" });

  // Description
  doc
    .fontSize(14)
    .fillColor("#666")
    .font("Helvetica")
    .text("has successfully completed the training course", 0, 245, { align: "center" });

  // Course title
  doc
    .fontSize(22)
    .fillColor("#1a1a1a")
    .font("Helvetica-Bold")
    .text(cert.course.title, 0, 275, { align: "center" });

  // Course code
  doc
    .fontSize(12)
    .fillColor("#666")
    .font("Helvetica")
    .text(`Course Code: ${cert.course.code}  |  Duration: ${cert.course.durationHours} hours  |  Score: ${cert.finalScore}%`, 0, 315, { align: "center" });

  // Issue + expiry dates
  const issueDate = cert.issuedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const expiryDate = cert.validUntil.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  doc
    .fontSize(11)
    .fillColor("#666")
    .text(`Issued: ${issueDate}  |  Valid Until: ${expiryDate}`, 0, 345, { align: "center" });

  // Certificate ref number
  doc
    .fontSize(10)
    .fillColor("#999")
    .font("Helvetica")
    .text(`Certificate No: ${cert.refNumber}`, 0, 375, { align: "center" });

  // Verification QR. A certificate with no token yet gets one now, and it is persisted
  // in the same update as pdfGeneratedAt below — otherwise the printed code would point
  // at a token no lookup could ever match.
  const verificationToken = cert.verificationToken ?? randomBytes(16).toString("hex");
  const verifyUrl = buildVerifyUrl(resolveOrigin(req), verificationToken);
  const qrPng = await renderQrPng(verifyUrl, { width: 240, margin: 1 });

  // doc.image() does not advance the text cursor, so everything after it passes
  // explicit coordinates (as the surrounding code already does).
  doc.image(qrPng, doc.page.width / 2 - 45, 395, { width: 90 });
  doc
    .fontSize(8)
    .fillColor("#999")
    .text("Scan to verify this certificate", 0, 490, { align: "center" })
    .fontSize(7)
    .text(verifyUrl, { align: "center" });

  // Company info (if available)
  if (cert.company?.name) {
    doc
      .fontSize(11)
      .fillColor("#666")
      .font("Helvetica")
      .text(`Company: ${cert.company.name}`, 0, 515, { align: "center" });
  }

  // Trainer info (if available)
  if (cert.session?.trainer?.fullName) {
    doc
      .fontSize(11)
      .fillColor("#666")
      .text(`Trainer: ${cert.session.trainer.fullName}`, 0, 533, { align: "center" });
  }

  // Signature line
  doc
    .moveTo(150, doc.page.height - 100)
    .lineTo(350, doc.page.height - 100)
    .lineWidth(1)
    .strokeColor("#999")
    .stroke()
    .fontSize(10)
    .fillColor("#666")
    .font("Helvetica")
    .text("Authorized Signature", 180, doc.page.height - 90, { align: "left" });

  // GCCLAB seal
  doc
    .moveTo(doc.page.width - 350, doc.page.height - 100)
    .lineTo(doc.page.width - 150, doc.page.height - 100)
    .stroke()
    .text("GCCLAB", doc.page.width - 320, doc.page.height - 90, { align: "left" });

  if (arabicFont) {
    doc
      .font("Arabic")
      .fontSize(10)
      .fillColor("#666")
      .text("المختبر الخليجي", doc.page.width - 320, doc.page.height - 76, { align: "left" });
  }

  doc.end();

  const pdfBuffer = await pdfPromise;

  // Update certificate with PDF generation timestamp
  await db.certificate.update({
    where: { id: cert.id },
    data: {
      pdfGeneratedAt: new Date(),
      // Persist a token generated above, so the QR on the printed page resolves.
      ...(cert.verificationToken ? {} : { verificationToken }),
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

  // Sprint 6: also update Certificate.status from APPROVED → ISSUED
  // (legacy VALID certs are also bumped to ISSUED for consistency)
  if (cert.status === "APPROVED" || cert.status === "VALID" || cert.status === "PENDING_APPROVAL") {
    await db.certificate.update({
      where: { id: cert.id },
      data: { status: "ISSUED", updatedBy: user.id },
    });
  }

  // ── Sprint 6: Notify the company coordinator that the cert was issued ──
  try {
    const companyUsers = await db.user.findMany({
      where: {
        companyId: cert.companyId ?? undefined,
        role: "CONTRACTOR", // company-side users (coordinator / company user)
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });
    for (const cu of companyUsers) {
      await db.notification.create({
        data: {
          userId: cu.id,
          title: "Certificate Issued",
          titleAr: "تم إصدار الشهادة",
          message: `Certificate ${cert.refNumber} for ${cert.traineeName} has been issued and is ready for download.`,
          messageAr: `تم إصدار شهادة ${cert.refNumber} لـ ${cert.traineeName} وهي جاهزة للتحميل.`,
          type: "SUCCESS",
          category: "CERTIFICATE",
          link: `/certificates`,
        },
      });
    }
  } catch {
    // notification failure shouldn't block PDF generation
  }

  // Audit
  await recordAudit({
    userId: user.id,
    action: "CERTIFICATE_GENERATE",
    entity: "CERTIFICATE",
    entityId: cert.id,
    entityRef: cert.refNumber,
    description: `Generated PDF for certificate ${cert.refNumber}`,
    descriptionAr: `تم توليد PDF للشهادة ${cert.refNumber}`,
    req,
    metadata: { verificationToken: cert.verificationToken },
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
