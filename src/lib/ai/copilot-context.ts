// GCCLAB AI Copilot — Context Builder
// =====================================================================
// Builds a system prompt + context payload for the LLM based on the
// logged-in user's role, permissions, and accessible data.
import { db } from "@/lib/db";

export interface CopilotContext {
  systemPrompt: string;
  contextData: string;
}

// Use a minimal user type that's compatible with both AuthUser definitions
interface CopilotUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  companyName?: string | null;
  companyId?: string | null;
  language?: string;
  permissions: string[];
}

export async function buildCopilotContext(user: CopilotUser, locale: "ar" | "en" = "en"): Promise<CopilotContext> {
  const role = user.role;
  const isContractor = role === "CONTRACTOR";
  const companyId = user.companyId;
  const canSeeFinancial = role === "SUPER_ADMIN" || role === "COORDINATOR" || role === "AUDITOR";
  const isArabic = locale === "ar";

  const [upcomingSessions, pendingRequests, overdueInvoices, expiringCerts, todaySessions, stats] = await Promise.all([
    db.trainingSession.findMany({
      where: { deletedAt: null, startDate: { gte: new Date(), lte: new Date(Date.now() + 7 * 86400000) }, ...(isContractor && companyId ? { enrollments: { some: { companyId, deletedAt: null } } } : {}) },
      take: 10, orderBy: { startDate: "asc" },
      select: { id: true, refNumber: true, title: true, startDate: true, status: true, shift: true, city: true, trainer: { select: { nameEn: true } }, course: { select: { title: true } }, _count: { select: { enrollments: true } } },
    }),
    db.trainingRequest.findMany({
      where: { deletedAt: null, status: { in: ["SUBMITTED", "UNDER_REVIEW"] }, ...(isContractor && companyId ? { companyId } : {}) },
      take: 10, orderBy: { createdAt: "desc" },
      include: { company: { select: { name: true } }, course: { select: { title: true } } },
    }),
    canSeeFinancial ? db.invoice.findMany({
      where: { deletedAt: null, status: { in: ["OVERDUE", "PENDING_PAYMENT", "PARTIALLY_PAID"] }, ...(isContractor && companyId ? { companyId } : {}) },
      take: 10, orderBy: { dueDate: "asc" },
      select: { id: true, refNumber: true, status: true, grandTotal: true, outstandingBalance: true, dueDate: true, currency: true, company: { select: { name: true } } },
    }) : [],
    db.certificate.findMany({
      where: { deletedAt: null, status: "VALID", validUntil: { gte: new Date(), lte: new Date(Date.now() + 30 * 86400000) }, ...(isContractor && companyId ? { companyId } : {}) },
      take: 10, orderBy: { validUntil: "asc" },
      select: { id: true, refNumber: true, traineeName: true, validUntil: true, status: true, course: { select: { title: true } } },
    }),
    db.trainingSession.findMany({
      where: { deletedAt: null, startDate: { gte: new Date(new Date().setHours(0, 0, 0, 0)), lte: new Date(new Date().setHours(23, 59, 59, 999)) }, ...(isContractor && companyId ? { enrollments: { some: { companyId, deletedAt: null } } } : {}) },
      take: 20, orderBy: { startDate: "asc" },
      select: { id: true, refNumber: true, title: true, startDate: true, status: true, shift: true, city: true, course: { select: { title: true } }, trainer: { select: { nameEn: true } }, _count: { select: { enrollments: true } } },
    }),
    db.trainingSession.aggregate({ _count: true, where: { deletedAt: null, ...(isContractor && companyId ? { enrollments: { some: { companyId, deletedAt: null } } } : {}) } }),
  ]);

  // ─── Language directive (root-cause fix for AI responding in wrong language) ──
  // The LLM is explicitly told which language to use. This is NOT a translation
  // layer — the model itself generates the response in the target language.
  const languageDirective = isArabic
    ? `## LANGUAGE (STRICT)
You are communicating in ARABIC.
- Always answer in Modern Standard Arabic (الفصحى).
- NEVER answer in English unless the user explicitly writes in English.
- Use professional Arabic suitable for Saudi business users.
- Use Arabic technical terminology (e.g., "متدرب" not "trainee", "دورة" not "course", "جلسة" not "session", "شهادة" not "certificate", "فاتورة" not "invoice").
- Proper nouns (system names like "GCC LAB", person names, reference numbers like TR-2026-000007) remain in their original form.
- Numbers may remain as Western Arabic numerals (0-9) — this is standard in Saudi business contexts.`
    : `## LANGUAGE (STRICT)
You are communicating in ENGLISH.
- Always answer in English.
- NEVER answer in Arabic unless the user explicitly writes in Arabic.
- Use professional English suitable for business users.`;

  const systemPrompt = `You are GCC LAB AI Assistant, an intelligent assistant for the GCC Electrical Testing Laboratory Training Management System.

Your role is to help ${role} users perform their work faster by answering questions, providing insights, and assisting with operations.

${languageDirective}

SYSTEM CONTEXT:
- User: ${user.fullName} (${user.email})
- Role: ${role}
- Company: ${user.companyName ?? "N/A"}

CAPABILITIES:
- Answer questions about sessions, trainees, trainers, courses, requests, attendance, certificates, invoices, payments, and reports.
- Provide analytics and recommendations based on live system data.
- Help draft emails, notifications, and reports.
- Search across the system using natural language.

RULES:
- Always respect the user's permissions. A contractor can only see their own company's data.
- Be concise and professional. Use bullet points for lists.
- When suggesting actions, describe what the user should do in the UI.
- If you don't have enough data, say so and suggest where to find it.

CURRENT SYSTEM DATA (live as of ${new Date().toISOString()}):`;

  const parts: string[] = [];
  if (todaySessions.length > 0) {
    parts.push(`## Today's Sessions (${todaySessions.length})`);
    todaySessions.forEach(s => parts.push(`- ${s.refNumber}: ${s.course?.title ?? s.title} | ${new Date(s.startDate).toLocaleTimeString()} | ${s.city ?? "—"} | Trainer: ${s.trainer?.nameEn ?? "Unassigned"} | ${s._count.enrollments} trainees | ${s.status}`));
  }
  if (upcomingSessions.length > 0) {
    parts.push(`\n## Upcoming Sessions (${upcomingSessions.length})`);
    upcomingSessions.forEach(s => parts.push(`- ${s.refNumber}: ${s.course?.title ?? s.title} | ${new Date(s.startDate).toLocaleDateString()} | ${s.shift ?? "—"}`));
  }
  if (pendingRequests.length > 0) {
    parts.push(`\n## Pending Requests (${pendingRequests.length})`);
    pendingRequests.forEach(r => parts.push(`- ${r.refNumber}: ${r.company?.name ?? "—"} | ${r.course?.title ?? "—"} | ${r.traineeCount} trainees | ${r.priority} | ${r.status}`));
  }
  if (overdueInvoices.length > 0) {
    parts.push(`\n## Outstanding Invoices (${overdueInvoices.length})`);
    overdueInvoices.forEach(inv => parts.push(`- ${inv.refNumber}: ${inv.company?.name ?? "—"} | Total: ${inv.grandTotal} ${inv.currency} | Outstanding: ${inv.outstandingBalance} ${inv.currency} | Due: ${inv.dueDate?.toLocaleDateString() ?? "—"} | ${inv.status}`));
  }
  if (expiringCerts.length > 0) {
    parts.push(`\n## Expiring Certificates (30 days, ${expiringCerts.length})`);
    expiringCerts.forEach(c => parts.push(`- ${c.refNumber}: ${c.traineeName} | ${c.course?.title ?? "—"} | Expires: ${new Date(c.validUntil).toLocaleDateString()}`));
  }
  parts.push(`\n## Quick Stats: Total Sessions (accessible): ${stats._count}`);

  return { systemPrompt, contextData: parts.join("\n") };
}
