// /api/receipts/[id]/pdf — generate professional A4 PDF for a receipt
import { db } from "@/lib/db";
import { withModuleAction, notFound } from "@/lib/auth/api";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { format } from "date-fns";

const SAR = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseSnapshot(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export const GET = withModuleAction("receipts", "view", async ({ params, user }) => {
  const id = params.id as string;
  const receipt = await db.receipt.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, refNumber: true, crNumber: true, vatNumber: true, address: true, phone: true, email: true } },
      invoice: { select: { id: true, refNumber: true, grandTotal: true, paidAmount: true, outstandingBalance: true, currency: true } },
      payment: { select: { id: true, refNumber: true, method: true, referenceNumber: true, paidBy: true } },
    },
  });
  if (!receipt || receipt.deletedAt) return notFound("Receipt not found");
  if (user.role === "CONTRACTOR" && user.companyId !== receipt.companyId) return notFound("Receipt not found");

  const snapshot = parseSnapshot(receipt.snapshot);
  const snapCompany = (snapshot?.company as Record<string, unknown> | undefined) ?? {};

  const qrBuffer = await QRCode.toBuffer(receipt.refNumber, { width: 100, margin: 1, type: "png" });

  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - 100;

  // Header
  doc.fontSize(16).font("Helvetica-Bold").fillColor("#0d9488").text(snapCompany.name as string ?? "GCC ELECTRICAL TESTING LABORATORY", 50, 50, { width: 300 });
  doc.fontSize(8).font("Helvetica").fillColor("#666666");
  doc.text(`CR: ${snapCompany.crNumber ?? "—"}`, 50, 72, { width: 300 });
  doc.text(`VAT: ${snapCompany.vatNumber ?? "—"}`, 50, 83, { width: 300 });
  doc.text(snapCompany.address as string ?? "", 50, 94, { width: 300 });

  doc.fontSize(24).font("Helvetica-Bold").fillColor("#0d9488").text("RECEIPT", pageWidth - 200, 50, { width: 150, align: "right" });
  doc.fontSize(10).font("Helvetica").fillColor("#333333");
  doc.text(receipt.refNumber, pageWidth - 200, 80, { width: 150, align: "right" });
  doc.text(`Date: ${format(new Date(receipt.receiptDate), "dd MMM yyyy")}`, pageWidth - 200, 95, { width: 150, align: "right" });

  // PAID stamp
  doc.save();
  doc.translate(pageWidth - 180, 120).rotate(-0.3);
  doc.roundedRect(0, 0, 120, 45, 5).fillColor("#22c55e").fill();
  doc.fontSize(22).font("Helvetica-Bold").fillColor("#ffffff").text("PAID", 10, 12, { width: 100, align: "center" });
  doc.restore();

  // Receipt details
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#0d9488").text("Receipt Details", 50, 130);
  doc.fontSize(9).font("Helvetica").fillColor("#333333");
  let y = 145;
  doc.text(`Receipt #: ${receipt.refNumber}`, 50, y); y += 12;
  doc.text(`Invoice #: ${receipt.invoice?.refNumber ?? "—"}`, 50, y); y += 12;
  doc.text(`Payment Method: ${(receipt.paymentMethod || receipt.payment?.method || "—").replace(/_/g, " ")}`, 50, y); y += 12;
  doc.text(`Reference: ${receipt.referenceNumber || receipt.payment?.referenceNumber || "—"}`, 50, y); y += 12;
  doc.text(`Paid By: ${receipt.paidBy || receipt.payment?.paidBy || "—"}`, 50, y); y += 20;

  // Amount box
  doc.rect(50, y, contentWidth, 80).fill("#f0fdf9").stroke("#0d9488");
  doc.fontSize(10).font("Helvetica").fillColor("#666666");
  doc.text("Amount Paid:", 65, y + 12);
  doc.fontSize(16).font("Helvetica-Bold").fillColor("#22c55e").text(`${SAR.format(receipt.amount)} ${receipt.currency}`, 200, y + 10);
  doc.fontSize(9).font("Helvetica").fillColor("#666666");
  doc.text(`VAT Amount:`, 65, y + 35);
  doc.text(`${SAR.format(receipt.vatAmount)} ${receipt.currency}`, 200, y + 35);
  if (receipt.invoice) {
    doc.text(`Invoice Total:`, 65, y + 50);
    doc.text(`${SAR.format(receipt.invoice.grandTotal)} ${receipt.invoice.currency}`, 200, y + 50);
    doc.text(`Remaining Balance:`, 65, y + 65);
    doc.fillColor(receipt.invoice.outstandingBalance > 0 ? "#f59e0b" : "#22c55e").text(`${SAR.format(receipt.invoice.outstandingBalance)} ${receipt.invoice.currency}`, 200, y + 65);
  }

  // Received from
  y += 100;
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#0d9488").text("Received From", 50, y);
  doc.fontSize(9).font("Helvetica").fillColor("#333333");
  doc.text(receipt.company.name, 50, y + 15);
  if (receipt.company.crNumber) doc.text(`CR: ${receipt.company.crNumber}`, 50, y + 27);
  if (receipt.company.vatNumber) doc.text(`VAT: ${receipt.company.vatNumber}`, 50, y + 39);
  if (receipt.company.address) doc.text(receipt.company.address, 50, y + 51);

  // QR code
  doc.image(qrBuffer, pageWidth - 130, y, { width: 80, height: 80 });
  doc.fontSize(7).fillColor("#999999").text("Receipt verification", pageWidth - 130, y + 85, { width: 80, align: "center" });

  // Footer
  const footerY = doc.page.height - 80;
  doc.rect(50, footerY, contentWidth, 1).fill("#e2e8f0");
  doc.fontSize(7).font("Helvetica").fillColor("#999999");
  doc.text(`${snapCompany.name ?? "GCC Lab"} | CR: ${snapCompany.crNumber ?? "—"} | VAT: ${snapCompany.vatNumber ?? "—"}`, 50, footerY + 8, { width: contentWidth, align: "center" });
  doc.text("This is a computer-generated receipt.", 50, footerY + 20, { width: contentWidth, align: "center" });

  doc.end();
  const pdfBuffer = await new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  return new Response(new Uint8Array(pdfBuffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${receipt.refNumber}.pdf"` },
  });
});
