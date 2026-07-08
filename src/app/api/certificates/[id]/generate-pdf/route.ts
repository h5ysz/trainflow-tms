// /api/certificates/[id]/generate-pdf — generate PDF certificate with QR verification
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, fail, audit } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";
import { syncCertificateStatus } from "@/lib/api/enrollment-sync";
import PDFDocument from "pdfkit";
import { randomBytes } from "crypto";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);

  const { id } = await ctx.params;
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
    .strokeColor("#0d9488")
    .stroke();

  // Inner border
  doc
    .rect(40, 40, doc.page.width - 80, doc.page.height - 80)
    .lineWidth(1)
    .strokeColor("#0d9488")
    .opacity(0.3)
    .stroke()
    .opacity(1);

  // Header
  doc
    .fontSize(14)
    .fillColor("#0d9488")
    .font("Helvetica-Bold")
    .text("TRAINFLOW TMS", 0, 70, { align: "center" })
    .fontSize(10)
    .fillColor("#666")
    .font("Helvetica")
    .text("Training Management System", { align: "center" });

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
    .fillColor("#0d9488")
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

  // Verification QR text (simplified — in production, generate actual QR image)
  const verifyUrl = `${req.headers.get("origin") || ""}/verify/${cert.verificationToken}`;
  doc
    .fontSize(9)
    .fillColor("#666")
    .text(`Verify online: ${verifyUrl}`, 0, 400, { align: "center" })
    .fontSize(8)
    .fillColor("#999")
    .text(`Verification Token: ${cert.verificationToken}`, { align: "center" });

  // Company info (if available)
  if (cert.company?.name) {
    doc
      .fontSize(11)
      .fillColor("#666")
      .font("Helvetica")
      .text(`Company: ${cert.company.name}`, 0, 430, { align: "center" });
  }

  // Trainer info (if available)
  if (cert.session?.trainer?.fullName) {
    doc
      .fontSize(11)
      .fillColor("#666")
      .text(`Trainer: ${cert.session.trainer.fullName}`, 0, 450, { align: "center" });
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

  // TrainFlow seal
  doc
    .moveTo(doc.page.width - 350, doc.page.height - 100)
    .lineTo(doc.page.width - 150, doc.page.height - 100)
    .stroke()
    .text("TrainFlow TMS", doc.page.width - 320, doc.page.height - 90, { align: "left" });

  doc.end();

  const pdfBuffer = await pdfPromise;

  // Update certificate with PDF generation timestamp
  await db.certificate.update({
    where: { id: cert.id },
    data: {
      pdfGeneratedAt: new Date(),
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

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="certificate-${cert.refNumber}.pdf"`,
      "Content-Length": pdfBuffer.length.toString(),
    },
  });
}
