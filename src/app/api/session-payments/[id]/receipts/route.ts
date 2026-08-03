// /api/session-payments/[id]/receipts — contractor uploads transfer receipts
//
// POST: upload a receipt file (PDF/JPG/PNG) + amount. Creates a PaymentReceipt
//      record linked to the SessionPayment. Notifies all coordinators.
// GET:  list all receipts for this session payment.
//
// RBAC:
//   - Contractor: can upload receipts for their own company's session payment.
//   - Coordinator/Admin: can view all receipts.
//   - Trainer: can view (sessions.view).
import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "payment-receipts");
const PUBLIC_PREFIX = "/uploads/payment-receipts";
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const GET = withModuleAction("sessions", "view", async ({ req, params, user }) => {
  const id = params.id as string;
  const sp = await db.sessionPayment.findUnique({
    where: { id },
    include: { receipts: { orderBy: { uploadedAt: "desc" } } },
  });
  if (!sp || sp.deletedAt) return fail("Session payment not found", 404);

  // Contractors can only see their own company's receipts
  if (user.role === "CONTRACTOR" && sp.companyId !== user.companyId) {
    return fail("Forbidden", 403);
  }

  return ok(sp.receipts);
});

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const id = params.id as string;

  const sp = await db.sessionPayment.findUnique({
    where: { id },
    include: { company: { select: { name: true } }, session: { select: { refNumber: true } } },
  });
  if (!sp || sp.deletedAt) return fail("Session payment not found", 404);

  // Contractors can only upload for their own company
  if (user.role === "CONTRACTOR" && sp.companyId !== user.companyId) {
    return fail("Forbidden — you can only upload receipts for your own company", 403);
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const amountStr = formData?.get("amount") as string | null;
  const notes = formData?.get("notes") as string | null;

  if (!file || typeof file === "string") {
    return fail("No file uploaded", 422, "VALIDATION_ERROR");
  }
  if (!amountStr) {
    return fail("Amount is required", 422, "VALIDATION_ERROR");
  }

  const amount = parseFloat(amountStr);
  if (Number.isNaN(amount) || amount <= 0) {
    return fail("Amount must be a positive number", 422, "VALIDATION_ERROR");
  }

  const f = file as File;
  const mime = f.type || "";
  const ext = ALLOWED[mime];
  if (!ext) {
    return fail(`Unsupported file type: ${mime || "unknown"}. Accepted: PDF, JPG, PNG, WebP.`, 422, "VALIDATION_ERROR");
  }
  if (f.size > MAX_BYTES) {
    return fail(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`, 422, "FILE_TOO_LARGE");
  }

  const buffer = Buffer.from(await f.arrayBuffer());
  const basename = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  const targetPath = path.join(UPLOAD_DIR, basename);

  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(targetPath, buffer, { flag: "wx" });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return fail("Upload conflict — please retry", 409, "UPLOAD_CONFLICT");
    console.error("[payment-receipts] writeFile failed", e);
    return fail("Could not save uploaded file", 500);
  }

  const now = new Date();
  const receipt = await db.paymentReceipt.create({
    data: {
      id: crypto.randomUUID(),
      sessionPaymentId: id,
      filename: basename,
      originalName: f.name || basename,
      url: `${PUBLIC_PREFIX}/${basename}`,
      amount,
      currency: sp.currency,
      status: "PENDING",
      uploadedById: user.id,
      uploadedAt: now,
      notes: notes ?? null,
      updatedAt: now,
    },
  });

  // ── Notify all coordinators ──────────────────────────────────────────────
  const coordinators = await db.user.findMany({
    where: { role: "COORDINATOR", isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (coordinators.length > 0) {
    await db.notification.createMany({
      data: coordinators.map((c) => ({
        id: crypto.randomUUID(),
        userId: c.id,
        title: "Payment Receipt Uploaded",
        titleAr: "تم رفع إيصال دفع",
        message: `${sp.company?.name ?? "A company"} uploaded a payment receipt for ${amount} ${sp.currency} (Session ${sp.session.refNumber}). Please verify.`,
        messageAr: `${sp.company?.name ?? "شركة"} رفعت إيصال دفع بمبلغ ${amount} ${sp.currency} (جلسة ${sp.session.refNumber}). يرجى التحقق.`,
        type: "INFO",
        category: "FINANCIAL",
        updatedAt: now,
      })),
    });
  }

  await audit({
    user,
    action: "CREATE",
    entity: "SESSION",
    entityId: sp.sessionId,
    entityRef: sp.session.refNumber,
    description: `Payment receipt uploaded: ${amount} ${sp.currency} by ${user.fullName} for session ${sp.session.refNumber}`,
    descriptionAr: `تم رفع إيصال دفع: ${amount} ${sp.currency} بواسطة ${user.fullName} لجلسة ${sp.session.refNumber}`,
    req,
    newValue: { receiptId: receipt.id, amount, currency: sp.currency, filename: basename },
    metadata: {
      action: "PAYMENT_RECEIPT_UPLOADED",
      sessionPaymentId: id,
      receiptId: receipt.id,
      amount,
      currency: sp.currency,
      companyName: sp.company?.name ?? null,
    },
  });

  return ok(receipt);
});
