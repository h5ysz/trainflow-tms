// /api/invoices/[id]/pdf — generate professional A4 PDF for an invoice
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

export const GET = withModuleAction("invoices", "view", async ({ params, user }) => {
  const id = params.id as string;
  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, refNumber: true, crNumber: true, vatNumber: true, address: true, phone: true, email: true } },
      request: { select: { id: true, refNumber: true } },
      session: { select: { id: true, refNumber: true, title: true } },
      bankAccount: true,
    },
  });
  if (!invoice || invoice.deletedAt) return notFound("Invoice not found");
  if (user.role === "CONTRACTOR" && user.companyId !== invoice.companyId) return notFound("Invoice not found");

  const snapshot = parseSnapshot(invoice.snapshot);
  const snapCompany = (snapshot?.company as Record<string, unknown> | undefined) ?? {};
  const snapBank = (snapshot?.bank as Record<string, unknown> | undefined) ?? null;
  const snapCustomer = (snapshot?.customer as Record<string, unknown> | undefined) ?? {};

  let lineItems: Array<{ description?: string; courseTitle?: string; traineeCount?: number; unitPrice?: number; lineTotal?: number; quantity?: number }> = [];
  try { lineItems = JSON.parse(invoice.lineItems); } catch { lineItems = []; }

  const qrData = JSON.stringify({
    invoiceRef: invoice.refNumber,
    iban: snapBank?.iban ?? invoice.bankAccount?.iban ?? "",
    amount: invoice.grandTotal,
    currency: invoice.currency,
  });
  const qrBuffer = await QRCode.toBuffer(qrData, { width: 150, margin: 1, type: "png" });

  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - 100;
  const isPaid = invoice.status === "PAID";

  // Header
  doc.fontSize(16).font("Helvetica-Bold").fillColor("#0d9488").text(snapCompany.name as string ?? "GCC ELECTRICAL TESTING LABORATORY", 50, 50, { width: 300 });
  doc.fontSize(8).font("Helvetica").fillColor("#666666");
  doc.text(`CR: ${snapCompany.crNumber ?? "—"}`, 50, 72, { width: 300 });
  doc.text(`VAT: ${snapCompany.vatNumber ?? "—"}`, 50, 83, { width: 300 });
  doc.text(snapCompany.address as string ?? "", 50, 94, { width: 300 });
  doc.text(`Tel: ${snapCompany.phone ?? "—"}  |  Email: ${snapCompany.email ?? "—"}`, 50, 110, { width: 300 });

  doc.fontSize(24).font("Helvetica-Bold").fillColor("#0d9488").text("INVOICE", pageWidth - 200, 50, { width: 150, align: "right" });
  doc.fontSize(10).font("Helvetica").fillColor("#333333");
  doc.text(invoice.refNumber, pageWidth - 200, 80, { width: 150, align: "right" });
  doc.text(`Issue: ${format(new Date(invoice.issueDate), "dd MMM yyyy")}`, pageWidth - 200, 95, { width: 150, align: "right" });
  doc.text(`Due: ${invoice.dueDate ? format(new Date(invoice.dueDate), "dd MMM yyyy") : "—"}`, pageWidth - 200, 108, { width: 150, align: "right" });

  if (isPaid) {
    doc.save();
    doc.translate(pageWidth - 180, 140).rotate(-0.3);
    doc.roundedRect(0, 0, 120, 45, 5).fillColor("#22c55e").fill();
    doc.fontSize(22).font("Helvetica-Bold").fillColor("#ffffff").text("PAID", 10, 12, { width: 100, align: "center" });
    doc.restore();
  }

  // Bill To
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#0d9488").text("BILL TO", 50, 145);
  doc.fontSize(10).font("Helvetica").fillColor("#333333");
  doc.text(snapCustomer.name as string ?? invoice.company.name, 50, 160);
  if (snapCustomer.crNumber) doc.text(`CR: ${snapCustomer.crNumber}`, 50, 174);
  if (snapCustomer.vatNumber) doc.text(`VAT: ${snapCustomer.vatNumber}`, 50, 186);
  if (snapCustomer.address) doc.text(snapCustomer.address as string, 50, 198);
  if (snapCustomer.phone) doc.text(`Tel: ${snapCustomer.phone}`, 50, 210);

  // Table
  const tableTop = 250;
  const colX = { desc: 50, qty: 280, price: 350, total: 450 };
  doc.rect(50, tableTop, contentWidth, 22).fill("#0d9488");
  doc.fontSize(9).font("Helvetica-Bold").fillColor("#ffffff");
  doc.text("Description", colX.desc + 8, tableTop + 7);
  doc.text("Qty", colX.qty + 8, tableTop + 7, { width: 62, align: "center" });
  doc.text("Unit Price", colX.price + 8, tableTop + 7, { width: 92, align: "right" });
  doc.text("Total", colX.total + 8, tableTop + 7, { width: 72, align: "right" });

  let rowY = tableTop + 22;
  lineItems.forEach((item, idx) => {
    const desc = item.description || item.courseTitle || "Training Services";
    const qty = item.traineeCount || item.quantity || 1;
    const price = item.unitPrice || 0;
    const total = item.lineTotal || qty * price;
    if (idx % 2 === 0) doc.rect(50, rowY, contentWidth, 20).fill("#f8fafc");
    doc.fontSize(9).font("Helvetica").fillColor("#333333");
    doc.text(desc, colX.desc + 8, rowY + 6, { width: 222 });
    doc.text(String(qty), colX.qty + 8, rowY + 6, { width: 62, align: "center" });
    doc.text(SAR.format(price), colX.price + 8, rowY + 6, { width: 92, align: "right" });
    doc.text(SAR.format(total), colX.total + 8, rowY + 6, { width: 72, align: "right" });
    rowY += 20;
  });

  // Totals
  const totalsY = rowY + 15;
  doc.fontSize(9).font("Helvetica").fillColor("#666666");
  doc.text("Subtotal:", 350, totalsY, { width: 100, align: "right" });
  doc.text(SAR.format(invoice.subtotal), 450, totalsY, { width: 80, align: "right" });
  doc.fillColor("#ef4444").text(`-${SAR.format(invoice.discountAmount)}`, 450, totalsY + 14, { width: 80, align: "right" });
  doc.fillColor("#666666").text("Discount:", 350, totalsY + 14, { width: 100, align: "right" });
  doc.text(`VAT (${invoice.vatRate}%):`, 350, totalsY + 28, { width: 100, align: "right" });
  doc.text(SAR.format(invoice.vatAmount), 450, totalsY + 28, { width: 80, align: "right" });
  doc.rect(345, totalsY + 42, contentWidth - 295, 22).fill("#0d9488");
  doc.fontSize(11).font("Helvetica-Bold").fillColor("#ffffff");
  doc.text("GRAND TOTAL:", 350, totalsY + 47, { width: 100, align: "right" });
  doc.text(`${SAR.format(invoice.grandTotal)} ${invoice.currency}`, 450, totalsY + 47, { width: 80, align: "right" });

  // Bank details
  const bankY = totalsY + 85;
  const bank = snapBank ?? (invoice.bankAccount ? {
    bankName: invoice.bankAccount.bankName, beneficiary: invoice.bankAccount.beneficiary,
    accountNumber: invoice.bankAccount.accountNumber, iban: invoice.bankAccount.iban, swift: invoice.bankAccount.swift,
  } : null);
  if (bank) {
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#0d9488").text("Payment Instructions", 50, bankY);
    doc.fontSize(9).font("Helvetica").fillColor("#333333");
    doc.text(`Bank: ${bank.bankName}`, 50, bankY + 15);
    doc.text(`Beneficiary: ${bank.beneficiary}`, 50, bankY + 27);
    doc.text(`Account: ${bank.accountNumber}`, 50, bankY + 39);
    if (bank.iban) doc.text(`IBAN: ${bank.iban}`, 50, bankY + 51);
    if (bank.swift) doc.text(`SWIFT: ${bank.swift}`, 50, bankY + 63);
    doc.image(qrBuffer, pageWidth - 170, bankY, { width: 100, height: 100 });
    doc.fontSize(7).fillColor("#999999").text("Scan to pay", pageWidth - 170, bankY + 105, { width: 100, align: "center" });
  }

  // Footer
  const footerY = doc.page.height - 80;
  doc.rect(50, footerY, contentWidth, 1).fill("#e2e8f0");
  doc.fontSize(7).font("Helvetica").fillColor("#999999");
  doc.text(`${snapCompany.name ?? "GCC Lab"} | CR: ${snapCompany.crNumber ?? "—"} | VAT: ${snapCompany.vatNumber ?? "—"}`, 50, footerY + 8, { width: contentWidth, align: "center" });
  doc.text("This is a computer-generated invoice.", 50, footerY + 20, { width: contentWidth, align: "center" });

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(7).fillColor("#cccccc").text(`Page ${i + 1} of ${range.count}`, 50, doc.page.height - 30, { width: contentWidth, align: "center" });
  }

  doc.end();
  const pdfBuffer = await new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  return new Response(new Uint8Array(pdfBuffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${invoice.refNumber}.pdf"` },
  });
});
