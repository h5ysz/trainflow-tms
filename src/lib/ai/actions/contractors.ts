// GCCLAB AI Copilot — Phase 2 — CONTRACTORS (Companies) actions
// =====================================================================
// create / edit / update — mirrors /api/companies endpoint logic without
// modifying it.
import { db } from "@/lib/db";
import { nextRefNumber } from "@/lib/api/ref-number";
import type { ActionHandler } from "./types";
import { ActionError } from "./types";
import { copilotAudit } from "./audit";

interface CompanyInput {
  name?: string;
  nameAr?: string;
  legalName?: string;
  crNumber?: string;
  vatNumber?: string;
  industry?: string;
  country?: string;
  city?: string;
  address?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
  website?: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
  status?: string;
}

function pickCompanyFields(input: CompanyInput) {
  return {
    name: input.name,
    nameAr: input.nameAr ?? null,
    legalName: input.legalName ?? null,
    crNumber: input.crNumber ?? null,
    vatNumber: input.vatNumber ?? null,
    industry: input.industry ?? null,
    country: input.country ?? null,
    city: input.city ?? null,
    address: input.address ?? null,
    postalCode: input.postalCode ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    website: input.website ?? null,
    contactPerson: input.contactPerson ?? null,
    contactPhone: input.contactPhone ?? null,
    contactEmail: input.contactEmail ?? null,
    status: input.status ?? "ACTIVE",
  };
}

