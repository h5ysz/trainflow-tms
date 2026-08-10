// /api/certificates/[id]/generate-pdf — generate PDF certificate with QR verification
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction, fail } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";
import { syncCertificateStatus } from "@/lib/api/enrollment-sync";
import PDFDocument from "pdfkit";
import { buildVerifyUrl, resolveOrigin } from "@/lib/qr/urls";
import { renderQrPng } from "@/lib/qr/server";
import { arabicFontPath, arabicFontBoldPath, certificateLogoPath } from "@/lib/pdf/fonts";
import { drawCertificateLayout } from "@/lib/pdf/certificate-layout";
import { randomBytes } from "crypto";

// Gated on `view`: anyone who can see a certificate may render its PDF. Security is
// enforced inside — contractors may only render their own company's certificates,
// and only after the coordinator released them (releaseStatus RELEASED/DOWNLOADED).
// The handler also writes `pdfGeneratedAt` and syncs the enrollment to ISSUED, but
// that is metadata, not an authorization boundary.
export const POST = withModuleAction("certificates", "view", async ({ req, params, user }) => {
  const id = params.id as string;
  const cert = await db.certificate.findUnique({
    where: { id },
    include: {
      course: true,
      session: {
        include: {
          trainer: { select: { nameEn: true, refNumber: true } },
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

  // ── Certificate Release Security ──
  // Contractors can only generate/download PDFs after the certificate has
  // been released by a coordinator (releaseStatus === "RELEASED" or "DOWNLOADED").
  // Coordinators + admins can generate PDFs at any time (for preview/internal use).
  if (user.role === "CONTRACTOR") {
    if (cert.releaseStatus !== "RELEASED" && cert.releaseStatus !== "DOWNLOADED") {
      return fail(
        "Certificate has not been released. Please contact your coordinator.",
        403,
        "NOT_RELEASED",
      );
    }
  }

  // ─── Verification QR ────────────────────────────────────────────────
  // A certificate with no token yet gets one now, and it is persisted in the
  // same update as pdfGeneratedAt below — otherwise the printed code would
  // point at a token no lookup could ever match.
  const verificationToken = cert.verificationToken ?? randomBytes(16).toString("hex");
  const verifyUrl = buildVerifyUrl(resolveOrigin(req), verificationToken);
  const qrPng = await renderQrPng(verifyUrl, { width: 240, margin: 1 });

  // ─── Certificate Design ──────────────────────────────────────────────
  // All content is drawn by the shared layout module, which auto-fits every
  // block to one page (long names/course titles shrink instead of overflowing).
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

  const arabicFont = arabicFontPath();
  const arabicBoldFont = arabicFontBoldPath();
  // One embedded family renders Latin + Arabic in both weights, matching the
  // @font-face'd files the browser preview and print use — so the downloaded PDF
  // is the same design as the on-screen sheet.
  if (arabicFont) doc.registerFont("Certificate", arabicFont);
  if (arabicBoldFont) doc.registerFont("Certificate-Bold", arabicBoldFont);

  drawCertificateLayout(
    doc,
    {
      traineeName: cert.traineeName,
      courseTitle: cert.course.title,
      courseCode: cert.course.code,
      durationHours: cert.course.durationHours,
      finalScore: cert.finalScore,
      issuedAt: cert.issuedAt,
      validUntil: cert.validUntil,
      refNumber: cert.refNumber,
      companyName: cert.company?.name,
      trainerName: cert.session?.trainer?.nameEn,
      verifyUrl,
      qrPng,
    },
    {
      fontName: arabicFont ? "Certificate" : null,
      fontNameBold: arabicBoldFont ? "Certificate-Bold" : null,
      logoPath: certificateLogoPath(),
    },
  );

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