// ─── CONTRACTOR_CREATE ────────────────────────────────────────────────────
const createContractor: ActionHandler<CompanyInput> = {
  type: "CONTRACTOR_CREATE",
  category: "CONTRACTORS",
  description: "Create a new contractor (company) record with name, CR number, contact info.",
  descriptionAr: "إنشاء سجل مقاول (شركة) جديد بالاسم والسجل التجاري ومعلومات الاتصال.",
  resolvePermission: () => ({ module: "companies", action: "create" }),
  async preparePreview(input, _user) {
    if (!input.name) throw new ActionError("Company name is required", 422, "VALIDATION_ERROR");
    const dup = await db.company.findFirst({
      where: { name: input.name, deletedAt: null },
    });
    if (dup) {
      throw new ActionError(
        `Company "${input.name}" already exists (${dup.refNumber})`,
        400,
        "DUPLICATE_NAME"
      );
    }
    const fields = pickCompanyFields(input);
    return {
      actionType: "CONTRACTOR_CREATE",
      title: "Create Contractor",
      titleAr: "إنشاء مقاول",
      summary: `Create contractor "${fields.name}"${fields.crNumber ? ` (CR ${fields.crNumber})` : ""}.`,
      summaryAr: `إنشاء مقاول "${fields.name}"${fields.crNumber ? ` (سجل تجاري ${fields.crNumber})` : ""}.`,
      affectedRecords: [
        { entity: "COMPANY", description: `New contractor: ${fields.name}` },
      ],
      changes: [
        { field: "name", label: "Name", oldValue: null, newValue: fields.name },
        { field: "crNumber", label: "CR Number", oldValue: null, newValue: fields.crNumber ?? "—" },
        { field: "vatNumber", label: "VAT Number", oldValue: null, newValue: fields.vatNumber ?? "—" },
        { field: "contactPerson", label: "Contact Person", oldValue: null, newValue: fields.contactPerson ?? "—" },
        { field: "phone", label: "Phone", oldValue: null, newValue: fields.phone ?? "—" },
        { field: "email", label: "Email", oldValue: null, newValue: fields.email ?? "—" },
        { field: "city", label: "City", oldValue: null, newValue: fields.city ?? "—" },
      ],
      warnings: [],
      expectedResult: `New contractor "${fields.name}" will appear in the Companies list.`,
      expectedResultAr: `سيظهر المقاول الجديد "${fields.name}" في قائمة الشركات.`,
      hydratedParams: { input: fields },
    };
  },
  async execute(preview, user, req) {
    const input = preview.hydratedParams.input as CompanyInput;
    const refNumber = await nextRefNumber("COMPANY");
    const fields = pickCompanyFields(input);
    const company = await db.company.create({
      data: {
        refNumber,
        name: fields.name!,
        nameAr: fields.nameAr,
        legalName: fields.legalName,
        crNumber: fields.crNumber,
        vatNumber: fields.vatNumber,
        industry: fields.industry,
        country: fields.country,
        city: fields.city,
        address: fields.address,
        postalCode: fields.postalCode,
        phone: fields.phone,
        email: fields.email,
        website: fields.website,
        contactPerson: fields.contactPerson,
        contactPhone: fields.contactPhone,
        contactEmail: fields.contactEmail,
        status: fields.status!,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
    await copilotAudit({
      user,
      action: "CREATE_COMPANY",
      entity: "COMPANY",
      entityId: company.id,
      entityRef: company.refNumber,
      description: `AI created contractor ${company.refNumber} (${company.name})`,
      descriptionAr: `أنشأ الذكاء الاصطناعي مقاول ${company.refNumber} (${company.name})`,
      req,
      newValue: fields,
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "CONTRACTOR_CREATE",
      message: `Contractor ${company.refNumber} (${company.name}) created.`,
      messageAr: `تم إنشاء المقاول ${company.refNumber} (${company.name}).`,
      results: [{ entity: "COMPANY", id: company.id, refNumber: company.refNumber, description: company.name }],
    };
  },
};

// ─── CONTRACTOR_EDIT ──────────────────────────────────────────────────────
interface CompanyEditInput {
  companyId: string;
  changes: Partial<CompanyInput>;
}
const editContractor: ActionHandler<CompanyEditInput> = {
  type: "CONTRACTOR_EDIT",
  category: "CONTRACTORS",
  description: "Edit a contractor's profile (contact, address, CR/VAT numbers, status).",
  descriptionAr: "تعديل ملف المقاول (الاتصال، العنوان، أرقام السجل/الضريبة، الحالة).",
  resolvePermission: () => ({ module: "companies", action: "edit" }),
  async preparePreview(input, user) {
    if (!input.companyId) throw new ActionError("companyId is required", 422, "VALIDATION_ERROR");
    if (!input.changes || Object.keys(input.changes).length === 0) {
      throw new ActionError("No changes provided", 422, "VALIDATION_ERROR");
    }
    // Contractor scoping — only edit own company
    const scope = user.role === "CONTRACTOR" && user.companyId
      ? { id: user.companyId }
      : { id: input.companyId };
    const company = await db.company.findFirst({ where: { ...scope, deletedAt: null } });
    if (!company) throw new ActionError("Company not found", 404, "NOT_FOUND");

    const allowed: Array<keyof CompanyInput> = [
      "name", "nameAr", "legalName", "crNumber", "vatNumber", "industry",
      "country", "city", "address", "postalCode", "phone", "email", "website",
      "contactPerson", "contactPhone", "contactEmail", "status",
    ];
    const changes: Record<string, unknown> = {};
    for (const k of allowed) {
      if (input.changes[k] !== undefined) changes[k] = input.changes[k]!;
    }
    if (Object.keys(changes).length === 0) {
      throw new ActionError("No editable fields supplied", 422, "VALIDATION_ERROR");
    }
    if (changes.crNumber) {
      const dup = await db.company.findFirst({
        where: { crNumber: changes.crNumber as string, deletedAt: null, NOT: { id: company.id } },
      });
      if (dup) throw new ActionError(`CR number already used by ${dup.refNumber}`, 400, "DUPLICATE_CR");
    }
    const changeRows = Object.entries(changes).map(([k, v]) => ({
      field: k,
      label: k,
      oldValue: (company as Record<string, unknown>)[k] ?? null,
      newValue: v,
    }));
    return {
      actionType: "CONTRACTOR_EDIT",
      title: "Edit Contractor",
      titleAr: "تعديل المقاول",
      summary: `Update ${Object.keys(changes).length} field(s) on contractor ${company.refNumber}.`,
      summaryAr: `تحديث ${Object.keys(changes).length} حقل(حقول) للمقاول ${company.refNumber}.`,
      affectedRecords: [
        { entity: "COMPANY", refNumber: company.refNumber, description: company.name },
      ],
      changes: changeRows,
      warnings: [],
      expectedResult: `Contractor ${company.refNumber} will reflect the new values.`,
      expectedResultAr: `سيعكس المقاول ${company.refNumber} القيم الجديدة.`,
      hydratedParams: { companyId: company.id, changes },
    };
  },
  async execute(preview, user, req) {
    const companyId = preview.hydratedParams.companyId as string;
    const changes = preview.hydratedParams.changes as Record<string, unknown>;
    const before = await db.company.findUnique({ where: { id: companyId } });
    if (!before) throw new ActionError("Company no longer exists", 404, "NOT_FOUND");
    const updated = await db.company.update({
      where: { id: companyId },
      data: { ...changes, updatedBy: user.id },
    });
    await copilotAudit({
      user,
      action: "UPDATE_COMPANY",
      entity: "COMPANY",
      entityId: updated.id,
      entityRef: updated.refNumber,
      description: `AI updated contractor ${updated.refNumber}`,
      descriptionAr: `حدّث الذكاء الاصطناعي المقاول ${updated.refNumber}`,
      req,
      oldValue: before,
      newValue: updated,
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "CONTRACTOR_EDIT",
      message: `Contractor ${updated.refNumber} updated.`,
      messageAr: `تم تحديث المقاول ${updated.refNumber}.`,
      results: [{ entity: "COMPANY", id: updated.id, refNumber: updated.refNumber, description: updated.name }],
    };
  },
};

// CONTRACTOR_UPDATE is an alias of CONTRACTOR_EDIT (the spec lists both as
// separate actions; functionally identical — edit a contractor's data).
const updateContractor: ActionHandler<CompanyEditInput> = {
  ...editContractor,
  type: "CONTRACTOR_UPDATE",
  description: "Update contractor data (alias of CONTRACTOR_EDIT).",
  descriptionAr: "تحديث بيانات المقاول (نفس تعديل المقاول).",
};

export const contractorActions: ActionHandler<any>[] = [createContractor, editContractor, updateContractor];
